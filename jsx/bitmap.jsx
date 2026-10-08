/*
 * PaperFig for Illustrator host helpers.
 * GPL-3.0 ExtendScript (ES3-compatible); see LICENSE.
 *
 * Limits (see README):
 * - Linked PlacedItem: Apply place-replaces with a new linked file (unique name)
 *   so Illustrator must reload pixels; falls back to relink+verify.
 * - Embedded PlacedItem / RasterItem: staged via imageCapture as PNG, with
 *   duplicate-to-temp-doc + ExportOptionsPNG24 fallback; replace swaps to a
 *   new linked PlacedItem preserving geometricBounds. Layer/mask/clip stacks
 *   may need manual cleanup. Unsaved documents stage into durable fallback dir.
 * - Panel preview/Apply (0.3.0+): Canvas pipeline for JPG/PNG/GIF/BMP (no Fiji);
*   preview display aspect follows artboard geometry when file pixels disagree;
 *   captureSelectedForPanelPreview is the middle fallback (AI capture → temp PNG);
 *   Fiji panel proxy is last resort for complex / undecodable sources.
 * - GroupItem / nested groups: bitmaps are found recursively; replace targets
 *   the bitmap item itself without dissolving the parent group.
 */

var SCI_BITMAP_HOST_VERSION = "1.2.5";
if (typeof sciBitmapIdentityRegistry === "undefined") {
    var sciBitmapIdentityRegistry = { docs: [], items: [], epoch: String(new Date().getTime()) };
}

function sciBitmapSessionId(list, object, prefix) {
    var i;
    for (i = 0; i < list.length; i++) { if (list[i] === object) { return prefix + i; } }
    list.push(object);
    return prefix + (list.length - 1);
}

function sciBitmapEscapeString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")
        .replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function sciBitmapJSON(value) {
    var kind = typeof value;
    var parts;
    var key;
    var i;
    if (value === null) { return "null"; }
    if (kind === "string") { return "\"" + sciBitmapEscapeString(value) + "\""; }
    if (kind === "number") { return isFinite(value) ? String(value) : "null"; }
    if (kind === "boolean") { return value ? "true" : "false"; }
    if (value instanceof Array) {
        parts = [];
        for (i = 0; i < value.length; i += 1) { parts.push(sciBitmapJSON(value[i])); }
        return "[" + parts.join(",") + "]";
    }
    if (kind === "object") {
        parts = [];
        for (key in value) {
            if (value.hasOwnProperty(key) && typeof value[key] !== "undefined") {
                parts.push("\"" + sciBitmapEscapeString(key) + "\":" + sciBitmapJSON(value[key]));
            }
        }
        return "{" + parts.join(",") + "}";
    }
    return "null";
}

function sciBitmapResult(payload) { return sciBitmapJSON(payload); }
function sciBitmapFailure(error) {
    return sciBitmapResult({ ok: false, error: error && error.message ? error.message : String(error) });
}

function sciBitmapIsBitmap(item) {
    return item && (item.typename === "PlacedItem" || item.typename === "RasterItem");
}

/*
 * Recursively collect PlacedItem / RasterItem from a selection or pageItems
 * list. Nested GroupItem (including clipped groups) are walked via pageItems.
 * Each entry: { item, inGroup }.
 */
function sciBitmapCollectBitmaps(items, inGroup, out) {
    var i;
    var child;
    var nested;
    if (!items) { return out; }
    if (!out) { out = []; }
    for (i = 0; i < items.length; i += 1) {
        child = items[i];
        if (!child) { continue; }
        if (sciBitmapIsBitmap(child)) {
            out.push({ item: child, inGroup: !!inGroup });
        } else if (child.typename === "GroupItem") {
            try {
                nested = child.pageItems;
                if (nested && nested.length) {
                    sciBitmapCollectBitmaps(nested, true, out);
                }
            } catch (ignoreGroup) {}
        }
    }
    return out;
}

function sciBitmapFirstBitmap(selection) {
    var found = sciBitmapCollectBitmaps(selection, false, []);
    return found.length ? found[0].item : null;
}

function sciBitmapFirstBitmapEntry(selection) {
    var found = sciBitmapCollectBitmaps(selection, false, []);
    return found.length ? found[0] : null;
}

function sciBitmapPlacedLinked(item) {
    var source;
    if (!item || item.typename !== "PlacedItem") { return null; }
    try {
        if (item.embedded === true) { return null; }
        source = item.file;
        if (source && source.exists) { return source; }
    } catch (ignore) {}
    return null;
}

function sciBitmapMatrixValues(item) {
    try { var m = item.matrix; return [m.mValueA,m.mValueB,m.mValueC,m.mValueD,m.mValueTX,m.mValueTY]; }
    catch (ignore) { return []; }
}

function sciBitmapItemRotationDeg(item) {
    var m;
    var deg = 0;
    try {
        m = item.matrix;
        /* Illustrator: x' = a*x + c*y + tx; y' = b*x + d*y + ty. CCW degrees. */
        deg = Math.atan2(Number(m.mValueB), Number(m.mValueA)) * 180 / Math.PI;
        if (!isFinite(deg)) { deg = 0; }
    } catch (ignore) { deg = 0; }
    return deg;
}

function sciBitmapDocIdentity() {
    var doc = app.activeDocument;
    var name = String(doc.name || "");
    var id = "";
    try { id = doc.fullName.fsName; } catch (ignore) {}
    if (!id) { id = sciBitmapSessionId(sciBitmapIdentityRegistry.docs, doc, "session:" + sciBitmapIdentityRegistry.epoch + ":"); }
    return { docName: name, docId: id, docSessionId: sciBitmapSessionId(sciBitmapIdentityRegistry.docs, doc, "doc-session:" + sciBitmapIdentityRegistry.epoch + ":") };
}

function sciBitmapItemUuid(item) {
    var u = "";
    try { if (item.uuid != null) { u = String(item.uuid); } } catch (ignore) {}
    try { if (!u && item.uuid != null) { u = String(item.uuid); } } catch (ignore2) {}
    return u;
}

function sciBitmapObjectKey(item, sourcePath, bounds, widthPt, heightPt) {
    var uuid = sciBitmapItemUuid(item);
    var doc = sciBitmapDocIdentity();
    return doc.docId + "|" + (uuid ? "uuid:" + uuid :
        sciBitmapSessionId(sciBitmapIdentityRegistry.items, item, "item:" + sciBitmapIdentityRegistry.epoch + ":"));
}


/*
 * Read width×height from a linked image file on disk (PNG/JPEG/GIF/BMP/TIFF headers).
 * Used when Illustrator does not expose pixel metadata on the PlacedItem.
 */
function sciBitmapProbeFilePixels(filePath) {
    var f, bytes, i, b0, b1, le, u16, u32, off, count, entry, tag, typ, nvals, unit, valueOff, value, w, h;
    if (!filePath) { return null; }
    f = new File(filePath);
    if (!f.exists) { return null; }
    try {
        f.encoding = "BINARY";
        if (!f.open("r")) { return null; }
        bytes = f.read(Math.min(65536, f.length));
        f.close();
    } catch (eOpen) {
        try { f.close(); } catch (ignoreClose) {}
        return null;
    }
    if (!bytes || bytes.length < 10) { return null; }
    function u8(pos) {
        return bytes.charCodeAt(pos) & 255;
    }
    function be16(pos) { return (u8(pos) << 8) | u8(pos + 1); }
    function le16(pos) { return u8(pos) | (u8(pos + 1) << 8); }
    function be32(pos) { return ((u8(pos) << 24) | (u8(pos + 1) << 16) | (u8(pos + 2) << 8) | u8(pos + 3)) >>> 0; }
    function le32(pos) { return (u8(pos) | (u8(pos + 1) << 8) | (u8(pos + 2) << 16) | (u8(pos + 3) << 24)) >>> 0; }
    /* PNG */
    if (bytes.length >= 24 &&
        u8(0) === 0x89 && u8(1) === 0x50 && u8(2) === 0x4E && u8(3) === 0x47) {
        return { width: be32(16), height: be32(20) };
    }
    /* JPEG */
    if (u8(0) === 0xFF && u8(1) === 0xD8) {
        i = 2;
        while (i + 9 < bytes.length) {
            if (u8(i) !== 0xFF) { break; }
            while (i < bytes.length && u8(i) === 0xFF) { i += 1; }
            if (i >= bytes.length) { break; }
            b1 = u8(i); i += 1;
            if (b1 === 0xD9 || b1 === 0xDA) { break; }
            if (b1 === 0x01 || (b1 >= 0xD0 && b1 <= 0xD7)) { continue; }
            if (i + 1 >= bytes.length) { break; }
            nvals = be16(i);
            if (nvals < 2 || i + nvals > bytes.length) { break; }
            if (b1 === 0xC0 || b1 === 0xC1 || b1 === 0xC2 || b1 === 0xC3 ||
                b1 === 0xC5 || b1 === 0xC6 || b1 === 0xC7 || b1 === 0xC9 ||
                b1 === 0xCA || b1 === 0xCB || b1 === 0xCD || b1 === 0xCE || b1 === 0xCF) {
                if (nvals >= 7) {
                    return { width: be16(i + 5), height: be16(i + 3) };
                }
                break;
            }
            i += nvals;
        }
        return null;
    }
    /* GIF */
    if (bytes.length >= 10 && bytes.substring(0, 4) === "GIF8") {
        return { width: le16(6), height: le16(8) };
    }
    /* BMP */
    if (bytes.length >= 26 && u8(0) === 0x42 && u8(1) === 0x4D) {
        if (le32(14) === 12) {
            return { width: le16(18), height: le16(20) };
        }
        w = le32(18); h = le32(22);
        if (h > 0x7FFFFFFF) { h = (0x100000000 - h); }
        return { width: w, height: h };
    }
    /* TIFF classic (not BigTIFF) */
    if (bytes.length >= 8 && ((u8(0) === 0x49 && u8(1) === 0x49) || (u8(0) === 0x4D && u8(1) === 0x4D))) {
        le = (u8(0) === 0x49);
        u16 = le ? le16 : be16;
        u32 = le ? le32 : be32;
        if (u16(2) !== 42) { return null; }
        off = u32(4);
        if (off + 2 > bytes.length) { return null; }
        count = u16(off);
        w = 0; h = 0;
        for (i = 0; i < count; i += 1) {
            entry = off + 2 + i * 12;
            if (entry + 12 > bytes.length) { break; }
            tag = u16(entry);
            if (tag !== 256 && tag !== 257) { continue; }
            typ = u16(entry + 2);
            nvals = u32(entry + 4);
            unit = (typ === 3) ? 2 : ((typ === 4) ? 4 : 0);
            if (!unit || nvals < 1) { continue; }
            valueOff = (unit * nvals > 4) ? u32(entry + 8) : (entry + 8);
            if (valueOff + unit > bytes.length) { continue; }
            value = (typ === 3) ? u16(valueOff) : u32(valueOff);
            if (tag === 256) { w = value; }
            if (tag === 257) { h = value; }
        }
        if (w > 0 && h > 0) { return { width: w, height: h }; }
    }
    return null;
}

function sciBitmapItemInfo(item, inGroup) {
    var sourcePath = "";
    var sourceName = "";
    var bounds = item.geometricBounds;
    var linked = sciBitmapPlacedLinked(item);
    var widthPt;
    var heightPt;
    var doc;
    var uuid;
    var objectKey;
    var filePx = null;
    var pixelWidth = 0;
    var pixelHeight = 0;
    try {
        if (linked) {
            sourcePath = linked.fsName;
            sourceName = linked.name;
        } else if (item.typename === "PlacedItem" && item.file) {
            sourcePath = item.file.fsName;
            sourceName = item.file.name;
        }
    } catch (ignore) {}
    try {
        if (sourcePath) { filePx = sciBitmapProbeFilePixels(sourcePath); }
    } catch (ignorePx) { filePx = null; }
    if (filePx && filePx.width > 0 && filePx.height > 0) {
        pixelWidth = Number(filePx.width) || 0;
        pixelHeight = Number(filePx.height) || 0;
    }
    widthPt = Math.abs(bounds[2] - bounds[0]);
    heightPt = Math.abs(bounds[1] - bounds[3]);
    if (widthPt < 1) { widthPt = Math.abs(Number(item.width)) || 1; }
    if (heightPt < 1) { heightPt = Math.abs(Number(item.height)) || 1; }
    doc = sciBitmapDocIdentity();
    uuid = sciBitmapItemUuid(item);
    objectKey = sciBitmapObjectKey(item, sourcePath, bounds, widthPt, heightPt);
    return {
        typename: item.typename,
        name: item.name || sourceName || "",
        sourcePath: sourcePath,
        embedded: item.typename === "RasterItem" || (item.typename === "PlacedItem" && item.embedded === true),
        linked: !!linked,
        inGroup: !!inGroup,
        widthPt: widthPt,
        heightPt: heightPt,
        pixelWidth: pixelWidth,
        pixelHeight: pixelHeight,
        rotationDeg: sciBitmapItemRotationDeg(item),
        matrix: sciBitmapMatrixValues(item),
        bounds: [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])],
        docName: doc.docName,
        docId: doc.docId,
        docSessionId: doc.docSessionId,
        uuid: uuid,
        objectKey: objectKey
    };
}

function inspectSelectedBitmaps() {
    var selection;
    var found;
    var items = [];
    var i;
    try {
        if (app.documents.length === 0) { throw new Error("Open an Illustrator document first."); }
        selection = app.activeDocument.selection;
        if (!selection || selection.length === 0) {
            throw new Error("Select a linked or embedded image (PlacedItem/RasterItem), or a group containing one — not paths or text.");
        }
        found = sciBitmapCollectBitmaps(selection, false, []);
        for (i = 0; i < found.length; i += 1) {
            items.push(sciBitmapItemInfo(found[i].item, found[i].inGroup));
        }
        if (items.length === 0) {
            throw new Error("No bitmap in selection. Select a linked/embedded image (or a group containing one), not paths or text.");
        }
        return sciBitmapResult({ ok: true, count: items.length, items: items });
    } catch (error) { return sciBitmapFailure(error); }
}

/*
 * Short fingerprint of the current selection for CEP polling.
 * Changes when count, first item type, bounds, or linked source path change.
 */
function selectionFingerprint() {
    var selection;
    var found;
    var entry;
    var item;
    var info;
    var parts;
    try {
        if (app.documents.length === 0) {
            return sciBitmapResult({ ok: true, fingerprint: "nodoc" });
        }
        selection = app.activeDocument.selection;
        if (!selection || selection.length === 0) {
            return sciBitmapResult({ ok: true, fingerprint: "empty" });
        }
        found = sciBitmapCollectBitmaps(selection, false, []);
        if (found.length === 0) {
            parts = ["nobitmap", String(selection.length)];
            try { parts.push(selection[0].typename || "?"); } catch (ignoreType) {}
            return sciBitmapResult({ ok: true, fingerprint: parts.join("|") });
        }
        entry = found[0];
        item = entry.item;
        /* Cheap poll: identity + rounded geometry only.
           sciBitmapItemInfo reads the linked file header and blocks every button. */
        var key = sciBitmapObjectKey(item, "", null, 0, 0);
        var b;
        var m;
        var path = "";
        var mi;
        var mparts = [];
        function r1(n) {
            n = Number(n);
            if (!isFinite(n)) { return "0"; }
            return String(Math.round(n * 10) / 10);
        }
        try { b = item.geometricBounds; } catch (ignoreB) { b = [0, 0, 0, 0]; }
        m = sciBitmapMatrixValues(item);
        if (m && m.length) {
            for (mi = 0; mi < m.length; mi += 1) { mparts.push(r1(m[mi])); }
        }
        try {
            if (item.typename === "PlacedItem" && item.file) { path = String(item.file.fsName || ""); }
        } catch (ignorePath) { path = ""; }
        parts = [
            String(found.length),
            key,
            mparts.join(","),
            item.typename || "",
            entry.inGroup ? "g" : "t",
            [r1(b[0]), r1(b[1]), r1(b[2]), r1(b[3])].join(","),
            path,
            (item.typename === "RasterItem") ? "e" : "l"
        ];
        return sciBitmapResult({ ok: true, fingerprint: parts.join("|"), count: found.length });
    } catch (error) {
        return sciBitmapResult({ ok: true, fingerprint: "err:" + String(error && error.message ? error.message : error) });
    }
}

function sciBitmapTempDir() {
    try {
        return Folder.temp.fsName;
    } catch (e1) {
        return Folder.userData.fsName;
    }
}

function sciBitmapTempPngPath() {
    return sciBitmapTempDir() + "/paperfig-" + (new Date().getTime()) + ".png";
}

/*
 * Fallback: duplicate item into a temporary RGB document and export PNG24.
 * Used when imageCapture fails for embedded/raster content.
 */
function sciBitmapExportViaTempDoc(item, resolution) {
    var tempFile;
    var tempDoc;
    var dup;
    var bounds;
    var width;
    var height;
    var pngOpts;
    var prevDoc;
    var pad = 0;

    prevDoc = app.activeDocument;
    bounds = item.geometricBounds;
    width = Math.abs(bounds[2] - bounds[0]);
    height = Math.abs(bounds[1] - bounds[3]);
    if (width < 1) { width = Math.abs(Number(item.width)) || 1; }
    if (height < 1) { height = Math.abs(Number(item.height)) || 1; }

    tempFile = new File(sciBitmapTempPngPath());
    tempDoc = app.documents.add(
        DocumentColorSpace.RGB,
        width + pad * 2,
        height + pad * 2
    );
    try {
        dup = item.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING);
        try {
            dup.position = [pad, tempDoc.height - pad];
        } catch (posErr) {
            try { dup.translate(pad - bounds[0], (tempDoc.height - pad) - bounds[1]); } catch (ignoreTranslate) {}
        }
        try { app.activeDocument = tempDoc; } catch (ignoreActivate) {}
        pngOpts = new ExportOptionsPNG24();
        pngOpts.antiAliasing = true;
        pngOpts.transparency = true;
        pngOpts.artBoardClipping = true;
        try { pngOpts.horizontalScale = 100; pngOpts.verticalScale = 100; } catch (ignoreScale) {}
        /* DPI hint via resolution when supported; otherwise 100% of artboard pts. */
        try {
            if (resolution && resolution > 0) {
                pngOpts.horizontalScale = (resolution / 72) * 100;
                pngOpts.verticalScale = (resolution / 72) * 100;
            }
        } catch (ignoreDpi) {}
        tempDoc.exportFile(tempFile, ExportType.PNG24, pngOpts);
    } finally {
        try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (ignoreClose) {}
        try { if (prevDoc) { app.activeDocument = prevDoc; } } catch (ignoreRestore) {}
    }
    if (!tempFile.exists) {
        throw new Error("PNG24 temp-doc export failed for embedded/raster content.");
    }
    return tempFile;
}

function sciBitmapStageEmbedded(item, resolution) {
    // Isolate the selected item: document.imageCapture(bounds) includes overlapping artwork.
    var file = sciBitmapExportViaTempDoc(item, resolution);
    return { file:file, method:"png24-isolated", dpi:resolution,
        note:"Selected item rendered in an isolated temporary RGB document." };
}

function exportSelectedBitmapTemp(requestedFormat, dpi) {
    var selection;
    var entry;
    var item;
    var linked;
    var staged;
    var resolution = Number(dpi) || 300;
    var doc;
    try {
        if (app.documents.length === 0) { throw new Error("Open an Illustrator document first."); }
        doc = app.activeDocument;
        selection = doc.selection;
        entry = sciBitmapFirstBitmapEntry(selection);
        if (!entry) {
            throw new Error("No bitmap in selection. Select a linked/embedded image (or a group containing one), not paths or text.");
        }
        item = entry.item;

        linked = sciBitmapPlacedLinked(item);
        if (linked) {
            return sciBitmapResult({
                ok: true,
                path: linked.fsName,
                staged: false,
                linked: true,
                inGroup: !!entry.inGroup,
                typename: item.typename,
                bitmapCount: sciBitmapCollectBitmaps(selection, false, []).length,
                requestedFormat: String(requestedFormat || "TIFF").toUpperCase(),
                note: "Using linked source; Fiji/Bio-Formats will handle conversion."
            });
        }

        staged = sciBitmapStageEmbedded(item, resolution);
        return sciBitmapResult({
            ok: true,
            path: staged.file.fsName,
            staged: true,
            linked: false,
            inGroup: !!entry.inGroup,
            typename: item.typename,
            bitmapCount: sciBitmapCollectBitmaps(selection, false, []).length,
            actualFormat: "PNG",
            requestedFormat: String(requestedFormat || "TIFF").toUpperCase(),
            dpi: staged.dpi || resolution,
            method: staged.method,
            note: staged.note || "Embedded/raster staged as PNG; pixel dims depend on bounds×DPI."
        });
    } catch (error) { return sciBitmapFailure(error); }
}

/*
 * Panel canvas preview middle fallback (0.2.7+): imageCapture the selected
 * PlacedItem / RasterItem geometricBounds to a temp PNG (artboard pixels).
 * CEP tries linked-file → Canvas first for PNG/JPEG/GIF/BMP / simple 8-bit TIFF;
 * this host helper runs when that fails or for embedded/complex sources.
 * Optional maxEdge (~800). PNG24 temp-doc fallback if imageCapture fails.
 */
function capturePanelPreviewForKey(objectKey, maxEdge, dpiHint) {
    try {
        if (!app.documents.length) { throw new Error("Document closed."); }
        var entry = sciBitmapFirstBitmapEntry(app.activeDocument.selection);
        if (!entry || sciBitmapItemInfo(entry.item,entry.inGroup).objectKey !== objectKey) {
            throw new Error("Selection changed before capture. Refresh preview.");
        }
        return captureSelectedForPanelPreview(maxEdge,dpiHint);
    } catch(error) { return sciBitmapFailure(error); }
}

function captureSelectedForPanelPreview(maxEdge, dpiHint) {
    var selection;
    var entry;
    var item;
    var bounds;
    var widthPt;
    var heightPt;
    var longest;
    var edge = Math.max(64, Number(maxEdge) || 800);
    var hint = Number(dpiHint) || 0;
    var resolution;
    var staged;
    var linked;
    try {
        if (app.documents.length === 0) { throw new Error("Open an Illustrator document first."); }
        selection = app.activeDocument.selection;
        entry = sciBitmapFirstBitmapEntry(selection);
        if (!entry) {
            throw new Error("No bitmap in selection. Select a linked/embedded image (or a group containing one), not paths or text.");
        }
        item = entry.item;
        bounds = item.geometricBounds;
        widthPt = Math.abs(bounds[2] - bounds[0]);
        heightPt = Math.abs(bounds[1] - bounds[3]);
        if (widthPt < 1) { widthPt = Math.abs(Number(item.width)) || 1; }
        if (heightPt < 1) { heightPt = Math.abs(Number(item.height)) || 1; }
        longest = widthPt > heightPt ? widthPt : heightPt;
        if (longest < 1) { longest = 1; }
        /* pixels ≈ pt * resolution / 72 → resolution ≈ edge * 72 / longestPt */
        resolution = (edge * 72) / longest;
        if (hint > 0 && resolution > hint) { resolution = hint; }
        if (resolution < 36) { resolution = 36; }
        if (resolution > 600) { resolution = 600; }
        resolution = Math.round(resolution);

        staged = sciBitmapStageEmbedded(item, resolution);
        linked = sciBitmapPlacedLinked(item);
        return sciBitmapResult({
            ok: true,
            path: staged.file.fsName,
            staged: true,
            method: staged.method || "imageCapture",
            dpi: staged.dpi || resolution,
            maxEdge: edge,
            widthPt: widthPt,
            heightPt: heightPt,
            linked: !!linked,
            embedded: item.typename === "RasterItem" || (item.typename === "PlacedItem" && item.embedded === true),
            inGroup: !!entry.inGroup,
            typename: item.typename,
            sourcePath: linked ? linked.fsName : "",
            note: staged.note || "Panel preview via Illustrator imageCapture."
        });
    } catch (error) { return sciBitmapFailure(error); }
}

/*
 * Replace the first selected bitmap with filePath, retaining on-artboard geometry.
 * Works when the bitmap is nested in a GroupItem — replaces that item only.
 * PlacedItem (linked or embedded): assign .file (relink).
 * RasterItem: insert linked PlacedItem with same position/size, remove raster.
 * Optional rotateDegrees: geometric item.rotate (Illustrator CCW+), NOT pixel rotate.
 * Optional flipH / flipV: geometric item.resize(-100|100, …) mirrors — NOT Fiji pixels.
 * Wrapped in UndoModes.ENTIRE_SCRIPT so Illustrator Ctrl+Z undoes Apply as one step.
 */


function sciBitmapNormalizePath(p) {
    p = String(p || "").replace(/\\/g, "/");
    if (p.length >= 2 && p.charAt(1) === ":") {
        p = p.charAt(0).toLowerCase() + p.substring(1);
    }
    return p;
}
function sciBitmapPathsEqual(a, b) {
    return sciBitmapNormalizePath(a) === sciBitmapNormalizePath(b);
}
function sciBitmapLinkedFsName(item) {
    try {
        if (item && item.file) { return String(item.file.fsName || ""); }
    } catch (ignore) {}
    return "";
}
function sciBitmapAssertLinkedPath(item, expectedFile) {
    var expected = expectedFile && expectedFile.fsName ? expectedFile.fsName : String(expectedFile || "");
    var actual = sciBitmapLinkedFsName(item);
    var exists = false;
    try { exists = !!(item && item.file && item.file.exists); } catch (ignoreEx) {}
    if (!actual) {
        throw new Error("Illustrator did not attach a link after replace. Expected: " + expected);
    }
    if (!sciBitmapPathsEqual(actual, expected)) {
        throw new Error("Artboard link path mismatch. Expected: " + expected + " · Got: " + actual);
    }
    if (!exists) {
        throw new Error("Linked file missing after replace (display would break): " + actual);
    }
    return actual;
}

/*
 * Force Illustrator to load new pixels: place a NEW PlacedItem, copy geometry,
 * remove the old one. Relink alone can return ok while the screen keeps a stale proxy.
 * Does NOT delete the replacement file — only the previous artwork object.
 */

/* Relink/Raster fallback: size upright to crop aspect, center on prior frame. */
function sciBitmapSizeUprightInPlace(item, pixelWidth, pixelHeight, oldWidth, oldHeight, oldPosition) {
    var bounds;
    var cx;
    var cy;
    var frameW;
    var frameH;
    var aspect;
    var pw = Number(pixelWidth) || 0;
    var ph = Number(pixelHeight) || 0;
    var newW;
    var newH;
    var scale;
    try {
        bounds = item.geometricBounds;
        cx = (bounds[0] + bounds[2]) / 2;
        cy = (bounds[1] + bounds[3]) / 2;
        frameW = Math.abs(bounds[2] - bounds[0]);
        frameH = Math.abs(bounds[1] - bounds[3]);
    } catch (ignoreB) {
        cx = oldPosition[0] + Math.abs(oldWidth) / 2;
        cy = oldPosition[1] - Math.abs(oldHeight) / 2;
        frameW = Math.abs(oldWidth) || 1;
        frameH = Math.abs(oldHeight) || 1;
    }
    if (pw > 0 && ph > 0) {
        aspect = pw / ph;
        /* Keep previous max-edge roughly; force crop aspect upright. */
        if (frameW / frameH > aspect) {
            newH = frameH;
            newW = newH * aspect;
        } else {
            newW = frameW;
            newH = newW / aspect;
        }
    } else {
        newW = frameW;
        newH = frameH;
    }
    item.width = newW;
    item.height = newH;
    item.position = [cx - newW / 2, cy + newH / 2];
    return item;
}

/*
 * After crop: place upright with aspect matching new pixels (Photoshop-like).
 * Do NOT FitCorners into the old rotated/sheared quad — that stretches crop
 * pixels into the previous diagonal frame.
 * Preserves approximate source scale (pt per intrinsic unit) and centers on
 * the previous geometricBounds center. Clears rotation/shear by using a fresh
 * PlacedItem (identity orientation) sized to crop aspect.
 */
function sciBitmapPlaceUprightCrop(item, file, pixelWidth, pixelHeight) {
    var bounds = item.geometricBounds;
    var cx = (bounds[0] + bounds[2]) / 2;
    var cy = (bounds[1] + bounds[3]) / 2;
    var frameW = Math.abs(bounds[2] - bounds[0]);
    var frameH = Math.abs(bounds[1] - bounds[3]);
    var oldIntrW = 0;
    var oldIntrH = 0;
    var scale = 1;
    var natW;
    var natH;
    var newW;
    var newH;
    var replacement;
    var pw = Number(pixelWidth) || 0;
    var ph = Number(pixelHeight) || 0;
    try {
        var corners = sciBitmapCorners(item);
        var ux = corners[1][0] - corners[0][0];
        var uy = corners[1][1] - corners[0][1];
        var vx = corners[3][0] - corners[0][0];
        var vy = corners[3][1] - corners[0][1];
        frameW = Math.sqrt(ux * ux + uy * uy);
        frameH = Math.sqrt(vx * vx + vy * vy);
    } catch (ignoreCorners) {}
    try {
        var box = item.boundingBox;
        if (box) {
            oldIntrW = Math.abs(box[2] - box[0]);
            oldIntrH = Math.abs(box[3] - box[1]);
        }
    } catch (ignoreBox) {}
    if (oldIntrW > 0.01 && oldIntrH > 0.01) {
        scale = 0.5 * ((frameW / oldIntrW) + (frameH / oldIntrH));
    } else if (pw > 0 && ph > 0 && frameW > 0 && frameH > 0) {
        /* Fallback when intrinsic box unavailable: fit crop aspect into old AABB. */
        scale = Math.min(frameW / pw, frameH / ph);
    }
    if (!(scale > 0) || !isFinite(scale)) { scale = 1; }
    try { item.__sciPlaceTarget = true; } catch (ignoreMark) {}
    try {
        replacement = app.activeDocument.placedItems.add();
        try {
            replacement.file = file;
        } catch (placeErr) {
            try { replacement.remove(); } catch (ignoreRm) {}
            throw new Error("Illustrator rejected linked file (path not accepted?): " + file.fsName + " — " + (placeErr.message || placeErr));
        }
        try {
            replacement.move(item, ElementPlacement.PLACEBEFORE);
        } catch (ignoreMove) {}
        try {
            var nbox = replacement.boundingBox;
            if (nbox) {
                natW = Math.abs(nbox[2] - nbox[0]);
                natH = Math.abs(nbox[3] - nbox[1]);
            }
        } catch (ignoreNat) {}
        if (!(natW > 0.01) || !(natH > 0.01)) {
            natW = Math.abs(Number(replacement.width)) || pw || 1;
            natH = Math.abs(Number(replacement.height)) || ph || 1;
        }
        if (pw > 0 && ph > 0) {
            /* Prefer explicit crop pixel aspect when AI reports odd natural size. */
            var reportedAspect = natW / natH;
            var wantedAspect = pw / ph;
            if (!(reportedAspect > 0) || Math.abs(reportedAspect - wantedAspect) / wantedAspect > 0.02) {
                natW = pw;
                natH = ph;
            }
        }
        newW = natW * scale;
        newH = natH * scale;
        if (!(newW > 0.01)) { newW = frameW > 0 ? frameW : natW; }
        if (!(newH > 0.01)) { newH = newW * (natH / natW); }
        replacement.width = newW;
        replacement.height = newH;
        /* AI position is top-left; Y grows upward so top = cy + height/2. */
        replacement.position = [cx - newW / 2, cy + newH / 2];
        sciBitmapAssertLinkedPath(replacement, file);
        try {
            item.remove();
        } catch (rmErr) {
            try { replacement.remove(); } catch (ignoreRm2) {}
            throw new Error("Could not remove previous placed item after upright crop place: " + (rmErr.message || rmErr));
        }
        return replacement;
    } finally {
        try { item.__sciPlaceTarget = false; } catch (ignoreClear) {}
    }
}

function sciBitmapPlaceReplaceExact(item, file, geomOpts) {
    var wanted = null;
    var hasCorners = false;
    var oldWidth = item.width;
    var oldHeight = item.height;
    var oldPosition = [item.position[0], item.position[1]];
    var replacement;
    var resetUpright = geomOpts && geomOpts.resetUpright;
    if (resetUpright) {
        return sciBitmapPlaceUprightCrop(item, file, geomOpts.pixelWidth, geomOpts.pixelHeight);
    }
    try {
        if (item.boundingBox && typeof item.transform === "function") {
            wanted = sciBitmapCorners(item);
            hasCorners = true;
        }
    } catch (ignoreCorners) {}
    /* Expando helps test hosts; real AI ignores unknown properties. */
    try { item.__sciPlaceTarget = true; } catch (ignoreMark) {}
    try {
    replacement = app.activeDocument.placedItems.add();
    try {
        replacement.file = file;
    } catch (placeErr) {
        try { replacement.remove(); } catch (ignoreRm) {}
        throw new Error("Illustrator rejected linked file (path not accepted?): " + file.fsName + " — " + (placeErr.message || placeErr));
    }
    try {
        replacement.move(item, ElementPlacement.PLACEBEFORE);
    } catch (ignoreMove) {}
    if (hasCorners) {
        try {
            sciBitmapFitCorners(replacement, wanted);
        } catch (fitErr) {
            replacement.width = oldWidth;
            replacement.height = oldHeight;
            replacement.position = oldPosition;
        }
    } else {
        replacement.width = oldWidth;
        replacement.height = oldHeight;
        replacement.position = oldPosition;
    }
    sciBitmapAssertLinkedPath(replacement, file);
    try {
        item.remove();
    } catch (rmErr) {
        try { replacement.remove(); } catch (ignoreRm2) {}
        throw new Error("Could not remove previous placed item after place: " + (rmErr.message || rmErr));
    }
    return replacement;
    } finally {
        try { item.__sciPlaceTarget = false; } catch (ignoreClear) {}
    }
}

/*
 * Force Illustrator to resolve and paint the newly linked pixels.
 * item.relink() + a lone app.redraw() often return before the artboard
 * shows the new raster (especially from Downloads / synced folders).
 * Request one redraw after a successful replacement without nudging geometry.
 */
function sciBitmapForceArtboardRefresh(item) {
    var t0=new Date().getTime();
    // A completed replacement needs one repaint, never artificial geometry edits.
    try { app.redraw(); } catch(ignore) {}
    return new Date().getTime()-t0;
}

function sciBitmapReplaceSelectedCore(filePath, rotateDegrees, flipH, flipV, targetEntry, geomOpts) {
    var file = new File(filePath);
    var selection;
    var entry;
    var item;
    var replacement;
    var finalItem;
    var oldWidth;
    var oldHeight;
    var oldPosition;
    var wasEmbedded = false;
    var parentGroup = null;
    var angle = Number(rotateDegrees) || 0;
    var doFlipH = !!flipH;
    var doFlipV = !!flipV;
    var mode;
    var inGroup;
    var tRelink0;
    var relinkMs = 0;
    var redrawMs = 0;
    var resetUpright = false;
    var cropPixelW = 0;
    var cropPixelH = 0;
    if (geomOpts && typeof geomOpts === "string") {
        try { geomOpts = eval("(" + geomOpts + ")"); } catch (ignoreGeomParse) { geomOpts = null; }
    }
    if (geomOpts && geomOpts.resetUpright) {
        resetUpright = true;
        cropPixelW = Number(geomOpts.pixelWidth) || 0;
        cropPixelH = Number(geomOpts.pixelHeight) || 0;
    }
    if (app.documents.length === 0) { throw new Error("Open an Illustrator document first."); }
    if (!file.exists) { throw new Error("Replacement file does not exist: " + file.fsName); }
    selection = app.activeDocument.selection;
    entry = targetEntry || sciBitmapFirstBitmapEntry(selection);
    if (!entry) {
        throw new Error("No bitmap in selection. Select a linked/embedded image (or a group containing one), not paths or text.");
    }
    item = entry.item;
    inGroup = !!entry.inGroup;

    tRelink0 = new Date().getTime();
    if (item.typename === "PlacedItem") {
        try { wasEmbedded = item.embedded === true; } catch (ignore) {}
        oldWidth = item.width; oldHeight = item.height;
        oldPosition = [item.position[0], item.position[1]];
        /* 0.5.6: prefer place+remove so AI must reload pixels (not stale relink proxy).
         * 0.6.4 crop: upright reset (skip FitCorners stretch into old diagonal frame). */
        try {
            finalItem = sciBitmapPlaceReplaceExact(item, file, resetUpright ? { resetUpright: true, pixelWidth: cropPixelW, pixelHeight: cropPixelH } : null);
            mode = wasEmbedded ? (resetUpright ? "embedded-placed-upright" : "embedded-placed") : (resetUpright ? "placed-upright" : "placed-replaced");
        } catch (placeErr) {
            /* Fallback: relink in place, then verify the link really points at the new file. */
            try {
                if (resetUpright) {
                    item.relink(file);
                    finalItem = sciBitmapSizeUprightInPlace(item, cropPixelW, cropPixelH, oldWidth, oldHeight, oldPosition);
                } else if (item.boundingBox && typeof item.transform === 'function') {
                    sciBitmapRelinkExact(item, file);
                    finalItem = item;
                } else {
                    item.relink(file);
                    item.width = oldWidth; item.height = oldHeight; item.position = oldPosition;
                    finalItem = item;
                }
                sciBitmapAssertLinkedPath(finalItem, file);
                mode = wasEmbedded ? (resetUpright ? "embedded-relinked-upright" : "embedded-relinked") : (resetUpright ? "relinked-upright" : "relinked");
            } catch (relinkErr) {
                throw new Error(
                    "Place-replace failed (" + (placeErr.message || placeErr) +
                    "); relink also failed (" + (relinkErr.message || relinkErr) +
                    "). Output kept at: " + file.fsName
                );
            }
        }
        if (!targetEntry && finalItem) {
            try { finalItem.selected = true; } catch (ignoreSel) {}
        }
    } else {
        /* RasterItem: place a linked PlacedItem before it, then remove raster.
         * Prefer same parent container so groups/clips stay intact. */
        oldWidth = item.width;
        oldHeight = item.height;
        oldPosition = [item.position[0], item.position[1]];
        try {
            if (item.parent && item.parent.typename === "GroupItem") {
                parentGroup = item.parent;
            }
        } catch (ignoreParent) {}

        if (parentGroup) {
            replacement = app.activeDocument.placedItems.add();
        } else {
            replacement = app.activeDocument.placedItems.add();
        }
        replacement.file = file;
        try {
            replacement.move(item, ElementPlacement.PLACEBEFORE);
        } catch (moveError) {
            try { replacement.remove(); } catch (ignoreRemove) {}
            throw new Error("Could not preserve original stacking order: " + moveError.message);
        }
        if (resetUpright) {
            sciBitmapSizeUprightInPlace(replacement, cropPixelW, cropPixelH, oldWidth, oldHeight, oldPosition);
            mode = "replaced-upright";
        } else {
            replacement.position = oldPosition;
            replacement.width = oldWidth;
            replacement.height = oldHeight;
            mode = "replaced-with-linked";
        }
        item.remove();
        replacement.selected = true;
        finalItem = replacement;
    }

    /* Crop upright already cleared rotate/shear; skip deferred geometric rotate/flip. */
    if (resetUpright) {
        angle = 0;
        doFlipH = false;
        doFlipV = false;
    }

    /* Geometric rotation on the artwork item (not Fiji pixels). Positive = CCW. */
    if (finalItem && Math.abs(angle) > 0.0001) {
        try {
            finalItem.rotate(angle);
        } catch (rotErr) {
            throw new Error("Illustrator rotate failed: " + (rotErr && rotErr.message ? rotErr.message : String(rotErr)));
        }
    }

    /* Geometric flip (Illustrator resize mirror). Applied after rotate. */
    if (finalItem && (doFlipH || doFlipV)) {
        try {
            finalItem.resize(doFlipH ? -100 : 100, doFlipV ? -100 : 100);
        } catch (flipErr) {
            throw new Error("Illustrator flip failed: " + (flipErr && flipErr.message ? flipErr.message : String(flipErr)));
        }
    }
    relinkMs = new Date().getTime() - tRelink0;

    /* Verify the live object really links the durable output — no silent false success. */
    sciBitmapAssertLinkedPath(finalItem, file);

    /* relink/file= often returns before pixels paint; force resolve + redraw and time it. */
    redrawMs = sciBitmapForceArtboardRefresh(finalItem);
    return {
        ok: true,
        path: file.fsName,
        linkedPath: sciBitmapLinkedFsName(finalItem),
        mode: mode,
        inGroup: inGroup,
        rotated: angle,
        flipH: doFlipH,
        flipV: doFlipV,
        uprightCrop: !!resetUpright,
        relinkMs: relinkMs,
        redrawMs: redrawMs,
        info: sciBitmapItemInfo(finalItem, inGroup)
    };
}


/*
 * Capture a lock token for the current first bitmap (doc + object identity + source).
 * CEP Apply / artboard preview / Cancel-preview must re-verify before write-back.
 */
function captureSelectionLock() {
    var selection;
    var entry;
    var info;
    try {
        if (app.documents.length === 0) { throw new Error("Open an Illustrator document first."); }
        selection = app.activeDocument.selection;
        entry = sciBitmapFirstBitmapEntry(selection);
        if (!entry) {
            throw new Error("No bitmap in selection. Select a linked/embedded image (or a group containing one), not paths or text.");
        }
        info = sciBitmapItemInfo(entry.item, entry.inGroup);
        return sciBitmapResult({
            ok: true,
            info: info,
            count: sciBitmapCollectBitmaps(selection, false, []).length,
            lock: {
                docName: info.docName,
                docId: info.docId,
                docSessionId: info.docSessionId,
                objectKey: info.objectKey,
                uuid: info.uuid,
                sourcePath: info.sourcePath || "",
                typename: info.typename,
                bounds: info.bounds,
                matrix: info.matrix,
                widthPt: info.widthPt,
                heightPt: info.heightPt,
                name: info.name
            }
        });
    } catch (error) { return sciBitmapFailure(error); }
}

/*
 * Verify the selection still matches a previously captured lock.
 * Returns ok:false with reason when doc/item/source diverged (abort write).
 */
function verifySelectionLock(lockJson) {
    try {
        var expected = typeof lockJson === "string" ? eval("(" + lockJson + ")") : lockJson;
        if (!expected || !expected.objectKey || !expected.docId) { throw new Error("Missing target identity. Refresh and try again."); }
        if (!app.documents.length) { throw new Error("Document closed."); }
        var entry = sciBitmapFirstBitmapEntry(app.activeDocument.selection);
        if (!entry) { throw new Error("Selection no longer contains a bitmap."); }
        var info = sciBitmapItemInfo(entry.item, entry.inGroup);
        if (expected.docId !== info.docId || expected.docSessionId !== info.docSessionId || expected.objectKey !== info.objectKey ||
            (expected.uuid && expected.uuid !== info.uuid)) {
            throw new Error("Target changed. Select the original image and try again.");
        }
        if (String(expected.sourcePath || "") !== String(info.sourcePath || "")) {
            throw new Error("Source link changed while processing. Refresh and retry.");
        }
        if (expected.bounds && expected.bounds.join(",") !== info.bounds.join(",")) {
            throw new Error("Image geometry changed while processing. Retry with the new geometry.");
        }
        if (expected.matrix && expected.matrix.join(",") !== info.matrix.join(",")) {
            throw new Error("Image transform changed while processing. Retry.");
        }
        return sciBitmapResult({ok:true, matched:true, current:info});
    } catch (error) { return sciBitmapFailure(error); }
}

// Verify and mutate in one host invocation. No event-loop gap between them.
function sciBitmapAssertLock(lockJson) {
    var result = eval("(" + verifySelectionLock(lockJson) + ")");
    if (!result.ok) { throw new Error(result.error || result.reason || "Target changed."); }
    return result.current;
}

function replaceLockedWithFile(lockJson, filePath, angle, flipH, flipV, geomJson) {
    try {
        sciBitmapAssertLock(lockJson);
        return replaceSelectedWithFile(filePath, angle, flipH, flipV, geomJson);
    } catch (error) { return sciBitmapFailure(error); }
}

function exportLockedBitmapTemp(lockJson, format, dpi) {
    try {
        sciBitmapAssertLock(lockJson);
        return exportSelectedBitmapTemp(format, dpi);
    } catch (error) { return sciBitmapFailure(error); }
}

function replaceSelectedWithFile(filePath, rotateDegrees, flipH, flipV, geomJson) {
    var resultPayload = null;
    var angleArg = Number(rotateDegrees) || 0;
    var flipHArg = flipH ? 1 : 0;
    var flipVArg = flipV ? 1 : 0;
    var geomArg = null;
    if (geomJson != null && geomJson !== "" && geomJson !== "null") {
        if (typeof geomJson === "string") {
            try { geomArg = eval("(" + geomJson + ")"); } catch (ignoreG) { geomArg = null; }
        } else {
            geomArg = geomJson;
        }
    }
    try {
        if (typeof UndoModes !== "undefined" && typeof app.doScript === "function") {
            app.doScript(
                "sciBitmapUndoReplacePayload = sciBitmapReplaceSelectedCore(" +
                    sciBitmapJSON(String(filePath)) + ", " + sciBitmapJSON(angleArg) + ", " +
                    sciBitmapJSON(flipHArg) + ", " + sciBitmapJSON(flipVArg) + ", null, " +
                    sciBitmapJSON(geomArg) + ");",
                ScriptLanguage.JAVASCRIPT,
                undefined,
                UndoModes.ENTIRE_SCRIPT
            );
            if (typeof sciBitmapUndoReplacePayload !== "undefined" && sciBitmapUndoReplacePayload) {
                resultPayload = sciBitmapUndoReplacePayload;
            }
        } else {
            resultPayload = sciBitmapReplaceSelectedCore(filePath, angleArg, flipHArg, flipVArg, null, geomArg);
        }
        if (!resultPayload) { resultPayload = sciBitmapReplaceSelectedCore(filePath, angleArg, flipHArg, flipVArg, null, geomArg); }
        return sciBitmapResult(resultPayload);
    } catch (error) { return sciBitmapFailure(error); }
}

/*
 * Immediate geometric rotate on the first selected bitmap (Illustrator native).
 * Positive degrees = CCW. One undo step when UndoModes available.
 */
function sciBitmapRotateSelectedCore(degrees) {
    var selection;
    var entry;
    var item;
    var angle = Number(degrees) || 0;
    if (app.documents.length === 0) { throw new Error("Open an Illustrator document first."); }
    if (Math.abs(angle) < 0.0001) {
        return { ok: true, rotated: 0, skipped: true };
    }
    selection = app.activeDocument.selection;
    entry = sciBitmapFirstBitmapEntry(selection);
    if (!entry) {
        throw new Error("No bitmap in selection. Select a linked/embedded image (or a group containing one), not paths or text.");
    }
    item = entry.item;
    try {
        item.rotate(angle);
    } catch (rotErr) {
        throw new Error("Illustrator rotate failed: " + (rotErr && rotErr.message ? rotErr.message : String(rotErr)));
    }
    app.redraw();
    return { ok: true, rotated: angle, inGroup: !!entry.inGroup, typename: item.typename };
}

function rotateSelectedBitmap(degrees) {
    var resultPayload = null;
    var angleArg = Number(degrees) || 0;
    try {
        if (typeof UndoModes !== "undefined" && typeof app.doScript === "function") {
            app.doScript(
                "sciBitmapUndoRotatePayload = sciBitmapRotateSelectedCore(" + sciBitmapJSON(angleArg) + ");",
                ScriptLanguage.JAVASCRIPT,
                undefined,
                UndoModes.ENTIRE_SCRIPT
            );
            if (typeof sciBitmapUndoRotatePayload !== "undefined" && sciBitmapUndoRotatePayload) {
                resultPayload = sciBitmapUndoRotatePayload;
            }
        } else {
            resultPayload = sciBitmapRotateSelectedCore(angleArg);
        }
        if (!resultPayload) { resultPayload = sciBitmapRotateSelectedCore(angleArg); }
        return sciBitmapResult(resultPayload);
    } catch (error) { return sciBitmapFailure(error); }
}

/*
 * Immediate geometric flip via item.resize(±100, ±100). One undo step when possible.
 */
function sciBitmapFlipSelectedCore(flipH, flipV) {
    var selection;
    var entry;
    var item;
    var doFlipH = !!flipH;
    var doFlipV = !!flipV;
    if (app.documents.length === 0) { throw new Error("Open an Illustrator document first."); }
    if (!doFlipH && !doFlipV) {
        return { ok: true, flipH: false, flipV: false, skipped: true };
    }
    selection = app.activeDocument.selection;
    entry = sciBitmapFirstBitmapEntry(selection);
    if (!entry) {
        throw new Error("No bitmap in selection. Select a linked/embedded image (or a group containing one), not paths or text.");
    }
    item = entry.item;
    try {
        item.resize(doFlipH ? -100 : 100, doFlipV ? -100 : 100);
    } catch (flipErr) {
        throw new Error("Illustrator flip failed: " + (flipErr && flipErr.message ? flipErr.message : String(flipErr)));
    }
    app.redraw();
    return { ok: true, flipH: doFlipH, flipV: doFlipV, inGroup: !!entry.inGroup, typename: item.typename };
}

function flipSelectedBitmap(flipH, flipV) {
    var resultPayload = null;
    var flipHArg = flipH ? 1 : 0;
    var flipVArg = flipV ? 1 : 0;
    try {
        if (typeof UndoModes !== "undefined" && typeof app.doScript === "function") {
            app.doScript(
                "sciBitmapUndoFlipPayload = sciBitmapFlipSelectedCore(" +
                    sciBitmapJSON(flipHArg) + ", " + sciBitmapJSON(flipVArg) + ");",
                ScriptLanguage.JAVASCRIPT,
                undefined,
                UndoModes.ENTIRE_SCRIPT
            );
            if (typeof sciBitmapUndoFlipPayload !== "undefined" && sciBitmapUndoFlipPayload) {
                resultPayload = sciBitmapUndoFlipPayload;
            }
        } else {
            resultPayload = sciBitmapFlipSelectedCore(flipHArg, flipVArg);
        }
        if (!resultPayload) { resultPayload = sciBitmapFlipSelectedCore(flipHArg, flipVArg); }
        return sciBitmapResult(resultPayload);
    } catch (error) { return sciBitmapFailure(error); }
}

/*
 * Relink/replace selection with a preview file (same geometry preserve as Apply).
 * Optional rotate/flip applied after place. Caller remembers original path for cancel.
 * Prefer ENTIRE_SCRIPT so one Undo undoes the preview place (+ rotate/flip).
 */
function previewPlaceSelected(filePath, rotateDegrees, flipH, flipV) {
    return replaceSelectedWithFile(filePath, rotateDegrees, flipH, flipV);
}

/*
 * Restore original linked file after artboard preview (no extra rotate/flip).
 */
function restoreOriginalLink(filePath) {
    return replaceSelectedWithFile(filePath, 0, 0, 0);
}

/* Batch references are bound to this live document and exact item; never resolve by file name. */
var SCI_BITMAP_BATCH = null;
function captureBitmapBatch() {
    try {
        if (!app.documents.length) { throw new Error("Open a document first."); }
        var entries=sciBitmapCollectBitmaps(app.activeDocument.selection,false,[]), unique=[], infos=[], seen={}, i, info;
        if(entries.length>100) { throw new Error("Select at most 100 bitmaps per batch."); }
        for(i=0;i<entries.length;i++) {
            info=sciBitmapItemInfo(entries[i].item,entries[i].inGroup);
            if(!seen[info.objectKey]) { seen[info.objectKey]=true; unique.push(entries[i]); infos.push(info); }
        }
        if(!unique.length) { throw new Error("Select linked images first."); }
        var token="batch-"+(new Date().getTime())+"-"+Math.random();
        SCI_BITMAP_BATCH={token:token,doc:app.activeDocument,entries:unique,infos:infos};
        return sciBitmapResult({ok:true,token:token,items:infos});
    } catch(e) { return sciBitmapFailure(e); }
}
function replaceBatchBitmap(token,index,filePath) {
    try {
        var batch=SCI_BITMAP_BATCH;
        if(!batch || batch.token!==token || !app.documents.length || app.activeDocument!==batch.doc) { throw new Error("Batch document changed. Review selection again."); }
        var entry=batch.entries[index], expected=batch.infos[index];
        if(!entry || !expected) { throw new Error("Invalid batch target."); }
        var info=sciBitmapItemInfo(entry.item,entry.inGroup);
        if(info.docSessionId!==expected.docSessionId || info.objectKey!==expected.objectKey || info.sourcePath!==expected.sourcePath || info.bounds.join(",")!==expected.bounds.join(",") || info.matrix.join(",")!==expected.matrix.join(",")) { throw new Error("Batch target or geometry changed; skipped."); }
        if(!info.linked) { throw new Error("Batch requires linked images."); }
        var result=sciBitmapReplaceSelectedCore(filePath,0,false,false,entry);
        batch.entries[index]=null;
        return sciBitmapResult(result);
    } catch(e) { return sciBitmapFailure(e); }
}
function releaseBitmapBatch(token) {
    if(SCI_BITMAP_BATCH && SCI_BITMAP_BATCH.token===token) { SCI_BITMAP_BATCH=null; }
    return sciBitmapResult({ok:true});
}

/* Scientific geometry and vector scale bars. Loaded by bitmap.jsx. See LICENSE. */
function sciBitmapCorners(item) {
    var box=item.boundingBox,m=sciBitmapMatrixValues(item);
    if(!box || m.length!==6) { throw new Error('This object does not expose its intrinsic placed bounds.'); }
    var points=[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]],out=[],i;
    for(i=0;i<4;i++) {out.push([m[0]*points[i][0]+m[2]*points[i][1]+m[4],m[1]*points[i][0]+m[3]*points[i][1]+m[5]]);}
    var minX=out[0][0],maxY=out[0][1];for(i=1;i<4;i++){minX=Math.min(minX,out[i][0]);maxY=Math.max(maxY,out[i][1]);}
    var bounds=item.geometricBounds,dx=bounds[0]-minX,dy=bounds[1]-maxY;
    for(i=0;i<4;i++){out[i][0]+=dx;out[i][1]+=dy;}return out;
}
function sciBitmapFitCorners(item,wanted) {
    var box=item.boundingBox,m=sciBitmapMatrixValues(item),w=box[2]-box[0],h=box[3]-box[1];
    if(!w||!h)throw new Error('Invalid intrinsic frame');
    var a=(wanted[1][0]-wanted[0][0])/w,b=(wanted[1][1]-wanted[0][1])/w,c=(wanted[3][0]-wanted[0][0])/h,d=(wanted[3][1]-wanted[0][1])/h;
    var tx=wanted[0][0]-a*box[0]-c*box[1],ty=wanted[0][1]-b*box[0]-d*box[1],det=m[0]*m[3]-m[1]*m[2];
    if(Math.abs(det)<1e-12)throw new Error('Singular artwork transform');
    var ia=m[3]/det,ib=-m[1]/det,ic=-m[2]/det,id=m[0]/det,itx=-(ia*m[4]+ic*m[5]),ity=-(ib*m[4]+id*m[5]);
    var delta=app.getIdentityMatrix();delta.mValueA=a*ia+c*ib;delta.mValueB=b*ia+d*ib;delta.mValueC=a*ic+c*id;delta.mValueD=b*ic+d*id;delta.mValueTX=a*itx+c*ity+tx;delta.mValueTY=b*itx+d*ity+ty;
    item.transform(delta,true,true,true,true,100,Transformation.DOCUMENTORIGIN);
    var actual=sciBitmapCorners(item);for(var i=0;i<4;i++)if(Math.abs(actual[i][0]-wanted[i][0])>0.05||Math.abs(actual[i][1]-wanted[i][1])>0.05)throw new Error('Illustrator changed the placed frame unexpectedly');
}
function sciBitmapRelinkExact(item,file) {
    var wanted=sciBitmapCorners(item),original=item.file;
    try{item.relink(file);sciBitmapFitCorners(item,wanted);}catch(e){try{item.relink(original);sciBitmapFitCorners(item,wanted);}catch(rollback){throw new Error(e.message+'; rollback failed: '+rollback.message+' — use Undo and inspect the object.');}throw e;}
}
function sciBitmapScaleBar(lockJson,specJson) {
    var group=null,wrapper=null,item=null,originalParent=null,imageMoved=false,rollbackFailed=false,committed=false;
    try {
        var info=sciBitmapAssertLock(lockJson),selected=sciBitmapCollectBitmaps(app.activeDocument.selection,false,[]),entry=selected[0],s=eval('('+specJson+')');
        if(selected.length!==1)throw new Error('Select exactly one image for its scale bar');
        item=entry.item;
        if(item.typename!=='PlacedItem')throw new Error('Scale bar requires a linked placed image');
        originalParent=item.parent;
        var ancestor=originalParent;
        while(ancestor&&ancestor.typename==='GroupItem'){
            if(ancestor.clipped)throw new Error('Scale bar cannot be grouped inside a clipping group');
            ancestor=ancestor.parent;
        }
        if(!originalParent||(originalParent.typename!=='GroupItem'&&originalParent.typename!=='Layer'))throw new Error('Unsupported image parent for scale bar grouping');
        var includeText=s.includeText!==false;
        if(!(s.fraction>0&&s.fraction<0.9)||!(s.lineWidth>0&&s.lineWidth<=20)||!(s.margin>=0&&s.margin<=200))throw new Error('Invalid scale bar settings');
        if(includeText&&!(s.fontSize>=4&&s.fontSize<=72))throw new Error('Invalid scale bar settings');
        var textPad=includeText?(Number(s.fontSize)||9)+4:Math.max(Number(s.lineWidth)||1.5,2);
        var p=sciBitmapCorners(item),ux=p[1][0]-p[0][0],uy=p[1][1]-p[0][1],vx=p[3][0]-p[0][0],vy=p[3][1]-p[0][1],w=Math.sqrt(ux*ux+uy*uy),h=Math.sqrt(vx*vx+vy*vy);
        /* Prefer AI Y-up geometricBounds for bottom-* when the frame is axis-aligned.
           Fresh linked items often expose BL-first sciBitmapCorners (V toward visual top),
           so UV y=1 ("bottom") would land at the top. */
        var start,end,b,left,top,right,bottom,frameW,frameH,barW,x0,lineY,placedBounds=false;
        try {
            b=item.geometricBounds;
            if(b&&isFinite(b[0])&&isFinite(b[1])&&isFinite(b[2])&&isFinite(b[3])){
                left=b[0];top=b[1];right=b[2];bottom=b[3];
                frameW=right-left;frameH=top-bottom;
                /* Axis-aligned only: U horizontal and V vertical so a horizontal bar matches source-X. */
                if(frameW>0.5&&frameH>0.5&&Math.abs(uy)<0.5&&Math.abs(vx)<0.5){
                    barW=frameW*s.fraction;
                    x0=s.position==='bottom-left'?left+s.margin:right-s.margin-barW;
                    lineY=bottom+s.margin+textPad;
                    if(!(x0>=left-0.01&&x0+barW<=right+0.01&&lineY>=bottom-0.01&&lineY<=top+0.01))throw new Error('Scale bar/margins do not fit inside this frame');
                    start=[x0,lineY];end=[x0+barW,lineY];placedBounds=true;
                }
            }
        }catch(boundsErr){
            if(boundsErr.message&&/Scale bar\/margins/.test(String(boundsErr.message)))throw boundsErr;
        }
        if(!placedBounds){
            var x=s.position==='bottom-left'?s.margin/w:1-s.margin/w-s.fraction;
            var topEdge=(p[0][1]+p[1][1])*0.5,botEdge=(p[2][1]+p[3][1])*0.5;
            var yBottom=topEdge>=botEdge?1:0;
            var y=yBottom===1?1-(s.margin+textPad)/h:(s.margin+textPad)/h;
            if(x<0||x+s.fraction>1||y<0||y>1)throw new Error('Scale bar/margins do not fit inside this frame');
            start=[p[0][0]+x*ux+y*vx,p[0][1]+x*uy+y*vy];end=[start[0]+s.fraction*ux,start[1]+s.fraction*uy];
        }
        var color=new RGBColor(),hex=String(s.color||'');if(!/^#[0-9a-f]{6}$/i.test(hex))throw new Error('Invalid scale bar color');color.red=parseInt(hex.substr(1,2),16);color.green=parseInt(hex.substr(3,2),16);color.blue=parseInt(hex.substr(5,2),16);
        // Keep the editable vector bar next to its image in the same group.
        var nameSuffix=includeText?String(s.label||''):(s.length!=null?String(s.length)+(s.unit==='um'?' \u00b5m':' '+String(s.unit||'')):'bar');
        group=app.activeDocument.groupItems.add();group.name='SCI scale \u00b7 '+nameSuffix;
        var line=group.pathItems.add();line.setEntirePath([start,end]);line.filled=false;line.stroked=true;line.strokeWidth=s.lineWidth;line.strokeColor=color;
        if(includeText){
            var label=group.textFrames.add();label.contents=String(s.label);label.textRange.characterAttributes.size=s.fontSize;sciBitmapApplyFigureType(label.textRange.characterAttributes,'','regular');label.textRange.characterAttributes.fillColor=color;
            label.position=[start[0]+(end[0]-start[0])/2-label.width/2,start[1]-(s.fontSize+2)];
        }
        // The text stays upright for readability; the line follows source-X, including rotation/shear.
        group.note='SCI_SCALE_V1:'+sciBitmapJSON({objectKey:info.objectKey,sourcePath:info.sourcePath,calibration:s.calibration,displayPixelsX:s.displayPixelsX,length:s.length,unit:s.unit,includeText:includeText,corners:p,createdAt:(new Date()).toUTCString()});
        var old=[];for(var i=0;i<app.activeDocument.groupItems.length;i++){var g=app.activeDocument.groupItems[i];if(g===group)continue;try{if(g.note&&g.note.indexOf('SCI_SCALE_V1:')===0){var note=eval('('+g.note.substr(13)+')');if(note.objectKey===info.objectKey)old.push(g);}}catch(ignore){}}
        if(originalParent.typename==='Layer'){
            wrapper=app.activeDocument.groupItems.add();wrapper.name='SCI image + scale';
            wrapper.move(item,ElementPlacement.PLACEBEFORE);
            item.move(wrapper,ElementPlacement.PLACEATEND);
            imageMoved=true;
        }
        group.move(item,ElementPlacement.PLACEAFTER);
        group.zOrder(ZOrderMethod.BRINGTOFRONT);
        committed=true;
        // Replace only a previous generated bar for this exact image.
        for(i=0;i<old.length;i++)old[i].remove();
        try{app.redraw();}catch(ignoreRedraw){}
        return sciBitmapResult({ok:true,label:s.label,includeText:includeText,grouped:true});
    }catch(e){
        if(!committed){
            if(imageMoved){try{item.move(originalParent,ElementPlacement.PLACEATEND);}catch(rollback){rollbackFailed=true;e=new Error(e.message+'; image rollback failed — use Undo and inspect the image.');}}
            if(group){try{group.remove();}catch(ignoreGroup){}}
            if(wrapper&&!rollbackFailed){try{wrapper.remove();}catch(ignoreWrapper){}}
        }
        return sciBitmapFailure(e);
    }
}
function sciBitmapFontFaceFlags(fontStyle) {
    var style = String(fontStyle || '');
    return {
        bold: /bold|demi|semi|black|heavy/i.test(style),
        italic: /italic|oblique/i.test(style)
    };
}
function sciBitmapFigureFontFamilies() {
    try {
        var items = [], seen = {}, fonts = app.textFonts, i, font, family, style, name, key;
        for (i = 0; fonts && i < fonts.length; i++) {
            try {
                font = fonts[i];
                family = String(font.family || '');
                style = String(font.style || '');
                name = String(font.name || '');
            } catch (ignoreFont) { continue; }
            if (!family && !name) { continue; }
            key = name || (family + '\t' + style);
            if (seen[key]) { continue; }
            seen[key] = true;
            items.push({ name: name, family: family || name, style: style });
        }
        items.sort(function (a, b) {
            var af = String(a.family).toLowerCase(), bf = String(b.family).toLowerCase();
            if (af < bf) { return -1; }
            if (af > bf) { return 1; }
            af = String(a.style).toLowerCase(); bf = String(b.style).toLowerCase();
            if (af < bf) { return -1; }
            if (af > bf) { return 1; }
            return 0;
        });
        return sciBitmapResult({ ok: true, fonts: items });
    } catch (e) { return sciBitmapFailure(e); }
}
function sciBitmapFigureFont(name, style) {
    var fonts = app.textFonts, wanted = String(name || ''), bold = style === 'bold' || style === 'bold-italic', italic = style === 'italic' || style === 'bold-italic';
    var i, font, exact = null, family = '', matches = [], flags, fontStyle, styled = null;
    if (!wanted) { wanted = 'Arial'; }
    for (i = 0; fonts && i < fonts.length; i++) {
        try { font = fonts[i]; } catch (ignoreFont) { continue; }
        if (String(font.name || '') === wanted) { exact = font; family = String(font.family || ''); break; }
    }
    for (i = 0; fonts && i < fonts.length; i++) {
        try { font = fonts[i]; fontStyle = String(font.style || ''); } catch (ignoreFont) { continue; }
        if (String(font.family || '') !== wanted && String(font.name || '') !== wanted && !(family && String(font.family || '') === family)) { continue; }
        matches.push(font);
        flags = sciBitmapFontFaceFlags(fontStyle);
        if (!styled && flags.bold === bold && flags.italic === italic) { styled = font; }
    }
    if (!matches.length) { throw new Error('Font is not installed: ' + wanted); }
    if (exact && !bold && !italic) { return exact; }
    if (styled) { return styled; }
    return exact || matches[0];
}
function sciBitmapApplyFigureType(attrs, name, style) {
    var bold = style === 'bold' || style === 'bold-italic', italic = style === 'italic' || style === 'bold-italic';
    var font = sciBitmapFigureFont(name, style), flags = { bold: false, italic: false };
    if (font) {
        attrs.textFont = font;
        flags = sciBitmapFontFaceFlags(font.style);
    }
    if (bold && !flags.bold) { attrs.fauxBold = true; }
    if (italic && !flags.italic) { attrs.fauxItalic = true; }
}
function sciBitmapFigureStains(group, s, bounds) {
    var positions = { 'top-left': 1, 'top-right': 1, 'bottom-left': 1, 'bottom-right': 1,
        'outside-top-left': 1, 'outside-top-right': 1, 'outside-bottom-left': 1, 'outside-bottom-right': 1 };
    var entries = s.stains || [], active = [], position = String(s.stainPosition || 'top-left');
    var size = Number(s.stainSize == null ? s.size : s.stainSize), style = String(s.stainStyle || 'regular');
    var margin = Number(s.stainMargin == null ? 8 : s.stainMargin);
    var vertical = Number(s.stainVerticalOffset == null ? 0 : s.stainVerticalOffset);
    var gap = Math.max(6, size * 0.5), totalWidth = 0, maxHeight = 0, i, entry, text, frame, width, height, x, y;
    if (!positions[position] || !(margin >= -200 && margin <= 200) || !(vertical >= -200 && vertical <= 200) ||
        !(size >= 4 && size <= 72) || !/^(regular|bold|italic|bold-italic)$/.test(style) || entries.length > 3) {
        throw new Error('Invalid staining label settings.');
    }
    for (i = 0; i < entries.length; i++) {
        entry = entries[i] || {};
        text = String(entry.text || '').replace(/^\s+|\s+$/g, '');
        if (!text) { continue; }
        if (text.length > 40 || /[\r\n]/.test(text) || !/^#[0-9a-f]{6}$/i.test(String(entry.color || ''))) {
            throw new Error('Invalid staining label text or color.');
        }
        frame = group.textFrames.add();
        frame.contents = text;
        frame.textRange.characterAttributes.size = size;
        frame.textRange.characterAttributes.fillColor = sciBitmapHexColor(entry.color);
        sciBitmapApplyFigureType(frame.textRange.characterAttributes, s.stainFont, style);
        width = Number(frame.width) || text.length * size * 0.7;
        height = Number(frame.height) || size * 1.2;
        active.push({ frame: frame, width: width });
        totalWidth += width;
        if (height > maxHeight) { maxHeight = height; }
    }
    if (!active.length) { return 0; }
    totalWidth += gap * (active.length - 1);
    x = /-right$/.test(position) ? Number(bounds[2]) - margin - totalWidth : Number(bounds[0]) + margin;
    if (position.indexOf('outside-top-') === 0) { y = Number(bounds[1]) + 8 + maxHeight + vertical; }
    else if (position.indexOf('outside-bottom-') === 0) { y = Number(bounds[3]) - 8 + vertical; }
    else if (position.indexOf('bottom-') === 0) { y = Number(bounds[3]) + 8 + maxHeight + vertical; }
    else { y = Number(bounds[1]) - 8 + vertical; }
    for (i = 0; i < active.length; i++) {
        active[i].frame.position = [x, y];
        x += active[i].width + gap;
    }
    return active.length;
}
function sciBitmapFigureLabel(lockJson, specJson) {
    var group = null;
    try {
        var info = sciBitmapAssertLock(lockJson), entry = sciBitmapFirstBitmapEntry(app.activeDocument.selection);
        var item = entry && entry.item, s = eval('(' + specJson + ')'), text = String(s.text || '').replace(/^\s+|\s+$/g, '');
        var positions = { 'top-left': 1, 'top-right': 1, 'bottom-left': 1, 'bottom-right': 1, 'outside-top-left': 1, 'outside-top-right': 1 };
        var size = Number(s.size), margin = Number(s.margin), verticalOffset = Number(s.verticalOffset == null ? 0 : s.verticalOffset), bounds, left, top, right, bottom, color, frame, width, height, x, y, stainCount, old = [], i, g, note;
        if (!item || (item.typename !== 'PlacedItem' && item.typename !== 'RasterItem')) { throw new Error('Figure label requires one image.'); }
        if (!text || text.length > 16 || /[\r\n]/.test(text)) { throw new Error('Enter a label of 1–16 characters.'); }
        if (!(size >= 4 && size <= 72) || !(margin >= -200 && margin <= 200) || !(verticalOffset >= -200 && verticalOffset <= 200) || !positions[s.position]) { throw new Error('Invalid figure label settings.'); }
        sciBitmapFigureFont(s.font, String(s.style || 'regular'));
        color = sciBitmapHexColor(s.color);
        bounds = item.geometricBounds;
        left = Number(bounds[0]); top = Number(bounds[1]); right = Number(bounds[2]); bottom = Number(bounds[3]);
        if (!(right > left && top > bottom)) { throw new Error('Invalid image bounds.'); }
        group = app.activeDocument.groupItems.add();
        group.name = 'SCI figure label \u00b7 ' + text;
        frame = group.textFrames.add();
        frame.contents = text;
        frame.textRange.characterAttributes.size = size;
        frame.textRange.characterAttributes.fillColor = color;
        sciBitmapApplyFigureType(frame.textRange.characterAttributes, s.font, String(s.style || 'regular'));
        width = Number(frame.width) || text.length * size * 0.7;
        height = Number(frame.height) || size * 1.2;
        x = /-right$/.test(s.position) ? right - margin - width : left + margin;
        y = s.position.indexOf('outside-') === 0 ? top + 8 + height + verticalOffset : (/^bottom-/.test(s.position) ? bottom + 8 + height + verticalOffset : top - 8 + verticalOffset);
        if (s.position.indexOf('outside-') !== 0 && (x < left - 0.01 || x + width > right + 0.01 || y > top + 0.01 || y - height < bottom - 0.01)) {
            throw new Error('Figure label does not fit inside this image.');
        }
        frame.position = [x, y];
        stainCount = sciBitmapFigureStains(group, s, bounds);
        group.note = 'SCI_FIGLABEL_V1:' + sciBitmapJSON({ objectKey: info.objectKey, sourcePath: info.sourcePath, text: text, font: s.font || '', style: s.style || 'regular', size: size, margin: margin, verticalOffset: verticalOffset, position: s.position, color: s.color, stains: s.stains || [], stainFont: s.stainFont || '', stainStyle: s.stainStyle || 'regular', stainSize: s.stainSize == null ? size : s.stainSize, stainPosition: s.stainPosition || 'top-left', stainMargin: s.stainMargin == null ? 8 : s.stainMargin, stainVerticalOffset: s.stainVerticalOffset == null ? 0 : s.stainVerticalOffset });
        for (i = 0; i < app.activeDocument.groupItems.length; i++) {
            g = app.activeDocument.groupItems[i];
            if (g === group) { continue; }
            try {
                if (g.note && g.note.indexOf('SCI_FIGLABEL_V1:') === 0) {
                    note = eval('(' + g.note.substr(16) + ')');
                    if (note.objectKey === info.objectKey) { old.push(g); }
                }
            } catch (ignore) {}
        }
        for (i = 0; i < old.length; i++) { old[i].remove(); }
        app.redraw();
        return sciBitmapResult({ ok: true, text: text, position: s.position, stainCount: stainCount });
    } catch (e) { if (group) { try { group.remove(); } catch (ignoreRemove) {} } return sciBitmapFailure(e); }
}
/*
 * Inset. Crops are already written in source-file pixels.
 * Places a new linked image (no resample of µm/px), a vector frame on the
 * original quad, optional leaders, and an optional scale bar on the inset.
 * Replaces a previous SCI_INSET_V1 group for the same parent objectKey.
 */
function sciBitmapHexColor(hex) {
    var color = new RGBColor();
    var h = String(hex || '');
    if (!/^#[0-9a-f]{6}$/i.test(h)) { throw new Error('Invalid inset stroke color'); }
    color.red = parseInt(h.substr(1, 2), 16);
    color.green = parseInt(h.substr(3, 2), 16);
    color.blue = parseInt(h.substr(5, 2), 16);
    return color;
}
function sciBitmapStrokePath(path, style) {
    path.filled = false;
    path.stroked = true;
    path.strokeWidth = style.weight;
    path.strokeColor = sciBitmapHexColor(style.color);
    try { path.strokeDashes = style.dashes && style.dashes.length ? style.dashes : []; } catch (ignoreDash) {}
    try {
        if (typeof StrokeJoin !== 'undefined') {
            if (style.corner === 'round') { path.strokeJoin = StrokeJoin.ROUNDENDJOIN; }
            else if (style.corner === 'bevel') { path.strokeJoin = StrokeJoin.BEVELENDJOIN; }
            else { path.strokeJoin = StrokeJoin.MITERENDJOIN; }
        }
    } catch (ignoreJoin) {}
    try {
        if (style.corner === 'round' && typeof StrokeCap !== 'undefined') { path.strokeCap = StrokeCap.ROUNDENDCAP; }
    } catch (ignoreCap) {}
}
function sciBitmapQuadBounds(quad) {
    var i, left = quad[0][0], right = quad[0][0], top = quad[0][1], bottom = quad[0][1];
    for (i = 1; i < quad.length; i++) {
        if (quad[i][0] < left) { left = quad[i][0]; }
        if (quad[i][0] > right) { right = quad[i][0]; }
        if (quad[i][1] > top) { top = quad[i][1]; }
        if (quad[i][1] < bottom) { bottom = quad[i][1]; }
    }
    return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: top - bottom };
}
function sciBitmapQuadAxisAligned(quad) {
    var i, dx, dy;
    for (i = 0; i < 4; i++) {
        dx = Math.abs(quad[(i + 1) % 4][0] - quad[i][0]);
        dy = Math.abs(quad[(i + 1) % 4][1] - quad[i][1]);
        if (Math.min(dx, dy) > 0.75) { return false; }
    }
    return true;
}
function sciBitmapFileNyToCornerNy(corners, fileNy) {
    /* fileNy 0 = top of raster file. boundingBox×matrix corner order can put
       corner[0] at visual bottom; map file Y onto the visually upper edge.
       Involutive: also maps corner UV → file Y. */
    var topEdge = (corners[0][1] + corners[1][1]) * 0.5;
    var botEdge = (corners[2][1] + corners[3][1]) * 0.5;
    if (topEdge >= botEdge) { return fileNy; }
    return 1 - fileNy;
}
function sciBitmapFileNormQuad(item, corners, fileCorners) {
    /* fileCorners: TL,TR,BR,BL in file UV (y=0 at file top). */
    var i, nx, ny, out = [], b, L, T, R, Btm, ux, uy, vx, vy;
    if (sciBitmapQuadAxisAligned(corners)) {
        /* Axis-aligned: geometricBounds so file top → artboard top even when
           sciBitmapCorners is BL-first (ROI box otherwise sits too high / wrong). */
        try { b = item.geometricBounds; } catch (ignoreB) { b = null; }
        if (b && isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3])) {
            L = b[0]; T = b[1]; R = b[2]; Btm = b[3];
            for (i = 0; i < 4; i++) {
                nx = Number(fileCorners[i].x); ny = Number(fileCorners[i].y);
                out.push([L + nx * (R - L), T - ny * (T - Btm)]);
            }
            return out;
        }
    }
    ux = corners[1][0] - corners[0][0]; uy = corners[1][1] - corners[0][1];
    vx = corners[3][0] - corners[0][0]; vy = corners[3][1] - corners[0][1];
    for (i = 0; i < 4; i++) {
        nx = Number(fileCorners[i].x);
        ny = sciBitmapFileNyToCornerNy(corners, Number(fileCorners[i].y));
        out.push([corners[0][0] + nx * ux + ny * vx, corners[0][1] + nx * uy + ny * vy]);
    }
    return out;
}
function sciBitmapInsetFrame(group, quad, style) {
    var path, bounds, radius, doc;
    radius = Number(style.radius) || 0;
    if (style.corner === 'round' && radius > 0.05 && sciBitmapQuadAxisAligned(quad)) {
        bounds = sciBitmapQuadBounds(quad);
        if (radius > Math.min(bounds.width, bounds.height) / 2) { radius = Math.min(bounds.width, bounds.height) / 2; }
        doc = app.activeDocument;
        if (doc.pathItems && doc.pathItems.roundedRectangle) {
            path = doc.pathItems.roundedRectangle(bounds.top, bounds.left, bounds.width, bounds.height, radius, radius);
            try { path.move(group, ElementPlacement.PLACEATEND); } catch (ignoreMove) {}
            sciBitmapStrokePath(path, style);
            return path;
        }
    }
    path = group.pathItems.add();
    path.setEntirePath(quad);
    path.closed = true;
    sciBitmapStrokePath(path, style);
    return path;
}
function sciBitmapInsetNoteList() {
    var out = [], i, g, note;
    for (i = 0; i < app.activeDocument.groupItems.length; i++) {
        g = app.activeDocument.groupItems[i];
        try {
            if (g.note && g.note.indexOf('SCI_INSET_V1:') === 0) {
                note = eval('(' + g.note.substr(13) + ')');
                out.push({ group: g, note: note });
            }
        } catch (ignore) {}
    }
    return out;
}
function sciBitmapPlacedBoxMatches(placed, sizeW, sizeH) {
    var b, w, h, want;
    try {
        b = placed.geometricBounds;
        if (!b) { return false; }
        w = Math.abs(b[2] - b[0]);
        h = Math.abs(b[1] - b[3]);
        want = sizeW / sizeH;
        if (!(w > 0.5 && h > 0.5 && want > 0)) { return false; }
        return Math.abs((w / h) - want) / want < 0.04 && Math.abs(w - sizeW) / sizeW < 0.04 && Math.abs(h - sizeH) / sizeH < 0.04;
    } catch (ignoreBox) { return false; }
}
function sciBitmapApplyPlacedSize(placed, sizeW, sizeH) {
    var curW, curH, sx, sy, m, b, box;
    if (!(sizeW > 0.5) || !(sizeH > 0.5)) { return; }
    curW = 0;
    curH = 0;
    /* geometricBounds is the on-artboard box. A fresh place is often still
       square, and PlacedItem width/height (and a 2-arg resize) keep that
       aspect, so 4:3 and 16:9 insets collapsed to 1:1. Scale the matrix X
       basis and Y basis separately. */
    try {
        b = placed.geometricBounds;
        if (b && isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3])) {
            curW = Math.abs(b[2] - b[0]);
            curH = Math.abs(b[1] - b[3]);
        }
    } catch (ignoreB) {}
    if (!(curW > 0.5) || !(curH > 0.5)) {
        try {
            box = placed.boundingBox;
            if (box) {
                curW = Math.abs(box[2] - box[0]);
                curH = Math.abs(box[3] - box[1]);
            }
        } catch (ignoreBox) {}
    }
    if (!(curW > 0.5) || !(curH > 0.5)) {
        curW = Math.abs(Number(placed.width)) || sizeW;
        curH = Math.abs(Number(placed.height)) || sizeH;
    }
    sx = sizeW / curW;
    sy = sizeH / curH;
    if (!(sx > 0) || !(sy > 0) || !isFinite(sx) || !isFinite(sy)) { return; }
    var sized = false;
    try {
        m = placed.matrix;
        if (m && isFinite(m.mValueA) && isFinite(m.mValueD)) {
            m.mValueA = Number(m.mValueA) * sx;
            m.mValueB = Number(m.mValueB) * sx;
            m.mValueC = Number(m.mValueC) * sy;
            m.mValueD = Number(m.mValueD) * sy;
            placed.matrix = m;
            sized = true;
        }
    } catch (ignoreM) { sized = false; }
    if (sized && sciBitmapPlacedBoxMatches(placed, sizeW, sizeH)) { return; }
    try {
        if (typeof placed.resize === 'function') {
            placed.resize(100 * sx, 100 * sy, true, true, true, true, 100, Transformation.CENTER);
            if (sciBitmapPlacedBoxMatches(placed, sizeW, sizeH)) { return; }
        }
    } catch (ignoreR) {}
    try {
        placed.width = sizeW;
        placed.height = sizeH;
    } catch (ignoreWH) {}
}
function sciBitmapInset(lockJson, specJson) {
    var group = null, placed = null;
    try {
        var info = sciBitmapAssertLock(lockJson);
        var entry = sciBitmapFirstBitmapEntry(app.activeDocument.selection);
        var item = entry.item;
        var s = eval('(' + specJson + ')');
        var corners, norm, gap, anchor, frameW, frameH, sizeW, sizeH, bounds, pos, file, quad, i;
        var frameStyle, leaderStyle, ux, uy, vx, vy, x0, y0, x1, y1;
        var scaleSkipped = false, old, oldPaths, pi, placedPath, notePath;
        if (item.typename !== 'PlacedItem' || !item.file) { throw new Error('Inset requires a linked placed image'); }
        if (!s || !s.norm || !s.file) { throw new Error('Invalid inset settings'); }
        norm = s.norm;
        if (!(Number(norm.w) > 0.002 && Number(norm.h) > 0.002)) { throw new Error('Inset region is empty'); }
        if (Number(norm.x) < 0) { norm.w = Number(norm.w) + Number(norm.x); norm.x = 0; }
        if (Number(norm.y) < 0) { norm.h = Number(norm.h) + Number(norm.y); norm.y = 0; }
        if (Number(norm.x) + Number(norm.w) > 1) { norm.w = 1 - Number(norm.x); }
        if (Number(norm.y) + Number(norm.h) > 1) { norm.h = 1 - Number(norm.y); }
        frameStyle = s.frame || { weight: 1.5, color: '#ff0000', dashes: [], corner: 'miter', radius: 0 };
        if (!(frameStyle.weight > 0 && frameStyle.weight <= 20)) { throw new Error('Invalid inset settings'); }
        leaderStyle = s.leaders && s.leaders.enabled ? s.leaders : null;
        if (leaderStyle && !(leaderStyle.weight > 0 && leaderStyle.weight <= 20)) { throw new Error('Invalid inset settings'); }
        corners = sciBitmapCorners(item);
        ux = corners[1][0] - corners[0][0]; uy = corners[1][1] - corners[0][1];
        vx = corners[3][0] - corners[0][0]; vy = corners[3][1] - corners[0][1];
        frameW = Math.sqrt(ux * ux + uy * uy); frameH = Math.sqrt(vx * vx + vy * vy);
        gap = Number(s.gap); if (!(gap >= 0) || gap > 400) { gap = 12; }
        anchor = String(s.anchor || 'right');
        if (anchor !== 'left' && anchor !== 'right' && anchor !== 'above' && anchor !== 'below') { anchor = 'right'; }
        /* Left/right: match main image height and align top/bottom; width from crop aspect.
           Prefer rasterized pixel aspect so frame and inset content stay locked.
           Above/below: match main image width and align left/right; height from crop aspect. */
        var pw = Number(s.pixelWidth) || 0;
        var ph = Number(s.pixelHeight) || 0;
        var cropAspect = (pw > 0 && ph > 0) ? (pw / ph) : ((Number(norm.w) / Number(norm.h)) * (frameW / frameH));
        if (!(cropAspect > 0)) { throw new Error('Inset region is empty'); }
        if (anchor === 'left' || anchor === 'right') {
            sizeH = frameH;
            sizeW = sizeH * cropAspect;
        } else {
            sizeW = frameW;
            sizeH = sizeW / cropAspect;
        }
        if (!(sizeW > 0.5 && sizeH > 0.5)) { throw new Error('Inset region is empty'); }
        bounds = item.geometricBounds;
        if (anchor === 'left') { pos = [bounds[0] - gap - sizeW, bounds[1]]; }
        else if (anchor === 'above') { pos = [bounds[0], bounds[1] + gap + sizeH]; }
        else if (anchor === 'below') { pos = [bounds[0], bounds[3] - gap]; }
        else { pos = [bounds[2] + gap, bounds[1]]; }
        /* Prefer exact source-UV corners of the rasterized region (tight frame).
           File Y (0=file top) → artboard via geometricBounds / BL-first remap so
           the ROI box is not vertically offset from inset content. */
        if (s.frameCorners && s.frameCorners.length === 4) {
            quad = sciBitmapFileNormQuad(item, corners, s.frameCorners);
        } else {
            x0 = Number(norm.x); y0 = Number(norm.y); x1 = x0 + Number(norm.w); y1 = y0 + Number(norm.h);
            quad = sciBitmapFileNormQuad(item, corners, [
                { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }
            ]);
        }
        file = new File(String(s.file));
        if (!file.exists) { throw new Error('Replacement file does not exist: ' + s.file); }
        group = app.activeDocument.groupItems.add();
        var effectiveMag = (anchor === 'above' || anchor === 'below')
            ? sizeW / (Number(norm.w) * frameW)
            : sizeH / (Number(norm.h) * frameH);
        group.name = 'SCI inset · ' + (Math.round(effectiveMag * 100) / 100) + '×';
        try { item.__sciPlaceTarget = false; } catch (ignoreMark) {}
        placed = app.activeDocument.placedItems.add();
        try { placed.file = file; }
        catch (placeErr) {
            try { placed.remove(); } catch (ignoreRm) {}
            placed = null;
            throw new Error('Illustrator rejected linked file (path not accepted?): ' + file.fsName + ' — ' + (placeErr.message || placeErr));
        }
        sciBitmapApplyPlacedSize(placed, sizeW, sizeH);
        placed.position = pos;
        sciBitmapOrientInsetPlaced(placed, pos, item);
        /* Re-read bounds after place/orient so border + leaders share the pixel frame.
           A fresh place is often still square. Adopting that box turned every ratio into 1:1. */
        var live = sciBitmapInsetPlacedRect(placed, pos, sizeW, sizeH);
        var liveAspect = (live.sizeH > 0.5) ? (live.sizeW / live.sizeH) : cropAspect;
        if (live.sizeW > 0.5 && live.sizeH > 0.5 && Math.abs(liveAspect - cropAspect) / cropAspect < 0.08) {
            pos = live.pos; sizeW = live.sizeW; sizeH = live.sizeH;
        }
        try { placed.position = pos; } catch (ignorePin) {}
        try { placed.move(group, ElementPlacement.PLACEATBEGINNING); } catch (ignoreNest) {}
        sciBitmapInsetFrame(group, quad, frameStyle);
        /* Matching frame around the magnified inset (same stroke as ROI box). */
        sciBitmapInsetFrame(group, [
            [pos[0], pos[1]],
            [pos[0] + sizeW, pos[1]],
            [pos[0] + sizeW, pos[1] - sizeH],
            [pos[0], pos[1] - sizeH]
        ], frameStyle);
        if (leaderStyle) {
            var leaders = sciBitmapInsetLeaderSegs(quad, pos, sizeW, sizeH);
            for (i = 0; i < leaders.length; i++) {
                var line = group.pathItems.add();
                line.setEntirePath(leaders[i]);
                line.closed = false;
                sciBitmapStrokePath(line, leaderStyle);
            }
        }
        if (s.scaleBar) {
            try { sciBitmapInsetScale(group, placed, s.scaleBar); }
            catch (scaleErr) { scaleSkipped = true; }
        }
        group.note = 'SCI_INSET_V1:' + sciBitmapJSON({
            parentKey: info.objectKey,
            placedPath: file.fsName,
            norm: { x: Number(norm.x), y: Number(norm.y), w: Number(norm.w), h: Number(norm.h) },
            effectiveMagnification: effectiveMag,
            anchor: anchor,
            createdAt: (new Date()).toUTCString()
        });
        old = sciBitmapInsetNoteList();
        oldPaths = [];
        for (i = 0; i < old.length; i++) {
            if (old[i].group === group) { continue; }
            if (old[i].note && old[i].note.parentKey === info.objectKey) {
                if (old[i].note.placedPath) { oldPaths.push(String(old[i].note.placedPath)); }
                try { old[i].group.remove(); } catch (ignoreOld) {}
            }
        }
        if (app.activeDocument.placedItems) {
            for (pi = app.activeDocument.placedItems.length - 1; pi >= 0; pi--) {
                var cand = app.activeDocument.placedItems[pi];
                if (!cand || cand === placed || cand === item) { continue; }
                placedPath = '';
                try { placedPath = String(cand.file && (cand.file.fsName || cand.file) || ''); } catch (ignoreP) {}
                for (i = 0; i < oldPaths.length; i++) {
                    notePath = oldPaths[i];
                    if (placedPath && notePath && placedPath === notePath && notePath !== String(file.fsName)) {
                        try { cand.remove(); } catch (ignorePr) {}
                        break;
                    }
                }
            }
        }
        try { app.activeDocument.selection = [item]; } catch (ignoreSel) {}
        try { app.redraw(); } catch (ignoreRedraw) {}
        return sciBitmapResult({ ok: true, effectiveMagnification: effectiveMag, anchor: anchor, placedPath: file.fsName, scaleBar: s.scaleBar && !scaleSkipped, scaleSkipped: scaleSkipped, widthPt: sizeW, heightPt: sizeH });
    } catch (e) {
        if (placed) { try { placed.remove(); } catch (ignoreP2) {} }
        if (group) { try { group.remove(); } catch (ignoreG) {} }
        return sciBitmapFailure(e);
    }
}
function sciBitmapOrientInsetPlaced(placed, pos, mainItem) {
    /* AI linked rasters place with inherent det < 0 (Y-up artboard vs Y-down
       file pixels) — same as sciBitmapPlaceUprightCrop. Blind resize(100,-100)
       inverted those upright crops (ROI yellow-at-bottom → inset yellow-at-top).
       Only flip when the fresh place came out with det > 0 (wrong reflection).
       mainItem kept for call-site compatibility. */
    try {
        var m = sciBitmapMatrixValues(placed);
        var det = m[0] * m[3] - m[1] * m[2];
        if (det > 0 && typeof placed.resize === 'function') {
            placed.resize(100, -100);
        }
    } catch (ignoreR) {}
    try { placed.position = pos; } catch (ignoreP) {}
}
function sciBitmapInsetPlacedRect(placed, fallbackPos, fallbackW, fallbackH) {
    /* Prefer live geometricBounds so the inset stroke / leaders match pixels. */
    try {
        var b = placed.geometricBounds;
        var w, h;
        if (b && isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3])) {
            w = b[2] - b[0];
            h = b[1] - b[3];
            if (w > 0.5 && h > 0.5) {
                return { pos: [b[0], b[1]], sizeW: w, sizeH: h };
            }
        }
    } catch (ignoreB) {}
    return { pos: fallbackPos, sizeW: fallbackW, sizeH: fallbackH };
}
function sciBitmapInsetLeaderSegs(frameQuad, pos, sizeW, sizeH) {
    var inset = [[pos[0], pos[1]], [pos[0] + sizeW, pos[1]], [pos[0] + sizeW, pos[1] - sizeH], [pos[0], pos[1] - sizeH]];
    var fc = [0, 0], ic = [0, 0], i, dx, dy, fo, io, fA, fB, iA, iB, pairA, pairB;
    function dist2(a, b) {
        var x = a[0] - b[0], y = a[1] - b[1];
        return x * x + y * y;
    }
    function segmentsCross(a, b) {
        function cross(o, p, q) { return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]); }
        var d1 = cross(a[0], a[1], b[0]), d2 = cross(a[0], a[1], b[1]);
        var d3 = cross(b[0], b[1], a[0]), d4 = cross(b[0], b[1], a[1]);
        return d1 * d2 < 0 && d3 * d4 < 0;
    }
    function scoreList(pts, ox, oy, sx, sy) {
        var order = [], a, b, k, tmp;
        for (k = 0; k < 4; k++) { order.push({ i: k, s: (pts[k][0] - ox) * sx + (pts[k][1] - oy) * sy }); }
        for (a = 0; a < 4; a++) { for (b = a + 1; b < 4; b++) { if (order[b].s > order[a].s) { tmp = order[a]; order[a] = order[b]; order[b] = tmp; } } }
        return order;
    }
    for (i = 0; i < 4; i++) {
        fc[0] += frameQuad[i][0]; fc[1] += frameQuad[i][1];
        ic[0] += inset[i][0]; ic[1] += inset[i][1];
    }
    fc[0] /= 4; fc[1] /= 4; ic[0] /= 4; ic[1] /= 4;
    dx = ic[0] - fc[0]; dy = ic[1] - fc[1];
    fo = scoreList(frameQuad, fc[0], fc[1], dx, dy);
    io = scoreList(inset, ic[0], ic[1], -dx, -dy);
    fA = frameQuad[fo[0].i]; fB = frameQuad[fo[1].i];
    iA = inset[io[0].i]; iB = inset[io[1].i];
    /* Prefer the pairing that does not form an X; if neither/both, take shorter total length. */
    pairA = [[fA, iA], [fB, iB]];
    pairB = [[fA, iB], [fB, iA]];
    if (segmentsCross(pairA[0], pairA[1]) && !segmentsCross(pairB[0], pairB[1])) { return pairB; }
    if (segmentsCross(pairB[0], pairB[1]) && !segmentsCross(pairA[0], pairA[1])) { return pairA; }
    if (dist2(fA, iA) + dist2(fB, iB) <= dist2(fA, iB) + dist2(fB, iA)) { return pairA; }
    return pairB;
}
function sciBitmapInsetScale(group, placed, s) {
    var includeText = s.includeText !== false;
    if (!(s.fraction > 0 && s.fraction < 0.9) || !(s.lineWidth > 0 && s.lineWidth <= 20) ||
        (includeText && !(s.fontSize >= 4 && s.fontSize <= 72))) {
        throw new Error('Invalid scale bar settings');
    }
    var margin = s.margin >= 0 ? Number(s.margin) : 4;
    var textPad = includeText ? Number(s.fontSize) + 4 : Math.max(Number(s.lineWidth), 2);
    var start, end, color, line, label, b, left, top, right, bottom, frameW, frameH, barW, x0, lineY;
    var p, ux, uy, vx, vy, w, h, x, y, topEdge, botEdge, yBottom;
    /* Fresh linked PlacedItems often expose BL-first sciBitmapCorners (V toward
       visual top), so UV y=1 ("bottom") lands at the top. Prefer AI Y-up
       geometricBounds for Bottom-left / Bottom-right. */
    try {
        b = placed.geometricBounds;
        if (b && isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3])) {
            left = b[0]; top = b[1]; right = b[2]; bottom = b[3];
            frameW = right - left; frameH = top - bottom;
            if (frameW > 0.5 && frameH > 0.5) {
                barW = frameW * s.fraction;
                x0 = s.position === 'bottom-left' ? left + margin : right - margin - barW;
                lineY = bottom + margin + textPad;
                if (!(x0 >= left - 0.01 && x0 + barW <= right + 0.01 && lineY >= bottom - 0.01 && lineY <= top + 0.01)) {
                    throw new Error('Scale bar/margins do not fit inside this frame');
                }
                start = [x0, lineY];
                end = [x0 + barW, lineY];
                color = sciBitmapHexColor(s.color || '#ffffff');
                line = group.pathItems.add();
                line.setEntirePath([start, end]);
                line.filled = false; line.stroked = true; line.strokeWidth = s.lineWidth; line.strokeColor = color;
                try { line.strokeDashes = []; } catch (ignoreD) {}
                if (includeText) {
                    label = group.textFrames.add();
                    label.contents = String(s.label || '');
                    label.textRange.characterAttributes.size = s.fontSize;
                    sciBitmapApplyFigureType(label.textRange.characterAttributes, '', 'regular');
                    label.textRange.characterAttributes.fillColor = color;
                    label.position = [start[0] + (end[0] - start[0]) / 2 - label.width / 2, start[1] - (s.fontSize + 2)];
                }
                return;
            }
        }
    } catch (boundsErr) {
        if (boundsErr.message && /Scale bar\/margins/.test(String(boundsErr.message))) { throw boundsErr; }
    }
    p = sciBitmapCorners(placed);
    ux = p[1][0] - p[0][0]; uy = p[1][1] - p[0][1]; vx = p[3][0] - p[0][0]; vy = p[3][1] - p[0][1];
    w = Math.sqrt(ux * ux + uy * uy); h = Math.sqrt(vx * vx + vy * vy);
    x = s.position === 'bottom-left' ? margin / w : 1 - margin / w - s.fraction;
    topEdge = (p[0][1] + p[1][1]) * 0.5; botEdge = (p[2][1] + p[3][1]) * 0.5;
    yBottom = topEdge >= botEdge ? 1 : 0;
    y = yBottom === 1 ? 1 - (margin + textPad) / h : (margin + textPad) / h;
    if (x < 0 || x + s.fraction > 1 || y < 0 || y > 1) { throw new Error('Scale bar/margins do not fit inside this frame'); }
    start = [p[0][0] + x * ux + y * vx, p[0][1] + x * uy + y * vy];
    end = [start[0] + s.fraction * ux, start[1] + s.fraction * uy];
    color = sciBitmapHexColor(s.color || '#ffffff');
    line = group.pathItems.add();
    line.setEntirePath([start, end]);
    line.filled = false; line.stroked = true; line.strokeWidth = s.lineWidth; line.strokeColor = color;
    try { line.strokeDashes = []; } catch (ignoreD2) {}
    if (includeText) {
        label = group.textFrames.add();
        label.contents = String(s.label || '');
        label.textRange.characterAttributes.size = s.fontSize;
        sciBitmapApplyFigureType(label.textRange.characterAttributes, '', 'regular');
        label.textRange.characterAttributes.fillColor = color;
        label.position = [start[0] + (end[0] - start[0]) / 2 - label.width / 2, start[1] - (s.fontSize + 2)];
    }
}
