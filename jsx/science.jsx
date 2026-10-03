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
    var group=null;
    try {
        var info=sciBitmapAssertLock(lockJson),entry=sciBitmapFirstBitmapEntry(app.activeDocument.selection),item=entry.item,s=eval('('+specJson+')');
        if(item.typename!=='PlacedItem')throw new Error('Scale bar requires a linked placed image');
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
        // Separate top-level group: not baked into pixels or silently placed inside clipping groups.
        var nameSuffix=includeText?String(s.label||''):(s.length!=null?String(s.length)+(s.unit==='um'?' \u00b5m':' '+String(s.unit||'')):'bar');
        group=app.activeDocument.groupItems.add();group.name='SCI scale \u00b7 '+nameSuffix;
        var line=group.pathItems.add();line.setEntirePath([start,end]);line.filled=false;line.stroked=true;line.strokeWidth=s.lineWidth;line.strokeColor=color;
        if(includeText){
            var label=group.textFrames.add();label.contents=String(s.label);label.textRange.characterAttributes.size=s.fontSize;label.textRange.characterAttributes.fillColor=color;
            label.position=[start[0]+(end[0]-start[0])/2-label.width/2,start[1]-(s.fontSize+2)];
        }
        // The text stays upright for readability; the line follows source-X, including rotation/shear.
        group.note='SCI_SCALE_V1:'+sciBitmapJSON({objectKey:info.objectKey,sourcePath:info.sourcePath,calibration:s.calibration,displayPixelsX:s.displayPixelsX,length:s.length,unit:s.unit,includeText:includeText,corners:p,createdAt:(new Date()).toUTCString()});
        var old=[];for(var i=0;i<app.activeDocument.groupItems.length;i++){var g=app.activeDocument.groupItems[i];if(g===group)continue;try{if(g.note&&g.note.indexOf('SCI_SCALE_V1:')===0){var note=eval('('+g.note.substr(13)+')');if(note.objectKey===info.objectKey)old.push(g);}}catch(ignore){}}
        // New group is complete before replacing the prior generated bar.
        for(i=0;i<old.length;i++)old[i].remove();app.redraw();return sciBitmapResult({ok:true,label:s.label,includeText:includeText});
    }catch(e){if(group){try{group.remove();}catch(ignore){}}return sciBitmapFailure(e);}
}
/*
 * Inset / zoom box (0.9.0). Crops are already written in source-file pixels.
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
function sciBitmapArtboardRegion(lockJson, specJson) {
    try {
        var info = sciBitmapAssertLock(lockJson);
        var spec = eval('(' + specJson + ')');
        var sw = Number(spec.sourceWidth), sh = Number(spec.sourceHeight);
        var entry = sciBitmapFirstBitmapEntry(app.activeDocument.selection);
        var item = entry.item;
        var corners = sciBitmapCorners(item);
        var sel = app.activeDocument.selection;
        var path = null, i, pts = [], b, n, minX, minY, maxX, maxY, ux, uy, vx, vy, dx, dy, det, nx, ny, left, top, width, height;
        if (!(sw > 1 && sh > 1)) { throw new Error('Inset region is empty'); }
        for (i = 0; i < sel.length; i++) {
            if (!sel[i] || sel[i] === item) { continue; }
            if (sel[i].typename === 'PathItem' || sel[i].typename === 'CompoundPathItem') { path = sel[i]; break; }
        }
        if (!path) { throw new Error('Select the image and a rectangle to read an artboard region'); }
        if (path.pathPoints && path.pathPoints.length >= 2) {
            for (i = 0; i < path.pathPoints.length; i++) { pts.push(path.pathPoints[i].anchor); }
        } else if (path.geometricBounds) {
            b = path.geometricBounds;
            pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
        }
        if (pts.length < 2) { throw new Error('Select the image and a rectangle to read an artboard region'); }
        ux = corners[1][0] - corners[0][0]; uy = corners[1][1] - corners[0][1];
        vx = corners[3][0] - corners[0][0]; vy = corners[3][1] - corners[0][1];
        det = ux * vy - uy * vx;
        if (Math.abs(det) < 1e-8) { throw new Error('Singular artwork transform'); }
        minX = 1e9; minY = 1e9; maxX = -1e9; maxY = -1e9;
        for (i = 0; i < pts.length; i++) {
            dx = pts[i][0] - corners[0][0]; dy = pts[i][1] - corners[0][1];
            nx = (dx * vy - vx * dy) / det; ny = (ux * dy - uy * dx) / det;
            if (nx < minX) { minX = nx; } if (ny < minY) { minY = ny; }
            if (nx > maxX) { maxX = nx; } if (ny > maxY) { maxY = ny; }
        }
        if (minX < 0) { minX = 0; } if (minY < 0) { minY = 0; }
        if (maxX > 1) { maxX = 1; } if (maxY > 1) { maxY = 1; }
        /* Corner UV → file Y (no-op when corner[0] is visual top). */
        var fileY0 = sciBitmapFileNyToCornerNy(corners, minY);
        var fileY1 = sciBitmapFileNyToCornerNy(corners, maxY);
        var fileMinY = Math.min(fileY0, fileY1), fileMaxY = Math.max(fileY0, fileY1);
        left = Math.round(minX * sw); top = Math.round(fileMinY * sh);
        width = Math.round((maxX - minX) * sw); height = Math.round((fileMaxY - fileMinY) * sh);
        if (left + width > sw) { width = sw - left; }
        if (top + height > sh) { height = sh - top; }
        if (!(width > 1 && height > 1)) { throw new Error('Inset region is empty'); }
        return sciBitmapResult({ ok: true, left: left, top: top, width: width, height: height, objectKey: info.objectKey });
    } catch (e) { return sciBitmapFailure(e); }
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
        var corners, norm, mag, gap, anchor, frameW, frameH, sizeW, sizeH, bounds, pos, file, quad, i;
        var frameStyle, leaderStyle, ux, uy, vx, vy, x0, y0, x1, y1;
        var scaleSkipped = false, old, oldPaths, pi, placedPath, notePath;
        if (item.typename !== 'PlacedItem' || !item.file) { throw new Error('Inset requires a linked placed image'); }
        if (!s || !s.norm || !s.file) { throw new Error('Invalid inset settings'); }
        norm = s.norm;
        mag = Number(s.magnification);
        if (!(mag >= 1 && mag <= 20)) { throw new Error('Invalid inset settings'); }
        if (!(Number(norm.w) > 0.002 && Number(norm.h) > 0.002)) { throw new Error('Inset region is empty'); }
        if (Number(norm.x) < 0) { norm.w = Number(norm.w) + Number(norm.x); norm.x = 0; }
        if (Number(norm.y) < 0) { norm.h = Number(norm.h) + Number(norm.y); norm.y = 0; }
        if (Number(norm.x) + Number(norm.w) > 1) { norm.w = 1 - Number(norm.x); }
        if (Number(norm.y) + Number(norm.h) > 1) { norm.h = 1 - Number(norm.y); }
        frameStyle = s.frame || { weight: 1.5, color: '#ffffff', dashes: [], corner: 'miter', radius: 0 };
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
        } else if (anchor === 'above' || anchor === 'below') {
            sizeW = frameW;
            sizeH = sizeW / cropAspect;
        } else {
            sizeW = Number(norm.w) * frameW * mag;
            sizeH = Number(norm.h) * frameH * mag;
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
            ? ((Number(norm.w) > 0 && frameW > 0) ? (sizeW / (Number(norm.w) * frameW)) : mag)
            : ((Number(norm.h) > 0 && frameH > 0) ? (sizeH / (Number(norm.h) * frameH)) : mag);
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
            magnification: mag,
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
        return sciBitmapResult({ ok: true, magnification: mag, effectiveMagnification: effectiveMag, anchor: anchor, placedPath: file.fsName, scaleBar: s.scaleBar && !scaleSkipped, scaleSkipped: scaleSkipped, widthPt: sizeW, heightPt: sizeH });
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
    if (!(s.fraction > 0 && s.fraction < 0.9) || !(s.lineWidth > 0 && s.lineWidth <= 20) || !(s.fontSize >= 4 && s.fontSize <= 72)) {
        throw new Error('Invalid scale bar settings');
    }
    var margin = s.margin >= 0 ? Number(s.margin) : 4;
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
                lineY = bottom + margin + s.fontSize + 4;
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
                label = group.textFrames.add();
                label.contents = String(s.label || '');
                label.textRange.characterAttributes.size = s.fontSize;
                label.textRange.characterAttributes.fillColor = color;
                label.position = [start[0] + (end[0] - start[0]) / 2 - label.width / 2, start[1] - (s.fontSize + 2)];
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
    y = yBottom === 1 ? 1 - (margin + s.fontSize + 4) / h : (margin + s.fontSize + 4) / h;
    if (x < 0 || x + s.fraction > 1 || y < 0 || y > 1) { throw new Error('Scale bar/margins do not fit inside this frame'); }
    start = [p[0][0] + x * ux + y * vx, p[0][1] + x * uy + y * vy];
    end = [start[0] + s.fraction * ux, start[1] + s.fraction * uy];
    color = sciBitmapHexColor(s.color || '#ffffff');
    line = group.pathItems.add();
    line.setEntirePath([start, end]);
    line.filled = false; line.stroked = true; line.strokeWidth = s.lineWidth; line.strokeColor = color;
    try { line.strokeDashes = []; } catch (ignoreD2) {}
    label = group.textFrames.add();
    label.contents = String(s.label || '');
    label.textRange.characterAttributes.size = s.fontSize;
    label.textRange.characterAttributes.fillColor = color;
    label.position = [start[0] + (end[0] - start[0]) / 2 - label.width / 2, start[1] - (s.fontSize + 2)];
}
