# 0.6.0 module map

- `bitmap-panel.js`: existing RGB8 UI/selection/crop/cache workflow and a narrow scientific adapter. New scientific state is not added to its legacy pipeline.
- `scientific-panel.js`: raw object bindings, native-range controls, immutable group lock, raw batch orchestration and spatial calibration UI.
- `scientific-core.js`: pure uint8/uint16 mapping, exact histograms, strict clipping counts, native single-file TIFF/OME reader and calibration mathematics.
- `histogram-view.js`: drawing only; 256 log-count bins, range markers and red endpoint indicators.
- `raw-bridge.js`: serial task queue and a reusable Fiji process using a private filesystem inbox. No TCP listener or shell command concatenation.
- `scripts/raw-service.groovy`: headless Bio-Formats reader, single-plane selection, explicit pixel-type/memory checks, OME physical-size conversion and raw little-endian plane export. 10-minute idle timeout.
- `jsx/science.jsx`: four-corner fitting and vector line/text generation. Its content is included at the end of `jsx/bitmap.jsx` for a single host load; edit the source and synchronize the bundled copy when modifying it.
- `bitmap-core.js`, `bitmap-workflow.js`: retained RGB metadata, crop, blur, preset and baseline RGBA TIFF functions.

Raw display output is an 8-bit derivative; raw datasets remain the source of truth. Range lock is distinct from spatial calibration. A calibration cannot be copied merely because a display recipe is reused.

Known boundaries: no projection, CLAHE, raw spatial filtering, multi-file dataset support, or automatic scale-bar tracking. Backend Groovy and Adobe DOM still require actual host validation.

There is no automatic scale-bar tracking. The bar is a vector group created once from the pixel width and µm/px at that moment. If the placed image is scaled on its own afterward, the bar length does not follow. Create the bar again after that scale.

A legacy source stamp `size:mtime` is not treated as unchanged content. The panel shows “来源待重新确认” until the user confirms, then stores `sha256:`. Raw display records are written to a `.partial` file and renamed into place. If the image is already replaced and the record write fails, the panel says so and retries that record the next time it opens. Raw source hashing is chunked and asynchronous, and raw display rendering yields by rows, with separate reading, processing, and writing progress.

Primary implementation references:
- https://bio-formats.readthedocs.io/en/stable/developers/file-reader.html
- https://ome-model.readthedocs.io/en/latest/ome-tiff/specification.html
- https://imagej.net/learn/headless
- https://ai-scripting.docsforadobe.dev/jsobjref/PlacedItem/

## UI layout (0.5.2+) + Apply speed (0.5.4)

`client/index.html` keeps a sticky header (preview + primary actions + notice) and a compact tab bar. Tab panes host the previous long sections without renaming control IDs. Tab state is stored in `localStorage` key `sci_bitmap_active_tab`. Restore / Extra backup removed (0.5.6). Undo = Illustrator Ctrl/Cmd+Z.

## Apply speed (0.5.4)

Canvas path (`JPG/PNG/GIF/BMP`) in `bitmap-panel.js`, target ~1–3s typical JPG:

1. Order: process/encode → **relink artboard first** → never backup on Apply (Undo = Illustrator Ctrl/Cmd+Z).
2. `rasterizeWithCanvas` separated from write; settle warms `applyReadyCache`; Apply reuses warmed buffer or full-res `previewImageData` when dims match source.
3. Stage labels ZH/EN + per-stage ms in status (`lock` / `process` / `encode` / `relink`).
4. `loadImageElementFromPath` prefers `file://`, then Blob; Base64 last. Decoded Image cache reused.
5. `writeCanvasToImageFile` uses `blob.arrayBuffer` / async `fs.writeFile`; default PNG.
6. Post-Apply refresh seeds from cached source / processed canvas (no re-decode of output).
7. Removed from hot path: `maybeBackupBeforeApply`, sync `copyFileSync` before `replaceSelectedWithFile`, batch pre-replace backup copy.

## Apply refresh (0.5.5)

Bottleneck after fast encode: Illustrator host link resolve / screen paint, not CEP pixels.

1. `durableOutputPath` skips Downloads/Desktop/OneDrive (and similar); falls back to durable `paperfig-out` under LocalAppData/home (0.5.6).
2. `sciBitmapReplaceSelectedCore` times `relinkMs` (relink + fit + rotate/flip) vs `redrawMs` (`sciBitmapForceArtboardRefresh`: file touch, sub-point nudge, `app.redraw`×2).
3. Status shows host `relink Xs · redraw Ys` (plus stage ms). No backup on Apply.


## Apply truthfulness + durable links (0.5.6)

1. Host `sciBitmapPlaceReplaceExact`: place new linked PlacedItem, fit corners, remove old; verify `file.fsName` + exists. Relink is fallback only.
2. CEP `assertAppliedLink`: after host ok, require output exists (non-empty) and reported link path matches. Else clear error (no false Applied).
3. `durableFallbackDir`: `%LOCALAPPDATA%/paperfig-out` or `~/paperfig-out` — not `os.tmpdir()`. Linked display survives as long as that file remains.
4. Panel backup/copy/Restore fully removed. Backup removal never deletes the active linked derivative.



## Inset / zoom box (0.8.9)

Region L/T/W/H use the same overlay ↔ file mapping as crop (`overlayRectToSourceRect` / `sourceRectToOverlayRect`). The exported PNG is a 1:1 crop of the linked file (`identityPixels`, no tone ops); For left/right anchors the placed inset height matches the main image (top/bottom aligned) and width follows the crop aspect; for above/below anchors the placed inset width matches the main image (left/right aligned) and height follows the crop aspect. `umPerPixel` is unchanged (1:1 crop). Leaders connect the two facing corners with the non-crossing pairing (shorter length if tied) so they do not form an X. After sizing, orientation matches AI's inherent linked-image matrix (det < 0): only flip with resize(100,-100) when the fresh place has det > 0. Blind always-flip inverted upright crops. Inset border/leaders re-read geometricBounds after place so the stroke matches the pixels; panel crop L/T/W/H are rounded with the same cropRect used for rasterize so ROI UV matches the PNG. Axis-aligned ROI frames map file Y through geometricBounds (file top → artboard top) so BL-first `sciBitmapCorners` cannot lift the box; inset scale bars use geometricBounds for Bottom-* placement. A rotated linked preview bakes the display matrix before cropping (same as crop Apply); the vector frame uses the file-pixel AABB of that overlay on the placed quad. Host entry `sciBitmapInset` draws the ROI frame, a matching frame around the inset, and optional leaders (stroke weight, color, dash, corner/radius) and an optional scale bar on the inset (`displayPixelsX` = crop width). A prior `SCI_INSET_V1` group for the same `objectKey` is replaced. `sciBitmapArtboardRegion` maps a selected path through the inverse image quad into file pixels.

## Crop aspect / fixed size (0.5.7)

Crop L/T/W/H and Fixed W×H are always **source-file pixels**. After rotate/flip, if preview is artboard-oriented (`previewOrientSwap`), the marquee and pointer map display↔file (`sourceRectToDisplayRect` / `displayPointToSource` / handle remap); Apply still crops file pixels via `Core.cropRect`. Aspect presets and numeric W↔H sync live in `bitmap-core.js` + Geom tab controls. Fast Apply / no-backup path unchanged.



## JPEG EXIF preview orient (0.9.6)

Canvas decode of linked/embedded JPEG reads APP1 EXIF Orientation (1–8) via `Core.readMetadata` / `exifOrientationTransform`. After `Image()` decode, `ensurePreviewMatchesArtboardOrient` bakes a transform **only** when the preview aspect (plus linked CSS matrix AABB, if any) still disagrees with artboard `widthPt×heightPt`. Orientation=1 and already-matching files are untouched. Storage SOF size stays in `sourceImageSize` for crop Apply; when EXIF was baked or the decoder already oriented, `previewBakedExif` forces identity CSS (no double rotate) and `artboardOrientActive` maps display↔file pixels. TIFF/PNG/raw and live rotate/flip paths unchanged.

## Preview orient + crop hit-testing (0.5.9)

After live rotate/flip, `refreshPanelPreviewAfterGeom` keeps the instant-oriented buffer (`keepPreviewUntilLoad`), stamps `lastFingerprint` to avoid poll re-entry, and reloads with `preferAi`. If AI capture is busy/fails, Canvas decode + `bakeArtboardOrientIntoPreview` runs; last resort is `applyCssOrientFallback` (CSS rotate/scaleX). Crop overlay is a **stage sibling** of `#previewTransform` (not clipped by transform `overflow`). Canvas/transform/checker use `pointer-events: none`; overlay keeps `pointer-events: auto`. Marquee mode uses geometric `Core.hitTestCrop` in display space (then file mapping), not `event.target` alone.

## Preview orient after rotate (0.5.8)

Live rotate/flip invalidates the panel preview cache and reloads with `preferAi` (AI `imageCapture` of the placed item). Canvas-capable sources fall back to file decode + **display transform** (`bakeArtboardOrientIntoPreview` / `transformRgbaBuffer`) so the panel matches artboard orientation without Fiji. Crop marquee edits on the oriented preview; L/T/W/H remain **file pixels** via `displayPointToSource` / `sourceRectToDisplayRect` for 0/90/180/270° and matrix reflection. Instant CSS/buffer feedback runs before the async refresh. Fast Apply / no-backup path unchanged from 0.5.6–0.5.7.


## Crop Apply upright geometry (0.6.0)

Root cause of diagonal stretch after crop: `sciBitmapPlaceReplaceExact` / FitCorners forced new pixels into the **previous** rotated/sheared `geometricBounds`, so a 4:3 crop was stretched into the old long diagonal frame.

On Apply **when crop L/T/W/H is set** (not artboard preview — Cancel must restore old frame): host place-replaces, then sizes the new PlacedItem to the **cropped pixel aspect**, centered on the old frame, with **identity orientation** (no FitCorners). Non-crop Apply still preserves geometry via FitCorners. Crop overlay move uses `moveCropBox` (translate only); aspect ratio applies only to draw/resize. File-px crop numbers unchanged.

## Crop overlay axis-aligned (0.6.3)

Preview (`#previewTransform`) still applies the linked PlacedItem display matrix. The crop overlay is a stage sibling and **must not** copy that matrix — it draws and hit-tests as an axis-aligned rect in panel/stage coordinates. Flat screen crop rects map through the inverse display matrix (`Core.screenRectToSourceAABB`) into file L/T/W/H; overlay redraw uses `Core.sourceRectToScreenAABB`. Apply with crop still uses `geomOptsForCropReplace` → `sciBitmapPlaceUprightCrop` (identity orientation, aspect = cropped pixels).



## Crop free-drag + bake Apply (0.6.4)

Linked CSS-matrix preview: crop L/T/W/H are **flat overlay** coords (same space as hit-test). Interaction no longer stores AABB via `screenRectToSourceAABB` (that inflated the box after pointer-up). Move uses `moveCropBox` + `keepCropSize`. Apply with non-identity `linkedPreviewMatrix` sets `cropDisplaySpace` + `displayMatrix`, bakes the matrix about image center in `rasterizeWithCanvas`, then crops the overlay rect; host still `sciBitmapPlaceUprightCrop`. Embedded artboard-orient path keeps file-px + quarter-turn transpose.

## Apply preview baseline (0.6.6 → 0.8.1 provenance)

Root cause of 0.6.5 still showing the old strip + crop after Apply: `rememberRecipe` / processing sidecar made `sourceFor(newLink)` return the **pre-Apply original**, and quiet selection poll → `showPreview` → `switchDraft` restored the saved crop. Artboard was correct; panel preview was overwritten.

After Apply+reset, `rerootAppliedBaseline(key, out)` still re-roots the **recipe map** at `out` (empty outputs) and updates `shownSource`/`shownShape` via `seedPreviewFromProcessed`. Crop overlay hides when W/H are 0. No change to bake/rotation/crop Apply math.

**0.8.1 write-once records (replaces in-place `applied-baseline` rewrite):** 0.6.6–0.8.0 overwrote `<out>.json` in place (`role=applied-baseline`, `source→out`, crop cleared), destroying provenance. Now:

- `<out>.json` — processing record written once (status may move prepared→applied / not-applied); **never** rewritten to clear `source`/crop or flip `role`. Keeps source, sourceStamp, recipe, crop, calibration.
- `<out>.baseline.json` — separate marker (`schema: paperfig-baseline-marker`) meaning "panel baseline; do not remap to source". Carries `provenance` path + `provenanceSha256` of the untouched record. Deleting the marker only changes panel behaviour.
- Legacy 0.8.0 sidecars with `role=applied-baseline` remain recognised by `isAppliedBaseline`, but their original `source` cannot be recovered from that file.
- **Lineage:** when Apply input is itself a PaperFig output, `recipeSidecar` sets `parent` (`path`, `record`, `recordSha256`, `source`, `origin`) so chained Applies trace back to the acquisition.
- Scale-bar / sidecar recovery honour the marker (`displayPixelsX` uses crop width while status=`applied` and not baseline; linked file width after reroot / marker).

Raw path asymmetry: Raw Apply keeps binding to the acquisition and does **not** currently write `.baseline.json` or `parent` on `sci-raw-display` records; recovery still *honours* a marker / legacy `applied-baseline` if present.

## Apply preview refresh (0.6.5)

`workflowApply` (non-preview) after successful relink must treat the **new output file** as the panel baseline:

1. `invalidatePanelPreviewCache(source)` + `invalidateDecodedImage(out)` + `invalidateApplyReady()`
2. `resetAdjustmentsAfterApply(true)` — zeros crop L/T/W/H and tone/geom UI
3. `lastSourcePath = out`
4. Prefer `seedPreviewFromProcessed(processed, replaced.info)` (baked canvas = cropped upright pixels)
5. Fallback `refreshPanelPreviewAfterGeom()` (inspect + `showPreview` skipCache)

Do **not** call `seedPreviewFromCachedSource(source, …)` here — that reuses the pre-Apply full image and leaves the crop overlay looking “stuck” on the old strip while the artboard already shows the crop.


## Fluorescence keep-channel (0.7.0)

RGB tab (`Fluorescence / 荧光通道`): R/G/B are **display planes** of an 8-bit composite, not acquisition C. Keep checkboxes / quick buttons (1 or 2 of 3) zero hidden planes on preview and Apply via `mapChannels` (visibility honored even when recoloring was off; UI auto-enables mapping). Solo grayscale in `channelView` remains preview-only.

Raw tab: acquisition channels named from OME (else C1/C2/C3). Same keep checkboxes drive `recipe.channels[].visible` in `scientific-core.render`. Quick buttons target the first three channels; datasets may still expose up to 8.


## Preview zoom for scale endpoints

Panel preview magnify (`previewViewZoom` / `previewViewPanX/Y`) scales the same object-fit contain box used by `#previewTransform`, the crop overlay, and `pointerToImagePx`. Fit is zoom 1 with pan 0 (CSS translate string unchanged). Scroll/pinch and − / + zoom about the cursor; Fit resets. Space-drag or middle-drag pans while zoomed. Changing the selected object resets to fit. Scale-bar endpoint picks stay on the preview and use the zoomed box, so source-pixel coordinates stay correct. Crop default (full image), F·M preview orientation, pick-mode vs selection poll, and spatial-metadata status are unchanged.

**Zoom must enlarge the bitmap:** `#previewTransform` is sized in JS to `fitW×zoom` / `fitH×zoom`. Do **not** put CSS `max-width` / `max-height` on that box (a prior `96%` cap left the label at 1600% while the canvas stayed fit-sized). `syncTransformBoxSize` also forces `maxWidth/maxHeight: none`. Stage `overflow: hidden` still clips; pan uses the translate offset. Pointer mapping continues to use the same layout box.

## Per-image spatial calibration persistence

localStorage key `sci_calibrations_v1` maps `objectKey` (document + PlacedItem uuid) → calibration record (`method`, `umPerPixelX/Y`, `input` endpoints/µm, `source`, `sourceStamp`, `sourcePixels`). Last successful save is also kept in `sci_calibration_last_v1` for the optional **Reuse last** button only.

On image select, Scale UI restores that object's saved method / field size / reference length / two-point endpoints. Switching to an **uncalibrated** image clears those calibration fields (does **not** silently reuse another image's µm/px). Bar style (length/line/font/margin/position/color) stays sticky as UI preference.

Refresh / Apply / reopen do not clear a saved calibration. Place-replace after Apply changes `objectKey`; `rememberReplacementIdentity` / raw Apply call `migrateCalibration(oldKey, newKey)`. Lookup also re-adopts a calibration embedded in the display sidecar `*.json` when the objectKey entry is missing.

## Crop-independent spatial calibration

`umPerPixelX/Y` and two-point endpoints are stored in **full-source file pixel space** (`coordSpace: 'full-source'`), never relative to the active crop L/T/W/H.

- Field calibration uses full raw/file `sourcePixels` width/height (not crop W×H).
- Endpoint picks use `pointerToImagePx` (file px). Crop overlay / Use full image ↔ crop does **not** clear `sci_calibrations_v1` or rewrite µm/px (`onCropChanged` only refreshes status).
- Vector scale bar: `displayPixelsX` = currently placed pixel width (sidecar crop width when status=`applied` and not a baseline marker / legacy `applied-baseline`, or linked file width after Apply+reroot / `.baseline.json`). Fraction = `barUm / (umPerPixelX * displayPixelsX)` so the same calibration works before and after crop without re-picking.
- Place-replace still migrates the calibration to the new `objectKey`.

