/* Crop and inset marquee. Installed into the panel via PaperFigMarquee.install(api). See LICENSE. */
(function (root) {
  'use strict';
  function install(api) {
  var insetAspectToken = '';
  window.__pfAspectChosen = function (id, val) {
    if (id === 'insetAspectMode') { commitInsetAspect(val); }
  };
  function syncCropAspectUi() {
    var mode = (api.byId('cropAspectMode') && api.byId('cropAspectMode').value) || 'free';
    var custom = api.byId('cropCustomAspect');
    var fixed = api.byId('cropFixedSize');
    var stage = api.byId('previewStage');
    var fixedLike = (mode === 'fixed' || mode === 'source-px');
    if (custom) {
      if (mode === 'custom') { custom.hidden = false; custom.classList.remove('hidden'); }
      else { custom.hidden = true; custom.classList.add('hidden'); }
    }
    if (fixed) {
      if (fixedLike) { fixed.hidden = false; fixed.classList.remove('hidden'); }
      else { fixed.hidden = true; fixed.classList.add('hidden'); }
    }
    if (stage) { stage.classList.toggle('crop-fixed', fixedLike); }
    updateCropSizeHint();
  }

  function getCropAspectMode() {
    return (api.byId('cropAspectMode') && api.byId('cropAspectMode').value) || api.settings.cropAspectMode || 'free';
  }

  /* >0 = W/H ratio in FILE px; 0 = free; -1 = fixed / original-file FILE px size. */
  function getActiveCropAspect() {
    var mode = getCropAspectMode();
    if (mode === 'fixed' || mode === 'source-px') { return -1; }
    return api.Core.cropAspectRatio(mode,
      api.byId('cropAspectW') && api.byId('cropAspectW').value,
      api.byId('cropAspectH') && api.byId('cropAspectH').value);
  }

  /* Fixed W×H always in original source-file pixels. */
  function getFixedCropSize() {
    return {
      width: Math.max(1, Math.round(Number(api.byId('cropFixedW') && api.byId('cropFixedW').value) || api.settings.cropFixedW || 512)),
      height: Math.max(1, Math.round(Number(api.byId('cropFixedH') && api.byId('cropFixedH').value) || api.settings.cropFixedH || 512))
    };
  }

  /* True linked-file pixel size only — never artboard/display layout fallback.
   * Used by “Original file px” crop so Place scale cannot skew the crop box. */
  function getStrictSourcePixelSize() {
    if (api.sourceImageSize && api.sourceImageSize.width > 0 && api.sourceImageSize.height > 0) {
      return { width: api.sourceImageSize.width, height: api.sourceImageSize.height };
    }
    return null;
  }

  function updateCropSizeHint() {
    var hint = api.byId('imageSizeHint');
    var mode = getCropAspectMode();
    var src = (mode === 'source-px') ? getStrictSourcePixelSize() : getCropSourceSize();
    if (!hint) { return; }
    if (src && src.width > 0 && src.height > 0) {
      hint.textContent = api.t('imageSizeFile', { w: src.width, h: src.height });
    } else {
      hint.textContent = '';
    }
  }

  function nearestQuarterTurns(rotationDeg) {
    var a = Number(rotationDeg) || 0;
    a = ((a % 360) + 360) % 360;
    if (a > 315 || a <= 45) { return 0; }
    if (a <= 135) { return 1; }
    if (a <= 225) { return 2; }
    return 3;
  }

  /* True when bitmap matrix includes a *user* reflection (Flip H/V).
   * Linked PlacedItem upright placement uses det<0 (inherent negative D).
   * RasterItem/embedded upright uses det>0. A user flip flips the det sign. */
  function matrixHasReflection(matrix) {
    var a, b, c, d, det;
    if (!matrix || matrix.length < 4) { return false; }
    a = Number(matrix[0]) || 0;
    b = Number(matrix[1]) || 0;
    c = Number(matrix[2]) || 0;
    d = Number(matrix[3]) || 0;
    det = a * d - b * c;
    if (api.lastSelectedItem && api.lastSelectedItem.linked) { return det > 0; }
    return det < 0;
  }

  function previewNeedsArtboardOrient() {
    if(api.lastSelectedItem && api.lastSelectedItem.linked)return false;
    return nearestQuarterTurns(api.lastRotationDeg) !== 0 ||
      matrixHasReflection(api.lastSelectedItem && api.lastSelectedItem.matrix);
  }

  function artboardOrientActive() {
    /* Linked normally uses CSS-matrix overlay crop. When EXIF was baked into
     * preview pixels to match the artboard, use file↔display mapping instead. */
    if (api.lastSelectedItem && api.lastSelectedItem.linked && !api.previewBakedExif) { return false; }
    return !!(api.previewMatchesArtboard || api.previewOrientSwap);
  }

  /*
   * Display handle labels sit on the artboard-oriented overlay. When preview is
   * artboard-oriented, map them to FILE-space edges/corners so resize stays in source px.
   */
  function mapHandleToFileSpace(handle) {
    var turns;
    var map90 = { n: 'e', e: 's', s: 'w', w: 'n', nw: 'ne', ne: 'se', se: 'sw', sw: 'nw' };
    var map180 = { n: 's', e: 'w', s: 'n', w: 'e', nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };
    var map270 = { n: 'w', e: 'n', s: 'e', w: 's', nw: 'sw', ne: 'nw', se: 'ne', sw: 'se' };
    var flipMap = { n: 'n', s: 's', e: 'w', w: 'e', nw: 'ne', ne: 'nw', se: 'sw', sw: 'se' };
    var out = handle;
    if (!handle || !artboardOrientActive()) { return handle; }
    turns = nearestQuarterTurns(api.lastRotationDeg);
    if (turns === 1) { out = map90[handle] || handle; }
    else if (turns === 2) { out = map180[handle] || handle; }
    else if (turns === 3) { out = map270[handle] || handle; }
    if (matrixHasReflection(api.lastSelectedItem && api.lastSelectedItem.matrix)) {
      out = flipMap[out] || out;
    }
    return out;
  }

  /* Apply aspect/fixed/source-px mode to current FILE-px crop (L/T/W/H fields). */
  function applyAspectModeToCurrentCrop() {
    var mode = getCropAspectMode();
    var src;
    var rect;
    var aspect;
    var fixed;
    var next;
    if (mode === 'source-px') {
      src = getStrictSourcePixelSize();
      if (!src || !(src.width > 0 && src.height > 0)) {
        syncCropAspectUi();
        api.notice(api.t('errNeedSourcePixels'), 'error');
        return;
      }
    } else {
      src = getCropSourceSize();
    }
    if (!src || !(src.width > 0 && src.height > 0)) { syncCropAspectUi(); return; }
    rect = readCropRect();
    if (!rect.width || !rect.height) {
      rect = { left: 0, top: 0, width: src.width, height: src.height };
    }
    if (mode === 'fixed' || mode === 'source-px') {
      fixed = getFixedCropSize();
      next = api.Core.placeFixedRect(
        rect.left + (rect.width - fixed.width) / 2,
        rect.top + (rect.height - fixed.height) / 2,
        fixed.width, fixed.height, src.width, src.height);
      writeCropRect(next.left, next.top, next.width, next.height);
      if (mode === 'source-px') {
        api.notice(api.t('sourcePxApplied', { w: next.width, h: next.height }));
      }
    } else {
      aspect = getActiveCropAspect();
      if (aspect > 0) {
        next = api.Core.fitAspectRect(rect.left, rect.top, rect.width, rect.height,
          aspect, src.width, src.height);
        writeCropRect(next.left, next.top, next.width, next.height, { aspectReady: true });
      }
    }
    syncCropAspectUi();
    updateCropOverlay();
  }

  /* Numeric W/H input with FILE-px ratio lock (changing W updates H, etc.). */
  function onCropNumericInput(changedField) {
    var src = (getCropAspectMode() === 'source-px')
      ? (getStrictSourcePixelSize() || getCropSourceSize())
      : getCropSourceSize();
    var rect = readCropRect();
    var aspect = getActiveCropAspect();
    var next;
    var iw = src && src.width;
    var ih = src && src.height;
    if (aspect < 0) {
      /* Fixed / original-file-px: W/H fields follow fixed FILE size; L/T move only. */
      next = getFixedCropSize();
      if (iw > 0) { next.width = Math.min(next.width, iw); }
      if (ih > 0) { next.height = Math.min(next.height, ih); }
      writeCropRect(rect.left, rect.top, next.width, next.height, { quiet: true });
      api.scheduleSaveSettings();
      return;
    }
    if (aspect > 0 && (changedField === 'cropWidth' || changedField === 'cropHeight') &&
        (rect.width > 0 || rect.height > 0)) {
      next = api.Core.fitAspectRect(rect.left, rect.top,
        changedField === 'cropHeight' ? Math.round((rect.height || 1) * aspect) : (rect.width || 1),
        changedField === 'cropHeight' ? (rect.height || 1) : Math.round((rect.width || 1) / aspect),
        aspect, iw || 0, ih || 0);
      writeCropRect(next.left, next.top, next.width, next.height, { quiet: true, aspectReady: true });
    } else {
      writeCropRect(rect.left, rect.top, rect.width, rect.height, { quiet: true });
    }
    api.scheduleSaveSettings();
  }

  function readCropRect() {
    return {
      left: Math.max(0, Math.round(Number(api.byId('cropLeft').value) || 0)),
      top: Math.max(0, Math.round(Number(api.byId('cropTop').value) || 0)),
      width: Math.max(0, Math.round(Number(api.byId('cropWidth').value) || 0)),
      height: Math.max(0, Math.round(Number(api.byId('cropHeight').value) || 0))
    };
  }

  function writeCropRect(left, top, width, height, opts) {
    var src = (getCropAspectMode() === 'source-px') ? (getStrictSourcePixelSize() || getCropSourceSize()) : getCropSourceSize();
    var iw = src && src.width;
    var ih = src && src.height;
    var quiet = opts && opts.quiet;
    var keepCropSize = opts && opts.keepCropSize;
    var moved;
    left = Math.round(left);
    top = Math.round(top);
    width = Math.max(0, Math.round(width));
    height = Math.max(0, Math.round(height));
    if (api.marqueeMode === 'inset') {
      if (width > 0 && height > 0 && api.Core.fitAspectRect) {
        var keepInset = width / height;
        var fittedInset = api.Core.fitAspectRect(left, top, width, height, keepInset, iw || 0, ih || 0);
        left = fittedInset.left;
        top = fittedInset.top;
        width = fittedInset.width;
        height = fittedInset.height;
      }
      writeInsetRect(left, top, width, height, opts);
      updateCropOverlay();
      return;
    }
    if ((keepCropSize || (opts && opts.aspectReady)) && width > 0 && height > 0 && api.Core.moveCropBox) {
      /* Move: never shrink W×H — only translate inside the image. */
      moved = api.Core.moveCropBox(left, top, width, height, iw || 0, ih || 0);
      left = moved.left; top = moved.top; width = moved.width; height = moved.height;
    } else {
      /* Size edits: cap to image; prefer shifting origin over shrinking when possible. */
      if (iw > 0) {
        if (width > iw) { width = iw; }
        if (left < 0) { left = 0; }
        if (width > 0 && left + width > iw) { left = Math.max(0, iw - width); }
        if (width <= 0 && left > iw) { left = iw; }
      } else {
        left = Math.max(0, left);
      }
      if (ih > 0) {
        if (height > ih) { height = ih; }
        if (top < 0) { top = 0; }
        if (height > 0 && top + height > ih) { top = Math.max(0, ih - height); }
        if (height <= 0 && top > ih) { top = ih; }
      } else {
        top = Math.max(0, top);
      }
    }
    /* Width/Height 0 = full image convention when both zero. */
    api.byId('cropLeft').value = left;
    api.byId('cropTop').value = top;
    api.byId('cropWidth').value = width;
    api.byId('cropHeight').value = height;
    if (!quiet) {
      api.saveSettings();
      /* Crop must not clear per-image calibration / umPerPixel (full-source). */
      if (api.science && api.science.onCropChanged) { api.science.onCropChanged(); }
    }
    updateCropSizeHint();
    updateCropOverlay();
  }

  /* Screen box for a file/layout rect. One scale on both axes so 16:9 numbers stay 16:9.
     Separate width/iw and height/ih scales turned a 16:9 rect into a square when the
     preview frame was square. */
  function pinOverlayStyle(overlay, prop, value) {
    overlay.style.setProperty(prop, value, 'important');
  }

  function placeMarqueeOverlay(overlay, left, top, width, height, iw, ih, contain) {
    var boxLeft;
    var boxTop;
    var scale;
    var wpx;
    var hpx;
    if (!overlay || !(iw > 0) || !(ih > 0) || !(width > 0) || !(height > 0)) { return; }
    if (contain && contain.boxW > 0 && contain.boxH > 0) {
      scale = contain.boxW / iw;
      boxLeft = (contain.stageW - contain.boxW) / 2 + (contain.panX || 0);
      boxTop = (contain.stageH - contain.boxH) / 2 + (contain.panY || 0);
      wpx = Math.max(1, Math.round(width * scale));
      hpx = Math.max(1, Math.round(height * scale));
      pinOverlayStyle(overlay, 'left', Math.round(boxLeft + left * scale) + 'px');
      pinOverlayStyle(overlay, 'top', Math.round(boxTop + top * scale) + 'px');
      pinOverlayStyle(overlay, 'width', wpx + 'px');
      pinOverlayStyle(overlay, 'height', hpx + 'px');
      pinOverlayStyle(overlay, 'min-width', wpx + 'px');
      pinOverlayStyle(overlay, 'max-width', wpx + 'px');
      pinOverlayStyle(overlay, 'min-height', hpx + 'px');
      pinOverlayStyle(overlay, 'max-height', hpx + 'px');
    } else {
      scale = 100 / iw;
      pinOverlayStyle(overlay, 'left', (left * scale) + '%');
      pinOverlayStyle(overlay, 'top', (top * scale) + '%');
      pinOverlayStyle(overlay, 'width', (width * scale) + '%');
      pinOverlayStyle(overlay, 'height', (height * scale) + '%');
      pinOverlayStyle(overlay, 'min-width', '0');
      pinOverlayStyle(overlay, 'max-width', 'none');
      pinOverlayStyle(overlay, 'min-height', '0');
      pinOverlayStyle(overlay, 'max-height', 'none');
    }
    pinOverlayStyle(overlay, 'right', 'auto');
    pinOverlayStyle(overlay, 'bottom', 'auto');
    pinOverlayStyle(overlay, 'margin', '0');
    pinOverlayStyle(overlay, 'transform', 'none');
  }

  function liveOverlayAgrees(live, width, height) {
    var liveAspect;
    var fieldAspect;
    if (!live || !(live.width > 0) || !(live.height > 0) || !(width > 0) || !(height > 0)) { return false; }
    liveAspect = live.width / live.height;
    fieldAspect = width / height;
    if (!(liveAspect > 0) || !(fieldAspect > 0)) { return false; }
    return Math.abs(liveAspect - fieldAspect) / fieldAspect <= 0.02;
  }

  function updateCropOverlay() {
    var overlay = api.byId('cropOverlay');
    var rect = api.marqueeMode === 'inset' ? readInsetRect() : readCropRect();
    var layout = api.getPreviewLayoutSize();
    var contain = getSourceContainLayout();
    var iw = (layout && layout.width) || (api.lastImageSize && api.lastImageSize.width);
    var ih = (layout && layout.height) || (api.lastImageSize && api.lastImageSize.height);
    var src = getCropSourceSize();
    var stage = api.byId('previewStage');
    var left = rect.left;
    var top = rect.top;
    var width = rect.width;
    var height = rect.height;
    var full;
    var disp;
    var boxLeft;
    var boxTop;

    if (!overlay) { updateInsetOverlay(); return; }
    if (!api.previewIsSource || (api.marqueeMode !== 'inset' && (api.marqueeMode !== 'crop' || !api.cropDrawArmed))) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      updateInsetOverlay();
      return;
    }
    /* Show whenever pixel size is known — including TIFF (no canvas decode). */
    if (!iw || !ih) {
      overlay.classList.add('hidden');
      updateInsetOverlay();
      return;
    }
    if (stage && !stage.classList.contains('has-image') && !stage.classList.contains('has-canvas')) {
      stage.classList.add('has-crop-size');
    }

    /* Crop fields are file-px; overlay stays axis-aligned in stage coords.
     * During drag, prefer the live flat screen rect so rotation AABB round-trips
     * do not inflate/jitter the box while the user is still drawing.
     * W/H unset (0) = no active crop — hide overlay (post-Apply clear). */
    full = !width || !height;
    if (full) {
      if (!(api.cropDrag && api.cropDrag.liveOverlay && api.cropDrag.liveOverlay.width > 0 && api.cropDrag.liveOverlay.height > 0)) {
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
        updateInsetOverlay();
        return;
      }
      if (src && src.width > 0 && src.height > 0) {
        left = 0; top = 0; width = src.width; height = src.height;
      } else {
        left = 0; top = 0; width = iw; height = ih;
      }
    }
    if (api.cropDrag && liveOverlayAgrees(api.cropDrag.liveOverlay, width, height)) {
      left = api.cropDrag.liveOverlay.left;
      top = api.cropDrag.liveOverlay.top;
      width = api.cropDrag.liveOverlay.width;
      height = api.cropDrag.liveOverlay.height;
    } else {
      disp = sourceRectToOverlayRect({ left: left, top: top, width: width, height: height }, iw, ih);
      left = disp.left; top = disp.top; width = disp.width; height = disp.height;
    }

    api.syncTransformBoxSize();
    placeMarqueeOverlay(overlay, left, top, width, height, iw, ih, contain);
    overlay.style.transformOrigin = '';
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    updateInsetOverlay();
  }

  /*
   * Object-fit:contain display box for the preview aspect inside the stage.
   * Box aspect follows api.getPreviewLayoutSize() (artboard-oriented / api.previewBase)
   * so the canvas is never squashed into a mismatched wide/tall frame.
   * iw/ih stay in crop UI space (same aspect as the box when reconciled).
   */
  function getSourceContainLayout() {
    var stage = api.byId('previewStage');
    var layout = api.getPreviewLayoutSize();
    var iw = layout && layout.width;
    var ih = layout && layout.height;
    var sw;
    var sh;
    var margin = 0.04;
    var availW;
    var availH;
    var ar;
    var boxW;
    var boxH;
    if (!stage || !iw || !ih) { return null; }
    sw = stage.clientWidth || 300;
    sh = stage.clientHeight || 280;
    availW = Math.max(1, sw * (1 - 2 * margin));
    availH = Math.max(1, sh * (1 - 2 * margin));
    ar = iw / Math.max(1, ih);
    if (availW / availH > ar) {
      boxH = availH;
      boxW = boxH * ar;
    } else {
      boxW = availW;
      boxH = boxW / ar;
    }
    var affine=linkedPreviewMatrix();
    var fit=Math.min(1,availW/(Math.abs(affine[0])*boxW+Math.abs(affine[2])*boxH),availH/(Math.abs(affine[1])*boxW+Math.abs(affine[3])*boxH));
    boxW*=fit;boxH*=fit;
    var fitW = Math.max(1, boxW);
    var fitH = Math.max(1, boxH);
    var zoom = Number(api.previewViewZoom);
    var panX = Number(api.previewViewPanX) || 0;
    var panY = Number(api.previewViewPanY) || 0;
    var maxX;
    var maxY;
    if (!isFinite(zoom) || zoom < 1) { zoom = 1; }
    if (zoom > api.PREVIEW_ZOOM_MAX) { zoom = api.PREVIEW_ZOOM_MAX; }
    if (!isFinite(panX)) { panX = 0; }
    if (!isFinite(panY)) { panY = 0; }
    boxW = fitW * zoom;
    boxH = fitH * zoom;
    if (zoom <= 1.001) {
      zoom = 1;
      panX = 0;
      panY = 0;
      boxW = fitW;
      boxH = fitH;
    } else {
      maxX = Math.max(0, (boxW - sw) / 2 + 8);
      maxY = Math.max(0, (boxH - sh) / 2 + 8);
      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
    }
    return {
      boxW: Math.max(1, boxW),
      boxH: Math.max(1, boxH),
      fitW: fitW,
      fitH: fitH,
      zoom: zoom,
      panX: panX,
      panY: panY,
      stageW: sw,
      stageH: sh,
      iw: iw,
      ih: ih
    };
  }

  /* Client-rect of the contain box (unrotated layout; ignores brief CSS rotate). */
  /*
   * AI document space is Y-up; CSS / decoded pixels are Y-down.
   * PlacedItem matrices already include an inherent negative D so image buffers
   * display upright on the artboard. Convert with F*M (negate B and D) — not
   * F*M*F (negate B and C) — or upright images stay scaleY(-1) in the panel.
   * Keep source buffers immutable; use the same affine map for pixels and crop.
   */
  function linkedPreviewMatrix() {
    var m=api.lastSelectedItem && api.lastSelectedItem.linked && api.lastSelectedItem.matrix;
    if (!m || m.length<4) return [1,0,0,1];
    var a=Number(m[0]),b=-Number(m[1]),c=Number(m[2]),d=-Number(m[3]);
    var k=Math.max(Math.sqrt(a*a+b*b),Math.sqrt(c*c+d*d));
    if (!isFinite(k) || k<1e-10 || Math.abs(a*d-b*c)<1e-12) return [1,0,0,1];
    return [a/k,b/k,c/k,d/k];
  }

  function getDisplayedImageClientRect() {
    var stage = api.byId('previewStage');
    var layout = getSourceContainLayout();
    var sr;
    if (!stage || !layout) { return null; }
    sr = stage.getBoundingClientRect();
    return {
      left: sr.left + (sr.width - layout.boxW) / 2 + (layout.panX || 0),
      top: sr.top + (sr.height - layout.boxH) / 2 + (layout.panY || 0),
      width: layout.boxW,
      height: layout.boxH,
      iw: layout.iw,
      ih: layout.ih
    };
  }

  /*
   * Crop fields are always in ORIGINAL FILE pixel space (0.3.0).
   * Preview may show artboard-oriented aspect (swap); map display↔source for
   * pointer / overlay. Covers ~90° CCW/CW; flips assumed already in AI capture
   * after live Flip (UI flip flags reset). Mental cover: 90° + prior Flip H —
   * capture shows flipped artboard; rotationDeg maps display→file.
   */
  function getCropSourceSize() {
    var src = api.getSourcePixelSize();
    if (src && src.width > 0 && src.height > 0) { return src; }
    return api.lastImageSize;
  }

  function displayPointToSource(dx, dy, dispW, dispH, srcW, srcH, rotationDeg) {
    var turns;
    var sx = dx;
    var sy = dy;
    var flip;
    if (!(srcW > 0 && srcH > 0)) { return { x: dx, y: dy }; }
    if (!artboardOrientActive()) {
      return {
        x: Math.max(0, Math.min(srcW, dx)),
        y: Math.max(0, Math.min(srcH, dy))
      };
    }
    turns = nearestQuarterTurns(rotationDeg);
    /* Inverse of source→display (CCW quarter turns on file pixels). */
    if (turns === 1) {
      sx = srcW - dy;
      sy = dx;
    } else if (turns === 2) {
      sx = srcW - dx;
      sy = srcH - dy;
    } else if (turns === 3) {
      sx = dy;
      sy = srcH - dx;
    } else {
      sx = dx;
      sy = dy;
    }
    flip = matrixHasReflection(api.lastSelectedItem && api.lastSelectedItem.matrix);
    if (flip) { sx = srcW - sx; }
    return {
      x: Math.max(0, Math.min(srcW, sx)),
      y: Math.max(0, Math.min(srcH, sy))
    };
  }

  /* Map artboard-oriented display crop → file px (Apply). Inverse of sourceRectToDisplayRect. */
  function transposeCropDisplayToSource(crop, srcW, srcH, rotationDeg) {
    var L = Math.max(0, Math.round(Number(crop.left) || 0));
    var T = Math.max(0, Math.round(Number(crop.top) || 0));
    var W = Math.max(0, Math.round(Number(crop.width) || 0));
    var H = Math.max(0, Math.round(Number(crop.height) || 0));
    var turns;
    var out;
    var flip;
    if (!(W > 0 && H > 0) || !(srcW > 0 && srcH > 0)) {
      return { left: L, top: T, width: W, height: H };
    }
    if (!artboardOrientActive()) {
      return { left: L, top: T, width: W, height: H };
    }
    turns = nearestQuarterTurns(rotationDeg);
    if (turns === 1) {
      out = { left: srcW - (T + H), top: L, width: H, height: W };
    } else if (turns === 2) {
      out = { left: srcW - (L + W), top: srcH - (T + H), width: W, height: H };
    } else if (turns === 3) {
      out = { left: T, top: srcH - (L + W), width: H, height: W };
    } else {
      out = { left: L, top: T, width: W, height: H };
    }
    flip = matrixHasReflection(api.lastSelectedItem && api.lastSelectedItem.matrix);
    if (flip) {
      out.left = srcW - (out.left + out.width);
    }
    out.left = Math.max(0, Math.min(srcW - 1, Math.round(out.left)));
    out.top = Math.max(0, Math.min(srcH - 1, Math.round(out.top)));
    out.width = Math.max(1, Math.min(srcW - out.left, Math.round(out.width)));
    out.height = Math.max(1, Math.min(srcH - out.top, Math.round(out.height)));
    return out;
  }

  function sourceRectToDisplayRect(rect, srcW, srcH, rotationDeg) {
    var sL = Math.max(0, Math.round(Number(rect.left) || 0));
    var sT = Math.max(0, Math.round(Number(rect.top) || 0));
    var sW = Math.max(0, Math.round(Number(rect.width) || 0));
    var sH = Math.max(0, Math.round(Number(rect.height) || 0));
    var turns;
    var out;
    var flip;
    var right;
    if (!artboardOrientActive() || !(srcW > 0 && srcH > 0)) {
      return { left: sL, top: sT, width: sW, height: sH };
    }
    flip = matrixHasReflection(api.lastSelectedItem && api.lastSelectedItem.matrix);
    if (flip) {
      sL = srcW - (sL + sW);
    }
    turns = nearestQuarterTurns(rotationDeg);
    if (turns === 1) {
      out = { left: sT, top: srcW - sL - sW, width: sH, height: sW };
    } else if (turns === 2) {
      out = { left: srcW - sL - sW, top: srcH - sT - sH, width: sW, height: sH };
    } else if (turns === 3) {
      out = { left: srcH - sT - sH, top: sL, width: sH, height: sW };
    } else {
      out = { left: sL, top: sT, width: sW, height: sH };
    }
    return out;
  }

  /*
   * Map pointer → STAGE/overlay pixel space (letterbox-aware, axis-aligned).
   * Does NOT inverse the preview matrix — the crop box is always flat on screen.
   */
  function pointerToDisplayPx(clientX, clientY) {
    var rect = getDisplayedImageClientRect();
    var x;
    var y;
    if (!rect || rect.width < 1 || rect.height < 1) { return null; }
    x = ((clientX - rect.left) / rect.width) * rect.iw;
    y = ((clientY - rect.top) / rect.height) * rect.ih;
    return {
      x: Math.max(0, Math.min(rect.iw, x)),
      y: Math.max(0, Math.min(rect.ih, y)),
      iw: rect.iw,
      ih: rect.ih,
      boxW: rect.width,
      boxH: rect.height
    };
  }

  /* Inverse-map one overlay/stage point into source-file pixels. */
  function overlayPointToSource(ox, oy, iw, ih, srcW, srcH) {
    var m = linkedPreviewMatrix();
    var inv;
    var cx;
    var cy;
    var p;
    var sx = ox;
    var sy = oy;
    if (srcW > 0 && srcH > 0 && iw > 0 && ih > 0 && api.Core.affineIsIdentity && !api.Core.affineIsIdentity(m)) {
      inv = api.Core.invertAffine2(m);
      cx = iw / 2;
      cy = ih / 2;
      p = api.Core.applyAffine2(inv, ox - cx, oy - cy);
      sx = p.x + cx;
      sy = p.y + cy;
      /* Linked CSS path uses layout=source dims; scale if ever mismatched. */
      if (Math.abs(iw - srcW) > 0.5 || Math.abs(ih - srcH) > 0.5) {
        sx = sx * (srcW / iw);
        sy = sy * (srcH / ih);
      }
      return {
        x: Math.max(0, Math.min(srcW, sx)),
        y: Math.max(0, Math.min(srcH, sy))
      };
    }
    return displayPointToSource(ox, oy, iw, ih, srcW, srcH, api.lastRotationDeg);
  }

  /* Map pointer → FILE pixel space (flat screen point through inverse preview transform). */
  function pointerToImagePx(clientX, clientY) {
    var disp = pointerToDisplayPx(clientX, clientY);
    var src;
    if (!disp) { return null; }
    src = getCropSourceSize();
    if (!src) { return { x: disp.x, y: disp.y }; }
    return overlayPointToSource(disp.x, disp.y, disp.iw, disp.ih, src.width, src.height);
  }

  /*
   * Flat overlay is the crop source of truth (Photoshop-style).
   * - artboardOrientActive (embedded bake / 90° swap): fields stay FILE px; map display↔file.
   * - linked CSS matrix (incl. arbitrary angle): fields are OVERLAY/screen px in layout space.
   *   Do NOT AABB-round-trip through the matrix — that inflated the box after every release so
   *   interior drags could not stick. Apply bakes the matrix then crops this overlay rect.
   */
  function sourceRectToOverlayRect(rect, iw, ih) {
    var src = getCropSourceSize();
    var out = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    if (src && artboardOrientActive()) {
      out = sourceRectToDisplayRect(out, src.width, src.height, api.lastRotationDeg);
    }
    return out;
  }

  /* Overlay rect → stored crop fields (file px only when artboardOrientActive). */
  function overlayRectToSourceRect(rect, iw, ih) {
    var src = getCropSourceSize();
    var sw = (src && src.width) || iw;
    var sh = (src && src.height) || ih;
    if (!(sw > 0 && sh > 0)) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    if (artboardOrientActive()) {
      return transposeCropDisplayToSource(rect, sw, sh, api.lastRotationDeg);
    }
    /* One scale. Separate sw/iw and sh/ih turned a 16:9 rect into a square when aspects differed. */
    if (iw > 0 && sw > 0 && (Math.abs(iw - sw) > 1 || Math.abs(ih - sh) > 1)) {
      var scale = sw / iw;
      return {
        left: rect.left * scale,
        top: rect.top * scale,
        width: rect.width * scale,
        height: rect.height * scale
      };
    }
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  /* True when crop L/T/W/H are flat overlay coords and Apply must bake the display matrix. */
  function cropNeedsDisplayBake() {
    var m;
    if (artboardOrientActive()) { return false; }
    if (!(api.lastSelectedItem && api.lastSelectedItem.linked)) { return false; }
    m = linkedPreviewMatrix();
    return !!(api.Core.affineIsIdentity && !api.Core.affineIsIdentity(m));
  }

  /* Overlay-space crop rect for hit-testing (matches flat overlay draw). */
  function displayCropRectForHit() {
    var rect = readCropRect();
    var src = getCropSourceSize();
    var layout = api.getPreviewLayoutSize();
    var iw = (layout && layout.width) || (api.lastImageSize && api.lastImageSize.width);
    var ih = (layout && layout.height) || (api.lastImageSize && api.lastImageSize.height);
    var left = rect.left;
    var top = rect.top;
    var width = rect.width;
    var height = rect.height;
    if (!iw || !ih) { return null; }
    if (!width || !height) {
      if (src && src.width > 0 && src.height > 0) {
        left = 0; top = 0; width = src.width; height = src.height;
      } else {
        left = 0; top = 0; width = iw; height = ih;
      }
    }
    return sourceRectToOverlayRect({ left: left, top: top, width: width, height: height }, iw, ih);
  }

  function normalizeDragRect(x0, y0, x1, y1) {
    var left = Math.min(x0, x1);
    var top = Math.min(y0, y1);
    var right = Math.max(x0, x1);
    var bottom = Math.max(y0, y1);
    return {
      left: left,
      top: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  /* Commit a flat overlay-space rect into crop fields (file px only if artboardOrient). */
  function writeOverlayCropRect(overlayRect, opts) {
    var layout = api.getPreviewLayoutSize() || getCropSourceSize();
    var iw = (layout && layout.width) || 0;
    var ih = (layout && layout.height) || 0;
    var srcRect;
    if (!overlayRect) { return; }
    if (api.cropDrag) {
      api.cropDrag.liveOverlay = {
        left: overlayRect.left,
        top: overlayRect.top,
        width: overlayRect.width,
        height: overlayRect.height
      };
    }
    srcRect = overlayRectToSourceRect(overlayRect, iw, ih);
    writeCropRect(srcRect.left, srcRect.top, srcRect.width, srcRect.height, opts);
  }


  function numOr(id, fallback) {
    var el = api.byId(id);
    var n = el ? Number(el.value) : NaN;
    return isFinite(n) ? n : fallback;
  }

  function readInsetStyleSettings() {
    if (!api.byId('insetGap')) { return; }
    api.settings.insetAspectMode = readInsetAspectMode();
    api.settings.insetGap = Math.max(0, Math.min(400, numOr('insetGap', 12)));
    api.settings.insetAnchor = (api.byId('insetAnchor') && api.byId('insetAnchor').value) || 'right';
    api.settings.insetFrameWeight = Math.max(0.1, Math.min(20, numOr('insetFrameWeight', 1.5)));
    api.settings.insetFrameColor = (api.byId('insetFrameColor') && api.byId('insetFrameColor').value) || '#ff0000';
    api.settings.insetFrameDash = (api.byId('insetFrameDash') && api.byId('insetFrameDash').value) || 'solid';
    api.settings.insetFrameCorner = (api.byId('insetFrameCorner') && api.byId('insetFrameCorner').value) || 'miter';
    api.settings.insetFrameRadius = Math.max(0, Math.min(40, numOr('insetFrameRadius', 0)));
    api.settings.insetLeaderOn = !!(api.byId('insetLeaderOn') && api.byId('insetLeaderOn').checked);
    api.settings.insetLeaderWeight = Math.max(0.1, Math.min(20, numOr('insetLeaderWeight', 0.75)));
    api.settings.insetLeaderColor = (api.byId('insetLeaderColor') && api.byId('insetLeaderColor').value) || '#ffffff';
    api.settings.insetLeaderDash = (api.byId('insetLeaderDash') && api.byId('insetLeaderDash').value) || 'solid';
    api.settings.insetScaleOn = !!(api.byId('insetScaleOn') && api.byId('insetScaleOn').checked);
    api.settings.insetScaleLength = Math.max(0, numOr('insetScaleLength', 20));
    api.settings.insetScaleUnit = (api.byId('insetScaleUnit') && api.byId('insetScaleUnit').value) || 'um';
    api.settings.insetScaleLine = Math.max(0.1, Math.min(20, numOr('insetScaleLine', 1.5)));
    api.settings.insetScaleMargin = Math.max(0, Math.min(200, numOr('insetScaleMargin', 8)));
    api.settings.insetScaleColor = (api.byId('insetScaleColor') && api.byId('insetScaleColor').value) || '#ffffff';
    api.settings.insetScaleIncludeText = !!(api.byId('insetScaleIncludeText') && api.byId('insetScaleIncludeText').checked);
    api.settings.insetScaleFont = Math.max(4, Math.min(72, numOr('insetScaleFont', 9)));
    api.settings.insetScalePosition = (api.byId('insetScalePosition') && api.byId('insetScalePosition').value) || 'bottom-right';
  }

  function populateInsetStyle() {
    if (!api.byId('insetGap')) { return; }
    var insetAspectEl = api.byId('insetAspectMode');
    if (insetAspectEl) {
      commitInsetAspect(readInsetAspectMode() || '4:3');
      selectInsetAspectOption(insetAspectEl, insetAspectToken);
    }
    api.byId('insetGap').value = api.settings.insetGap != null ? api.settings.insetGap : 12;
    api.byId('insetAnchor').value = api.settings.insetAnchor || 'right';
    api.byId('insetFrameWeight').value = api.settings.insetFrameWeight != null ? api.settings.insetFrameWeight : 1.5;
    api.byId('insetFrameColor').value = api.settings.insetFrameColor || '#ff0000';
    if (window.PaperFigColorPicker) { window.PaperFigColorPicker.sync(api.byId('insetFrameColor')); }
    api.byId('insetFrameDash').value = api.settings.insetFrameDash || 'solid';
    api.byId('insetFrameCorner').value = api.settings.insetFrameCorner || 'miter';
    api.byId('insetFrameRadius').value = api.settings.insetFrameRadius != null ? api.settings.insetFrameRadius : 0;
    api.byId('insetLeaderOn').checked = api.settings.insetLeaderOn !== false;
    api.byId('insetLeaderWeight').value = api.settings.insetLeaderWeight != null ? api.settings.insetLeaderWeight : 0.75;
    api.byId('insetLeaderColor').value = api.settings.insetLeaderColor || '#ffffff';
    if (window.PaperFigColorPicker) { window.PaperFigColorPicker.sync(api.byId('insetLeaderColor')); }
    api.byId('insetLeaderDash').value = api.settings.insetLeaderDash || 'solid';
    api.byId('insetScaleOn').checked = api.settings.insetScaleOn !== false;
    api.byId('insetScaleLength').value = api.settings.insetScaleLength != null ? api.settings.insetScaleLength : 20;
    api.byId('insetScaleUnit').value = api.settings.insetScaleUnit || 'um';
    api.byId('insetScaleLine').value = api.settings.insetScaleLine != null ? api.settings.insetScaleLine : 1.5;
    api.byId('insetScaleMargin').value = api.settings.insetScaleMargin != null ? api.settings.insetScaleMargin : 8;
    api.byId('insetScaleColor').value = api.settings.insetScaleColor || '#ffffff';
    if (window.PaperFigColorPicker) { window.PaperFigColorPicker.sync(api.byId('insetScaleColor')); }
    api.byId('insetScaleIncludeText').checked = api.settings.insetScaleIncludeText !== false;
    syncInsetScaleTextUi();
    api.byId('insetScaleFont').value = api.settings.insetScaleFont != null ? api.settings.insetScaleFont : 9;
    api.byId('insetScalePosition').value = api.settings.insetScalePosition || 'bottom-right';
    if (api.byId('insetLeft')) {
      api.byId('insetLeft').value = 0;
      api.byId('insetTop').value = 0;
      api.byId('insetWidth').value = 0;
      api.byId('insetHeight').value = 0;
    }
    syncInsetDrawButton();
  }

  function readInsetRect() {
    if (!api.byId('insetLeft')) { return { left: 0, top: 0, width: 0, height: 0 }; }
    return {
      left: Math.max(0, Math.round(Number(api.byId('insetLeft').value) || 0)),
      top: Math.max(0, Math.round(Number(api.byId('insetTop').value) || 0)),
      width: Math.max(0, Math.round(Number(api.byId('insetWidth').value) || 0)),
      height: Math.max(0, Math.round(Number(api.byId('insetHeight').value) || 0))
    };
  }

  function clearInsetRegionQuiet() {
    if (!api.byId('insetLeft')) { return; }
    api.byId('insetLeft').value = 0;
    api.byId('insetTop').value = 0;
    api.byId('insetWidth').value = 0;
    api.byId('insetHeight').value = 0;
    if (api.insetDrag) { api.insetDrag.liveOverlay = null; }
    updateInsetOverlay();
    updateCropOverlay();
  }

  function writeInsetRect(left, top, width, height, opts) {
    var quiet = opts && opts.quiet;
    if (!api.byId('insetLeft')) { return; }
    left = Math.round(left);
    top = Math.round(top);
    width = Math.max(0, Math.round(width));
    height = Math.max(0, Math.round(height));
    api.byId('insetLeft').value = left;
    api.byId('insetTop').value = top;
    api.byId('insetWidth').value = width;
    api.byId('insetHeight').value = height;
    if (!quiet) { api.saveSettings(); }
    updateInsetOverlay();
  }

  function normalizeAspectToken(raw) {
    return String(raw || '').replace(/^\s+|\s+$/g, '').replace(/\uFF1A/g, ':').replace(/\s+/g, '');
  }

  function commitInsetAspect(raw) {
    var token = normalizeAspectToken(raw);
    if (!token) { return; }
    insetAspectToken = token;
    if (api.settings) { api.settings.insetAspectMode = token; }
    if (api.byId('insetAspectMode')) {
      try { api.byId('insetAspectMode').setAttribute('data-pf-aspect', token); } catch (ignoreAttr) {}
    }
  }

  function selectInsetAspectOption(el, token) {
    var i;
    var opt;
    var val;
    if (!el || !el.options) { return; }
    for (i = 0; i < el.options.length; i += 1) {
      opt = el.options[i];
      val = (opt.getAttribute && opt.getAttribute('value')) || opt.value || '';
      if (normalizeAspectToken(val) === token) {
        el.selectedIndex = i;
        try { el.value = val; } catch (ignoreVal) {}
        return;
      }
    }
  }

  function optionAspectToken(opt) {
    var attr = '';
    var text = '';
    if (!opt) { return ''; }
    if (opt.getAttribute) { attr = opt.getAttribute('value') || ''; }
    text = opt.textContent || opt.text || '';
    attr = normalizeAspectToken(attr);
    text = normalizeAspectToken(text);
    if (/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(text) && (!attr || attr === '1:1') && text !== '1:1') {
      return text;
    }
    return attr || text;
  }

  function markupInsetAspect(el) {
    var i;
    var opt;
    var token;
    if (!el || !el.options) { return ''; }
    for (i = 0; i < el.options.length; i += 1) {
      opt = el.options[i];
      if (opt.defaultSelected || (opt.getAttribute && opt.getAttribute('selected') != null)) {
        token = optionAspectToken(opt);
        if (token) { return token; }
      }
    }
    return '';
  }

  function readInsetAspectMode() {
    var el = api.byId('insetAspectMode');
    var picked = '';
    var fromIndex = '';
    var fromMarkup = '';
    var opt;
    if (el && el.getAttribute) { picked = normalizeAspectToken(el.getAttribute('data-pf-user-aspect') || ''); }
    if (picked) { return picked; }
    fromMarkup = markupInsetAspect(el);
    if (el && el.options && el.selectedIndex >= 0 && el.options[el.selectedIndex]) {
      opt = el.options[el.selectedIndex];
      fromIndex = optionAspectToken(opt);
    }
    if (fromMarkup && fromMarkup !== '1:1' && (!fromIndex || fromIndex === '1:1')) {
      return fromMarkup;
    }
    if (fromIndex) { return fromIndex; }
    if (fromMarkup) { return fromMarkup; }
    if (el && el.value) {
      picked = normalizeAspectToken(el.value);
      if (picked && picked !== '1:1') { return picked; }
    }
    if (api.settings && api.settings.insetAspectMode) {
      picked = normalizeAspectToken(api.settings.insetAspectMode);
      if (picked && picked !== '1:1') { return picked; }
    }
    return fromMarkup || picked || '4:3';
  }

  function getActiveInsetAspect() {
    var mode = readInsetAspectMode() || insetAspectToken;
    if (!api.Core || !api.Core.cropAspectRatio) { return 0; }
    return api.Core.cropAspectRatio(mode, 0, 0);
  }

  function applyInsetAspect(raw) {
    var token = normalizeAspectToken(raw);
    var rect;
    var aspect;
    var src;
    var next;
    var w;
    var h;
    if (!token) { return; }
    commitInsetAspect(token);
    selectInsetAspectOption(api.byId('insetAspectMode'), token);
    if (api.marqueeMode !== 'inset') { setMarqueeMode('inset', { quiet: true }); }
    rect = readInsetRect();
    aspect = api.Core && api.Core.cropAspectRatio ? api.Core.cropAspectRatio(token, 0, 0) : 0;
    src = getCropSourceSize();
    if (!(aspect > 0) || !src || !(src.width > 0) || !(src.height > 0)) {
      updateInsetOverlay();
      api.scheduleSaveSettings();
      return;
    }
    if (!(rect.width > 0 && rect.height > 0)) {
      w = src.width;
      h = Math.max(1, Math.round(w / aspect));
      if (h > src.height) { h = src.height; w = Math.max(1, Math.round(h * aspect)); }
      rect = {
        left: Math.max(0, Math.round((src.width - w) / 2)),
        top: Math.max(0, Math.round((src.height - h) / 2)),
        width: w,
        height: h
      };
    }
    next = api.Core.fitAspectRect(rect.left, rect.top, rect.width, rect.height, aspect, src.width, src.height);
    writeInsetRect(next.left, next.top, next.width, next.height, { quiet: true, aspectReady: true });
    api.scheduleSaveSettings();
  }

  /* Commit the chosen W/H onto a file-pixel rect. Skip when the preview is
     rotated into display space: that mapping swaps axes on purpose. */
  function lockInsetFileAspect(rect) {
    var aspect;
    var bounds;
    var iw;
    var ih;
    /* Rotated display space swaps axes on purpose; do not force file aspect there. */
    if (!rect || artboardOrientActive()) { return rect; }
    aspect = getActiveInsetAspect();
    if (!(aspect > 0) || !(rect.width > 0 && rect.height > 0)) { return rect; }
    bounds = api.getPreviewLayoutSize() || getCropSourceSize();
    iw = (bounds && bounds.width) || 0;
    ih = (bounds && bounds.height) || 0;
    if (api.Core.fitAspectRect) {
      return api.Core.fitAspectRect(rect.left, rect.top, rect.width, rect.height, aspect, iw, ih);
    }
    if (!api.Core.syncSizeWithAspect) { return rect; }
    return api.Core.syncSizeWithAspect(rect.left, rect.top, rect.width, rect.height, 'width', aspect, iw, ih);
  }

  function writeInsetFromOverlay(overlayRect, opts) {
    var layout = api.getPreviewLayoutSize() || getCropSourceSize();
    var iw = (layout && layout.width) || 0;
    var ih = (layout && layout.height) || 0;
    var srcRect;
    if (!overlayRect) { return; }
    if (api.insetDrag) {
      api.insetDrag.liveOverlay = {
        left: overlayRect.left, top: overlayRect.top,
        width: overlayRect.width, height: overlayRect.height
      };
    }
    writeInsetRect(overlayRect.left, overlayRect.top, overlayRect.width, overlayRect.height, opts);
  }

  function updateInsetOverlay() {
    var overlay = api.byId('insetOverlay');
    if (!overlay) { return; }
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function abortMarqueeDrags() {
    var stage = api.byId('previewStage');
    if (api.cropDrag) {
      try {
        document.removeEventListener('mousemove', onCropPointerMove);
        document.removeEventListener('mouseup', onCropPointerUp);
        window.removeEventListener('blur', onCropPointerUp);
        document.removeEventListener('keydown', api.onCropEscape);
      } catch (ignoreCrop) {}
      api.cropDrag = null;
      api.cropStartRect = null;
    }
    api.insetDrag = null;
    if (stage) { stage.classList.remove('crop-drawing'); }
  }

  function clearCropMarqueeQuiet() {
    if (api.byId('cropLeft')) {
      api.byId('cropLeft').value = 0;
      api.byId('cropTop').value = 0;
      api.byId('cropWidth').value = 0;
      api.byId('cropHeight').value = 0;
    }
    api.settings.cropLeft = 0;
    api.settings.cropTop = 0;
    api.settings.cropWidth = 0;
    api.settings.cropHeight = 0;
  }

  function syncMarqueeModeUi() {
    var cropBtn = api.byId('marqueeModeCropBtn');
    var insetBtn = api.byId('marqueeModeInsetBtn');
    var stage = api.byId('previewStage');
    var insetOn = api.marqueeMode === 'inset';
    var cropArmed = !insetOn && !!api.cropDrawArmed;
    api.insetDrawMode = insetOn;
    if (cropBtn) {
      cropBtn.classList.toggle('primary', cropArmed);
      cropBtn.setAttribute('aria-pressed', cropArmed ? 'true' : 'false');
    }
    if (insetBtn) {
      insetBtn.classList.toggle('primary', insetOn);
      insetBtn.setAttribute('aria-pressed', insetOn ? 'true' : 'false');
    }
    if (stage) {
      stage.classList.toggle('inset-draw', insetOn);
      stage.classList.toggle('marquee-inset', insetOn);
      stage.classList.toggle('marquee-crop', cropArmed);
      var endpointPick = !!(api.science && api.science.isPicking && api.science.isPicking()) || stage.classList.contains('endpoint-pick');
      stage.classList.toggle('hand-pan', !insetOn && !cropArmed && !api.pickMode && !api.straightenMode && !endpointPick);
      stage.classList.toggle('endpoint-pick', !!endpointPick);
      if (endpointPick || api.pickMode) { stage.classList.remove('hand-pan'); }
    }
    var applyEl = api.byId('applyBtn');
    if (applyEl && !api.applyRunning) {
      var tabBtn = document.querySelector('.tab-bar [data-tab].active');
      var tabName = tabBtn ? tabBtn.getAttribute('data-tab') : '';
      applyEl.title = tabName === 'label' ? api.t('applyTitleLabel') : (tabName === 'scale' ? api.t('applyTitleScale') : (insetOn ? api.t('applyTitleInset') : api.t('applyTitle')));
      if (applyEl.dataset) { applyEl.dataset.label = api.t('apply'); }
      applyEl.textContent = api.t('apply');
    }
    var resetEl = api.byId('resetBtn');
    if (resetEl) {
      var activeTab = document.querySelector('.tab-bar [data-tab].active');
      var resetTab = activeTab ? activeTab.getAttribute('data-tab') : 'adjust';
      resetEl.title = api.t(resetTab === 'inset' ? 'resetInsetTitle' : resetTab === 'crop' ? 'resetCropTitle' : 'resetTitle');
      resetEl.disabled = !!api.applyRunning || (resetTab !== 'adjust' && resetTab !== 'crop' && resetTab !== 'inset' && resetTab !== 'raw');
    }
  }

  function syncInsetDrawButton() { syncMarqueeModeUi(); }

  /*
   * Exclusive preview marquee: crop XOR inset. Switching aborts drags and clears
   * the inactive tool's rect so the two overlays never stack/fight.
   */
  function setMarqueeMode(mode, opts) {
    var next = mode === 'inset' ? 'inset' : 'crop';
    var quiet = opts && opts.quiet;
    var force = opts && opts.force;
    if (next === 'crop' && opts && opts.armCrop) { api.cropDrawArmed = true; }
    else if (next !== 'crop') { api.cropDrawArmed = false; }
    else if (!(opts && opts.keepCropArm)) { api.cropDrawArmed = false; }
    if (next === api.marqueeMode && !force) {
      syncMarqueeModeUi();
      updateCropOverlay();
      updateInsetOverlay();
      return;
    }
    abortMarqueeDrags();
    if (next === 'inset') {
      clearCropMarqueeQuiet();
    } else {
      clearInsetRegionQuiet();
    }
    api.marqueeMode = next;
    if (next === 'inset') { fitExistingInsetToShownRatio(); }
    syncMarqueeModeUi();
    updateCropOverlay();
    updateInsetOverlay();
    try { api.saveSettings(); } catch (ignoreSave) {}
    if (!quiet) {
      api.notice(next === 'inset' ? api.t('marqueeModeInsetOn') : api.t('marqueeModeCropOn'));
    }
  }

  function setInsetDrawMode(on) {
    setMarqueeMode(on ? 'inset' : 'crop');
  }

  function fitExistingInsetToShownRatio() {
    var token = readInsetAspectMode();
    var aspect;
    var rect;
    var src;
    var next;
    if (!token) { return; }
    commitInsetAspect(token);
    selectInsetAspectOption(api.byId('insetAspectMode'), token);
    if (!api.Core || !api.Core.cropAspectRatio || !api.Core.fitAspectRect) { return; }
    aspect = api.Core.cropAspectRatio(token, 0, 0);
    rect = readInsetRect();
    src = getCropSourceSize();
    if (!(aspect > 0) || !src || !(src.width > 0) || !(rect.width > 0 && rect.height > 0)) { return; }
    if (Math.abs((rect.width / rect.height) - aspect) / aspect <= 0.02) { return; }
    next = api.Core.fitAspectRect(rect.left, rect.top, rect.width, rect.height, aspect, src.width, src.height);
    writeInsetRect(next.left, next.top, next.width, next.height, { quiet: true, aspectReady: true });
  }

  function insetOverlayRectForHit() {
    var rect = readInsetRect();
    var layout = api.getPreviewLayoutSize();
    var iw = layout && layout.width;
    var ih = layout && layout.height;
    if (!(rect.width > 0 && rect.height > 0) || !iw || !ih) { return null; }
    return sourceRectToOverlayRect(rect, iw, ih);
  }

  function onInsetNumeric(changed) {
    var src = getCropSourceSize();
    var rect = readInsetRect();
    var aspect = getActiveInsetAspect();
    var next;
    var iw = src && src.width;
    var ih = src && src.height;
    if (!(rect.width > 0 || rect.height > 0)) {
      writeInsetRect(rect.left, rect.top, rect.width, rect.height, { quiet: true });
      api.scheduleSaveSettings();
      return;
    }
    if (aspect > 0 && (changed === 'insetWidth' || changed === 'insetHeight') && api.Core.syncSizeWithAspect) {
      next = api.Core.syncSizeWithAspect(rect.left, rect.top, rect.width || 1, rect.height || 1,
        changed === 'insetHeight' ? 'height' : 'width', aspect, iw || 0, ih || 0);
      writeInsetRect(next.left, next.top, next.width, next.height, { quiet: true });
    } else {
      writeInsetRect(rect.left, rect.top, rect.width, rect.height, { quiet: true });
    }
    api.scheduleSaveSettings();
  }

  function currentInsetFileRect() {
    var rect = readInsetRect();
    var layout = api.getPreviewLayoutSize() || getCropSourceSize();
    var iw = (layout && layout.width) || 0;
    var ih = (layout && layout.height) || 0;
    return overlayRectToSourceRect(rect, iw, ih);
  }

  /* Map an overlay-space axis-aligned rect to 4 source-UV corners (TL,TR,BR,BL).
     Used so the artboard frame matches the exact pixels in a bake+crop inset —
     not the inflated file AABB of that overlay. */
  function overlayRectToSourceNormCorners(rect, srcW, srcH) {
    var m = linkedPreviewMatrix();
    var inv;
    var cx;
    var cy;
    var pts;
    var i;
    var p;
    var out = [];
    var x;
    var y;
    if (!(srcW > 0 && srcH > 0) || !rect) {
      return [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
      ];
    }
    pts = [
      [Number(rect.left) || 0, Number(rect.top) || 0],
      [(Number(rect.left) || 0) + (Number(rect.width) || 0), Number(rect.top) || 0],
      [(Number(rect.left) || 0) + (Number(rect.width) || 0), (Number(rect.top) || 0) + (Number(rect.height) || 0)],
      [Number(rect.left) || 0, (Number(rect.top) || 0) + (Number(rect.height) || 0)]
    ];
    if (api.Core.affineIsIdentity && !api.Core.affineIsIdentity(m) && api.Core.invertAffine2 && api.Core.applyAffine2) {
      inv = api.Core.invertAffine2(m);
      cx = srcW / 2;
      cy = srcH / 2;
      for (i = 0; i < 4; i += 1) {
        p = api.Core.applyAffine2(inv, pts[i][0] - cx, pts[i][1] - cy);
        x = (p.x + cx) / srcW;
        y = (p.y + cy) / srcH;
        out.push({
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y))
        });
      }
      return out;
    }
    for (i = 0; i < 4; i += 1) {
      out.push({
        x: Math.max(0, Math.min(1, pts[i][0] / srcW)),
        y: Math.max(0, Math.min(1, pts[i][1] / srcH))
      });
    }
    return out;
  }

  /* Norm + tight frame corners for the region actually rasterized.
     Frame UV must cover the same source pixels shown in the inset (TL,TR,BR,BL). */
  function insetNormForApply(fileRect, overlayRect) {
    var src = getCropSourceSize();
    var use = fileRect;
    var corners = null;
    var xs;
    var ys;
    var i;
    var norm;
    if (cropNeedsDisplayBake() && src && overlayRect) {
      /* Frame = exact source-UV image of the overlay rect (same pixels as bake+crop). */
      corners = overlayRectToSourceNormCorners(overlayRect, src.width, src.height);
      xs = []; ys = [];
      for (i = 0; i < 4; i += 1) { xs.push(corners[i].x); ys.push(corners[i].y); }
      use = {
        left: Math.min.apply(null, xs) * src.width,
        top: Math.min.apply(null, ys) * src.height,
        width: (Math.max.apply(null, xs) - Math.min.apply(null, xs)) * src.width,
        height: (Math.max.apply(null, ys) - Math.min.apply(null, ys)) * src.height
      };
      return {
        norm: api.Core.insetNormFromRect(use, src.width, src.height),
        frameCorners: corners
      };
    }
    if (!src || !(src.width > 0 && src.height > 0)) {
      return { norm: api.Core.insetNormFromRect(use, 1, 1), frameCorners: null };
    }
    norm = api.Core.insetNormFromRect(use, src.width, src.height);
    /* Axis-aligned file crop: explicit corners so host does not rebuild from AABB alone. */
    return {
      norm: norm,
      frameCorners: [
        { x: norm.x, y: norm.y },
        { x: norm.x + norm.w, y: norm.y },
        { x: norm.x + norm.w, y: norm.y + norm.h },
        { x: norm.x, y: norm.y + norm.h }
      ]
    };
  }

  function copyScaleBarStyleToInset() {
    [['scaleLength', 'insetScaleLength'], ['scaleBarUnit', 'insetScaleUnit'],
      ['scaleLine', 'insetScaleLine'], ['scaleFont', 'insetScaleFont'],
      ['scaleMargin', 'insetScaleMargin'], ['scalePosition', 'insetScalePosition'],
      ['scaleColor', 'insetScaleColor']].forEach(function (pair) {
      var source = api.byId(pair[0]), target = api.byId(pair[1]);
      if (source && target) { target.value = source.value; }
    });
    if (api.byId('scaleIncludeText') && api.byId('insetScaleIncludeText')) {
      api.byId('insetScaleIncludeText').checked = api.byId('scaleIncludeText').checked;
    }
    if (window.PaperFigColorPicker && api.byId('insetScaleColor')) {
      window.PaperFigColorPicker.sync(api.byId('insetScaleColor'));
    }
    syncInsetScaleTextUi();
    api.scheduleSaveSettings();
  }

  function syncInsetScaleTextUi() {
    var enabled = !!(api.byId('insetScaleIncludeText') && api.byId('insetScaleIncludeText').checked);
    var font = api.byId('insetScaleFont');
    if (font) { font.disabled = !enabled; if (font.parentElement) { font.parentElement.classList.toggle('dimmed', !enabled); } }
  }

  function buildInsetScaleSpec(pixelWidth) {
    var Sci = window.SciScientific;
    var cal;
    var len;
    var unit;
    var fraction;
    if (!api.byId('insetScaleOn') || !api.byId('insetScaleOn').checked) { return null; }
    cal = api.science && api.science.lookupCalibration ? api.science.lookupCalibration(api.lastSelectedItem) : null;
    if (!cal || !(Number(cal.umPerPixelX) > 0)) { return { skipped: 'uncalibrated' }; }
    len = numOr('insetScaleLength', 20);
    unit = (api.byId('insetScaleUnit') && api.byId('insetScaleUnit').value) || 'um';
    try {
      fraction = Sci.scaleFraction(cal, len, unit, pixelWidth);
    } catch (err) {
      return { skipped: err.message || 'scale' };
    }
    return {
      fraction: fraction,
      lineWidth: Math.max(0.1, Math.min(20, numOr('insetScaleLine', 1.5))),
      fontSize: Math.max(4, Math.min(72, numOr('insetScaleFont', 9))),
      margin: Math.max(0, Math.min(200, numOr('insetScaleMargin', 8))),
      position: (api.byId('insetScalePosition') && api.byId('insetScalePosition').value) || 'bottom-right',
      color: (api.byId('insetScaleColor') && api.byId('insetScaleColor').value) || '#ffffff',
      includeText: !!(api.byId('insetScaleIncludeText') && api.byId('insetScaleIncludeText').checked),
      label: len + ' ' + (unit === 'um' ? 'µm' : unit),
      length: len,
      unit: unit,
      displayPixelsX: pixelWidth,
      calibration: cal
    };
  }

  function applyInset() {
    var src;
    var stored;
    var fileRect;
    var sourcePath;
    var opts;
    var outPath;
    var frameStyle;
    var leaderStyle;
    if (api.applyRunning || api.artboardPreviewRunning) { return; }
    if (api.artboardPreviewActive) { api.notice(api.t('errInsetCancelPreview'), 'error'); return; }
    setMarqueeMode('inset', { quiet: true });
    src = getCropSourceSize();
    if (!src || !(src.width > 1 && src.height > 1) || !api.previewIsSource) {
      api.notice(api.t('errInsetNeedsPreview'), 'error');
      return;
    }
    if (!api.lastSelectedItem || !api.lastSelectedItem.linked || !api.lastSelectedItem.sourcePath) {
      api.notice(api.t('errInsetNeedsLinked'), 'error');
      return;
    }
    stored = readInsetRect();
    if (!(stored.width > 1 && stored.height > 1)) {
      api.notice(api.t('errInsetRegion'), 'error');
      return;
    }
    try {
      readInsetStyleSettings();
      frameStyle = api.Core.insetStrokeStyle({
        weight: api.settings.insetFrameWeight,
        color: api.settings.insetFrameColor,
        dash: api.settings.insetFrameDash,
        corner: api.settings.insetFrameCorner,
        radius: api.settings.insetFrameRadius
      }, 1.5);
      leaderStyle = {
        enabled: !!api.settings.insetLeaderOn,
        weight: api.settings.insetLeaderWeight,
        color: api.settings.insetLeaderColor,
        dash: api.settings.insetLeaderDash,
        corner: 'miter',
        radius: 0
      };
      if (leaderStyle.enabled) {
        leaderStyle = api.Core.insetStrokeStyle(leaderStyle, 0.75);
        leaderStyle.enabled = true;
      }
    } catch (styleErr) {
      api.notice(api.localizeMsg(styleErr.message || String(styleErr)), 'error');
      return;
    }
    fileRect = currentInsetFileRect();
    /* Round crop L/T/W/H the same way api.rasterizeWithCanvas does, so ROI frame UV
       covers exactly the pixels written into the inset PNG (avoids 1px drift). */
    fileRect = api.Core.cropRect({
      cropLeft: fileRect.left,
      cropTop: fileRect.top,
      cropWidth: fileRect.width,
      cropHeight: fileRect.height
    }, src.width, src.height);
    sourcePath = api.sourceFor(api.lastObjectKey, api.lastSourcePath);
    opts = {
      cropLeft: fileRect.left,
      cropTop: fileRect.top,
      cropWidth: fileRect.width,
      cropHeight: fileRect.height,
      identityPixels: true,
      format: 'PNG',
      brightness: 0,
      contrast: 0,
      toneLow: 0,
      toneHigh: 255,
      channels: window.SciBitmapWorkflow.channelsDefault()
    };
    if (cropNeedsDisplayBake()) {
      opts.cropDisplaySpace = true;
      opts.displayMatrix = linkedPreviewMatrix();
      stored = api.Core.cropRect({
        cropLeft: stored.left,
        cropTop: stored.top,
        cropWidth: stored.width,
        cropHeight: stored.height
      }, src.width, src.height);
      opts.cropLeft = stored.left;
      opts.cropTop = stored.top;
      opts.cropWidth = stored.width;
      opts.cropHeight = stored.height;
    }
    outPath = api.durableOutputPath(sourcePath, '.png');
    api.setApplyRunning(true);
    api.notice(api.t('insetWorking'), 'busy');
    api.rasterizeWithCanvas(sourcePath, opts).then(function (raster) {
      return api.writeRasterToFile(raster, outPath, { format: 'PNG', dpi: Number(api.byId('dpi').value) || 300 });
    }).then(function (processed) {
      var region = insetNormForApply(fileRect, stored);
      var scaleSpec = buildInsetScaleSpec(processed.width);
      var skipped = scaleSpec && scaleSpec.skipped;
      var spec = {
        file: processed.path,
        pixelWidth: processed.width,
        pixelHeight: processed.height,
        norm: region.norm,
        frameCorners: region.frameCorners,
        gap: api.settings.insetGap,
        anchor: api.settings.insetAnchor,
        frame: frameStyle,
        leaders: leaderStyle,
        scaleBar: skipped ? null : scaleSpec
      };
      return api.captureOperationLock().then(function (lock) {
        return api.ensureHostScript().then(function () {
          return api.evalHost('sciBitmapInset(' + api.quoteExtendScript(JSON.stringify(lock)) + ',' + api.quoteExtendScript(JSON.stringify(spec)) + ')');
        });
      }).then(api.parseHostResult).then(function (placed) {
        var msg = api.t('insetDone', { w: processed.width, h: processed.height });
        if (placed && placed.scaleBar) { msg += api.t('insetScaleAdded'); }
        else if (api.settings.insetScaleOn) { msg += api.t('insetScaleSkipped'); }
        api.notice(msg);
      });
    }).catch(function (err) {
      api.notice(api.localizeMsg(err && err.message ? err.message : String(err)), 'error');
    }).then(function () {
      api.setApplyRunning(false);
    });
  }

  /* The active tab owns the preview marquee; leaving Inset clears its region. */
  function exitInsetMarqueeIfNeeded(tabName) {
    var tab = tabName;
    var active;
    if (!tab) {
      active = document.querySelector('.tab-bar [data-tab].active');
      tab = active ? active.getAttribute('data-tab') : '';
    }
    if (tab && tab !== 'geometry' && api.straightenMode) { api.setStraightenMode(false); }
    if (tab === 'inset') { copyScaleBarStyleToInset(); setMarqueeMode('inset', { quiet: true }); }
    else if (tab === 'crop') { setMarqueeMode('crop', { quiet: true, armCrop: true }); }
    else if (tab && api.marqueeMode === 'inset') { setMarqueeMode('crop', { quiet: true }); }
    else if (tab) { api.cropDrawArmed = false; syncMarqueeModeUi(); }
  }

  function bindInsetControls() {
    if (api.byId('marqueeModeCropBtn')) {
      api.byId('marqueeModeCropBtn').addEventListener('click', function () { setMarqueeMode('crop', { armCrop: true, force: true }); });
    }
    if (api.byId('marqueeModeInsetBtn')) {
      api.byId('marqueeModeInsetBtn').addEventListener('click', function () { setMarqueeMode('inset'); });
    }
    document.addEventListener('paperfig-tab', function (ev) {
      var name = ev && ev.detail && ev.detail.tab;
      exitInsetMarqueeIfNeeded(name);
    });
    /* Boot / late api.bind: match the restored tab. */
    exitInsetMarqueeIfNeeded();
    if (api.byId('insetUpdateBtn')) {
      api.byId('insetUpdateBtn').addEventListener('click', applyInset);
    }
    ['insetLeft', 'insetTop', 'insetWidth', 'insetHeight'].forEach(function (id) {
      api.byId(id).addEventListener('change', function () { onInsetNumeric(id); });
    });
    api.byId('insetAspectMode').addEventListener('change', function () {
      var el = api.byId('insetAspectMode');
      var opt = el && el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      var chosen = '';
      if (opt) { chosen = optionAspectToken(opt); }
      if (chosen && el && el.setAttribute) {
        try { el.setAttribute('data-pf-user-aspect', chosen); } catch (ignoreUser) {}
      }
      if (!chosen && el && el.getAttribute) { chosen = el.getAttribute('data-pf-user-aspect') || el.getAttribute('data-pf-aspect') || ''; }
      if (!chosen && el) { chosen = el.value || ''; }
      applyInsetAspect(chosen);
    });
    api.byId('insetScaleIncludeText').addEventListener('change', syncInsetScaleTextUi);
    commitInsetAspect(readInsetAspectMode() || insetAspectToken || (api.settings && api.settings.insetAspectMode) || '4:3');
    ['insetGap', 'insetAnchor', 'insetFrameWeight', 'insetFrameColor', 'insetFrameDash', 'insetFrameCorner', 'insetFrameRadius',
      'insetLeaderOn', 'insetLeaderWeight', 'insetLeaderColor', 'insetLeaderDash', 'insetScaleOn', 'insetScaleLength', 'insetScaleUnit',
      'insetScaleFont', 'insetScalePosition', 'insetScaleLine', 'insetScaleMargin', 'insetScaleColor', 'insetScaleIncludeText'].forEach(function (id) {
      var el = api.byId(id);
      if (!el) { return; }
      el.addEventListener('change', function () { api.scheduleSaveSettings(); });
    });
    syncInsetDrawButton();
  }

  function onCropPointerDown(event) {
    if(event.button!=null && event.button!==0)return;
    if (api.beginStraightenDrag(event)) { return; }
    /* Endpoint pick wins over pan and over disarmed crop. */
    if (api.science && api.science.pick(event)) { return; }
    /* Crop drawing is opt-in. A failed pan must not fall through into a crop.
       Black/white sample pick still runs below when crop is disarmed. */
    if (api.marqueeMode !== 'inset' && !api.cropDrawArmed && !api.pickMode) { return; }
    if(api.cropDrag)onCropPointerUp();
    api.cropStartRect=readCropRect();
    var stage = api.byId('previewStage');
    var handle;
    var pt;
    var rect;
    var iw;
    var ih;
    var sample;
    var mode;
    var aspect;
    var fixed;
    var placed;
    var src;
    var dispPt;
    var dispCrop;
    var hit;
    var slop;
    var attrHandle;
    var srcPt;
    if (api.applyRunning || api.artboardPreviewRunning || api.panelProxyRunning || api.liveGeomBusy || !api.previewIsSource || !getCropSourceSize()) { return; }
    src = (getCropAspectMode() === 'source-px')
      ? (getStrictSourcePixelSize() || getCropSourceSize())
      : getCropSourceSize();
    if (getCropAspectMode() === 'source-px' && !getStrictSourcePixelSize()) {
      api.notice(api.t('errNeedSourcePixels'), 'error');
      return;
    }
    /* Flat overlay hit-test / drag use stage-aligned coords (not rotated with preview). */
    dispPt = pointerToDisplayPx(event.clientX, event.clientY);
    if (!dispPt) { return; }
    iw = dispPt.iw;
    ih = dispPt.ih;
    event.preventDefault();

    if (api.pickMode) {
      mode = api.pickMode;
      srcPt = pointerToImagePx(event.clientX, event.clientY) || dispPt;
      (function () {
        var drect = getDisplayedImageClientRect();
        var dx;
        var dy;
        if (drect && api.previewBase) {
          dx = srcPt.x / src.width * api.previewBase.width;
          dy = srcPt.y / src.height * api.previewBase.height;
          sample = api.samplePreviewNeighborhood(dx, dy, 2);
        } else {
          sample = api.samplePreviewNeighborhood(srcPt.x, srcPt.y, 2);
        }
      }());
      api.setPickMode(null);
      api.applyPickSample(mode, sample);
      return;
    }

    attrHandle = event.target && event.target.getAttribute && event.target.getAttribute('data-handle');
    rect = readCropRect();
    if (!rect.width || !rect.height) {
      rect = { left: 0, top: 0, width: src.width, height: src.height };
    }
    dispCrop = api.marqueeMode === 'inset' ? insetOverlayRectForHit() : displayCropRectForHit();
    aspect = api.marqueeMode === 'inset' ? getActiveInsetAspect() : getActiveCropAspect();
    if (api.marqueeMode === 'inset' && aspect === 1 && dispCrop && dispCrop.width > 0 && dispCrop.height > 0) {
      var boxRatio = dispCrop.width / dispCrop.height;
      if (Math.abs(boxRatio - 1) > 0.08) { aspect = boxRatio; }
    }
    pt = dispPt;

    /*
     * Geometric hit-test against the FLAT overlay. Do not rely on event.target
     * alone — canvas/transform/tab stacking in CEP often steals the target.
     */
    slop = 8;
    if (dispPt.boxW > 0) {
      slop = Math.max(4, (dispPt.iw / dispPt.boxW) * 8);
    }
    if (dispCrop && dispCrop.width > 0 && dispCrop.height > 0) {
      slop = Math.min(slop, Math.max(3, Math.min(dispCrop.width, dispCrop.height) * 0.22));
    }
    hit = (dispCrop && api.Core.hitTestCrop)
      ? api.Core.hitTestCrop(dispPt.x, dispPt.y, dispCrop, slop, aspect >= 0)
      : null;
    if (attrHandle) {
      handle = attrHandle;
      mode = 'resize';
    } else if (hit) {
      mode = hit.mode;
      handle = hit.handle || null;
    } else if (event.target && (event.target.id === 'cropOverlay' ||
        (event.target.classList && event.target.classList.contains('crop-handle')))) {
      mode = 'move';
      handle = null;
    } else {
      mode = 'draw';
      handle = null;
    }
    /* Full-image crop: interior click starts a new draw (move would be a no-op). */
    if (mode === 'move' && !attrHandle && dispCrop &&
        dispCrop.left <= 1 && dispCrop.top <= 1 &&
        dispCrop.width >= dispPt.iw - 2 && dispCrop.height >= dispPt.ih - 2) {
      mode = 'draw';
      handle = null;
    }

    if (aspect < 0) {
      /* Fixed FILE px: place/move in source space (size is file pixels). */
      srcPt = pointerToImagePx(event.clientX, event.clientY) || {
        x: dispPt.x * src.width / Math.max(1, iw),
        y: dispPt.y * src.height / Math.max(1, ih)
      };
      fixed = getFixedCropSize();
      if (mode === 'move' || mode === 'resize') {
        api.cropDrag = {
          mode: 'move',
          space: 'source',
          aspect: aspect,
          startX: srcPt.x,
          startY: srcPt.y,
          orig: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        };
      } else {
        placed = api.Core.placeFixedRect(srcPt.x - fixed.width / 2, srcPt.y - fixed.height / 2,
          fixed.width, fixed.height, src.width, src.height);
        writeCropRect(placed.left, placed.top, placed.width, placed.height, { quiet: true });
        api.cropDrag = {
          mode: 'move',
          space: 'source',
          aspect: aspect,
          startX: srcPt.x,
          startY: srcPt.y,
          orig: { left: placed.left, top: placed.top, width: placed.width, height: placed.height }
        };
      }
      document.addEventListener('mousemove', onCropPointerMove);
      document.addEventListener('mouseup', onCropPointerUp);
      window.addEventListener('blur', onCropPointerUp);
      document.addEventListener('keydown', api.onCropEscape);
      return;
    }

    /* Free / aspect: drag the flat overlay; map to file px on each update. */
    if (mode === 'resize' && handle) {
      api.cropDrag = {
        mode: 'resize',
        space: 'overlay',
        aspect: aspect,
        handle: handle,
        startX: pt.x,
        startY: pt.y,
        orig: {
          left: dispCrop.left,
          top: dispCrop.top,
          width: dispCrop.width,
          height: dispCrop.height
        }
      };
    } else if (mode === 'move') {
      api.cropDrag = {
        mode: 'move',
        space: 'overlay',
        aspect: aspect,
        startX: pt.x,
        startY: pt.y,
        orig: {
          left: dispCrop.left,
          top: dispCrop.top,
          width: dispCrop.width,
          height: dispCrop.height
        }
      };
    } else {
      api.cropDrag = {
        mode: 'draw',
        space: 'overlay',
        aspect: aspect,
        startX: pt.x,
        startY: pt.y,
        orig: null
      };
      if (stage) { stage.classList.add('crop-drawing'); }
      writeOverlayCropRect({ left: pt.x, top: pt.y, width: 1, height: 1 }, { quiet: true });
    }

    document.addEventListener('mousemove', onCropPointerMove);
    document.addEventListener('mouseup', onCropPointerUp);
    window.addEventListener('blur', onCropPointerUp);
    document.addEventListener('keydown', api.onCropEscape);
  }

  function onCropPointerMove(event) {
    var pt;
    var o;
    var dx;
    var dy;
    var left;
    var top;
    var iw;
    var ih;
    var next;
    var aspect;
    var src;
    var moved;
    if (!api.cropDrag || !getCropSourceSize()) { return; }
    aspect = (typeof api.cropDrag.aspect === 'number')
      ? api.cropDrag.aspect
      : (api.marqueeMode === 'inset' ? getActiveInsetAspect() : getActiveCropAspect());
    event.preventDefault();
    src = (getCropAspectMode() === 'source-px')
      ? (getStrictSourcePixelSize() || getCropSourceSize())
      : getCropSourceSize();

    if (api.cropDrag.space === 'source') {
      pt = pointerToImagePx(event.clientX, event.clientY);
      if (!pt) { return; }
      iw = src.width;
      ih = src.height;
      o = api.cropDrag.orig;
      dx = pt.x - api.cropDrag.startX;
      dy = pt.y - api.cropDrag.startY;
      left = o.left + dx;
      top = o.top + dy;
      writeCropRect(left, top, o.width, o.height, { quiet: true, keepCropSize: true });
      return;
    }

    pt = pointerToDisplayPx(event.clientX, event.clientY);
    if (!pt) { return; }
    iw = pt.iw;
    ih = pt.ih;

    if (api.cropDrag.mode === 'draw') {
      if (aspect > 0) {
        next = api.Core.constrainDrawRect(api.cropDrag.startX, api.cropDrag.startY, pt.x, pt.y, aspect, iw, ih);
      } else {
        next = normalizeDragRect(api.cropDrag.startX, api.cropDrag.startY, pt.x, pt.y);
        next = api.Core.clampCropBox(next.left, next.top, next.width, next.height, iw, ih);
      }
      writeOverlayCropRect(next, { quiet: true });
      return;
    }

    o = api.cropDrag.orig;
    dx = pt.x - api.cropDrag.startX;
    dy = pt.y - api.cropDrag.startY;

    if (api.cropDrag.mode === 'move') {
      /* Pure translate of flat overlay W×H — never resize via clamp/AABB. */
      moved = api.Core.moveCropBox(o.left + dx, o.top + dy, o.width, o.height, iw, ih);
      writeOverlayCropRect(moved, { quiet: true, keepCropSize: true });
      return;
    }

    next = api.Core.constrainResizeRect(o, api.cropDrag.handle, dx, dy, aspect > 0 ? aspect : 0, iw, ih);
    writeOverlayCropRect(next, { quiet: true });
  }

  function onCropPointerUp() {
    var rect;
    if (!api.cropDrag) { return; }
    api.byId('previewStage').classList.remove('crop-drawing');
    api.cropDrag = null;
    document.removeEventListener('mousemove', onCropPointerMove);
    document.removeEventListener('mouseup', onCropPointerUp);
    window.removeEventListener('blur', onCropPointerUp);
    document.removeEventListener('keydown', api.onCropEscape);
    rect = api.marqueeMode === 'inset' ? readInsetRect() : readCropRect();
    writeCropRect(rect.left, rect.top, rect.width, rect.height, { fromDrag: true });
    updateCropOverlay();
    if (rect.width > 0 && rect.height > 0) {
      api.notice(api.t('cropSet', { rect: rect.left + ',' + rect.top + ' ' + rect.width + '×' + rect.height }));
    }
    if (api.artboardPreviewActive) { api.scheduleArtboardPreviewRefresh(); }
  }

  /*
   * Size transform box to object-fit:contain of full source aspect within the stage.
   * Always — with or without canvas — so crop overlay % and pointer map agree.
   * Canvas CSS fills this box; downscaled Fiji proxy still maps via api.lastImageSize.
   */
  /* Translate that recenters the contain box, plus pan when zoomed. Fit (zoom 1) keeps the historical string. */
    return {
      abortMarqueeDrags: abortMarqueeDrags,
      applyAspectModeToCurrentCrop: applyAspectModeToCurrentCrop,
      applyInset: applyInset,
      artboardOrientActive: artboardOrientActive,
      bindInsetControls: bindInsetControls,
      buildInsetScaleSpec: buildInsetScaleSpec,
      clearCropMarqueeQuiet: clearCropMarqueeQuiet,
      clearInsetRegionQuiet: clearInsetRegionQuiet,
      cropNeedsDisplayBake: cropNeedsDisplayBake,
      currentInsetFileRect: currentInsetFileRect,
      displayCropRectForHit: displayCropRectForHit,
      displayPointToSource: displayPointToSource,
      exitInsetMarqueeIfNeeded: exitInsetMarqueeIfNeeded,
      getActiveCropAspect: getActiveCropAspect,
      getActiveInsetAspect: getActiveInsetAspect,
      getCropAspectMode: getCropAspectMode,
      getCropSourceSize: getCropSourceSize,
      getDisplayedImageClientRect: getDisplayedImageClientRect,
      getFixedCropSize: getFixedCropSize,
      getSourceContainLayout: getSourceContainLayout,
      getStrictSourcePixelSize: getStrictSourcePixelSize,
      insetNormForApply: insetNormForApply,
      insetOverlayRectForHit: insetOverlayRectForHit,
      linkedPreviewMatrix: linkedPreviewMatrix,
      mapHandleToFileSpace: mapHandleToFileSpace,
      matrixHasReflection: matrixHasReflection,
      nearestQuarterTurns: nearestQuarterTurns,
      normalizeDragRect: normalizeDragRect,
      numOr: numOr,
      onCropNumericInput: onCropNumericInput,
      onCropPointerDown: onCropPointerDown,
      onCropPointerMove: onCropPointerMove,
      onCropPointerUp: onCropPointerUp,
      onInsetNumeric: onInsetNumeric,
      overlayPointToSource: overlayPointToSource,
      overlayRectToSourceNormCorners: overlayRectToSourceNormCorners,
      overlayRectToSourceRect: overlayRectToSourceRect,
      pointerToDisplayPx: pointerToDisplayPx,
      pointerToImagePx: pointerToImagePx,
      populateInsetStyle: populateInsetStyle,
      previewNeedsArtboardOrient: previewNeedsArtboardOrient,
      readCropRect: readCropRect,
      readInsetRect: readInsetRect,
      readInsetStyleSettings: readInsetStyleSettings,
      setInsetDrawMode: setInsetDrawMode,
      setMarqueeMode: setMarqueeMode,
      sourceRectToDisplayRect: sourceRectToDisplayRect,
      sourceRectToOverlayRect: sourceRectToOverlayRect,
      syncCropAspectUi: syncCropAspectUi,
      syncInsetDrawButton: syncInsetDrawButton,
      syncMarqueeModeUi: syncMarqueeModeUi,
      transposeCropDisplayToSource: transposeCropDisplayToSource,
      updateCropOverlay: updateCropOverlay,
      updateCropSizeHint: updateCropSizeHint,
      updateInsetOverlay: updateInsetOverlay,
      writeCropRect: writeCropRect,
      writeInsetFromOverlay: writeInsetFromOverlay,
      writeInsetRect: writeInsetRect,
      writeOverlayCropRect: writeOverlayCropRect
    };
  }
  root.PaperFigMarquee = { install: install };
})(typeof window !== 'undefined' ? window : global);
