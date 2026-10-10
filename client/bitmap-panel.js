/* PaperFig for Illustrator — GPL-3.0; see LICENSE. */
(function () {
  'use strict';

  var SETTINGS_KEY = 'sci_bitmap_settings';
  var PREVIEW_STATE_KEY = 'sci_bitmap_preview_by_object';
  /* Fallback only; real version is read once from extensionPath/package.json in resolvePanelVersion(). */
  var PANEL_VERSION = '1.2.8';
  var HOST_SCRIPT_VERSION = PANEL_VERSION;
  var POLL_MS = 1100;
  var Core = window.SciBitmapCore;

  function t(key, vars) {
    try {
      if (window.PaperFigI18n && typeof window.PaperFigI18n.t === 'function') {
        return window.PaperFigI18n.t(key, vars);
      }
    } catch (ignore) {}
    return key;
  }

  function refreshBusyLabelsForLang() {
    var specs = [
      { id: 'applyBtn', staticKey: 'apply', busyKey: 'applying', busy: function () { return applyRunning; } },
      { id: 'inspectBtn', staticKey: 'refresh', busyKey: 'refreshing', busy: function () {
        var el = byId('inspectBtn');
        return !!(el && el.dataset && el.dataset.busy === '1');
      } },
      { id: 'artboardPreviewBtn', staticKey: 'artboardPreview', busyKey: 'previewing', busy: function () { return artboardPreviewRunning; } },
      { id: 'testBtn', staticKey: 'testConnection', busyKey: 'testing', busy: function () {
        var el = byId('testBtn');
        return !!(el && el.dataset && el.dataset.busy === '1');
      } },
      { id: 'fijiGateTest', staticKey: 'test', busyKey: 'testing', busy: function () {
        var el = byId('fijiGateTest');
        return !!(el && el.dataset && el.dataset.busy === '1');
      } }
    ];
    var i, spec, el;
    for (i = 0; i < specs.length; i++) {
      spec = specs[i];
      el = byId(spec.id);
      if (!el || !el.dataset) { continue; }
      el.dataset.label = t(spec.staticKey);
      el.textContent = spec.busy() ? t(spec.busyKey) : t(spec.staticKey);
    }
  }
  var shownSource = null;
  var shownShape = null;
  var pendingEmptyFingerprint = '';
  var cropStartRect = null;
  var science = null;
  var previewIsSource = true;
  var previewImageData = null;
  var blurScratch = {};
  var hostLastChecked = 0;
  var operationStartedAt = 0;
  var PREVIEW_MAX_EDGE = 800; /* settle / mouseup quality */
  var PREVIEW_DRAG_MAX_EDGE = 400; /* while dragging sliders */
  var ARTBOARD_PREVIEW_MAX_EDGE = 1500;
  var ARTBOARD_PREVIEW_DEBOUNCE_MS = 300;
  var SAVE_SETTINGS_DEBOUNCE_MS = 280;
  var META_CACHE_MAX = 64;
  var PANEL_CACHE_MAX_ENTRIES = 8;
  var PANEL_CACHE_MAX_BYTES = 48 * 1024 * 1024; /* ~48 MB RGBA budget */
  var DECODED_IMAGE_CACHE_MAX = 2; /* full-res Image elements reused by Apply after preview */
  var decodedImageCache = {};
  var decodedImageCacheOrder = [];
  var applyReadyCache = null; /* { fingerprint, canvas, imageData, width, height, source, stamp, method } */
  var applyReadyWarmToken = 0;
  var APPLY_WARM_MAX_MP = 25; /* skip background warm above ~25 MP */
  var defaults = {
    brightness: 0,
    contrast: 0,
    toneLow: 0,
    toneHigh: 255,
    cyanRed: 0,
    magentaGreen: 0,
    yellowBlue: 0,
    grayscale: false,
    invert: false,
    softBlur: false,
    sharpen: false,
    lut: 'None',
    rotate: 0,
    flipH: false,
    flipV: false,
    cropLeft: 0,
    cropTop: 0,
    cropWidth: 0,
    cropHeight: 0,
    cropAspectMode: 'free',
    cropAspectW: 16,
    cropAspectH: 9,
    cropFixedW: 512,
    cropFixedH: 512,
    insetAspectMode: '4:3',
    insetGap: 12,
    insetAnchor: 'right',
    insetFrameWeight: 1.5,
    insetFrameColor: '#ff0000',
    insetFrameDash: 'solid',
    insetFrameCorner: 'miter',
    insetFrameRadius: 0,
    insetLeaderOn: true,
    insetLeaderWeight: 0.75,
    insetLeaderColor: '#ffffff',
    insetLeaderDash: 'solid',
    insetScaleOn: true,
    insetScaleLength: 20,
    insetScaleUnit: 'um',
    insetScaleLine: 1.5,
    insetScaleFont: 9,
    insetScaleMargin: 8,
    insetScaleColor: '#ffffff',
    insetScaleIncludeText: true,
    insetScalePosition: 'bottom-right',
    format: 'PNG', /* lossless + compressed; TIFF remains available (uncompressed RGBA, slower/larger) */
    dpi: 300,
    fijiPath: '',
  };
  var settings = {};
  var cs = null;
  var extensionPath = '';
  var lastImageSize = null; /* { width, height } px — display layout (artboard-oriented) */
  var sourceImageSize = null; /* true linked-file px for crop fields + Apply */
  var lastGeomPt = null; /* { width, height } artboard pt from selection */
  var lastRotationDeg = 0; /* PlacedItem matrix rotation (CCW °) */
  var previewOrientSwap = false; /* display W/H swapped vs source (≈90° place) */
  var previewMatchesArtboard = false; /* preview pixels match artboard orient (AI capture or baked transform) */
  var previewBakedExif = false; /* EXIF Orientation baked into previewBase (storage px still in sourceImageSize) */
  var applyRunning = false;
  var lastFingerprint = null;
  var pollTimer = null;
  var inspectQuietRunning = false;
  var lastBitmapCount = 0;
  var lastSourcePath = '';
  var lastSelectedItem = null; /* last inspect item (identity fields) */
  var lastObjectKey = '';
  var operationLock = null; /* captured at Apply / artboard preview / Cancel-preview start */
  var comparingOriginal = false; /* hold-to-compare in preview */
  var sliderDragging = false; /* low-res preview while dragging */
  var saveSettingsTimer = null;
  var imageMetaCache = {}; /* path → { mtimeMs, width, height, bitsPerSample, samplesPerPixel } */
  var imageMetaCacheOrder = [];

  /* Canvas live preview (no Fiji): cached downscaled RGBA + rAF render */
  var previewBase = null; /* { width, height, data: Uint8ClampedArray } — settle res */
  var previewBaseDrag = null; /* optional lower-res while dragging */
  var previewRaf = null;
  var previewLoadToken = 0;
  var cropDrag = null; /* draw / move / resize interaction */
  var insetDrag = null;
  var insetDrawMode = false; /* true iff marqueeMode === 'inset' */
  var marqueeMode = 'crop'; /* 'crop' | 'inset' — exclusive preview marquee */
  var cropDrawArmed = false; /* drag draws a crop only after the Crop button */
  var pickMode = null; /* 'black' | 'white' | null */
  var straightenMode = false;
  var straightenDrag = null; /* { x0, y0, x1, y1 } display-px */
  /* Panel preview magnify (fit = 1). Pan is stage px from center; hit-testing uses the same box. */
  var previewViewZoom = 1;
  var previewViewPanX = 0;
  var previewViewPanY = 0;
  var previewSpaceDown = false;
  var PREVIEW_ZOOM_MAX = 16;

  /* Artboard in-place preview — state keyed by object identity (not globals alone) */
  var artboardPreviewActive = false;
  var artboardPreviewOriginalPath = '';
  var artboardPreviewFile = '';
  var artboardPreviewObjectKey = '';
  var artboardPreviewRunning = false;
  var artboardPreviewDebounceTimer = null;
  var artboardPreviewToken = 0;
  var liveGeomBusy = false; /* immediate AI rotate/flip in flight */

  /* Host script: load once; reload only if lost or version changed */
  var hostScriptLoadedVersion = '';
  var hostScriptLoadPromise = null;

  /* Panel preview (0.3.0): multi-image cache with memory cap; Canvas vs Fiji split unchanged.
   * Entries: { key, sourcePath, mtimeMs, method, path, base, bytes, geomKey }.
   * Pixel cache separate from orientation/geom (geomKey invalidates display use). */
  var panelPreviewCacheMap = {}; /* key → entry */
  var panelPreviewCacheOrder = []; /* LRU keys */
  var panelPreviewCacheBytes = 0;
  var panelPreviewCache = null; /* compat alias: last hit entry */
  var panelProxyToken = 0;
  var panelProxyRunning = false; /* busy for capture OR Fiji proxy */

  function byId(id) { return document.getElementById(id); }

  function merge(target, source) {
    var key;
    for (key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; }
    }
    return target;
  }

  function loadSettings() {
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (ignore) {}
    settings = merge(merge({}, defaults), stored);
  }

  function readUiSettings() {
    settings.channels = channelsFromUi();
    settings.brightness = Number(byId('brightness').value);
    settings.contrast = Number(byId('contrast').value);
    settings.toneLow = Math.max(0, Math.min(255, Number(byId('toneLow').value) || 0));
    settings.toneHigh = Math.max(0, Math.min(255, Number(byId('toneHigh').value)));
    if (settings.toneHigh < settings.toneLow) {
      settings.toneHigh = settings.toneLow;
      byId('toneHigh').value = settings.toneHigh;
    }
    settings.cyanRed = Number(byId('cyanRed').value);
    settings.magentaGreen = Number(byId('magentaGreen').value);
    settings.yellowBlue = Number(byId('yellowBlue').value);
    settings.grayscale = byId('grayscale').checked;
    settings.invert = byId('invert').checked;
    settings.softBlur = byId('softBlur').checked;
    settings.sharpen = byId('sharpen').checked;
    settings.lut = byId('lut').value;
    settings.rotate = Number(byId('rotateAngle').value) || 0;
    settings.flipH = !!settings.flipH;
    settings.flipV = !!settings.flipV;
    settings.cropLeft = Math.max(0, Math.round(Number(byId('cropLeft').value) || 0));
    settings.cropTop = Math.max(0, Math.round(Number(byId('cropTop').value) || 0));
    settings.cropWidth = Math.max(0, Math.round(Number(byId('cropWidth').value) || 0));
    settings.cropHeight = Math.max(0, Math.round(Number(byId('cropHeight').value) || 0));
    if (byId('cropAspectMode')) {
      settings.cropAspectMode = byId('cropAspectMode').value || 'free';
      settings.cropAspectW = Math.max(1, Math.round(Number(byId('cropAspectW').value) || 16));
      settings.cropAspectH = Math.max(1, Math.round(Number(byId('cropAspectH').value) || 9));
      settings.cropFixedW = Math.max(1, Math.round(Number(byId('cropFixedW').value) || 512));
      settings.cropFixedH = Math.max(1, Math.round(Number(byId('cropFixedH').value) || 512));
    }
    readInsetStyleSettings();
    settings.format = byId('format').value;
    settings.dpi = Number(byId('dpi').value) || 300;
    settings.fijiPath = byId('fijiPath').value.replace(/^\s+|\s+$/g, '');
  }

  function saveSettingsNow() {
    readUiSettings();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (ignore) {}
  }

  function saveSettings() {
    /* Immediate persist (Apply / critical paths call this). */
    if (saveSettingsTimer) {
      clearTimeout(saveSettingsTimer);
      saveSettingsTimer = null;
    }
    saveSettingsNow();
  }

  function scheduleSaveSettings() {
    if (saveSettingsTimer) { clearTimeout(saveSettingsTimer); }
    saveSettingsTimer = setTimeout(function () {
      saveSettingsTimer = null;
      saveSettingsNow();
    }, SAVE_SETTINGS_DEBOUNCE_MS);
  }

  function loadObjectMap(storageKey) {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (ignore) { return {}; }
  }

  function storeObjectMap(storageKey, map) {
    try { localStorage.setItem(storageKey, JSON.stringify(map || {})); } catch (ignore) {}
  }

  function persistArtboardPreviewState() {
    var map;
    if (!artboardPreviewObjectKey) { return; }
    map = loadObjectMap(PREVIEW_STATE_KEY);
    if (artboardPreviewActive && artboardPreviewOriginalPath) {
      map[artboardPreviewObjectKey] = {
        originalPath: artboardPreviewOriginalPath,
        previewFile: artboardPreviewFile || '',
        sourcePath: lastSourcePath || '',
        savedAt: Date.now()
      };
    } else {
      delete map[artboardPreviewObjectKey];
    }
    storeObjectMap(PREVIEW_STATE_KEY, map);
  }

  function restoreArtboardPreviewStateForKey(objectKey) {
    var map;
    var rec;
    if (!objectKey) { return null; }
    map = loadObjectMap(PREVIEW_STATE_KEY);
    rec = map[objectKey];
    if (!rec || !rec.originalPath) { return null; }
    return rec;
  }


  function populateSettings() {
    byId('brightness').value = settings.brightness;
    byId('contrast').value = settings.contrast;
    /* Migrate legacy window/level settings if present. */
    if (settings.toneLow == null && settings.window != null) { settings.toneLow = 0; }
    if (settings.toneHigh == null && settings.level != null) { settings.toneHigh = 255; }
    byId('toneLow').value = settings.toneLow != null ? settings.toneLow : 0;
    byId('toneHigh').value = settings.toneHigh != null ? settings.toneHigh : 255;
    byId('cyanRed').value = settings.cyanRed;
    byId('magentaGreen').value = settings.magentaGreen;
    byId('yellowBlue').value = settings.yellowBlue;
    byId('grayscale').checked = Boolean(settings.grayscale);
    byId('invert').checked = Boolean(settings.invert);
    byId('softBlur').checked = Boolean(settings.softBlur);
    byId('sharpen').checked = Boolean(settings.sharpen);
    byId('lut').value = settings.lut;
    byId('rotateAngle').value = settings.rotate;
    settings.flipH = Boolean(settings.flipH);
    settings.flipV = Boolean(settings.flipV);
    syncFlipButtons();
    /* Channel remap colors: do not restore stale prefs on panel open
     * (same idea as crop). Per-image draft/saved still restore via switchDraft. */
    settings.channels = null;
    /* Crop is per-image (draft/saved). Panel open always starts at use-full-image. */
    settings.cropLeft = 0;
    settings.cropTop = 0;
    settings.cropWidth = 0;
    settings.cropHeight = 0;
    byId('cropLeft').value = 0;
    byId('cropTop').value = 0;
    byId('cropWidth').value = 0;
    byId('cropHeight').value = 0;
    if (byId('cropAspectMode')) {
      byId('cropAspectMode').value = settings.cropAspectMode || 'free';
      byId('cropAspectW').value = settings.cropAspectW != null ? settings.cropAspectW : 16;
      byId('cropAspectH').value = settings.cropAspectH != null ? settings.cropAspectH : 9;
      byId('cropFixedW').value = settings.cropFixedW != null ? settings.cropFixedW : 512;
      byId('cropFixedH').value = settings.cropFixedH != null ? settings.cropFixedH : 512;
      syncCropAspectUi();
    }
    populateInsetStyle();
    byId('format').value = settings.format;
    byId('dpi').value = settings.dpi;
    byId('fijiPath').value = settings.fijiPath;
    updateAdjustmentDisplay();
    updateCropOverlay();
  }

  function clampTone(v) {
    v = Number(v);
    if (!isFinite(v)) { return 0; }
    if (v < 0) { return 0; }
    if (v > 255) { return 255; }
    return v;
  }

  /* Black/white points → setMinAndMax(low, high). Defaults 0–255 = untouched. */
  function toneRange(lowVal, highVal) {
    var lo = clampTone(lowVal);
    var hi = clampTone(highVal);
    if (hi < lo) { hi = lo; }
    return { min: lo, max: hi, low: lo, high: hi };
  }

  function tonePointsTouched(lowVal, highVal) {
    return clampTone(lowVal) !== 0 || clampTone(highVal) !== 255;
  }

  /*
   * PS-style midtone color balance → RGB multiply gains.
   * Positive C–R adds red (less cyan); M–G adds green; Y–B adds blue.
   */
  function colorBalanceGains(cyanRed, magentaGreen, yellowBlue) {
    var cr = Math.max(-100, Math.min(100, Number(cyanRed) || 0));
    var mg = Math.max(-100, Math.min(100, Number(magentaGreen) || 0));
    var yb = Math.max(-100, Math.min(100, Number(yellowBlue) || 0));
    function clampGain(g) {
      if (g < 0.25) { return 0.25; }
      if (g > 2) { return 2; }
      return g;
    }
    return {
      r: clampGain(1 + (cr / 200) - (mg / 400) - (yb / 400)),
      g: clampGain(1 + (mg / 200) - (cr / 400) - (yb / 400)),
      b: clampGain(1 + (yb / 200) - (cr / 400) - (mg / 400)),
      touched: cr !== 0 || mg !== 0 || yb !== 0
    };
  }

  /*
   * Pick Black/White color-cast nudge (documented):
   * Sample neighborhood mean (R,G,B), L = 0.299R+0.587G+0.114B.
   * Set Low (black) or High (white) = round(clamp(L,0,255)).
   * Neutralize cast so sampled point → gray of luminance L:
   *   cyanRed     = clamp(round((L - R) / 2.55), -100, 100)
   *   magentaGreen= clamp(round((L - G) / 2.55), -100, 100)
   *   yellowBlue  = clamp(round((L - B) / 2.55), -100, 100)
   * (R>L → negative C–R = more cyan; same for G/B axes.)
   */
  function balanceFromSample(r, g, b) {
    var L = 0.299 * r + 0.587 * g + 0.114 * b;
    function axis(channel) {
      var v = Math.round((L - channel) / 2.55);
      if (v < -100) { return -100; }
      if (v > 100) { return 100; }
      return v;
    }
    return {
      luminance: L,
      cyanRed: axis(r),
      magentaGreen: axis(g),
      yellowBlue: axis(b)
    };
  }

  function syncFlipButtons() {
    var h = byId('flipHBtn');
    var v = byId('flipVBtn');
    if (h) {
      h.classList.toggle('flip-on', !!settings.flipH);
      h.setAttribute('aria-pressed', settings.flipH ? 'true' : 'false');
    }
    if (v) {
      v.classList.toggle('flip-on', !!settings.flipV);
      v.setAttribute('aria-pressed', settings.flipV ? 'true' : 'false');
    }
  }

  function setPickMode(mode) {
    pickMode = mode || null;
    var stage = byId('previewStage');
    var blackBtn = byId('pickBlackBtn');
    var whiteBtn = byId('pickWhiteBtn');
    if (stage) {
      stage.classList.toggle('pick-mode', !!pickMode);
      /* Sampler pick and scale-endpoint pick share the stage. Do not drop endpoint-pick here. */
      if (pickMode) { stage.classList.remove('hand-pan'); }
    }
    if (blackBtn) { blackBtn.classList.toggle('active-pick', pickMode === 'black'); }
    if (whiteBtn) { whiteBtn.classList.toggle('active-pick', pickMode === 'white'); }
    if (pickMode === 'black') {
      notice(t('pickBlackNotice'));
    } else if (pickMode === 'white') {
      notice(t('pickWhiteNotice'));
    }
  }


  function setStraightenOverlay(visible, x0, y0, x1, y1) {
    var overlay = byId('straightenOverlay');
    var line = byId('straightenLineSeg');
    var stage = byId('previewStage');
    var rect;
    if (!overlay || !line) { return; }
    if (!visible) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', '0');
      line.setAttribute('x2', '0');
      line.setAttribute('y2', '0');
      return;
    }
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    rect = stage ? stage.getBoundingClientRect() : null;
    /* Line is in overlay/stage CSS pixels (same space as client minus stage origin). */
    if (rect) {
      line.setAttribute('x1', String(x0 - rect.left));
      line.setAttribute('y1', String(y0 - rect.top));
      line.setAttribute('x2', String(x1 - rect.left));
      line.setAttribute('y2', String(y1 - rect.top));
    }
  }

  function setStraightenMode(on) {
    straightenMode = !!on;
    if (!straightenMode) {
      straightenDrag = null;
      setStraightenOverlay(false);
      document.removeEventListener('mousemove', onStraightenMove);
      document.removeEventListener('mouseup', onStraightenUp);
      document.removeEventListener('keydown', onStraightenEscape);
      window.removeEventListener('blur', onStraightenUp);
    }
    var stage = byId('previewStage');
    var btn = byId('straightenLineBtn');
    if (stage) { stage.classList.toggle('straighten-mode', straightenMode); }
    if (btn) {
      btn.classList.toggle('active-pick', straightenMode);
      btn.setAttribute('aria-pressed', straightenMode ? 'true' : 'false');
    }
    if (straightenMode) {
      if (pickMode) { setPickMode(null); }
      notice(t('straightenLineNotice'));
    }
  }

  function angleToHorizontalDelta(x0, y0, x1, y1) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var angle;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) { return 0; }
    angle = Math.atan2(dy, dx) * 180 / Math.PI;
    /* Nearest horizontal: fold into (-90, 90]. */
    if (angle > 90) { angle -= 180; }
    if (angle <= -90) { angle += 180; }
    return normalizeAngle(-angle);
  }

  function onStraightenMove(event) {
    if (!straightenDrag) { return; }
    straightenDrag.x1 = event.clientX;
    straightenDrag.y1 = event.clientY;
    setStraightenOverlay(true, straightenDrag.x0, straightenDrag.y0, straightenDrag.x1, straightenDrag.y1);
  }

  function onStraightenUp(event) {
    var dx;
    var dy;
    var delta;
    var x1;
    var y1;
    if (!straightenDrag) { return; }
    x1 = event && event.clientX != null ? event.clientX : straightenDrag.x1;
    y1 = event && event.clientY != null ? event.clientY : straightenDrag.y1;
    dx = x1 - straightenDrag.x0;
    dy = y1 - straightenDrag.y0;
    document.removeEventListener('mousemove', onStraightenMove);
    document.removeEventListener('mouseup', onStraightenUp);
    document.removeEventListener('keydown', onStraightenEscape);
    window.removeEventListener('blur', onStraightenUp);
    straightenDrag = null;
    setStraightenOverlay(false);
    if (Math.sqrt(dx * dx + dy * dy) < 12) {
      notice(t('straightenLineTooShort'), 'error');
      setStraightenMode(false);
      return;
    }
    delta = angleToHorizontalDelta(0, 0, dx, dy);
    setStraightenMode(false);
    if (Math.abs(delta) < 0.05) {
      notice(t('straightenLineDone', { angle: 0 }));
      return;
    }
    /* liveRotateBy already notices rotatedAi in the current UI language. */
    liveRotateBy(delta, false);
  }

  function onStraightenEscape(event) {
    if (event.key !== 'Escape' && event.keyCode !== 27) { return; }
    if (straightenDrag || straightenMode) {
      event.preventDefault();
      setStraightenMode(false);
      notice(t('straightenLineCancelled'));
    }
  }

  function beginStraightenDrag(event) {
    if (!straightenMode) { return false; }
    if (event.button != null && event.button !== 0) { return true; }
    if (applyRunning || artboardPreviewRunning || liveGeomBusy || panelProxyRunning) {
      notice(t('busyRotate'), 'error');
      return true;
    }
    if (!pointerToDisplayPx(event.clientX, event.clientY)) {
      notice(t('clickInsidePreview'), 'error');
      return true;
    }
    event.preventDefault();
    straightenDrag = {
      x0: event.clientX,
      y0: event.clientY,
      x1: event.clientX,
      y1: event.clientY
    };
    setStraightenOverlay(true, straightenDrag.x0, straightenDrag.y0, straightenDrag.x1, straightenDrag.y1);
    document.addEventListener('mousemove', onStraightenMove);
    document.addEventListener('mouseup', onStraightenUp);
    document.addEventListener('keydown', onStraightenEscape);
    window.addEventListener('blur', onStraightenUp);
    return true;
  }

    /* Average RGBA in a small neighborhood of previewBase (source pixels). */
  function samplePreviewNeighborhood(imgX, imgY, radius) {
    var iw = lastImageSize && lastImageSize.width;
    var ih = lastImageSize && lastImageSize.height;
    var base = previewBase;
    var rad = radius == null ? 2 : radius;
    var sx;
    var sy;
    var x0;
    var y0;
    var x1;
    var y1;
    var x;
    var y;
    var i;
    var n = 0;
    var sr = 0;
    var sg = 0;
    var sb = 0;
    var scaleX;
    var scaleY;
    if (!base || !iw || !ih) { return null; }
    scaleX = 1;
    scaleY = 1;
    sx = Math.round(imgX * scaleX);
    sy = Math.round(imgY * scaleY);
    x0 = Math.max(0, sx - rad);
    y0 = Math.max(0, sy - rad);
    x1 = Math.min(base.width - 1, sx + rad);
    y1 = Math.min(base.height - 1, sy + rad);
    for (y = y0; y <= y1; y += 1) {
      for (x = x0; x <= x1; x += 1) {
        i = (y * base.width + x) * 4;
        if (base.data[i + 3] === 0) { continue; }
        sr += base.data[i];
        sg += base.data[i + 1];
        sb += base.data[i + 2];
        n += 1;
      }
    }
    if (!n) { return null; }
    return { r: sr / n, g: sg / n, b: sb / n };
  }

  function applyPickSample(mode, sample) {
    var bal;
    var tone;
    if (!sample) {
      notice(t('sampleFail'), 'error');
      return;
    }
    bal = balanceFromSample(sample.r, sample.g, sample.b);
    tone = Math.round(Math.max(0, Math.min(255, bal.luminance)));
    if (mode === 'black') {
      byId('toneLow').value = tone;
      if (Number(byId('toneHigh').value) < tone) { byId('toneHigh').value = tone; }
    } else {
      byId('toneHigh').value = tone;
      if (Number(byId('toneLow').value) > tone) { byId('toneLow').value = tone; }
    }
    byId('cyanRed').value = bal.cyanRed;
    byId('magentaGreen').value = bal.magentaGreen;
    byId('yellowBlue').value = bal.yellowBlue;
    updateAdjustmentDisplay();
    saveSettings();
    notice(t('pickedTone', { mode: mode === 'black' ? t('modeBlack') : t('modeWhite'), tone: tone, cr: bal.cyanRed, mg: bal.magentaGreen, yb: bal.yellowBlue }));
  }

  function autoLevelsFromPreview() {
    var base = previewBase;
    var hist;
    var i;
    var r;
    var g;
    var b;
    var a;
    var L;
    var total = 0;
    var acc = 0;
    var lowTarget;
    var highTarget;
    var low = 0;
    var high = 255;
    var foundLow = false;
    if (!base) {
      notice(t('autoLevelsNeedPreview'), 'error');
      return;
    }
    hist = new Array(256);
    for (i = 0; i < 256; i += 1) { hist[i] = 0; }
    for (i = 0; i < base.data.length; i += 4) {
      a = base.data[i + 3];
      if (a === 0) { continue; }
      r = base.data[i];
      g = base.data[i + 1];
      b = base.data[i + 2];
      L = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      if (L < 0) { L = 0; }
      if (L > 255) { L = 255; }
      hist[L] += 1;
      total += 1;
    }
    if (total < 16) {
      notice(t('autoLevelsNoPixels'), 'error');
      return;
    }
    lowTarget = total * 0.005;
    highTarget = total * 0.995;
    for (i = 0; i < 256; i += 1) {
      acc += hist[i];
      if (!foundLow && acc >= lowTarget) {
        low = i;
        foundLow = true;
      }
      if (acc >= highTarget) {
        high = i;
        break;
      }
    }
    if (high < low) { high = low; }
    byId('toneLow').value = low;
    byId('toneHigh').value = high;
    updateAdjustmentDisplay();
    saveSettings();
    notice(t('autoLevelsDone', { low: low, high: high }));
  }

  function autoLevelsPerChannelFromPreview() {
    var base = previewBase;
    var plane;
    var i;
    var a;
    var v;
    var total;
    var acc;
    var lowTarget;
    var highTarget;
    var low;
    var high;
    var foundLow;
    var hist;
    var results = [];
    if (!base) {
      notice(t('autoLevelsNeedPreview'), 'error');
      return;
    }
    for (plane = 0; plane < 3; plane += 1) {
      hist = new Array(256);
      for (i = 0; i < 256; i += 1) { hist[i] = 0; }
      total = 0;
      for (i = 0; i < base.data.length; i += 4) {
        a = base.data[i + 3];
        if (a === 0) { continue; }
        v = base.data[i + plane];
        if (v < 0) { v = 0; }
        if (v > 255) { v = 255; }
        hist[v] += 1;
        total += 1;
      }
      if (total < 16) {
        notice(t('autoLevelsNoPixels'), 'error');
        return;
      }
      lowTarget = total * 0.005;
      highTarget = total * 0.995;
      acc = 0;
      low = 0;
      high = 255;
      foundLow = false;
      for (i = 0; i < 256; i += 1) {
        acc += hist[i];
        if (!foundLow && acc >= lowTarget) {
          low = i;
          foundLow = true;
        }
        if (acc >= highTarget) {
          high = i;
          break;
        }
      }
      if (high <= low) { high = Math.min(255, low + 1); }
      byId('ch' + plane + 'Low').value = low;
      byId('ch' + plane + 'High').value = high;
      if (byId('ch' + plane + 'LowSlider')) { byId('ch' + plane + 'LowSlider').value = low; }
      if (byId('ch' + plane + 'HighSlider')) { byId('ch' + plane + 'HighSlider').value = high; }
      results.push({ low: low, high: high });
    }
    try { W.recipe(readPixelOpsFromUi()); } catch (e) { notice(e.message, 'error'); return; }
    saveSettings();
    onAdjustmentSettle();
    notice(t('autoChannelLevelsDone', {
      rLow: results[0].low, rHigh: results[0].high,
      gLow: results[1].low, gHigh: results[1].high,
      bLow: results[2].low, bHigh: results[2].high
    }));
  }

  /* Lean 3×3 box blur on RGBA ImageData (preview approx of mild Gaussian). */
  function boxBlur3(imgData) { blurScratch = Core.boxBlur3(imgData, blurScratch); }

  function unsharpLight(imgData, amount) {
    var w = imgData.width;
    var h = imgData.height;
    var src = new Uint8ClampedArray(imgData.data);
    var blurCopy = { width: w, height: h, data: new Uint8ClampedArray(src) };
    var amt = amount == null ? 0.4 : amount;
    var i;
    var d;
    boxBlur3(blurCopy);
    d = imgData.data;
    for (i = 0; i < d.length; i += 4) {
      d[i] = clampByte(src[i] + amt * (src[i] - blurCopy.data[i]));
      d[i + 1] = clampByte(src[i + 1] + amt * (src[i + 1] - blurCopy.data[i + 1]));
      d[i + 2] = clampByte(src[i + 2] + amt * (src[i + 2] - blurCopy.data[i + 2]));
      d[i + 3] = src[i + 3];
    }
  }

    function brightnessContrastRange(brightness, contrast) {
    var b = Math.max(-100, Math.min(100, Number(brightness) || 0));
    var c = Math.max(-100, Math.min(100, Number(contrast) || 0));
    var center = 127.5 - (b / 100) * 127.5;
    var halfSpan = 127.5 * (1 - (c / 100) * 0.9);
    if (halfSpan < 1) { halfSpan = 1; }
    return { min: center - halfSpan, max: center + halfSpan };
  }

  function normalizeAngle(deg) {
    var a = Number(deg) || 0;
    a = a % 360;
    if (a > 180) { a -= 360; }
    if (a <= -180) { a += 360; }
    return Math.round(a * 1000) / 1000;
  }

  function setPreviewStatus(message, kind) {
    var el = byId('previewStatus');
    if (!el) { return; }
    el.textContent = message || '';
    el.className = 'preview-status' + (kind ? ' ' + kind : '');
  }

  function updateAdjustmentDisplay() {
    var brightness = Number(byId('brightness').value);
    var contrast = Number(byId('contrast').value);
    var lowVal = Number(byId('toneLow').value);
    var highVal = Number(byId('toneHigh').value);
    var cyanRed = Number(byId('cyanRed').value);
    var magentaGreen = Number(byId('magentaGreen').value);
    var yellowBlue = Number(byId('yellowBlue').value);
    var tr = toneRange(lowVal, highVal);
    var toneOverrides = tonePointsTouched(tr.low, tr.high);
    var brightRow = byId('brightness') && byId('brightness').closest('label');
    var contrastRow = byId('contrast') && byId('contrast').closest('label');
    byId('brightnessValue').value = brightness;
    byId('contrastValue').value = contrast;
    byId('toneLowValue').value = tr.low;
    byId('toneHighValue').value = tr.high;
    if (byId('fluorToneLow')) {
      byId('fluorToneLow').value = tr.low;
      byId('fluorToneHigh').value = tr.high;
      byId('fluorToneLowValue').value = tr.low;
      byId('fluorToneHighValue').value = tr.high;
    }
    byId('cyanRedValue').value = cyanRed;
    byId('magentaGreenValue').value = magentaGreen;
    byId('yellowBlueValue').value = yellowBlue;
    if (byId('toneHint')) {
      byId('toneHint').textContent = toneOverrides ? t('toneHintOverride') : t('toneHintActive');
    }
    if (byId('brightness')) { byId('brightness').disabled = !!toneOverrides || applyRunning || artboardPreviewRunning || liveGeomBusy || panelProxyRunning; }
    if (byId('contrast')) { byId('contrast').disabled = !!toneOverrides || applyRunning || artboardPreviewRunning || liveGeomBusy || panelProxyRunning; }
    byId('brightnessValue').disabled=byId('brightness').disabled;
    byId('contrastValue').disabled=byId('contrast').disabled;
    if (brightRow) { brightRow.classList.toggle('dimmed', !!toneOverrides); }
    if (contrastRow) { contrastRow.classList.toggle('dimmed', !!toneOverrides); }
    if (!applyRunning && !artboardPreviewRunning && !liveGeomBusy) { updateExportUiHonesty(); }
    schedulePreviewRender();
  }

  /* Crop / inset marquee: bitmap-panel-marquee.js */

  var __marqueeFns = null;
  function installMarquee() {
    if (__marqueeFns) { return __marqueeFns; }
    var api = {};
    function linkVar(name, get, set) {
      Object.defineProperty(api, name, { get: get, set: set, configurable: true });
    }
    function linkFn(name, get) {
      Object.defineProperty(api, name, { get: get, configurable: true });
    }
    linkVar('Core', function(){return Core;}, function(v){Core=v;});
    linkVar('PREVIEW_ZOOM_MAX', function(){return PREVIEW_ZOOM_MAX;}, function(v){PREVIEW_ZOOM_MAX=v;});
    linkFn('applyPickSample', function(){return applyPickSample;});
    linkVar('applyRunning', function(){return applyRunning;}, function(v){applyRunning=v;});
    linkVar('artboardPreviewActive', function(){return artboardPreviewActive;}, function(v){artboardPreviewActive=v;});
    linkVar('artboardPreviewRunning', function(){return artboardPreviewRunning;}, function(v){artboardPreviewRunning=v;});
    linkFn('beginStraightenDrag', function(){return beginStraightenDrag;});
    linkFn('bind', function(){return bind;});
    linkFn('byId', function(){return byId;});
    linkFn('captureOperationLock', function(){return captureOperationLock;});
    linkVar('cropDrag', function(){return cropDrag;}, function(v){cropDrag=v;});
    linkVar('cropStartRect', function(){return cropStartRect;}, function(v){cropStartRect=v;});
    linkFn('durableOutputPath', function(){return durableOutputPath;});
    linkFn('ensureHostScript', function(){return ensureHostScript;});
    linkFn('evalHost', function(){return evalHost;});
    linkFn('getPreviewLayoutSize', function(){return getPreviewLayoutSize;});
    linkFn('getSourcePixelSize', function(){return getSourcePixelSize;});
    linkVar('insetDrag', function(){return insetDrag;}, function(v){insetDrag=v;});
    linkVar('insetDrawMode', function(){return insetDrawMode;}, function(v){insetDrawMode=v;});
    linkVar('lastImageSize', function(){return lastImageSize;}, function(v){lastImageSize=v;});
    linkVar('lastObjectKey', function(){return lastObjectKey;}, function(v){lastObjectKey=v;});
    linkVar('lastRotationDeg', function(){return lastRotationDeg;}, function(v){lastRotationDeg=v;});
    linkVar('lastSelectedItem', function(){return lastSelectedItem;}, function(v){lastSelectedItem=v;});
    linkVar('lastSourcePath', function(){return lastSourcePath;}, function(v){lastSourcePath=v;});
    linkVar('liveGeomBusy', function(){return liveGeomBusy;}, function(v){liveGeomBusy=v;});
    linkFn('localizeMsg', function(){return localizeMsg;});
    linkVar('marqueeMode', function(){return marqueeMode;}, function(v){marqueeMode=v;});
    linkVar('cropDrawArmed', function(){return cropDrawArmed;}, function(v){cropDrawArmed=v;});
    linkFn('notice', function(){return notice;});
    linkFn('onCropEscape', function(){return onCropEscape;});
    linkVar('panelProxyRunning', function(){return panelProxyRunning;}, function(v){panelProxyRunning=v;});
    linkFn('parseHostResult', function(){return parseHostResult;});
    linkVar('pickMode', function(){return pickMode;}, function(v){pickMode=v;});
    linkVar('previewBakedExif', function(){return previewBakedExif;}, function(v){previewBakedExif=v;});
    linkVar('previewBase', function(){return previewBase;}, function(v){previewBase=v;});
    linkVar('previewIsSource', function(){return previewIsSource;}, function(v){previewIsSource=v;});
    linkVar('previewMatchesArtboard', function(){return previewMatchesArtboard;}, function(v){previewMatchesArtboard=v;});
    linkVar('previewOrientSwap', function(){return previewOrientSwap;}, function(v){previewOrientSwap=v;});
    linkVar('previewViewPanX', function(){return previewViewPanX;}, function(v){previewViewPanX=v;});
    linkVar('previewViewPanY', function(){return previewViewPanY;}, function(v){previewViewPanY=v;});
    linkVar('previewViewZoom', function(){return previewViewZoom;}, function(v){previewViewZoom=v;});
    linkFn('quoteExtendScript', function(){return quoteExtendScript;});
    linkFn('rasterizeWithCanvas', function(){return rasterizeWithCanvas;});
    linkFn('samplePreviewNeighborhood', function(){return samplePreviewNeighborhood;});
    linkFn('saveSettings', function(){return saveSettings;});
    linkFn('scheduleArtboardPreviewRefresh', function(){return scheduleArtboardPreviewRefresh;});
    linkFn('scheduleSaveSettings', function(){return scheduleSaveSettings;});
    linkVar('science', function(){return science;}, function(v){science=v;});
    linkFn('setApplyRunning', function(){return setApplyRunning;});
    linkFn('setPickMode', function(){return setPickMode;});
    linkFn('setStraightenMode', function(){return setStraightenMode;});
    linkVar('settings', function(){return settings;}, function(v){settings=v;});
    linkFn('sourceFor', function(){return sourceFor;});
    linkVar('sourceImageSize', function(){return sourceImageSize;}, function(v){sourceImageSize=v;});
    linkVar('straightenMode', function(){return straightenMode;}, function(v){straightenMode=v;});
    linkFn('syncTransformBoxSize', function(){return syncTransformBoxSize;});
    linkFn('t', function(){return t;});
    linkFn('writeRasterToFile', function(){return writeRasterToFile;});
    __marqueeFns = window.PaperFigMarquee.install(api);
    return __marqueeFns;
  }
  function applyAspectModeToCurrentCrop(){ installMarquee(); return __marqueeFns.applyAspectModeToCurrentCrop.apply(this, arguments); }
  function abortMarqueeDrags(){ installMarquee(); return __marqueeFns.abortMarqueeDrags.apply(this, arguments); }
  function applyInset(){ installMarquee(); return __marqueeFns.applyInset.apply(this, arguments); }
  function artboardOrientActive(){ installMarquee(); return __marqueeFns.artboardOrientActive.apply(this, arguments); }
  function bindInsetControls(){ installMarquee(); return __marqueeFns.bindInsetControls.apply(this, arguments); }
  function clearInsetRegionQuiet(){ installMarquee(); return __marqueeFns.clearInsetRegionQuiet.apply(this, arguments); }
  function cropNeedsDisplayBake(){ installMarquee(); return __marqueeFns.cropNeedsDisplayBake.apply(this, arguments); }
  function getCropAspectMode(){ installMarquee(); return __marqueeFns.getCropAspectMode.apply(this, arguments); }
  function getSourceContainLayout(){ installMarquee(); return __marqueeFns.getSourceContainLayout.apply(this, arguments); }
  function linkedPreviewMatrix(){ installMarquee(); return __marqueeFns.linkedPreviewMatrix.apply(this, arguments); }
  function matrixHasReflection(){ installMarquee(); return __marqueeFns.matrixHasReflection.apply(this, arguments); }
  function nearestQuarterTurns(){ installMarquee(); return __marqueeFns.nearestQuarterTurns.apply(this, arguments); }
  function onCropNumericInput(){ installMarquee(); return __marqueeFns.onCropNumericInput.apply(this, arguments); }
  function onCropPointerDown(){ installMarquee(); return __marqueeFns.onCropPointerDown.apply(this, arguments); }
  function onCropPointerUp(){ installMarquee(); return __marqueeFns.onCropPointerUp.apply(this, arguments); }
  function onCropPointerMove(){ installMarquee(); return __marqueeFns.onCropPointerMove.apply(this, arguments); }
  function getDisplayedImageClientRect(){ installMarquee(); return __marqueeFns.getDisplayedImageClientRect.apply(this, arguments); }
  function pointerToDisplayPx(){ installMarquee(); return __marqueeFns.pointerToDisplayPx.apply(this, arguments); }
  function pointerToImagePx(){ installMarquee(); return __marqueeFns.pointerToImagePx.apply(this, arguments); }
  function populateInsetStyle(){ installMarquee(); return __marqueeFns.populateInsetStyle.apply(this, arguments); }
  function previewNeedsArtboardOrient(){ installMarquee(); return __marqueeFns.previewNeedsArtboardOrient.apply(this, arguments); }
  function readCropRect(){ installMarquee(); return __marqueeFns.readCropRect.apply(this, arguments); }
  function readInsetStyleSettings(){ installMarquee(); return __marqueeFns.readInsetStyleSettings.apply(this, arguments); }
  function setMarqueeMode(){ installMarquee(); return __marqueeFns.setMarqueeMode.apply(this, arguments); }
  function syncCropAspectUi(){ installMarquee(); return __marqueeFns.syncCropAspectUi.apply(this, arguments); }
  function syncMarqueeModeUi(){ installMarquee(); return __marqueeFns.syncMarqueeModeUi.apply(this, arguments); }
  function updateCropOverlay(){ installMarquee(); return __marqueeFns.updateCropOverlay.apply(this, arguments); }
  function updateCropSizeHint(){ installMarquee(); return __marqueeFns.updateCropSizeHint.apply(this, arguments); }
  function writeCropRect(){ installMarquee(); return __marqueeFns.writeCropRect.apply(this, arguments); }

  function previewCenterTransform() {
    var layout = getSourceContainLayout();
    var panX = layout ? layout.panX : 0;
    var panY = layout ? layout.panY : 0;
    if (Math.abs(panX) < 0.5 && Math.abs(panY) < 0.5) {
      return 'translate(-50%, -50%)';
    }
    return 'translate(calc(-50% + ' + panX.toFixed(2) + 'px), calc(-50% + ' + panY.toFixed(2) + 'px))';
  }

  function updatePreviewZoomUi() {
    var label = byId('previewZoomLabel');
    var stage = byId('previewStage');
    if (label) { label.textContent = Math.round((previewViewZoom || 1) * 100) + '%'; }
    if (stage) { stage.classList.toggle('preview-zoomed', (previewViewZoom || 1) > 1.01); }
  }

  function applyPreviewView() {
    var layout = getSourceContainLayout();
    if (layout) {
      previewViewZoom = layout.zoom;
      previewViewPanX = layout.panX;
      previewViewPanY = layout.panY;
    }
    syncTransformBoxSize();
    updateCropOverlay();
    updatePreviewZoomUi();
  }

  /* Zoom about a client point so that image pixel stays under the cursor. Omit anchor to use stage center. */
  function setPreviewZoom(nextZoom, anchorClientX, anchorClientY) {
    var stage = byId('previewStage');
    var before = getSourceContainLayout();
    var z = Number(nextZoom);
    var sr;
    var ax;
    var ay;
    var left;
    var top;
    var fx;
    var fy;
    var newW;
    var newH;
    if (!isFinite(z) || z < 1) { z = 1; }
    if (z > PREVIEW_ZOOM_MAX) { z = PREVIEW_ZOOM_MAX; }
    if (!before || !stage || z <= 1.001) {
      previewViewZoom = 1;
      previewViewPanX = 0;
      previewViewPanY = 0;
      applyPreviewView();
      return;
    }
    sr = stage.getBoundingClientRect();
    ax = (anchorClientX == null) ? (sr.left + sr.width / 2) : anchorClientX;
    ay = (anchorClientY == null) ? (sr.top + sr.height / 2) : anchorClientY;
    left = sr.left + (sr.width - before.boxW) / 2 + before.panX;
    top = sr.top + (sr.height - before.boxH) / 2 + before.panY;
    fx = before.boxW > 0 ? (ax - left) / before.boxW : 0.5;
    fy = before.boxH > 0 ? (ay - top) / before.boxH : 0.5;
    newW = before.fitW * z;
    newH = before.fitH * z;
    previewViewZoom = z;
    previewViewPanX = (ax - fx * newW) - (sr.left + (sr.width - newW) / 2);
    previewViewPanY = (ay - fy * newH) - (sr.top + (sr.height - newH) / 2);
    applyPreviewView();
  }

  function resetPreviewView() {
    previewViewZoom = 1;
    previewViewPanX = 0;
    previewViewPanY = 0;
    var stage = byId('previewStage');
    if (stage) {
      stage.classList.remove('preview-zoomed');
      stage.classList.remove('panning');
      stage.classList.remove('pan-ready');
    }
    updatePreviewZoomUi();
  }

  function onPreviewWheel(event) {
    var dy;
    var factor;
    if (!getSourceContainLayout()) { return; }
    if (event && event.preventDefault) { event.preventDefault(); }
    dy = Number(event.deltaY) || 0;
    if (event.deltaMode === 1) { dy *= 16; }
    else if (event.deltaMode === 2) { dy *= 280; }
    if (!dy) { return; }
    factor = Math.exp(-dy * 0.0016);
    setPreviewZoom(previewViewZoom * factor, event.clientX, event.clientY);
  }

  function beginPreviewPan(event) {
    var stage = byId('previewStage');
    var originX = event.clientX;
    var originY = event.clientY;
    var originPanX = previewViewPanX;
    var originPanY = previewViewPanY;
    if (stage) { stage.classList.add('panning'); }
    function move(ev) {
      previewViewPanX = originPanX + (ev.clientX - originX);
      previewViewPanY = originPanY + (ev.clientY - originY);
      applyPreviewView();
    }
    function up() {
      if (stage) { stage.classList.remove('panning'); }
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function syncTransformBoxSize() {
    var xf = byId('previewTransform');
    var layout;
    if (!xf) { return; }
    layout = getSourceContainLayout();
    if (!layout) {
      xf.style.width = '';
      xf.style.height = '';
      xf.style.maxWidth = '';
      xf.style.maxHeight = '';
      return;
    }
    /* Explicit px size = fitW×zoom. Clear any max-* so CSS cannot clamp zoomed boxes. */
    xf.style.maxWidth = 'none';
    xf.style.maxHeight = 'none';
    xf.style.width = Math.round(layout.boxW) + 'px';
    xf.style.height = Math.round(layout.boxH) + 'px';
    syncPreviewTransformStyle();
  }

  function setImageSizeHint(width, height) {
    lastImageSize = (width > 0 && height > 0) ? { width: width, height: height } : null;
    syncTransformBoxSize();
    updateCropSizeHint();
    updateCropOverlay();
  }

  function localizeMsg(message) {
    var msg = message == null ? '' : String(message);
    if (!msg) { return msg; }
    try {
      if (window.PaperFigI18n && typeof window.PaperFigI18n.localizeError === 'function') {
        return window.PaperFigI18n.localizeError(msg);
      }
    } catch (ignore) {}
    return msg;
  }

  function notice(message, kind) {
    var el = byId('notice');
    el.className = 'notice' + (kind ? ' ' + kind : '');
    el.textContent = localizeMsg(message || '');
  }

  function footerStatus(message, kind) {
    var el = byId('footerStatus');
    var localized = localizeMsg(message || '');
    if (!el) { notice(message, kind); return; }
    el.className = 'footer-status' + (kind ? ' ' + kind : '');
    el.textContent = localized;
    el.title = localized;
  }

  function appliedStatus(message) {
    notice('');
    footerStatus(message);
  }
  function setFijiStatus(kind, message) {
    var el = byId('fijiStatus');
    var gateEl = byId('fijiGateStatus');
    var localized = localizeMsg(message);
    if (el) {
      el.className = 'status ' + (kind || 'neutral');
      el.textContent = localized;
    }
    if (gateEl) {
      gateEl.className = 'status ' + (kind || 'neutral');
      gateEl.textContent = localized;
    }
  }

  function fijiPathValue() {
    var main = byId('fijiPath');
    var gate = byId('fijiGatePath');
    var v = '';
    if (main && main.value) { v = String(main.value).replace(/^\s+|\s+$/g, ''); }
    if (!v && gate && gate.value) { v = String(gate.value).replace(/^\s+|\s+$/g, ''); }
    return v;
  }

  function syncFijiPathFields(value) {
    var v = value == null ? fijiPathValue() : String(value).replace(/^\s+|\s+$/g, '');
    if (byId('fijiPath')) { byId('fijiPath').value = v; }
    if (byId('fijiGatePath')) { byId('fijiGatePath').value = v; }
    settings.fijiPath = v;
  }

  function hideFijiGate() {
    var gate = byId('fijiGate');
    if (!gate) { return; }
    gate.classList.add('hidden');
    gate.setAttribute('hidden', '');
  }

  function showFijiGate() {
    var gate = byId('fijiGate');
    var details = byId('fijiSetupDetails');
    if (!gate || (typeof gate.hasAttribute === 'function' && !gate.hasAttribute('hidden'))) { return; }
    syncFijiPathFields(settings.fijiPath || '');
    gate.classList.remove('hidden');
    gate.removeAttribute('hidden');
    if (details) { details.open = true; }
    var input = byId('fijiGatePath');
    if (input && typeof input.focus === 'function') { input.focus(); }
  }

  function completeFijiGate(savePath) {
    if (savePath) {
      syncFijiPathFields(savePath);
      saveSettings();
    }
    hideFijiGate();
  }

  function bindFijiGate() {
    var gateBrowse = byId('fijiGateBrowse');
    var gateDetect = byId('fijiGateDetect');
    var gateTest = byId('fijiGateTest');
    var gateSave = byId('fijiGateSave');
    var gateSkip = byId('fijiGateSkip');
    var gatePath = byId('fijiGatePath');
    if (!gateSave) { return; }
    if (gatePath) {
      gatePath.addEventListener('change', function () {
        syncFijiPathFields(gatePath.value);
        scheduleSaveSettings();
      });
      gatePath.addEventListener('input', function () {
        if (byId('fijiPath')) { byId('fijiPath').value = gatePath.value; }
      });
    }
    if (gateBrowse) {
      gateBrowse.addEventListener('click', function () { byId('fijiFile').click(); });
    }
    if (gateDetect) {
      gateDetect.addEventListener('click', function () {
        detectFiji();
        syncFijiPathFields(byId('fijiPath').value);
      });
    }
    if (gateTest) {
      gateTest.addEventListener('click', function () {
        syncFijiPathFields(gatePath ? gatePath.value : '');
        testFiji();
      });
    }
    gateSave.addEventListener('click', function () {
      var v = fijiPathValue();
      if (!v) {
        setFijiStatus('error', t('fijiEnterPath'));
        return;
      }
      syncFijiPathFields(v);
      saveSettings();
      setFijiStatus('ok', t('fijiSaved', { path: v }));
      completeFijiGate(v);
    });
    gateSkip.addEventListener('click', function () {
      hideFijiGate();
      setFijiStatus('neutral', t('notConfigured'));
      notice(t('fijiSkipped'));
    });
  }

  function setBusy(button, busy, busyText) {
    if (!button) { return; }
    var i18nKey = button.getAttribute && button.getAttribute('data-i18n');
    if (i18nKey) { button.dataset.label = t(i18nKey); }
    else if (!button.dataset.label) { button.dataset.label = button.textContent; }
    button.disabled = busy;
    if (busy) {
      button.dataset.busy = '1';
      button.textContent = busyText;
    } else {
      delete button.dataset.busy;
      button.textContent = button.dataset.label;
    }
  }


  function setApplyRunning(running) {
    applyRunning = running;
    byId('applyBtn').disabled = running;
    if (byId('insetUpdateBtn')) { byId('insetUpdateBtn').disabled = running; }
    byId('resetBtn').disabled = running || !resetTabAvailable();
    byId('inspectBtn').disabled = running;
    updateArtboardPreviewButtons();
    byId('applyBtn').dataset.label = t('apply');
    byId('applyBtn').textContent = running ? t('applying') : t('apply');
  }

  function quoteExtendScript(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '"';
  }

  /* Illustrator runs one evalScript at a time. Background polls must not sit ahead of a click. */
  var hostJobs = [];
  var hostPumping = false;
  function hostQueueHasUser() {
    var i;
    for (i = 0; i < hostJobs.length; i += 1) {
      if (!hostJobs[i].background) { return true; }
    }
    return false;
  }
  function pumpHostQueue() {
    var job;
    if (hostPumping || !hostJobs.length || !cs) { return; }
    job = hostJobs.shift();
    hostPumping = true;
    cs.evalScript(job.script, function (result) {
      hostPumping = false;
      if (result === 'EvalScript error.') { job.reject(new Error(result)); }
      else { job.resolve(result); }
      pumpHostQueue();
    });
  }
  function evalHost(script, opts) {
    return new Promise(function (resolve, reject) {
      var job;
      var i;
      var dropped;
      if (!cs) { reject(new Error(t('errCepUnavailable'))); return; }
      job = {
        script: script,
        resolve: resolve,
        reject: reject,
        background: !!(opts && opts.background)
      };
      if (!window.PaperFigInteraction) { reject(new Error('PaperFigInteraction missing')); return; }
      var placed = window.PaperFigInteraction.acceptHostJob(hostJobs, hostPumping, job);
      hostJobs = placed.queue;
      for (i = 0; i < placed.dropped.length; i += 1) {
        dropped = placed.dropped[i];
        dropped.reject(new Error('skipped'));
      }
      if (!placed.accepted) {
        reject(new Error('skipped'));
        return;
      }
      pumpHostQueue();
    });
  }

  function parseHostResult(result) {
    var parsed, shown;
    if (result == null || result === '' || result === 'undefined' || result === 'null') {
      throw new Error(t('errUnexpectedAi', { result: '(empty)' }));
    }
    try { parsed = JSON.parse(result); }
    catch (error) {
      shown = String(result);
      if (!shown.trim()) shown = '(empty)';
      throw new Error(t('errUnexpectedAi', { result: shown.length > 240 ? shown.slice(0, 240) + '…' : shown }));
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(t('errUnexpectedAi', { result: '(empty)' }));
    }
    if (!parsed.ok) { throw new Error(localizeMsg(parsed.error || t('errAiFailed'))); }
    return parsed;
  }

  function friendlyNoBitmapError(message) {
    return localizeMsg(message);
  }

  /*
   * Load bitmap.jsx once per panel session (0.3.0). Reload only if host lost
   * the helpers or HOST_SCRIPT_VERSION changed. Windows-safe forward-slash path.
   */
  function ensureHostScript(forceReload) {
    if (!cs || !extensionPath) { return Promise.reject(new Error(t('errHostUnavailable'))); }
    if (!forceReload && hostScriptLoadPromise &&
        (!hostScriptLoadedVersion || Date.now() - hostLastChecked < 5000)) { return hostScriptLoadPromise; }
    var jsxPath = extensionPath.replace(/\\/g, '/') + '/jsx/bitmap.jsx';
    hostScriptLoadPromise = evalHost('typeof SCI_BITMAP_HOST_VERSION === "undefined" ? "" : SCI_BITMAP_HOST_VERSION')
      .then(function (version) {
        if (!forceReload && version === HOST_SCRIPT_VERSION) { return null; }
        return evalHost('$.evalFile(new File(' + quoteExtendScript(jsxPath) + '))');
      }).then(function () {
        hostScriptLoadedVersion = HOST_SCRIPT_VERSION; hostLastChecked = Date.now();
      }).catch(function (error) {
        hostScriptLoadedVersion = ''; hostScriptLoadPromise = null;
        throw new Error(t('errLoadHelpers', { msg: error.message }));
      });
    return hostScriptLoadPromise;
  }

  function mimeForPath(filePath) {
    if (/\.png$/i.test(filePath)) { return 'image/png'; }
    if (/\.jpe?g$/i.test(filePath)) { return 'image/jpeg'; }
    if (/\.gif$/i.test(filePath)) { return 'image/gif'; }
    if (/\.bmp$/i.test(filePath)) { return 'image/bmp'; }
    if (/\.tif{1,2}$/i.test(filePath)) { return 'image/tiff'; }
    return '';
  }

  /* Browser Image() can usually decode these linked files without AI/Fiji. */
  function isBrowserSimpleMime(mime) {
    return mime === 'image/png' || mime === 'image/jpeg' ||
      mime === 'image/gif' || mime === 'image/bmp';
  }

  /*
   * 0.2.8: Canvas pipeline (preview + Apply, no Fiji) for formats Canvas Image can decode.
   * JPG/JPEG/PNG/GIF/BMP. TIFF / Bio-Formats / undecodable → Fiji only.
   */
  function isCanvasPipelineSource(filePath) {
    return isBrowserSimpleMime(mimeForPath(filePath));
  }

  /* Lightweight PNG / JPEG / TIFF dimension probe (no deps). */
  function metaCacheGet(filePath, mtimeMs) {
    var rec = imageMetaCache[filePath];
    if (!rec) { return null; }
    if (mtimeMs && rec.mtimeMs !== mtimeMs) { return null; }
    return rec;
  }

  function metaCachePut(filePath, rec) {
    var key;
    if (!filePath || !rec) { return; }
    if (!imageMetaCache[filePath]) {
      imageMetaCacheOrder.push(filePath);
      while (imageMetaCacheOrder.length > META_CACHE_MAX) {
        key = imageMetaCacheOrder.shift();
        delete imageMetaCache[key];
      }
    }
    imageMetaCache[filePath] = rec;
  }

  /* Header-only TIFF IFD read (first 256KB). No full-file readFileSync for dims. */
  function probeTiffMeta(filePath) { return probeCachedMetadata(filePath); }

  function probeImageSize(filePath) {
    var m = probeCachedMetadata(filePath);
    return m ? {width:m.width, height:m.height} : null;
  }

  function probeCachedMetadata(filePath) {
    if (!window.require || !filePath) { return null; }
    try {
      var mtime = sourceMtimeMs(filePath), cached = metaCacheGet(filePath, mtime);
      if (cached) { return cached; }
      var result = Core.readMetadata(window.require('fs'), filePath, window.require('buffer').Buffer);
      if (result) { metaCachePut(filePath, result); }
      return result;
    } catch (ignore) { return null; }
  }

  function isComplexTiffMeta(meta) {
    if (!meta) { return false; }
    if (meta.bitsPerSample && meta.bitsPerSample > 8) { return true; }
    if (meta.samplesPerPixel && meta.samplesPerPixel > 4) { return true; }
    return false;
  }

  /*
   * Linked file worth trying Image() decode first (skip AI/Fiji when it works).
   * PNG/JPEG/GIF/BMP always. 8-bit TIFF: try once (CEP often cannot decode → fall through).
   * Clearly complex TIFF: false.
   */
  function isSimpleLinkedPreviewCandidate(filePath) {
    var mime = mimeForPath(filePath);
    var meta;
    if (!filePath || !mime) { return false; }
    if (isBrowserSimpleMime(mime)) { return true; }
    if (mime !== 'image/tiff') { return false; }
    meta = probeTiffMeta(filePath);
    if (isComplexTiffMeta(meta)) { return false; }
    return true;
  }

  function previewMethodLabel(method, cached) {
    var label = method === 'ai' ? 'AI capture' : (method === 'fiji' ? 'Fiji' : 'Canvas');
    var note = cached ? (label + ' (cached)') : label;
    /* Thumbnail = overall tone; blur/sharpen differ at downscale. */
    note += ' · tone≈result';
    if (byId('softBlur') && byId('softBlur').checked || byId('sharpen') && byId('sharpen').checked) {
      note += ' · blur/sharpen approx at preview scale';
    }
    return note;
  }

  /* Estimate pixel size from Illustrator bounds (pt) × DPI when file probe fails. */
  function estimateSizeFromBounds(widthPt, heightPt, dpi) {
    var d = Math.max(36, Math.min(2400, Number(dpi) || settings.dpi || 300));
    var w = Math.round(Math.abs(Number(widthPt) || 0) * d / 72);
    var h = Math.round(Math.abs(Number(heightPt) || 0) * d / 72);
    if (w < 1 || h < 1) { return null; }
    return { width: w, height: h, estimated: true, dpi: d };
  }

  function aspectRatio(w, h) {
    w = Math.abs(Number(w) || 0);
    h = Math.abs(Number(h) || 0);
    return (w > 0 && h > 0) ? (w / h) : 0;
  }

  function aspectsDisagree(w1, h1, w2, h2) {
    var a1 = aspectRatio(w1, h1);
    var a2 = aspectRatio(w2, h2);
    var rel;
    if (!a1 || !a2) { return false; }
    if ((a1 > 1.05 && a2 < 0.95) || (a1 < 0.95 && a2 > 1.05)) { return true; }
    rel = Math.abs(a1 - a2) / Math.max(a1, a2);
    return rel > 0.22;
  }

  function aspectsNearlyReciprocal(w1, h1, w2, h2) {
    var a1 = aspectRatio(w1, h1);
    var a2 = aspectRatio(w2, h2);
    if (!a1 || !a2) { return false; }
    return Math.abs(a1 * a2 - 1) < 0.25;
  }

  function getSourcePixelSize() {
    if (sourceImageSize && sourceImageSize.width > 0 && sourceImageSize.height > 0) {
      return sourceImageSize;
    }
    return lastImageSize;
  }

  /*
   * Size used for transform-box aspect + crop overlay / pointer map.
   * Prefer live previewBase when present so CSS never stretches the bitmap;
   * keep lastImageSize magnitude when aspects already agree (full-res crop space).
   */
  function getPreviewLayoutSize() {
    var longEdge;
    var ar;
    if (previewBase && previewBase.width > 0 && previewBase.height > 0) {
      if (lastImageSize &&
          !aspectsDisagree(previewBase.width, previewBase.height, lastImageSize.width, lastImageSize.height)) {
        return lastImageSize;
      }
      if (lastImageSize && lastImageSize.width > 0 && lastImageSize.height > 0) {
        longEdge = Math.max(lastImageSize.width, lastImageSize.height);
        ar = previewBase.width / Math.max(1, previewBase.height);
        if (ar >= 1) {
          return { width: longEdge, height: Math.max(1, Math.round(longEdge / ar)) };
        }
        return { width: Math.max(1, Math.round(longEdge * ar)), height: longEdge };
      }
      return { width: previewBase.width, height: previewBase.height };
    }
    if (previewIsSource && sourceImageSize && !previewOrientSwap) { return sourceImageSize; }
    return lastImageSize;
  }

  /*
   * When file px and artboard pt disagree (common after 90° place/rotate), orient the
   * display to geometry and remember true file px for crop Apply mapping.
   */
  function applyGeomAwareImageSize(pixelSize, item) {
    var gw;
    var gh;
    var preferAi = false;
    previewOrientSwap = false;
    previewMatchesArtboard = false;
    previewBakedExif = false;
    sourceImageSize = null;
    lastGeomPt = null;
    lastRotationDeg = 0;
    if (!item) {
      if (pixelSize) { setImageSizeHint(pixelSize.width, pixelSize.height); }
      return { preferAi: false };
    }
    gw = Math.abs(Number(item.widthPt) || 0);
    gh = Math.abs(Number(item.heightPt) || 0);
    if (gw > 0 && gh > 0) { lastGeomPt = { width: gw, height: gh }; }
    lastRotationDeg = Number(item.rotationDeg) || 0;
    if (!pixelSize || !(pixelSize.width > 0 && pixelSize.height > 0)) {
      return { preferAi: false };
    }
    sourceImageSize = { width: pixelSize.width, height: pixelSize.height };
    if (item.linked) {
      /* Keep Canvas path (preferAi false). EXIF/geom mismatch is fixed in
       * ensurePreviewMatchesArtboardOrient after decode — do not force-rotate here. */
      setImageSizeHint(pixelSize.width, pixelSize.height);
      return { preferAi: false };
    }
    /* Prefer AI/display-transform when placed orientation differs from file (rotate/flip). */
    if (nearestQuarterTurns(lastRotationDeg) !== 0 || matrixHasReflection(item.matrix)) {
      preferAi = true;
    }
    if (lastGeomPt && aspectsDisagree(pixelSize.width, pixelSize.height, gw, gh)) {
      preferAi = true;
      if (aspectsNearlyReciprocal(pixelSize.width, pixelSize.height, gw, gh)) {
        previewOrientSwap = true;
        setImageSizeHint(pixelSize.height, pixelSize.width);
      } else {
        setImageSizeHint(pixelSize.width, pixelSize.height);
      }
    } else {
      setImageSizeHint(pixelSize.width, pixelSize.height);
    }
    return { preferAi: preferAi };
  }

  function reconcilePreviewAspectWithGeom() {
    if(lastSelectedItem && lastSelectedItem.linked)return ;
    var pw;
    var ph;
    var est;
    if (!previewBase || previewBase.width < 1 || previewBase.height < 1) { return; }
    pw = previewBase.width;
    ph = previewBase.height;
    if (lastGeomPt && aspectsDisagree(pw, ph, lastGeomPt.width, lastGeomPt.height)) {
      return;
    }
    if (!lastImageSize) {
      setImageSizeHint(pw, ph);
      return;
    }
    if (!aspectsDisagree(pw, ph, lastImageSize.width, lastImageSize.height)) { return; }
    if (!sourceImageSize && lastImageSize) {
      sourceImageSize = { width: lastImageSize.width, height: lastImageSize.height };
    }
    if (sourceImageSize && lastGeomPt &&
        aspectsNearlyReciprocal(sourceImageSize.width, sourceImageSize.height, lastGeomPt.width, lastGeomPt.height)) {
      previewOrientSwap = true;
      setImageSizeHint(sourceImageSize.height, sourceImageSize.width);
      return;
    }
    if (lastGeomPt) {
      est = estimateSizeFromBounds(lastGeomPt.width, lastGeomPt.height, settings.dpi || (byId('dpi') && byId('dpi').value));
      if (est) {
        setImageSizeHint(est.width, est.height);
        return;
      }
    }
    setImageSizeHint(pw, ph);
  }

  function cropOptsForApply(opts) {
    if (opts.cropWidth > 0 && opts.cropHeight > 0 && (!previewIsSource ||
        (lastSelectedItem && lastSelectedItem.linked && (!sourceImageSize || sourceImageSize.estimated)))) {
      throw new Error(t('errAccuratePixels'));
    }
    return opts;
  }

  function ijPath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
  }

  function escapeIjString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function generateApplyMacro(inPath, outPath, opts) {
    var lines = [];
    var cropW = Math.max(0, Math.round(Number(opts.cropWidth) || 0));
    var cropH = Math.max(0, Math.round(Number(opts.cropHeight) || 0));
    var cropL = Math.max(0, Math.round(Number(opts.cropLeft) || 0));
    var cropT = Math.max(0, Math.round(Number(opts.cropTop) || 0));
    var range;
    var wl;
    var gains;
    var dpi = Math.max(36, Math.min(2400, Number(opts.dpi) || 300));
    var lut = String(opts.lut || 'None');
    var inEsc = escapeIjString(ijPath(inPath));
    var outEsc = escapeIjString(ijPath(outPath));

    lines.push('// PaperFig for Illustrator generated apply macro (no rotate — Illustrator item.rotate)');
    lines.push('setBatchMode(true);');
    lines.push('open("' + inEsc + '");');
    lines.push('getDimensions(iw,ih,nc,nz,nt); if (nc*nz*nt>1) exit("Export a single image/channel from Fiji first. Stacks are not flattened automatically.");');

    /* Pixel crop in source space. Geometric rotate is applied in JSX after replace. */
    if (cropW > 0 && cropH > 0) {
      lines.push('if ('+cropL+'>=getWidth() || '+cropT+'>=getHeight()) exit("Crop outside image");');
      lines.push('cw=minOf('+cropW+',getWidth()-'+cropL+'); ch=minOf('+cropH+',getHeight()-'+cropT+');');
      lines.push('makeRectangle(' + cropL + ', ' + cropT + ', cw, ch);');
      lines.push('run("Crop");');
    }

    /* Artboard preview: downscale after crop for speed (max edge). */
    if (opts.previewMaxEdge && Number(opts.previewMaxEdge) > 0) {
      lines.push('iw = getWidth(); ih = getHeight();');
      lines.push('longest = iw > ih ? iw : ih;');
      lines.push('if (longest > ' + Math.round(Number(opts.previewMaxEdge)) + ') {');
      lines.push('  sc = ' + Math.round(Number(opts.previewMaxEdge)) + ' / longest;');
      lines.push('  run("Scale...", "x=" + sc + " y=" + sc + " interpolation=Bilinear average");');
      lines.push('}');
    }

    /* Color balance on RGB before optional grayscale conversion. */
    gains = colorBalanceGains(opts.cyanRed, opts.magentaGreen, opts.yellowBlue);
    if (gains.touched) {
      lines.push('if (bitDepth == 24) {');
      lines.push('  run("RGB Stack");');
      lines.push('  setSlice(1); run("Multiply...", "value=' + gains.r.toFixed(4) + ' slice");');
      lines.push('  setSlice(2); run("Multiply...", "value=' + gains.g.toFixed(4) + ' slice");');
      lines.push('  setSlice(3); run("Multiply...", "value=' + gains.b.toFixed(4) + ' slice");');
      lines.push('  run("RGB Color");');
      lines.push('}');
    }

    if (opts.grayscale) {
      lines.push('if (bitDepth == 24 || bitDepth == 32) {');
      lines.push('  run("RGB to Luminance");');
      lines.push('} else if (bitDepth != 8) {');
      lines.push('  run("8-bit");');
      lines.push('}');
    }

    /* Tone: Low/High (black/white) overrides B/C when not 0–255. */
    if (tonePointsTouched(opts.toneLow, opts.toneHigh)) {
      wl = toneRange(opts.toneLow, opts.toneHigh);
      lines.push('setMinAndMax(' + wl.min.toFixed(3) + ', ' + wl.max.toFixed(3) + ');');
      lines.push('run("Apply LUT");');
    } else if ((Number(opts.brightness) || 0) !== 0 || (Number(opts.contrast) || 0) !== 0) {
      range = brightnessContrastRange(opts.brightness, opts.contrast);
      lines.push('setMinAndMax(' + range.min.toFixed(3) + ', ' + range.max.toFixed(3) + ');');
      lines.push('run("Apply LUT");');
    }

    /* Lean pixel filters (after tone). Invert → soft Gaussian → light Unsharp Mask. */
    if (opts.invert) {
      lines.push('run("Invert");');
    }
    if (opts.softBlur) {
      lines.push('run("Gaussian Blur...", "sigma=0.8");');
    }
    if (opts.sharpen) {
      lines.push('run("Unsharp Mask...", "radius=1 mask=0.40 threshold=0");');
    }

    if (lut && lut !== 'None') {
      lines.push('run("' + escapeIjString(lut) + '");');
    }

    lines.push('run("Properties...", "unit=inch pixel_width=' +
      (1 / dpi).toFixed(8) + ' pixel_height=' + (1 / dpi).toFixed(8) + ' voxel_depth=1.0000000");');
    var fmt = opts.previewMaxEdge ? 'TIFF' : String(opts.format || 'TIFF').toUpperCase();
    if (fmt === 'PNG' || fmt === 'JPEG') {
      lines.push('if (bitDepth != 8 && bitDepth != 24) run("8-bit");');
      if (fmt === 'JPEG') { lines.push('run("RGB Color");'); }
    }
    lines.push('saveAs("' + (fmt === 'PNG' ? 'PNG' : (fmt === 'JPEG' ? 'Jpeg' : 'Tiff')) + '", "' + outEsc + '");');
    lines.push('close();');
    lines.push('print("' + (opts.previewMaxEdge ? 'SCI_BITMAP_PREVIEW_OK' : 'SCI_BITMAP_APPLY_OK') + '");');
    return lines.join('\n') + '\n';
  }

  function writeTempMacro(text) {
    var fs = window.require('fs');
    var path = window.require('path');
    var os = window.require('os');
    var file = path.join(os.tmpdir(), 'paperfig-apply-' + Date.now() + '.ijm');
    fs.writeFileSync(file, text, 'utf8');
    return file;
  }

  function suggestOutPath(sourcePath, format) {
    var fmt=String(format || 'PNG').toUpperCase();
    if (fmt !== 'PNG' && fmt !== 'JPEG' && fmt !== 'TIFF') { fmt = 'PNG'; }
    return durableOutputPath(sourcePath, fmt === 'PNG' ? '.png' : (fmt === 'JPEG' ? '.jpg' : '.tif'));
  }

  /*
   * Apply output: durable linked file AI keeps displaying.
   * Prefer beside source when writable. Slow/cloud folders use a durable
   * fallback under LocalAppData (Windows) or ~/paperfig-out — NEVER
   * os.tmpdir() alone (OS may purge TEMP and break the link / blank artboard).
   * Unique filename every Apply so Illustrator must reload pixels.
   * Removing panel backup does NOT delete or move this active linked file.
   */
  function isSlowRelinkDir(dir) { return window.PaperFigOutput.isSlowRelinkDir(dir); }
  function durableFallbackDir() { return window.PaperFigOutput.durableFallbackDir(); }
  function durableOutputPath(sourcePath, ext) { return window.PaperFigOutput.durableOutputPath(sourcePath, ext); }

  function suggestPreviewOutPath(sourcePath) {
    var path = window.require('path');
    var os = window.require('os');
    var base;
    try {
      base = path.basename(sourcePath, path.extname(sourcePath)) || 'paperfig';
    } catch (ignore) {
      base = 'paperfig';
    }
    return path.join(os.tmpdir(), base + '_preview_' + Date.now() + '.tif');
  }

  function clearPreviewCanvas() {
    var canvas = byId('previewCanvas');
    var stage = byId('previewStage');
    var xf = byId('previewTransform');
    previewBase = null;
    previewBaseDrag = null;
    previewImageData=null; blurScratch={};
    if (canvas) {
      canvas.classList.add('hidden');
      canvas.width = 1;
      canvas.height = 1;
    }
    if (xf) { xf.style.transform = 'translate(-50%, -50%) scale(1, 1)'; }
    stage.classList.remove('has-canvas');
    stage.classList.remove('crop-drawing');
    stage.classList.remove('has-crop-size');
    stage.style.backgroundImage = '';
    stage.classList.remove('has-image');
    stage.style.filter = '';
    setPreviewStatus('');
    if (byId('cropOverlay')) {
      byId('cropOverlay').classList.add('hidden');
    }
  }

  function clearPreviewIdle(message) {
    previewLoadToken += 1;
    panelProxyToken += 1;
    clearPreviewCanvas();
    byId('previewMessage').textContent = message || t('previewEmpty');
    byId('metaLine').textContent = t('metaNoUsable');
    setImageSizeHint(0, 0);
    sourceImageSize = null;
    lastGeomPt = null;
    lastRotationDeg = 0;
    previewOrientSwap = false;
    previewMatchesArtboard = false;
    lastBitmapCount = 0;
    lastSourcePath = '';
    lastSelectedItem=null; lastObjectKey='';
    resetPreviewView();
    adoptArtboardPreview(null);
  }

  function schedulePreviewRender() {
    if (previewRaf) { return; }
    previewRaf = (window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(function () {
      previewRaf = null;
      renderPreviewCanvas();
    });
  }

  function clampByte(v) {
    if (v < 0) { return 0; }
    if (v > 255) { return 255; }
    return v;
  }

  /*
   * Shared Canvas pixel pipeline (0.9.0) — same order as Apply:
   *   per-channel Low/High (+ keep / recolor) → color balance → grayscale →
   *   global tone (Low/High overrides B/C) → invert → soft blur → sharpen.
   * LUT is Fiji-only (skipped on Canvas path). Mutates imgData in place.
   */
  function applyPixelOpsToImageData(imgData, opts) {
    var gains;
    var toneMin;
    var toneMax;
    var toneSpan;
    var useWl;
    var range;
    var wl;
    var i;
    var r;
    var g;
    var b;
    var a;
    var ylum;
    var out;
    var brightness;
    var contrast;

    if (!imgData || !imgData.data) { return imgData; }
    opts = opts || {};
    /* Inset export keeps linked-file pixels so µm/px is unchanged. */
    if (opts.identityPixels) { return imgData; }
    W.mapChannels(imgData.data,opts.channels,opts.channelView||'merged');
    brightness = opts.brightness != null ? opts.brightness : 0;
    contrast = opts.contrast != null ? opts.contrast : 0;

    gains = colorBalanceGains(opts.cyanRed, opts.magentaGreen, opts.yellowBlue);
    useWl = tonePointsTouched(opts.toneLow, opts.toneHigh);
    if (useWl) {
      wl = toneRange(opts.toneLow, opts.toneHigh);
      toneMin = wl.min;
      toneMax = wl.max;
    } else {
      range = brightnessContrastRange(brightness, contrast);
      toneMin = range.min;
      toneMax = range.max;
    }
    toneSpan = toneMax - toneMin;
    if (Math.abs(toneSpan) < 0.0001) { toneSpan = 0.0001; }

    out = imgData.data;
    for (i = 0; i < out.length; i += 4) {
      r = out[i];
      g = out[i + 1];
      b = out[i + 2];
      a = out[i + 3];
      if (a === 0) { continue; }

      if (gains.touched) {
        r = clampByte(r * gains.r);
        g = clampByte(g * gains.g);
        b = clampByte(b * gains.b);
      }

      if (opts.grayscale) {
        ylum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = ylum;
      }

      if (useWl || (Number(brightness) || 0) !== 0 || (Number(contrast) || 0) !== 0) {
        r = clampByte(((r - toneMin) / toneSpan) * 255);
        g = clampByte(((g - toneMin) / toneSpan) * 255);
        b = clampByte(((b - toneMin) / toneSpan) * 255);
      }

      if (opts.invert) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }

    if (opts.softBlur) { boxBlur3(imgData); }
    if (opts.sharpen) { unsharpLight(imgData, 0.4); }
    return imgData;
  }

  function readPixelOpsFromUi() {
    return {
      channels: channelsFromUi(),
      brightness: Number(byId('brightness').value) || 0,
      contrast: Number(byId('contrast').value) || 0,
      toneLow: Number(byId('toneLow').value) || 0,
      toneHigh: Number(byId('toneHigh').value),
      cyanRed: Number(byId('cyanRed').value) || 0,
      magentaGreen: Number(byId('magentaGreen').value) || 0,
      yellowBlue: Number(byId('yellowBlue').value) || 0,
      grayscale: !!(byId('grayscale') && byId('grayscale').checked),
      invert: !!(byId('invert') && byId('invert').checked),
      softBlur: !!(byId('softBlur') && byId('softBlur').checked),
      sharpen: !!(byId('sharpen') && byId('sharpen').checked)
    };
  }

  function reusablePreviewData(ctx, w, h) {
    if (!previewImageData || previewImageData.width !== w || previewImageData.height !== h) {
      previewImageData = ctx.createImageData(w, h);
    }
    return previewImageData;
  }

  function renderPreviewCanvas() {
    var adjustTabActive = false;
    try { adjustTabActive = !!(document.querySelector('.tab-bar [data-tab="adjust"].active')); } catch (ignoreTab) {}
    /* Adjust-tab remap uses previewBase when present, even if a raw dataset is loaded. */
    if (science && science.active() && !(adjustTabActive && previewBase)) {
      try { science.renderPanel(); } catch (e) { notice(e.message, "error"); }
      return;
    }
    var canvas = byId('previewCanvas');
    var stage = byId('previewStage');
    var ctx;
    var angle;
    var srcW;
    var srcH;
    var srcData;
    var imgData;
    var base;
    var ops;
    var dragQuality;

    if (!canvas || !previewBase) { return; }

    /* Hold-to-compare: show untouched original previewBase. */
    if (comparingOriginal) {
      base = previewBase;
      srcW = base.width;
      srcH = base.height;
      if (canvas.width !== srcW || canvas.height !== srcH) { canvas.width = srcW; canvas.height = srcH; }
      ctx = canvas.getContext('2d');
      imgData = reusablePreviewData(ctx, srcW, srcH);
      imgData.data.set(base.data);
      ctx.putImageData(imgData, 0, 0);
      canvas.classList.remove('hidden');
      stage.classList.add('has-canvas', 'comparing');
      stage.classList.remove('has-image');
      stage.style.backgroundImage = '';
      stage.style.filter = '';
      byId('previewMessage').textContent = '';
      syncPreviewTransformStyle();
      syncTransformBoxSize();
      updateCropOverlay();
      return;
    }

    dragQuality = sliderDragging && previewBaseDrag && previewBaseDrag.data;
    base = dragQuality ? previewBaseDrag : previewBase;
    srcW = base.width;
    srcH = base.height;
    srcData = base.data;
    angle = normalizeAngle(byId('rotateAngle').value);

    if (canvas.width !== srcW || canvas.height !== srcH) { canvas.width = srcW; canvas.height = srcH; }
    ctx = canvas.getContext('2d');
    imgData = reusablePreviewData(ctx, srcW, srcH);
    imgData.data.set(srcData);

    ops = readPixelOpsFromUi();
    ops.channelView=byId('channelView').value;
    /* While dragging: skip expensive blur/sharpen at low-res (approx tone only). */
    if (sliderDragging) {
      ops.softBlur = false;
      ops.sharpen = false;
    }
    applyPixelOpsToImageData(imgData, ops);

    ctx.putImageData(imgData, 0, 0);
    canvas.classList.remove('hidden');
    syncPreviewTransformStyle();
    stage.classList.add('has-canvas');
    stage.classList.remove('has-image', 'comparing');
    stage.style.backgroundImage = '';
    stage.style.filter = '';
    byId('previewMessage').textContent = '';
    syncTransformBoxSize();
    updateCropOverlay();
  }


  /* AABB size of w×h after linked CSS matrix (identity when not linked). */
  function displayAspectAfterLinkedCss(w, h) {
    var m;
    w = Math.abs(Number(w) || 0);
    h = Math.abs(Number(h) || 0);
    if (!(w > 0 && h > 0)) { return { width: w, height: h }; }
    if (!(lastSelectedItem && lastSelectedItem.linked) || previewMatchesArtboard || previewBakedExif) {
      return { width: w, height: h };
    }
    m = linkedPreviewMatrix();
    if (!m || m.length < 4) { return { width: w, height: h }; }
    return {
      width: Math.abs(m[0]) * w + Math.abs(m[2]) * h,
      height: Math.abs(m[1]) * w + Math.abs(m[3]) * h
    };
  }

  /* True when preview (plus linked CSS, if any) already matches artboard aspect. */
  function previewAlreadyMatchesArtboard() {
    var d;
    if (!previewBase || !lastGeomPt) { return true; }
    d = displayAspectAfterLinkedCss(previewBase.width, previewBase.height);
    return !aspectsDisagree(d.width, d.height, lastGeomPt.width, lastGeomPt.height);
  }

  /* CEP Image() sometimes auto-applies EXIF (natural size = oriented). */
  function jpegDecoderAlreadyOriented(img, meta, xf) {
    var natW = (img && (img.naturalWidth || img.width)) || 0;
    var natH = (img && (img.naturalHeight || img.height)) || 0;
    var sofW = meta && meta.width;
    var sofH = meta && meta.height;
    if (!(natW > 0 && natH > 0 && sofW > 0 && sofH > 0 && xf)) { return false; }
    if (xf.swap) {
      return aspectsNearlyReciprocal(natW, natH, sofW, sofH) &&
        !aspectsDisagree(natW, natH, sofH, sofW);
    }
    if (xf.turns || xf.flipH) {
      /* Flips without swap: dims unchanged — assume not applied if we still mismatch artboard. */
      return false;
    }
    return !aspectsDisagree(natW, natH, sofW, sofH);
  }

  function bakeExifOrientIntoPreview(orientation) {
    var xf = Core.exifOrientationTransform(orientation);
    if (!xf || (!(xf.turns) && !xf.flipH)) { return false; }
    if (previewBase) { previewBase = transformRgbaBuffer(previewBase, xf.turns, xf.flipH); }
    if (previewBaseDrag) { previewBaseDrag = transformRgbaBuffer(previewBaseDrag, xf.turns, xf.flipH); }
    previewBakedExif = true;
    previewMatchesArtboard = true;
    previewOrientSwap = !!xf.swap;
    if (sourceImageSize && sourceImageSize.width > 0 && sourceImageSize.height > 0) {
      if (previewOrientSwap) {
        setImageSizeHint(sourceImageSize.height, sourceImageSize.width);
      } else {
        setImageSizeHint(sourceImageSize.width, sourceImageSize.height);
      }
    } else if (previewBase) {
      setImageSizeHint(previewBase.width, previewBase.height);
    }
    syncPreviewTransformStyle();
    schedulePreviewRender();
    updateCropOverlay();
    return true;
  }

  /*
   * Make Canvas preview match Illustrator display orientation.
   * Only acts when buffer (+ linked CSS) aspect disagrees with artboard geom —
   * Orientation=1 / already-matching JPGs are left alone.
   * Prefers EXIF Orientation 1–8; falls back to PlacedItem rotation / 90° geom swap.
   * Crop L/T/W/H stay storage-file pixels (sourceImageSize); display maps via artboardOrientActive.
   */
  function ensurePreviewMatchesArtboardOrient(img, filePath) {
    var meta;
    var orient;
    var xf;
    var turned;
    var decoderOriented;
    var bufLandscape;
    var artPortrait;
    var turns;
    if (!previewBase) { return false; }

    meta = filePath ? probeCachedMetadata(filePath) : null;
    orient = Number(meta && meta.orientation) || 1;
    xf = (orient > 1 && Core.exifOrientationTransform)
      ? Core.exifOrientationTransform(orient) : null;
    decoderOriented = !!(xf && jpegDecoderAlreadyOriented(img, meta, xf));

    if (meta && meta.width > 0 && meta.height > 0) {
      /* Storage (SOF) dims for crop Apply; may differ from oriented naturalWidth. */
      if (!sourceImageSize || sourceImageSize.estimated ||
          (xf && xf.swap && (sourceImageSize.width !== meta.width ||
            sourceImageSize.height !== meta.height))) {
        sourceImageSize = { width: meta.width, height: meta.height };
      }
    }

    /*
     * Decoder already applied EXIF (natural size oriented): keep storage in
     * sourceImageSize, mark display swap, and use identity CSS so a PlacedItem
     * matrix that also encodes EXIF cannot double-rotate the panel.
     */
    if (decoderOriented && xf) {
      previewOrientSwap = !!xf.swap;
      previewMatchesArtboard = true;
      previewBakedExif = true;
      if (sourceImageSize) {
        setImageSizeHint(
          previewOrientSwap ? sourceImageSize.height : sourceImageSize.width,
          previewOrientSwap ? sourceImageSize.width : sourceImageSize.height);
      }
      syncPreviewTransformStyle();
      updateCropOverlay();
      return true;
    }

    if (!lastGeomPt) { return false; }
    if (previewAlreadyMatchesArtboard()) { return false; }

    if (xf && (xf.turns || xf.flipH)) {
      bakeExifOrientIntoPreview(orient);
      if (previewAlreadyMatchesArtboard()) { return true; }
      /* Bake + linked CSS both applied EXIF → restore buffer, keep CSS path. */
      if (lastSelectedItem && lastSelectedItem.linked && previewBakedExif) {
        previewBakedExif = false;
        previewMatchesArtboard = false;
        previewOrientSwap = false;
        buildPreviewBaseFromImage(img);
        if (meta && meta.width > 0) {
          sourceImageSize = { width: meta.width, height: meta.height };
          setImageSizeHint(meta.width, meta.height);
        }
        syncPreviewTransformStyle();
        if (previewAlreadyMatchesArtboard()) { return false; }
      }
    }

    if (previewAlreadyMatchesArtboard()) { return !!previewBakedExif; }

    if (previewNeedsArtboardOrient()) {
      turned = bakeArtboardOrientIntoPreview();
      if (turned && previewAlreadyMatchesArtboard()) { return true; }
    }

    if (aspectsNearlyReciprocal(previewBase.width, previewBase.height,
          lastGeomPt.width, lastGeomPt.height)) {
      bufLandscape = aspectRatio(previewBase.width, previewBase.height) > 1.05;
      artPortrait = aspectRatio(lastGeomPt.width, lastGeomPt.height) < 0.95;
      turns = (bufLandscape && artPortrait) ? 3 : 1;
      if (previewBase) { previewBase = transformRgbaBuffer(previewBase, turns, false); }
      if (previewBaseDrag) { previewBaseDrag = transformRgbaBuffer(previewBaseDrag, turns, false); }
      previewBakedExif = true;
      previewMatchesArtboard = true;
      previewOrientSwap = true;
      if (sourceImageSize && sourceImageSize.width > 0) {
        setImageSizeHint(sourceImageSize.height, sourceImageSize.width);
      } else {
        setImageSizeHint(previewBase.width, previewBase.height);
      }
      syncPreviewTransformStyle();
      schedulePreviewRender();
      updateCropOverlay();
      return true;
    }
    return false;
  }

  function transformRgbaBuffer(base, turns, flipH) {
    var srcW, srcH, src, t, x, y, sx, sy, dw, dh, dst, si, di;
    if (!base || !base.data) { return base; }
    srcW = base.width;
    srcH = base.height;
    src = base.data;
    t = ((Number(turns) || 0) % 4 + 4) % 4;
    flipH = !!flipH;
    if (t === 0 && !flipH) {
      return { width: srcW, height: srcH, data: new Uint8ClampedArray(src) };
    }
    if (t === 1 || t === 3) { dw = srcH; dh = srcW; }
    else { dw = srcW; dh = srcH; }
    dst = new Uint8ClampedArray(dw * dh * 4);
    for (y = 0; y < srcH; y += 1) {
      for (x = 0; x < srcW; x += 1) {
        sx = flipH ? (srcW - 1 - x) : x;
        sy = y;
        si = (y * srcW + x) * 4;
        if (t === 1) {
          /* CCW 90: (sx,sy) → (sy, srcW-1-sx) */
          di = ((srcW - 1 - sx) * dw + sy) * 4;
        } else if (t === 2) {
          di = ((srcH - 1 - sy) * dw + (srcW - 1 - sx)) * 4;
        } else if (t === 3) {
          /* CCW 270: (sx,sy) → (srcH-1-sy, sx) */
          di = (sx * dw + (srcH - 1 - sy)) * 4;
        } else {
          di = (sy * dw + sx) * 4;
        }
        dst[di] = src[si];
        dst[di + 1] = src[si + 1];
        dst[di + 2] = src[si + 2];
        dst[di + 3] = src[si + 3];
      }
    }
    return { width: dw, height: dh, data: dst };
  }

  /*
   * Bake PlacedItem rotation/flip into previewBase so the panel matches the artboard.
   * Keeps previewIsSource + sourceImageSize so crop L/T/W/H stay file pixels with mapping.
   */
  function bakeArtboardOrientIntoPreview() {
    var turns = nearestQuarterTurns(lastRotationDeg);
    var flipH = matrixHasReflection(lastSelectedItem && lastSelectedItem.matrix);
    if (turns === 0 && !flipH) {
      previewMatchesArtboard = false;
      return false;
    }
    if (previewBase) { previewBase = transformRgbaBuffer(previewBase, turns, flipH); }
    if (previewBaseDrag) { previewBaseDrag = transformRgbaBuffer(previewBaseDrag, turns, flipH); }
    previewMatchesArtboard = true;
    previewOrientSwap = (turns % 2 === 1);
    syncPreviewTransformStyle();
    if (sourceImageSize && sourceImageSize.width > 0 && sourceImageSize.height > 0) {
      if (previewOrientSwap) {
        setImageSizeHint(sourceImageSize.height, sourceImageSize.width);
      } else {
        setImageSizeHint(sourceImageSize.width, sourceImageSize.height);
      }
    } else if (previewBase) {
      setImageSizeHint(previewBase.width, previewBase.height);
    }
    schedulePreviewRender();
    updateCropOverlay();
    return true;
  }

  /*
   * Sync #previewTransform CSS. Priority:
   * 1) Fine-angle field (brief CSS rotate before live Apply-to-AI)
   * 2) Identity when pixels already match artboard (AI / bake)
   * 3) CSS rotate/scaleX fallback so rotate/flip is still visible
   * Crop hit-testing uses unrotated layout; baking remains preferred.
   */
  function syncPreviewTransformStyle() {
    var xf = byId('previewTransform');
    var angle;
    var turns;
    var flipH;
    var parts;
    if (!xf) { return; }
    if (lastSelectedItem && lastSelectedItem.linked) {
      /* Pixels already match artboard (EXIF/AI bake) — do not re-apply place matrix. */
      if (previewMatchesArtboard || previewBakedExif) {
        xf.style.transform = previewCenterTransform();
        return;
      }
      xf.style.transform = previewCenterTransform() + ' matrix('+linkedPreviewMatrix().join(',')+',0,0)';
      return;
    }
    angle = normalizeAngle(byId('rotateAngle') && byId('rotateAngle').value);
    if (Math.abs(angle) > 0.01) {
      xf.style.transform = previewCenterTransform() + ' rotate(' + (-angle) + 'deg)';
      return;
    }
    if (previewMatchesArtboard) {
      xf.style.transform = previewCenterTransform();
      return;
    }
    turns = nearestQuarterTurns(lastRotationDeg);
    flipH = matrixHasReflection(lastSelectedItem && lastSelectedItem.matrix);
    if (!turns && !flipH) {
      xf.style.transform = previewCenterTransform();
      return;
    }
    parts = [previewCenterTransform()];
    if (flipH) { parts.push('scaleX(-1)'); }
    if (turns) { parts.push('rotate(' + (-turns * 90) + 'deg)'); }
    xf.style.transform = parts.join(' ');
  }

  function applyCssOrientFallback() {
    syncPreviewTransformStyle();
    if (!previewMatchesArtboard && previewNeedsArtboardOrient()) {
      setPreviewStatus(t('cssOrientFallback'), 'busy');
    }
  }

  /* Instant visual after live rotate/flip before AI/file refresh completes. */
  function instantOrientPanelPreview(deltaDeg, flipAxis) {
    if(lastSelectedItem && lastSelectedItem.linked)return ;
    var turns = nearestQuarterTurns(deltaDeg);
    var flipH = flipAxis === 'h';
    var flipV = flipAxis === 'v';
    if (!previewBase) { return; }
    if (flipV) {
      previewBase = transformRgbaBuffer(previewBase, 2, true);
      if (previewBaseDrag) { previewBaseDrag = transformRgbaBuffer(previewBaseDrag, 2, true); }
    } else if (flipH || turns) {
      previewBase = transformRgbaBuffer(previewBase, turns, flipH);
      if (previewBaseDrag) { previewBaseDrag = transformRgbaBuffer(previewBaseDrag, turns, flipH); }
    } else {
      return;
    }
    previewMatchesArtboard = true;
    if (turns % 2 === 1) {
      previewOrientSwap = !previewOrientSwap;
      if (lastImageSize) {
        setImageSizeHint(lastImageSize.height, lastImageSize.width);
      } else if (previewBase) {
        setImageSizeHint(previewBase.width, previewBase.height);
      }
    } else if (previewBase) {
      setImageSizeHint(previewBase.width, previewBase.height);
    }
    lastRotationDeg = (Number(lastRotationDeg) || 0) + (Number(deltaDeg) || 0);
    schedulePreviewRender();
    updateCropOverlay();
  }

  function buildPreviewBaseFromImage(img) {
    var natW = img.naturalWidth || img.width;
    var natH = img.naturalHeight || img.height;
    var scaleSettle = Math.min(1, PREVIEW_MAX_EDGE / Math.max(natW, natH));
    var scaleDrag = Math.min(1, PREVIEW_DRAG_MAX_EDGE / Math.max(natW, natH));
    var w = Math.max(1, Math.round(natW * scaleSettle));
    var h = Math.max(1, Math.round(natH * scaleSettle));
    var wd = Math.max(1, Math.round(natW * scaleDrag));
    var hd = Math.max(1, Math.round(natH * scaleDrag));
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    var data;
    c.width = w;
    c.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h);
    previewBase = { width: w, height: h, data: data.data };
    if (wd < w || hd < h) {
      var dragCanvas = document.createElement('canvas');
      dragCanvas.width = wd;
      dragCanvas.height = hd;
      var dragCtx = dragCanvas.getContext('2d');
      dragCtx.drawImage(c, 0, 0, wd, hd);
      data = dragCtx.getImageData(0, 0, wd, hd);
      previewBaseDrag = { width: wd, height: hd, data: data.data };
    } else {
      previewBaseDrag = null;
    }
    schedulePreviewRender();
  }

  function sourceMtimeMs(filePath) {
    var st;
    if (!window.require || !filePath) { return 0; }
    try {
      st = window.require('fs').statSync(filePath);
      if (st.mtimeMs != null) { return Number(st.mtimeMs); }
      if (st.mtime) { return Number(new Date(st.mtime).getTime()); }
    } catch (ignore) {}
    return 0;
  }

  function clonePreviewBase(base) {
    if (!base || !base.data) { return null; }
    return {
      width: base.width,
      height: base.height,
      data: new Uint8ClampedArray(base.data)
    };
  }

  function panelPreviewCacheKey(item) {
    if (!item) { return ''; }
    if (item.sourcePath) { return 'file:' + String(item.sourcePath); }
    return 'sel:' + [
      item.typename || '',
      Number(item.widthPt) || 0,
      Number(item.heightPt) || 0,
      (item.bounds && item.bounds.join(',')) || '',
      item.embedded ? 'e' : 'l'
    ].join('|');
  }

  function panelGeomKey(item) {
    if (!item) { return ''; }
    return [
      Number(item.widthPt) || 0,
      Number(item.heightPt) || 0,
      Number(item.rotationDeg) || 0,
      (item.bounds && item.bounds.join(',')) || ''
    ].join('|');
  }

  function previewBaseByteSize(base) {
    if (!base || !base.data) { return 0; }
    return base.data.length || (base.width * base.height * 4) || 0;
  }

  function touchPanelCacheKey(key) {
    var i = panelPreviewCacheOrder.indexOf(key);
    if (i >= 0) { panelPreviewCacheOrder.splice(i, 1); }
    panelPreviewCacheOrder.push(key);
  }

  function evictPanelPreviewCache() {
    var key;
    var entry;
    while ((panelPreviewCacheOrder.length > PANEL_CACHE_MAX_ENTRIES ||
        panelPreviewCacheBytes > PANEL_CACHE_MAX_BYTES) && panelPreviewCacheOrder.length) {
      key = panelPreviewCacheOrder.shift();
      entry = panelPreviewCacheMap[key];
      if (entry) {
        panelPreviewCacheBytes -= entry.bytes || 0;
        delete panelPreviewCacheMap[key];
      }
    }
    if (panelPreviewCache && !panelPreviewCacheMap[panelPreviewCache.key]) {
      panelPreviewCache = null;
    }
  }

  function getPanelPreviewCache(item) {
    var key;
    var mtime;
    var entry;
    var fs;
    if (!item) { return null; }
    key = panelPreviewCacheKey(item);
    if (!key) { return null; }
    entry = panelPreviewCacheMap[key];
    if (!entry) { return null; }
    if (item.sourcePath) {
      mtime = sourceMtimeMs(item.sourcePath);
      if (!mtime || entry.mtimeMs !== mtime) { return null; }
    }
    /* Geom mismatch after live rotate/flip: never reuse oriented/unoriented cache. */
    if (entry.geomKey && entry.geomKey !== panelGeomKey(item)) {
      return null;
    }
    if (entry.base && entry.base.data) {
      touchPanelCacheKey(key);
      panelPreviewCache = entry;
      return entry;
    }
    if (entry.path && window.require) {
      try {
        fs = window.require('fs');
        if (fs.existsSync(entry.path)) {
          touchPanelCacheKey(key);
          panelPreviewCache = entry;
          return entry;
        }
      } catch (ignore) {}
    }
    return null;
  }

  function rememberPanelPreview(item, method, filePath) {
    var key = panelPreviewCacheKey(item);
    var bytes;
    var prev;
    if (!key || !previewBase) { return; }
    bytes = previewBaseByteSize(previewBase) + previewBaseByteSize(previewBaseDrag);
    prev = panelPreviewCacheMap[key];
    if (prev) { panelPreviewCacheBytes -= prev.bytes || 0; }
    panelPreviewCacheMap[key] = {
      key: key,
      sourcePath: (item && item.sourcePath) ? String(item.sourcePath) : '',
      mtimeMs: (item && item.sourcePath) ? sourceMtimeMs(item.sourcePath) : 0,
      method: method || 'canvas',
      path: String(filePath || (item && item.sourcePath) || ''),
      base: previewBase,
      drag: previewBaseDrag,
      sourceSpace: previewIsSource,
      bytes: bytes,
      geomKey: panelGeomKey(item)
    };
    panelPreviewCacheBytes += bytes;
    touchPanelCacheKey(key);
    panelPreviewCache = panelPreviewCacheMap[key];
    evictPanelPreviewCache();
  }

  /* Drop cached panel RGBA when source geometry changed (live rotate/flip) or path matches. */
  function invalidatePanelPreviewCache(sourcePath) {
    var keys;
    var i;
    var key;
    var entry;
    if (!sourcePath) {
      panelPreviewCacheMap = {};
      panelPreviewCacheOrder = [];
      panelPreviewCacheBytes = 0;
      panelPreviewCache = null;
      return;
    }
    keys = Object.keys(panelPreviewCacheMap);
    for (i = 0; i < keys.length; i += 1) {
      key = keys[i];
      entry = panelPreviewCacheMap[key];
      if (!entry) { continue; }
      if (entry.sourcePath === String(sourcePath) ||
          entry.key === ('file:' + String(sourcePath)) ||
          (lastObjectKey && entry.key === ('obj:' + lastObjectKey))) {
        panelPreviewCacheBytes -= entry.bytes || 0;
        delete panelPreviewCacheMap[key];
        panelPreviewCacheOrder = panelPreviewCacheOrder.filter(function (k) { return k !== key; });
      }
    }
    if (panelPreviewCache && !panelPreviewCacheMap[panelPreviewCache.key]) {
      panelPreviewCache = null;
    }
  }

  function pathToFileUrl(filePath) {
    var p = String(filePath || '').replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(p)) { p = '/' + p; }
    if (p.charAt(0) !== '/') { p = '/' + p; }
    return 'file://' + encodeURI(p).replace(/#/g, '%23');
  }

  function decodedImageCacheKey(filePath) {
    return String(filePath) + '|' + String(sourceMtimeMs(filePath));
  }

  function rememberDecodedImage(key, img, revokeUrl) {
    var old;
    if (!key || !img) { return; }
    if (decodedImageCache[key]) {
      old = decodedImageCache[key];
      if (old.revokeUrl && old.revokeUrl !== revokeUrl && window.URL) {
        try { window.URL.revokeObjectURL(old.revokeUrl); } catch (ignore) {}
      }
    } else {
      decodedImageCacheOrder.push(key);
      while (decodedImageCacheOrder.length > DECODED_IMAGE_CACHE_MAX) {
        old = decodedImageCacheOrder.shift();
        if (old === key) { continue; }
        if (decodedImageCache[old] && decodedImageCache[old].revokeUrl && window.URL) {
          try { window.URL.revokeObjectURL(decodedImageCache[old].revokeUrl); } catch (ignore) {}
        }
        delete decodedImageCache[old];
      }
    }
    decodedImageCache[key] = { img: img, revokeUrl: revokeUrl || '' };
  }

  function getCachedDecodedImage(filePath) {
    var key = decodedImageCacheKey(filePath);
    var rec = decodedImageCache[key];
    if (rec && rec.img && (rec.img.naturalWidth || rec.img.width)) { return rec.img; }
    return null;
  }

  function invalidateDecodedImage(filePath) {
    var key, i;
    if (!filePath) { return; }
    key = decodedImageCacheKey(filePath);
    if (decodedImageCache[key] && decodedImageCache[key].revokeUrl && window.URL) {
      try { window.URL.revokeObjectURL(decodedImageCache[key].revokeUrl); } catch (ignore) {}
    }
    delete decodedImageCache[key];
    for (i = decodedImageCacheOrder.length - 1; i >= 0; i -= 1) {
      if (decodedImageCacheOrder[i] === key) { decodedImageCacheOrder.splice(i, 1); }
    }
  }

  /* Prefer file:// (no Node full-file copy). Fall back to Blob URL; Base64 only last. Cache Image for Apply. */
  function loadImageElementFromPath(filePath) {
    return new Promise(function (resolve, reject) {
      var cached;
      var img;
      var url = '';
      var timer;
      var settled = false;
      var key;
      var triedFileUrl = false;
      if (!filePath) { reject(new Error(t('errNoReadablePath'))); return; }
      cached = getCachedDecodedImage(filePath);
      if (cached) { resolve(cached); return; }
      key = decodedImageCacheKey(filePath);
      img = new Image();
      function fail(err) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        if (url && url.indexOf('blob:') === 0 && window.URL) {
          try { window.URL.revokeObjectURL(url); } catch (ignore) {}
        }
        reject(err || new Error(t('errCanvasDecode', { path: filePath })));
      }
      function succeed() {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        rememberDecodedImage(key, img, url.indexOf('blob:') === 0 ? url : '');
        resolve(img);
      }
      function loadViaBuffer() {
        var fs;
        if (!window.require) { fail(new Error(t('errNoReadablePath'))); return; }
        fs = window.require('fs');
        fs.readFile(filePath, function (error, bytes) {
          if (error) { fail(error); return; }
          try {
            if (window.URL && window.URL.createObjectURL && typeof Blob !== 'undefined') {
              /* Pass Node Buffer directly — avoid Uint8Array copy of the whole file. */
              url = window.URL.createObjectURL(new Blob([bytes], { type: mimeForPath(filePath) || 'image/png' }));
              img.src = url;
            } else {
              img.src = 'data:' + (mimeForPath(filePath) || 'image/png') + ';base64,' + bytes.toString('base64');
            }
          } catch (e) { fail(e); }
        });
      }
      img.onload = succeed;
      img.onerror = function () {
        if (triedFileUrl && url && url.indexOf('file:') === 0) {
          triedFileUrl = false;
          url = '';
          loadViaBuffer();
          return;
        }
        fail(new Error(t('errCanvasDecode', { path: filePath })));
      };
      timer = setTimeout(function () { fail(new Error(t('errDecodeTimeout'))); }, 60000);
      try {
        /* CEP allows file access (--allow-file-access-from-files); skip sync full-file read. */
        url = pathToFileUrl(filePath);
        triedFileUrl = true;
        img.src = url;
      } catch (e) {
        triedFileUrl = false;
        loadViaBuffer();
      }
    });
  }

  function suggestCanvasOutPath(sourcePath) {
    return durableOutputPath(sourcePath, String(settings.format).toUpperCase() === 'JPEG' ? '.jpg' : '.png');
  }

  function suggestCanvasPreviewOutPath(sourcePath) {
    var pathMod = window.require('path');
    var os = window.require('os');
    var base;
    try {
      base = pathMod.basename(sourcePath, pathMod.extname(sourcePath)) || 'paperfig';
    } catch (ignore) {
      base = 'paperfig';
    }
    return pathMod.join(os.tmpdir(), base + '_preview_' + Date.now() + '.png');
  }

  /* Encode canvas → PNG/JPEG/TIFF. Prefer toBlob (no Base64); reuse ImageData for TIFF. */
  function writeCanvasToImageFile(canvas, outPath, dpi, imageData) {
    var fs=window.require('fs'), B=window.require('buffer').Buffer;
    var mime=mimeForPath(outPath)||'image/png';
    return new Promise(function(resolve,reject) {
      function write(bytes) {
        var temp=outPath+'.partial';
        fs.writeFile(temp,bytes,function(error) {
          if(error) { reject(error); return; }
          fs.rename(temp,outPath,function(e) {
            if(e) { fs.unlink(temp,function(){}); reject(e); return; }
            /* Flush so Illustrator relink does not race an incomplete write. */
            try {
              var fd = fs.openSync(outPath, 'r+');
              try { if (typeof fs.fsyncSync === 'function') { fs.fsyncSync(fd); } } finally { fs.closeSync(fd); }
            } catch (ignoreFlush) {}
            resolve(outPath);
          });
        });
      }
      function writeBlob(blob) {
        if(!blob) { reject(new Error(t('errEncodeFailed'))); return; }
        if (typeof blob.arrayBuffer === 'function') {
          blob.arrayBuffer().then(function(ab){ write(B.from(ab)); }).catch(reject);
          return;
        }
        var reader=new FileReader();
        reader.onerror=function(){reject(new Error(t('errReadEncoded')));};
        reader.onload=function(){ write(B.from(reader.result)); };
        reader.readAsArrayBuffer(blob);
      }
      if(/\.tiff?$/i.test(outPath)) {
        try {
          write(W.encodeTiff(imageData || canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height), dpi||300, B));
        } catch(e) { reject(e); }
        return;
      }
      if(canvas.toBlob) {
        canvas.toBlob(writeBlob, mime, 0.92);
      } else {
        try { write(B.from(canvas.toDataURL(mime,0.92).split(',')[1],'base64')); }
        catch(e) { reject(e); }
      }
    });
  }

  function paintBusy() {
    return new Promise(function(resolve) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function(){ window.requestAnimationFrame(resolve); });
      } else { setTimeout(resolve, 0); }
    });
  }

  function hostRelinkTimingBits(replaced, timings) {
    var bits = [];
    var relinkMs = replaced && replaced.relinkMs != null ? Number(replaced.relinkMs) : (timings && timings.relink);
    var redrawMs = replaced && replaced.redrawMs != null ? Number(replaced.redrawMs) : (timings && timings.redraw);
    if (relinkMs != null && !isNaN(relinkMs)) {
      bits.push('relink ' + (relinkMs / 1000).toFixed(2) + 's');
      if (timings) { timings.relink = relinkMs; }
    }
    if (redrawMs != null && !isNaN(redrawMs)) {
      bits.push('redraw ' + (redrawMs / 1000).toFixed(2) + 's');
      if (timings) { timings.redraw = redrawMs; }
    }
    return bits;
  }

  function applyStage(zh, en, pct, timings) {
    var bits = [];
    var k;
    var label;
    var lang = 'zh';
    try {
      if (window.PaperFigI18n && window.PaperFigI18n.getLang) {
        lang = window.PaperFigI18n.getLang();
      }
    } catch (ignore) {}
    label = (lang === 'en') ? en : zh;
    if (timings) {
      for (k in timings) {
        if (Object.prototype.hasOwnProperty.call(timings, k) && timings[k] != null) {
          bits.push(k + '=' + timings[k] + 'ms');
        }
      }
    }
    notice(
      label +
      (pct != null ? ' · ' + pct + '%' : '') +
      (bits.length ? ' · ' + bits.join(' ') : ''),
      'busy'
    );
    return paintBusy();
  }

  function applyFingerprint(source, stamp, opts) {
    var r = W.recipe(opts || {});
    var dm = (opts && opts.displayMatrix) || null;
    return [
      String(source || ''),
      String(stamp || ''),
      String(opts && opts.format || 'PNG'),
      Number(opts && opts.cropLeft) || 0,
      Number(opts && opts.cropTop) || 0,
      Number(opts && opts.cropWidth) || 0,
      Number(opts && opts.cropHeight) || 0,
      Number(opts && opts.previewMaxEdge) || 0,
      opts && opts.cropDisplaySpace ? '1' : '0',
      dm ? dm.join(',') : '',
      JSON.stringify(r)
    ].join('|');
  }

  function invalidateApplyReady() {
    applyReadyCache = null;
    applyReadyWarmToken += 1;
  }

  /* Rasterize adjusted pixels only (no disk write). Used by warm + Apply. */
  function rasterizeWithCanvas(inPath, opts) {
    opts = opts || {};
    return loadWorkflowImage(inPath).then(function (img) {
      var srcW = img.naturalWidth || img.width;
      var srcH = img.naturalHeight || img.height;
      var maxEdge = Number(opts.previewMaxEdge) || 0;
      var outW;
      var outH;
      var canvas;
      var ctx;
      var imgData;
      var longest;
      var rect;
      var sx;
      var sy;
      var sw;
      var sh;
      var m = opts.displayMatrix;
      var sourceForCrop = img;

      /*
       * Photoshop-style rotated crop: apply display matrix about image center, then
       * take the flat overlay rect. Draw DIRECTLY into the crop-sized output —
       * do NOT allocate a full srcW×srcH intermediate (that OOM/hangs CEP on large
       * microscopy images after rotate, so Apply appears to do nothing).
       */
      rect = Core.cropRect(opts, srcW, srcH);
      sx = rect.left; sy = rect.top; sw = rect.width; sh = rect.height;

      outW = sw;
      outH = sh;
      if (maxEdge > 0) {
        longest = Math.max(sw, sh);
        if (longest > maxEdge) {
          outW = Math.max(1, Math.round(sw * (maxEdge / longest)));
          outH = Math.max(1, Math.round(sh * (maxEdge / longest)));
        }
      }

      canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      ctx = canvas.getContext('2d');
      if (opts.identityPixels) { try { ctx.imageSmoothingEnabled = false; } catch (ignoreSm2) {} }

      if (opts.cropDisplaySpace && m && Core.affineIsIdentity && !Core.affineIsIdentity(m) &&
          (Number(opts.cropWidth) > 0 && Number(opts.cropHeight) > 0)) {
        /* Equivalent to full-canvas bake then crop; see tests/regression bakeDirect. */
        if (outW !== sw || outH !== sh) {
          ctx.scale(outW / sw, outH / sh);
        }
        ctx.translate(-sx, -sy);
        ctx.translate(srcW / 2, srcH / 2);
        ctx.transform(Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0, 0, 0);
        ctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
      } else {
        ctx.drawImage(sourceForCrop, sx, sy, sw, sh, 0, 0, outW, outH);
      }
      imgData = ctx.getImageData(0, 0, outW, outH);
      applyPixelOpsToImageData(imgData, opts);
      ctx.putImageData(imgData, 0, 0);
      return { width: outW, height: outH, canvas: canvas, imageData: imgData, method: 'canvas' };
    });
  }

  /*
   * Fast path: panel preview already holds full-res adjusted ImageData
   * (source fits in PREVIEW_MAX_EDGE / no downscale). Encode that — skip re-decode/re-process.
   */
  function tryRasterizeFromLivePreview(source, opts) {
    var srcSize, canvas, ctx, imgData, rect, ops, previewCanvas;
    var fmt = String((opts && opts.format) || 'PNG').toUpperCase();
    if (!previewBase || !previewBase.data || !previewImageData) { return null; }
    if (Number(opts && opts.previewMaxEdge) > 0) { return null; }
    srcSize = getSourcePixelSize() || probeImageSize(source);
    if (!srcSize || !srcSize.width || !srcSize.height) { return null; }
    if (previewBase.width !== srcSize.width || previewBase.height !== srcSize.height) { return null; }
    if (opts && opts.cropDisplaySpace) { return null; /* bake+crop needs full rasterize */ }
    rect = Core.cropRect(opts || {}, srcSize.width, srcSize.height);
    if (rect.left !== 0 || rect.top !== 0 || rect.width !== srcSize.width || rect.height !== srcSize.height) {
      return null; /* crop needs full rasterize */
    }
    previewCanvas = byId('previewCanvas');
    if (!previewCanvas || previewCanvas.width !== srcSize.width || previewCanvas.height !== srcSize.height) {
      return null;
    }
    canvas = document.createElement('canvas');
    canvas.width = srcSize.width;
    canvas.height = srcSize.height;
    ctx = canvas.getContext('2d');
    imgData = ctx.createImageData(srcSize.width, srcSize.height);
    imgData.data.set(previewImageData.data);
    ctx.putImageData(imgData, 0, 0);
    if (fmt === 'JPEG') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    return { width: canvas.width, height: canvas.height, canvas: canvas, imageData: imgData, method: 'preview-reuse' };
  }

  function storeApplyReady(source, stamp, opts, raster) {
    if (!raster || !raster.canvas) { return; }
    applyReadyCache = {
      fingerprint: applyFingerprint(source, stamp, opts),
      source: source,
      stamp: stamp,
      canvas: raster.canvas,
      imageData: raster.imageData,
      width: raster.width,
      height: raster.height,
      method: raster.method || 'canvas'
    };
  }

  function takeApplyReady(source, stamp, opts) {
    var fp = applyFingerprint(source, stamp, opts);
    if (!applyReadyCache || applyReadyCache.fingerprint !== fp) { return null; }
    if (!applyReadyCache.canvas) { return null; }
    return applyReadyCache;
  }

  function writeRasterToFile(raster, outPath, opts) {
    var canvas = raster.canvas;
    var ctx;
    var fmt = String((opts && opts.format) || mimeForPath(outPath) || 'PNG').toUpperCase();
    if (fmt === 'JPEG' || mimeForPath(outPath) === 'image/jpeg') {
      ctx = canvas.getContext('2d');
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    return writeCanvasToImageFile(canvas, outPath, opts && opts.dpi, raster.imageData).then(function() {
      return {
        path: outPath,
        width: raster.width,
        height: raster.height,
        method: raster.method || 'canvas',
        canvas: canvas,
        imageData: raster.imageData
      };
    });
  }

  function processImageWithCanvas(inPath, outPath, opts) {
    opts = opts || {};
    return rasterizeWithCanvas(inPath, opts).then(function(raster) {
      return writeRasterToFile(raster, outPath, opts);
    });
  }

  /* Warm full-res adjusted buffer after slider settle so Apply is mostly encode+relink. */
  function scheduleWarmApplyBuffer() {
    var token;
    var source;
    var opts;
    if (applyRunning || artboardPreviewRunning || liveGeomBusy || panelProxyRunning) { return; }
    if (science && science.active && science.active()) { return; }
    source = lastSourcePath || (lastSelectedItem && lastSelectedItem.sourcePath) || '';
    if (artboardPreviewActive && artboardPreviewOriginalPath) { source = artboardPreviewOriginalPath; }
    if (!source || !isCanvasPipelineSource(source)) { return; }
    try {
      opts = buildAdjustmentOpts(null);
    } catch (e) { return; }
    token = ++applyReadyWarmToken;
    setTimeout(function() {
      var stamp, profile, mp, live;
      if (token !== applyReadyWarmToken || applyRunning) { return; }
      try {
        stamp = sourceStamp(source);
        profile = verifiedProfile(source, opts);
        mp = (profile.width * profile.height) / 1e6;
        if (mp > APPLY_WARM_MAX_MP) { return; }
        live = tryRasterizeFromLivePreview(source, opts);
        if (live) {
          storeApplyReady(source, stamp, opts, live);
          return;
        }
        rasterizeWithCanvas(source, opts).then(function(raster) {
          if (token !== applyReadyWarmToken) { return; }
          storeApplyReady(source, stamp, opts, raster);
        }).catch(function() { /* warm is best-effort */ });
      } catch (ignore) {}
    }, 120);
  }

  function restorePanelPreviewCache(cached, token) {
    if (!cached || token !== previewLoadToken) { return false; }
    if (cached.base && cached.base.data) {
      previewBase = cached.base;
      previewBaseDrag = cached.drag || null;
      previewIsSource = cached.sourceSpace !== false;
      previewMatchesArtboard = cached.method === 'ai' || previewNeedsArtboardOrient();
      if (previewMatchesArtboard && sourceImageSize) {
        previewOrientSwap = nearestQuarterTurns(lastRotationDeg) % 2 === 1;
      }
      reconcilePreviewAspectWithGeom();
      schedulePreviewRender();
      setPreviewStatus(previewMethodLabel(cached.method, true));
      byId('previewMessage').textContent = '';
      syncTransformBoxSize();
      updateCropOverlay();
      return true;
    }
    if (cached.path) {
      loadCanvasFromDecodablePath(cached.path, token, {
        preserveSize: !!lastImageSize,
        statusNote: previewMethodLabel(cached.method, true),
        rememberItem: null,
        rememberMethod: null
      });
      return true;
    }
    return false;
  }

  function suggestPanelProxyOutPath(sourcePath) {
    var pathMod = window.require('path');
    var os = window.require('os');
    var base;
    try {
      base = pathMod.basename(sourcePath, pathMod.extname(sourcePath)) || 'paperfig';
    } catch (ignore) {
      base = 'paperfig';
    }
    return pathMod.join(os.tmpdir(), base + '_panel_proxy_' + Date.now() + '.png');
  }

  function truncateStatusError(msg, maxLen) {
    var s = String(msg || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    maxLen = maxLen || 140;
    if (!s) { return ''; }
    if (s.length <= maxLen) { return s; }
    return s.slice(0, maxLen - 1) + '\u2026';
  }

  /* Fallback Fiji: open → Size max-edge → PNG (no adjustments). */
  function generatePanelProxyMacro(inPath, outPath, maxEdge) {
    var lines = [];
    var edge = Math.max(64, Math.round(Number(maxEdge) || PREVIEW_MAX_EDGE));
    var inEsc = escapeIjString(ijPath(inPath));
    var outEsc = escapeIjString(ijPath(outPath));
    lines.push('// PaperFig for Illustrator panel proxy (complex / undecodable → PNG for canvas)');
    lines.push('setBatchMode(true);');
    lines.push('open("' + inEsc + '");');
    lines.push('iw = getWidth(); ih = getHeight();');
    lines.push('longest = iw > ih ? iw : ih;');
    lines.push('if (longest > ' + edge + ') {');
    lines.push('  nw = round(iw * ' + edge + ' / longest);');
    lines.push('  nh = round(ih * ' + edge + ' / longest);');
    lines.push('  run("Size...", "width=" + nw + " height=" + nh + " constrain average interpolation=Bilinear");');
    lines.push('}');
    lines.push('saveAs("PNG", "' + outEsc + '");');
    lines.push('close();');
    lines.push('print("SCI_BITMAP_PANEL_PROXY_OK");');
    return lines.join('\n') + '\n';
  }

  function showTiffCropOnlyPlaceholder(reason) {
    var canvas = byId('previewCanvas');
    var stage = byId('previewStage');
    var xf = byId('previewTransform');
    previewBase = null;
    if (canvas) {
      canvas.classList.add('hidden');
      canvas.width = 1;
      canvas.height = 1;
    }
    if (xf) { xf.style.transform = 'translate(-50%, -50%) scale(1, 1)'; }
    if (stage) {
      stage.classList.remove('has-canvas');
      stage.classList.remove('has-image');
      stage.classList.remove('crop-drawing');
      stage.style.backgroundImage = '';
      stage.style.filter = '';
    }
    byId('previewMessage').textContent = lastImageSize
      ? ('Crop ' + lastImageSize.width + '\u00d7' + lastImageSize.height + ' px' +
        (reason ? ' \u00b7 ' + reason : ''))
      : ('Canvas preview unavailable' + (reason ? ' \u00b7 ' + reason : ''));
    updateCropOverlay();
  }

  /*
   * Load a PNG/JPEG/GIF/BMP (or decodable) path into the panel canvas.
   * Returns a Promise<boolean> — true if decode succeeded.
   * preserveSize: keep lastImageSize (full TIFF probe) so crop stays in source space.
   */
  function loadCanvasFromDecodablePath(filePath, token, opts) {
    opts=opts || {};
    return (opts.rememberMethod==='ai'?loadImageElementFromPath(filePath):loadWorkflowImage(filePath)).then(function(img) {
      var isAi = opts.rememberMethod === 'ai';
      var natW, natH;
      if(token !== previewLoadToken) { return false; }
      natW = img.naturalWidth || img.width;
      natH = img.naturalHeight || img.height;
      /*
       * Keep crop enabled whenever file px are known. AI capture / baked orient
       * match the artboard; L/T/W/H stay file pixels via display↔file mapping.
       */
      previewIsSource = true;
      if (!sourceImageSize && (!opts.preserveSize || !lastImageSize)) {
        sourceImageSize = { width: natW, height: natH };
      }
      if (!opts.preserveSize || !lastImageSize) {
        setImageSizeHint(natW, natH);
      }
      buildPreviewBaseFromImage(img);
      if (isAi) {
        previewMatchesArtboard = true;
        previewBakedExif = false;
        syncPreviewTransformStyle();
        if (sourceImageSize && lastGeomPt &&
            aspectsNearlyReciprocal(sourceImageSize.width, sourceImageSize.height,
              lastGeomPt.width, lastGeomPt.height)) {
          previewOrientSwap = true;
          setImageSizeHint(sourceImageSize.height, sourceImageSize.width);
        } else {
          previewOrientSwap = nearestQuarterTurns(lastRotationDeg) % 2 === 1;
          if (previewOrientSwap && sourceImageSize) {
            setImageSizeHint(sourceImageSize.height, sourceImageSize.width);
          }
        }
        setPreviewStatus((opts.statusNote || t('statusAiCapture')) +
          t('metaArtboardCropMaps'));
      } else if (opts.orientToArtboard || previewNeedsArtboardOrient()) {
        bakeArtboardOrientIntoPreview();
        if (!previewMatchesArtboard) {
          ensurePreviewMatchesArtboardOrient(img, filePath);
        }
        setPreviewStatus((opts.statusNote || t('statusCanvas')) +
          (previewMatchesArtboard
            ? (previewBakedExif ? t('metaArtboardCropMaps') : t('metaDisplayTransformCrop'))
            : t('statusSourceOrient')));
      } else {
        previewMatchesArtboard = false;
        previewBakedExif = false;
        /* EXIF / geom mismatch: orient only when preview disagrees with artboard. */
        if (ensurePreviewMatchesArtboardOrient(img, filePath)) {
          setPreviewStatus((opts.statusNote || t('statusCanvas')) + t('metaArtboardCropMaps'));
        } else {
          setPreviewStatus((opts.statusNote || t('statusCanvas')) + t('statusSourceOrient'));
        }
      }
      syncTransformBoxSize(); updateCropOverlay();
      if(opts.rememberItem) { rememberPanelPreview(opts.rememberItem,opts.rememberMethod||'canvas',filePath); }
      return true;
    }).catch(function(error) {
      if(token !== previewLoadToken) { return false; }
      clearPreviewCanvas(); setPreviewStatus(localizeMsg(truncateStatusError(error.message)),'error');
      return false;
    });
  }

  function loadPreviewViaImageCapture(item, token) {
    var dpiHint;
    var captureTok;

    if (token !== previewLoadToken) { return Promise.resolve(false); }
    if (!cs) { return Promise.resolve(false); }

    if (panelProxyRunning) {
      /* Must NOT report success — preferAi treats true as done and skips bake fallback. */
      setPreviewStatus(t('statusAiCapture')+'\u2026', 'busy');
      return Promise.resolve({ failed: true, busy: true, error: new Error(t('errPreviewBusy')) });
    }

    panelProxyRunning = true;
    updateArtboardPreviewButtons();
    captureTok = ++panelProxyToken;
    dpiHint = Number(settings.dpi || (byId('dpi') && byId('dpi').value) || 300) || 300;
    showTiffCropOnlyPlaceholder(t('statusAiCapture')+'\u2026');
    setPreviewStatus(t('statusAiCapture')+'\u2026', 'busy');
    byId('previewMessage').textContent = lastImageSize
      ? t('statusAiCropPx', { w: lastImageSize.width, h: lastImageSize.height })
      : t('statusCapturingSelection');

    return ensureHostScript()
      .then(function () {
        return evalHost('capturePanelPreviewForKey(' + quoteExtendScript(objectKeyFromItem(item)) + ', ' + PREVIEW_MAX_EDGE + ', ' + dpiHint + ')');
      })
      .then(function (raw) { return parseHostResult(raw); })
      .then(function (captured) {
        var fs;
        if (captureTok !== panelProxyToken || token !== previewLoadToken) { return true; }
        if (!captured || !captured.path) {
          throw new Error(t('errCaptureNoPath'));
        }
        fs = window.require && window.require('fs');
        if (fs && !fs.existsSync(captured.path)) {
          throw new Error(t('errCaptureNoFile', { path: captured.path }));
        }
        return loadCanvasFromDecodablePath(captured.path, token, {
          preserveSize: !!lastImageSize,
          statusNote: t('statusAiCapture'),
          rememberItem: item,
          rememberMethod: 'ai'
        }).then(function (ok) {
          if (!ok) { throw new Error(t('errCaptureDecode')); }
          return true;
        });
      })
      .catch(function (error) {
        if (captureTok !== panelProxyToken || token !== previewLoadToken) { return false; }
        return { failed: true, error: error };
      })
      .then(function (outcome) {
        if (captureTok === panelProxyToken) { panelProxyRunning = false; updateArtboardPreviewButtons(); }
        return outcome;
      });
  }

  /*
   * Last resort: one-shot Fiji Size → temp PNG. Cached by source path + mtime.
   */
  function loadPreviewViaFijiProxy(item, sourcePath, token) {
    var fijiPath;
    var outPath;
    var macroFile;
    var proxyTok;

    if (token !== previewLoadToken) { return Promise.resolve(false); }

    if (!window.SciBitmapFiji || !window.require) {
      showTiffCropOnlyPlaceholder(t('statusFijiUnavailable'));
      setPreviewStatus(t('statusFijiUnavailable'), 'error');
      return Promise.resolve(false);
    }

    saveSettings();
    fijiPath = settings.fijiPath || (byId('fijiPath') && byId('fijiPath').value) || '';
    fijiPath = String(fijiPath).replace(/^\s+|\s+$/g, '');
    if (!fijiPath) {
      showFijiGate();
      showTiffCropOnlyPlaceholder(t('statusFijiConfigure'));
      setPreviewStatus(t('statusFijiConfigure'), 'error');
      return Promise.resolve(false);
    }

    if (panelProxyRunning) {
      showTiffCropOnlyPlaceholder(t('statusFijiBusy'));
      setPreviewStatus(t('statusFijiBusy'));
      return Promise.resolve(true);
    }

    panelProxyRunning = true;
    updateArtboardPreviewButtons();
    proxyTok = ++panelProxyToken;
    showTiffCropOnlyPlaceholder(t('statusFijiBusy'));
    setPreviewStatus(t('statusFijiBusy'), 'busy');
    byId('previewMessage').textContent = lastImageSize
      ? t('statusFijiCropPx', { w: lastImageSize.width, h: lastImageSize.height })
      : t('statusFijiProxy');

    outPath = suggestPanelProxyOutPath(sourcePath);
    try {
      macroFile = writeTempMacro(generatePanelProxyMacro(sourcePath, outPath, PREVIEW_MAX_EDGE));
    } catch (error) {
      panelProxyRunning = false;
      showTiffCropOnlyPlaceholder(truncateStatusError(error && error.message));
      setPreviewStatus(t('statusFijiFailedDetail', { detail: localizeMsg(truncateStatusError(error && error.message, 100)) }), 'error');
      return Promise.resolve(false);
    }

    return window.SciBitmapFiji.runMacro(fijiPath, macroFile, null, { timeoutMs: 90000, successMarker: 'SCI_BITMAP_PANEL_PROXY_OK' })
      .then(function (fijiResult) {
        var combined;
        var fs;
        if (proxyTok !== panelProxyToken || token !== previewLoadToken) { return null; }
        combined = ((fijiResult && fijiResult.stdout) || '') + '\n' + ((fijiResult && fijiResult.stderr) || '');
        fs = window.require('fs');
        if (combined.indexOf('SCI_BITMAP_PANEL_PROXY_OK') === -1) {
          throw new Error(t('errFijiNoMarker', {
            detail: ((fijiResult && (fijiResult.stderr || fijiResult.stdout)) || '')
          }));
        }
        if (!fs.existsSync(outPath)) {
          throw new Error(t('errFijiNoProxy', { path: outPath }));
        }
        return loadCanvasFromDecodablePath(outPath, token, {
          preserveSize: true,
          statusNote: 'Fiji',
          rememberItem: item,
          rememberMethod: 'fiji'
        }).then(function (ok) {
          if (!ok) { throw new Error(t('errFijiProxyDecode')); }
          return true;
        });
      })
      .catch(function (error) {
        var detail = truncateStatusError(error && error.message);
        if (proxyTok !== panelProxyToken || token !== previewLoadToken) { return false; }
        showTiffCropOnlyPlaceholder(detail || t('statusProxyFailed'));
        setPreviewStatus(detail ? t('statusFijiFailedDetail', { detail: localizeMsg(detail) }) : t('statusFijiFailed'), 'error');
        return false;
      })
      .then(function (outcome) {
        try {
          if (macroFile) { window.require('fs').unlinkSync(macroFile); }
        } catch (ignore) {}
        if (proxyTok === panelProxyToken) { panelProxyRunning = false; updateArtboardPreviewButtons(); }
        return outcome;
      });
  }

  /* After Canvas file fail / skip: AI capture → Fiji. */
  /*
   * options.preferAi: after live rotate/flip, or when file px aspect disagrees with
   *   artboard geometry — AI capture first so orientation matches artboard;
   *   Canvas-capable sources fall back to file decode + display transform (never Fiji).
   * options.skipCache: bypass panel preview cache (required after geom change).
   */
  function loadPanelPreview(item, token, options) {
    var preferAi = !!(options && options.preferAi);
    if(item && item.linked && item.sourcePath)preferAi=false;
    var skipCache = !!(options && options.skipCache);
    var cached;
    var canvasCapable;
    if (science && science.maybeLoad(item)) { return; }
    if (!item) { clearPreviewCanvas(); return; }
    canvasCapable = !!(item.sourcePath && isCanvasPipelineSource(item.sourcePath));
    if (!skipCache) {
      cached = getPanelPreviewCache(item);
      if (cached && restorePanelPreviewCache(cached, token)) { return; }
    }
    if (preferAi) {
      setPreviewStatus(t('statusAiCapture')+'\u2026', 'busy');
      return loadPreviewViaImageCapture(item, token).then(function (outcome) {
        if (token !== previewLoadToken) { return; }
        if (outcome === true) {
          /* AI decode path sets previewMatchesArtboard; verify bake flag stuck. */
          if (previewNeedsArtboardOrient() && !previewMatchesArtboard && previewBase) {
            bakeArtboardOrientIntoPreview();
          }
          return;
        }
        if (item.sourcePath && (canvasCapable || isSimpleLinkedPreviewCandidate(item.sourcePath))) {
          setPreviewStatus(t('statusAiCaptureFallback'), 'busy');
          panelProxyRunning = true; updateArtboardPreviewButtons();
          return loadCanvasFromDecodablePath(item.sourcePath, token, {
            preserveSize: !!lastImageSize,
            statusNote: t('statusCanvas'),
            rememberItem: item,
            rememberMethod: 'canvas',
            orientToArtboard: true
          }).then(function () {
            panelProxyRunning = false; updateArtboardPreviewButtons();
            if (previewNeedsArtboardOrient() && !previewMatchesArtboard) {
              bakeArtboardOrientIntoPreview();
            }
            if (previewNeedsArtboardOrient() && !previewMatchesArtboard) {
              applyCssOrientFallback();
            }
          });
        }
        showTiffCropOnlyPlaceholder(t('statusCaptureFailed'));
        applyCssOrientFallback();
        setPreviewStatus(t('statusCaptureFailed'), 'error');
      });
    }
    if (item.sourcePath) {
      panelProxyRunning = true; updateArtboardPreviewButtons();
      return loadCanvasFromDecodablePath(item.sourcePath, token, {
        preserveSize: false,
        statusNote: 'Original source \u00b7 RGB workflow',
        rememberItem: item,
        rememberMethod: 'canvas',
        orientToArtboard: previewNeedsArtboardOrient()
      }).then(function () {
        panelProxyRunning = false; updateArtboardPreviewButtons();
      }, function () {
        panelProxyRunning = false; updateArtboardPreviewButtons();
      });
    }
    return loadPreviewViaImageCapture(item, token);
  }

  function adoptArtboardPreview(item) {
    var key = item ? objectKeyFromItem(item) : '';
    var rec = key && restoreArtboardPreviewStateForKey(key);
    if (artboardPreviewDebounceTimer) { clearTimeout(artboardPreviewDebounceTimer); artboardPreviewDebounceTimer = null; }
    artboardPreviewActive = !!(rec && rec.previewFile && item.sourcePath === rec.previewFile);
    artboardPreviewObjectKey = artboardPreviewActive ? key : '';
    artboardPreviewOriginalPath = artboardPreviewActive ? rec.originalPath : '';
    artboardPreviewFile = artboardPreviewActive ? rec.previewFile : '';
    updateArtboardPreviewButtons();
  }

  function showPreview(info, options) {
    var item = info.items && info.items[0];
    var previewTask;
    var nextShown=previewSourceIdentity(item),nextShape=previewShapeIdentity(item);
    if(options && options.geometryOnly && item && previewBase && (
        (item.linked && previewIsSource && shownSource && nextShown && JSON.stringify(shownSource)===JSON.stringify(nextShown)) ||
        (!item.linked && shownShape && nextShape && shownShape===nextShape))) {
      lastSelectedItem=item;lastObjectKey=objectKeyFromItem(item);lastBitmapCount=info.count||0;
      lastGeomPt={width:item.widthPt,height:item.heightPt};lastRotationDeg=Number(item.rotationDeg)||0;
      syncPreviewTransformStyle();syncTransformBoxSize();updateCropOverlay();
      byId('metaLine').textContent=item.typename+' · '+item.widthPt.toFixed(1)+' × '+item.heightPt.toFixed(1)+' pt · '+(item.linked?t('metaArtboardCropOrig'):t('metaArtworkCapture'));
      return;
    }
    shownSource=nextShown;shownShape=nextShape;
    if ((item ? objectKeyFromItem(item) : '') !== lastObjectKey) { resetPreviewView(); clearInsetRegionQuiet(); }
    var size = null;
    var token;
    var tiffMeta = null;
    var geomAware;
    var loadOpts;
    var srcPx;
    switchDraft(item);
    lastBitmapCount = info.count || 0;
    lastSelectedItem = item || null;
    if(science)science.onSelection(item);
    lastObjectKey = item ? objectKeyFromItem(item) : '';
    byId('previewMessage').textContent = t('previewBitmapCount', { count: info.count, s: info.count === 1 ? '' : 's' });
    setImageSizeHint(0, 0);
    sourceImageSize = null;
    lastGeomPt = null;
    lastRotationDeg = 0;
    previewOrientSwap = false;
    previewMatchesArtboard = false;
    previewBakedExif = false;
    lastSourcePath = (item && item.sourcePath) ? item.sourcePath : '';
    options = options || {};
    updateExportUiHonesty();
    adoptArtboardPreview(item);
    if (artboardPreviewActive) {
      item = merge({}, item);
      item.sourcePath = artboardPreviewOriginalPath;
      lastSourcePath = item.sourcePath;
    }
    if(item && item.sourcePath) {
      item=merge({},item);
      try { item.sourcePath=sourceFor(lastObjectKey,item.sourcePath); }
      catch(e){notice(e.message,'error');}
    }
    updateExportUiHonesty();
    loadOpts = {
      preferAi: !!options.preferAi,
      skipCache: !!options.skipCache
    };

    /* Always resolve pixel size so crop overlay/drag works (incl. TIFF). */
    if (item && item.sourcePath) {
      if (/\.tif{1,2}$/i.test(item.sourcePath)) {
        tiffMeta = probeTiffMeta(item.sourcePath);
        if (tiffMeta) {
          size = { width: tiffMeta.width, height: tiffMeta.height };
        }
      }
      if (!size) { size = probeImageSize(item.sourcePath); }
    }
    if (!size && item && item.pixelWidth > 0 && item.pixelHeight > 0) {
      size = { width: item.pixelWidth, height: item.pixelHeight };
    }
    if (!size && item) {
      size = estimateSizeFromBounds(item.widthPt, item.heightPt, settings.dpi || byId('dpi').value);
    }
    if (science && science.setSourcePixelSize) { science.setSourcePixelSize(size); }

    /*
     * If file px aspect disagrees with artboard geometry (e.g. landscape TIFF
     * placed as a tall strip), orient display/crop to geometry and prefer AI
     * capture so the preview matches what the user sees — no flat stretch.
     */
    geomAware = applyGeomAwareImageSize(size, item);
    if (geomAware.preferAi) { loadOpts.preferAi = true; }
    if(item&&item.linked)loadOpts.preferAi=false;

    previewLoadToken += 1;
    token = previewLoadToken;
    /* Geom refresh: keep instant-oriented pixels until AI/bake replaces them. */
    if (!options.keepPreviewUntilLoad) {
      clearPreviewCanvas();
    }
    previewIsSource = true;
    srcPx = getSourcePixelSize() || size;

    if (item) {
      if (!(loadOpts.skipCache || loadOpts.preferAi) && getPanelPreviewCache(item)) {
        setPreviewStatus(t('statusPreviewCache'));
      } else if (loadOpts.preferAi) {
        setPreviewStatus(previewOrientSwap ? t('statusAiCaptureMatch') : (t('statusAiCapture')+'\u2026'), 'busy');
      } else if (item.sourcePath && isCanvasPipelineSource(item.sourcePath)) {
        setPreviewStatus(t('statusCanvas')+'\u2026', 'busy');
      } else if (item.sourcePath && isSimpleLinkedPreviewCandidate(item.sourcePath)) {
        setPreviewStatus(t('statusCanvas')+'\u2026', 'busy');
      } else if (srcPx && item.sourcePath && /\.tif{1,2}$/i.test(item.sourcePath)) {
        setPreviewStatus(t('statusTiffCrop', {
          w: srcPx.width, h: srcPx.height,
          est: size && size.estimated ? t('statusEstDpi', { dpi: size.dpi }) : '',
          complex: tiffMeta && isComplexTiffMeta(tiffMeta) ? t('statusComplex') : ''
        }));
      } else if (size && size.estimated) {
        setPreviewStatus(t('statusSizeEstimated', { w: size.width, h: size.height, dpi: size.dpi }));
      } else {
        setPreviewStatus(t('statusAiCapture')+'\u2026', 'busy');
      }
      previewTask=loadPanelPreview(item, token, loadOpts);
    } else {
      clearPreviewCanvas();
      byId('previewMessage').textContent = t('previewNoBitmap');
      setPreviewStatus(t('statusNoBitmap'));
    }

    if (item) {
      byId('metaLine').textContent = item.typename + ' · ' + item.widthPt.toFixed(1) + ' × ' + item.heightPt.toFixed(1) + ' pt' +
        (srcPx ? t('metaPxFile', { w: srcPx.width, h: srcPx.height }) : '') +
        (previewOrientSwap && lastImageSize
          ? t('metaPreviewSize', { w: lastImageSize.width, h: lastImageSize.height })
          : '') +
        (tiffMeta && tiffMeta.bitsPerSample ? t('metaBit', { n: tiffMeta.bitsPerSample }) : '') +
        (item.embedded ? t('metaEmbedded') : '') +
        (item.inGroup ? t('metaInGroup') : '') +
        (item.name ? ' · ' + item.name : '') +
        (loadOpts.preferAi || previewOrientSwap
          ? t('metaArtboardOrientCrop')
          : t('metaSourceOrient')) +
        t('metaHoldOriginal');
    }
    updateCropOverlay();
    return previewTask;
  }

  function multiBitmapNotice(count) {
    if (count > 1) {
      notice(t('usingFirstOf', { count: count }));
    }
  }

  /*
   * quiet: true → no "Selection inspected" spam; only update preview / clear on empty.
   * Used by selection polling. Manual Refresh uses quiet:false.
   */
  function inspectSelection(options) {
    var quiet = options && options.quiet;
    var button = byId('inspectBtn');
    if (!quiet) {
      setBusy(button, true, t('refreshing'));
      notice('');
    }
    return ensureHostScript()
      .then(function () { return evalHost('inspectSelectedBitmaps()', quiet ? { background: true } : null); })
      .then(function (raw) { return parseHostResult(raw); })
      .then(function (result) {
        if(cropDrag){lastFingerprint=null;return result;}
        var previewReady=showPreview(result,{geometryOnly:!!quiet,keepPreviewUntilLoad:!!quiet && !!previewBase && !!lastSelectedItem && !!result.items[0] && objectKeyFromItem(lastSelectedItem)===objectKeyFromItem(result.items[0])});
        if (!quiet) {
          notice(t('selectionRefreshed'));
          multiBitmapNotice(result.count);
        } else if (result.count > 1) {
          multiBitmapNotice(result.count);
        }
        return Promise.resolve(previewReady).then(function(){return result;});
      })
      .catch(function (error) {
        if(!quiet)clearPreviewIdle();
        else lastFingerprint=null;
        if (!quiet) {
          notice(friendlyNoBitmapError(error.message), 'error');
        }
        return null;
      })
      .then(function (result) {
        if (!quiet) { setBusy(button, false); }
        return result;
      });
  }

  /* CEP may return the string "false". A boolean compare never stopped the poll, so Illustrator kept flashing. */
  var panelVisOverride = null;
  function coercePanelVisible(value) {
    if (value === true || value === 1) { return true; }
    if (value === false || value === 0) { return false; }
    var text = String(value == null ? '' : value).replace(/^\s+|\s+$/g, '').toLowerCase();
    if (text === 'true' || text === '1') { return true; }
    if (text === 'false' || text === '0') { return false; }
    if (text.charAt(0) === '{') {
      try {
        var parsed = JSON.parse(text);
        if (parsed && parsed.visible != null) { return coercePanelVisible(parsed.visible); }
      } catch (ignoreJson) {}
    }
    return null;
  }
  function paperfigPanelActive() {
    if (panelVisOverride !== null) { return panelVisOverride; }
    if (!cs || typeof cs.isWindowVisible !== 'function') { return true; }
    try {
      var parsed = coercePanelVisible(cs.isWindowVisible());
      if (parsed !== null) { return parsed; }
    } catch (ignoreVis) {}
    return true;
  }
  function notePanelVisibility(value) {
    var parsed = coercePanelVisible(value);
    if (parsed === null) { return; }
    panelVisOverride = parsed;
  }

  function pollSelection() {
    if (!paperfigPanelActive()) { return; }
    if (cropDrag || applyRunning || artboardPreviewRunning || panelProxyRunning || liveGeomBusy || inspectQuietRunning || hostPumping || hostQueueHasUser() || !cs) { return; }
    inspectQuietRunning = true;
    return ensureHostScript()
      .then(function () { return evalHost('selectionFingerprint()', { background: true }); })
      .then(function (raw) {
        var parsed;
        try { parsed = JSON.parse(raw); } catch (ignore) { return; }
        if (!parsed || !parsed.ok || cropDrag) { return; }
        var empty=parsed.fingerprint==='empty'||parsed.fingerprint==='nodoc'||String(parsed.fingerprint).indexOf('nobitmap')===0;
        if(empty && pendingEmptyFingerprint!==parsed.fingerprint){pendingEmptyFingerprint=parsed.fingerprint;return;}
        if(!empty)pendingEmptyFingerprint='';
        if (parsed.fingerprint === lastFingerprint) { return; }
        lastFingerprint = parsed.fingerprint;
        if (parsed.fingerprint === 'empty' || parsed.fingerprint === 'nodoc' ||
            (parsed.fingerprint && parsed.fingerprint.indexOf('nobitmap') === 0)) {
          clearPreviewIdle();
          return;
        }
        return inspectSelection({ quiet: true });
      })
      .catch(function () { /* ignore transient poll errors */ })
      .then(function () { inspectQuietRunning = false; });
  }

  function startSelectionPolling() {
    if (pollTimer) { return; }
    pollTimer = setInterval(pollSelection, POLL_MS);
    if (!paperfigPanelActive()) { return; }
    inspectQuietRunning = true;
    inspectSelection({ quiet: true }).then(function () {
      inspectQuietRunning = false;
    }, function () {
      inspectQuietRunning = false;
    });
  }

  function resetTabName() {
    var active = document.querySelector('.tab-bar [data-tab].active');
    return active ? active.getAttribute('data-tab') : 'adjust';
  }

  function resetTabAvailable() {
    var tab = resetTabName();
    return tab === 'adjust' || tab === 'crop' || tab === 'inset' || tab === 'raw';
  }

  function resetAdjustments() {
    var tab = resetTabName();
    if (tab === 'inset') {
      abortMarqueeDrags();
      clearInsetRegionQuiet();
      notice(t('insetCleared'));
      return;
    }
    if (tab === 'crop') {
      writeCropRect(0, 0, 0, 0);
      saveSettings();
      notice(t('cropCleared'));
      return;
    }
    if (tab === 'raw') { if (science) { science.reset(); } return; }
    if (tab !== 'adjust') { return; }
    channelsToUi(W.channelsDefault());byId('channelView').value='merged';
    byId('brightness').value = 0;
    byId('contrast').value = 0;
    byId('toneLow').value = 0;
    byId('toneHigh').value = 255;
    byId('cyanRed').value = 0;
    byId('magentaGreen').value = 0;
    byId('yellowBlue').value = 0;
    byId('grayscale').checked = false;
    byId('invert').checked = false;
    byId('softBlur').checked = false;
    byId('sharpen').checked = false;
    byId('lut').value = 'None';
    setPickMode(null);
    updateAdjustmentDisplay();
    saveSettings();
    notice(t('resetDefaults'));
  }

  /*
   * After live AI rotate/flip (0.2.8): drop preview cache and reload panel preview.
   * Prefer AI capture so orientation matches the artboard; Canvas-capable never uses Fiji.
   */
  /*
   * After Apply with settings retained: rebuild previewBase from cached ORIGINAL
   * (recipe still on sliders). Avoids re-decode and avoids double-applying pixels.
   */
  function seedPreviewFromCachedSource(sourcePath, replacedInfo) {
    var img = getCachedDecodedImage(sourcePath);
    var w, h;
    if (!img) { return false; }
    try {
      previewLoadToken += 1;
      previewIsSource = true;
      if (replacedInfo) {
        lastSelectedItem = replacedInfo;
        lastSourcePath = replacedInfo.sourcePath || lastSourcePath;
        lastObjectKey = objectKeyFromItem(replacedInfo) || lastObjectKey;
      }
      w = img.naturalWidth || img.width;
      h = img.naturalHeight || img.height;
      setImageSizeHint(w, h);
      sourceImageSize = { width: w, height: h };
      buildPreviewBaseFromImage(img);
      if (replacedInfo) {
        lastRotationDeg = Number(replacedInfo.rotationDeg) || lastRotationDeg || 0;
        if (!lastSelectedItem) { lastSelectedItem = replacedInfo; }
      }
      if (previewNeedsArtboardOrient()) { bakeArtboardOrientIntoPreview(); }
      byId('previewMessage').textContent = '';
      setPreviewStatus(t('statusAppliedReuse') +
        (previewMatchesArtboard ? t('metaArtboardOrientShort') : ''));
      syncTransformBoxSize();
      updateCropOverlay();
        return true;
    } catch (e) {
      return false;
    }
  }

  /* After Apply that resets adjustments: seed from baked result canvas. */
  function seedPreviewFromProcessed(result, replacedInfo) {
    var canvas = result && result.canvas;
    if (!canvas) { return false; }
    try {
      previewLoadToken += 1;
      previewIsSource = true;
      previewMatchesArtboard = false;
      previewOrientSwap = false;
      if (replacedInfo) {
        lastSelectedItem = replacedInfo;
        lastSourcePath = replacedInfo.sourcePath || lastSourcePath;
        lastObjectKey = objectKeyFromItem(replacedInfo) || lastObjectKey;
        lastRotationDeg = Number(replacedInfo.rotationDeg) || 0;
        lastGeomPt = {
          width: Number(replacedInfo.widthPt) || 0,
          height: Number(replacedInfo.heightPt) || 0
        };
        shownSource = previewSourceIdentity(replacedInfo);
        shownShape = previewShapeIdentity(replacedInfo);
      }
      setImageSizeHint(result.width || canvas.width, result.height || canvas.height);
      sourceImageSize = { width: result.width || canvas.width, height: result.height || canvas.height };
      buildPreviewBaseFromImage(canvas);
      /* New Apply output is already upright/baked — do not re-orient from old matrix. */
      syncPreviewTransformStyle();
      byId('previewMessage').textContent = '';
      setPreviewStatus(t('statusAppliedFromResult'));
      syncTransformBoxSize();
      updateCropOverlay();
      return true;
    } catch (e) {
      return false;
    }
  }

  function refreshPanelPreviewAfterGeom() {
    invalidatePanelPreviewCache(lastSourcePath);
    return ensureHostScript()
      .then(function () { return evalHost('inspectSelectedBitmaps()'); })
      .then(function (raw) {
        var info = parseHostResult(raw);
        var item = info && info.items && info.items[0];
        /* Stamp fingerprint now so pollSelection does not re-inspect mid-reload. */
        if (item) {
          lastFingerprint = [
            String(info.count || 1),
            item.objectKey || '',
            (item.matrix || []).join(','),
            item.typename || '',
            item.inGroup ? 'g' : 't',
            (item.bounds || []).join(','),
            item.sourcePath || '',
            item.embedded ? 'e' : 'l'
          ].join('|');
        }
        return Promise.resolve(showPreview(info, { preferAi: true, skipCache: true, keepPreviewUntilLoad: true })).then(function(){return info;});
      })
      .catch(function () {
        setPreviewStatus(t('statusPreviewRefreshFail'), 'error');
        applyCssOrientFallback();
        return null;
      });
  }

  function liveRotateBy(deltaDegrees, fromField) {
    var angle = normalizeAngle(deltaDegrees);
    if (Math.abs(angle) < 0.0001) {
      if (fromField) {
        byId('rotateAngle').value = 0;
        saveSettings();
        schedulePreviewRender();
      }
      return Promise.resolve(null);
    }
    if (applyRunning || artboardPreviewRunning || liveGeomBusy) {
      notice(t('busyRotate'), 'error');
      return Promise.resolve(null);
    }
    liveGeomBusy = true;
    updateArtboardPreviewButtons();
    notice(t('rotatingAi', { angle: angle }), 'busy');
    return ensureHostScript()
      .then(function () {
        return evalHost('rotateSelectedBitmap(' + angle + ')');
      })
      .then(function (raw) { return parseHostResult(raw); })
      .then(function (result) {
        byId('rotateAngle').value = 0;
        settings.rotate = 0;
        saveSettings();
        instantOrientPanelPreview(angle, null);
        notice(t('rotatedAi', { angle: (result.rotated || angle) }));
        return refreshPanelPreviewAfterGeom().then(function () { return result; });
      })
      .catch(function (error) {
        notice(friendlyNoBitmapError(error.message || String(error)), 'error');
        return null;
      })
      .then(function (result) {
        liveGeomBusy = false;
        updateArtboardPreviewButtons();
        return result;
      });
  }

  function bumpRotate(delta) {
    liveRotateBy(delta, false);
  }

  function applyFineAngleLive() {
    var angle = normalizeAngle(byId('rotateAngle').value);
    liveRotateBy(angle, true);
  }

  /* Immediate Illustrator flip; resets toggle so Apply does not flip again. */
  function liveFlip(axis) {
    var flipH = axis === 'h';
    var flipV = axis === 'v';
    if (applyRunning || artboardPreviewRunning || liveGeomBusy) {
      notice(t('busyFlip'), 'error');
      return;
    }
    liveGeomBusy = true;
    updateArtboardPreviewButtons();
    notice(t('flippingAi'), 'busy');
    ensureHostScript()
      .then(function () {
        return evalHost('flipSelectedBitmap(' + (flipH ? 1 : 0) + ', ' + (flipV ? 1 : 0) + ')');
      })
      .then(function (raw) { return parseHostResult(raw); })
      .then(function () {
        if (flipH) { settings.flipH = false; }
        if (flipV) { settings.flipV = false; }
        syncFlipButtons();
        saveSettings();
        instantOrientPanelPreview(0, flipH ? 'h' : 'v');
        notice(t('flippedAi', { axis: flipH ? 'H' : 'V' }));
        return refreshPanelPreviewAfterGeom();
      })
      .catch(function (error) {
        notice(friendlyNoBitmapError(error.message || String(error)), 'error');
      })
      .then(function () { liveGeomBusy = false; updateArtboardPreviewButtons(); });
  }

  /* ---- Target lock (no cross-image writes) ---- */

  function objectKeyFromItem(item) {
    if (!item) { return ''; }
    if (item.objectKey) { return String(item.objectKey); }
    return panelPreviewCacheKey(item);
  }

  function captureOperationLock() {
    var expectedKey = lastObjectKey;
    operationStartedAt = Date.now();
    return ensureHostScript().then(function () { return evalHost('captureSelectionLock()'); })
      .then(function (raw) {
        var parsed=parseHostResult(raw);
        if (!parsed.lock || !parsed.info) { throw new Error(t('errIdentifyImage')); }
        if (expectedKey && expectedKey !== parsed.lock.objectKey) {
          lastFingerprint = null;
          throw new Error(t('errSelectionChangedPreview'));
        }
        operationLock=parsed.lock; lastObjectKey=parsed.lock.objectKey;
        lastSelectedItem=parsed.info; lastSourcePath=parsed.info.sourcePath || '';
        lastBitmapCount=parsed.count || 1;
        adoptArtboardPreview(parsed.info);
        return operationLock;
      });
  }


  /*
   * After host replace: confirm output exists and PlacedItem links it.
   * Prevents false "Applied" when TEMP was rejected or wrong item stayed selected.
   * Never deletes the linked file — display depends on it remaining on disk.
   */
  function pathsEqualNorm(a, b) {
    function norm(p) {
      p = String(p || '').replace(/\\/g, '/');
      if (p.length >= 2 && p.charAt(1) === ':') { p = p.charAt(0).toLowerCase() + p.slice(1); }
      return p;
    }
    return norm(a) === norm(b);
  }

  function assertAppliedLink(replaced, expectedPath) {
    var fs = window.require('fs');
    if (!expectedPath) { throw new Error(t('errApplyMissingOut')); }
    if (!fs.existsSync(expectedPath)) {
      throw new Error(t('errApplyOutMissing', { path: expectedPath }));
    }
    try {
      if (!fs.statSync(expectedPath).size) {
        throw new Error(t('errApplyOutEmpty', { path: expectedPath }));
      }
    } catch (stErr) {
      if (/empty|missing|display/.test(String(stErr.message || ''))) { throw stErr; }
      throw new Error(t('errApplyOutStat', { path: expectedPath, msg: stErr.message }));
    }
    var linked = replaced && replaced.info && replaced.info.sourcePath;
    var hostPath = replaced && (replaced.linkedPath || replaced.path);
    var okLink = linked && pathsEqualNorm(linked, expectedPath);
    var okHost = hostPath && pathsEqualNorm(hostPath, expectedPath);
    if (!okLink && !okHost) {
      throw new Error(t('errLinkNotUpdated', {
        expected: expectedPath,
        host: (linked || hostPath || 'none')
      }));
    }
    if (replaced && replaced.info && replaced.info.embedded) {
      throw new Error(t('errReplaceEmbedded'));
    }
    return replaced;
  }

  /* When Apply crops pixels, host must reset PlacedItem to upright crop aspect. */
  function geomOptsForCropReplace(opts, processed) {
    var cw = Math.max(0, Math.round(Number(opts && opts.cropWidth) || 0));
    var ch = Math.max(0, Math.round(Number(opts && opts.cropHeight) || 0));
    var pw;
    var ph;
    if (!(cw > 0 && ch > 0)) { return null; }
    pw = processed && processed.width > 0 ? Math.round(processed.width) : cw;
    ph = processed && processed.height > 0 ? Math.round(processed.height) : ch;
    return { resetUpright: true, pixelWidth: pw, pixelHeight: ph };
  }

  function lockedReplace(path, angle, flipH, flipV, geom) {
    var geomArg;
    if (!operationLock) { return Promise.reject(new Error(t('errMissingLock'))); }
    geomArg = geom ? quoteExtendScript(JSON.stringify(geom)) : 'null';
    return evalHost('replaceLockedWithFile(' + quoteExtendScript(JSON.stringify(operationLock)) + ', ' +
      quoteExtendScript(path) + ', ' + (Number(angle)||0) + ', ' + (flipH?1:0) + ', ' + (flipV?1:0) + ', ' +
      geomArg + ')');
  }

  function lockedExport(format, dpi) {
    return evalHost('exportLockedBitmapTemp(' + quoteExtendScript(JSON.stringify(operationLock)) + ', ' +
      quoteExtendScript(format) + ', ' + dpi + ')').then(parseHostResult);
  }

  function rememberReplacementIdentity(replaced) {
    if (!replaced || !replaced.info) { return; }
    var oldKey = lastObjectKey;
    var newKey = objectKeyFromItem(replaced.info);
    /* Place-replace yields a new PlacedItem uuid → new objectKey; keep per-image calibration. */
    if (oldKey && newKey && oldKey !== newKey) {
      try {
        if (science && science.migrateCalibration) {
          science.migrateCalibration(oldKey, newKey);
        } else {
          var calMap = loadObjectMap('sci_calibrations_v1');
          if (calMap[oldKey] && !calMap[newKey]) {
            calMap[newKey] = calMap[oldKey];
            calMap[newKey].objectKey = newKey;
            storeObjectMap('sci_calibrations_v1', calMap);
          }
        }
      } catch (ignoreCal) {}
    }
    lastObjectKey = newKey;
    lastSelectedItem = replaced.info;
    lastSourcePath = replaced.info.sourcePath;
  }

  function currentPipelineIsCanvas() {
    var path = lastSourcePath || (lastSelectedItem && lastSelectedItem.sourcePath) || '';
    if (artboardPreviewActive && artboardPreviewOriginalPath) {
      path = artboardPreviewOriginalPath;
    }
    return !!(path && isCanvasPipelineSource(path));
  }

  function updateExportUiHonesty() {
    byId('lut').disabled=true;byId('lut').value='None';
    byId('dpi').disabled=applyRunning||artboardPreviewRunning||panelProxyRunning||byId('format').value!=='TIFF';
    Array.prototype.forEach.call(byId('format').options||[],function(o){o.disabled=false;});
    byId('exportCapability').textContent=t('exportCap');
  }

  /*
   * After successful Apply: new file is baseline. Reset all adjustments and crop;
   * reload preview of the new file without re-applying old params.
   */
  function resetAdjustmentsAfterApply(quiet) {
    channelsToUi(W.channelsDefault());byId('channelView').value='merged';
    byId('brightness').value = 0;
    byId('contrast').value = 0;
    byId('toneLow').value = 0;
    byId('toneHigh').value = 255;
    byId('cyanRed').value = 0;
    byId('magentaGreen').value = 0;
    byId('yellowBlue').value = 0;
    byId('grayscale').checked = false;
    byId('invert').checked = false;
    byId('softBlur').checked = false;
    byId('sharpen').checked = false;
    byId('lut').value = 'None';
    setPickMode(null);
    byId('cropLeft').value = 0;
    byId('cropTop').value = 0;
    byId('cropWidth').value = 0;
    byId('cropHeight').value = 0;
    settings.brightness = 0;
    settings.contrast = 0;
    settings.toneLow = 0;
    settings.toneHigh = 255;
    settings.cyanRed = 0;
    settings.magentaGreen = 0;
    settings.yellowBlue = 0;
    settings.grayscale = false;
    settings.invert = false;
    settings.softBlur = false;
    settings.sharpen = false;
    settings.lut = 'None';
    settings.rotate = 0;
    settings.cropLeft = 0;
    settings.cropTop = 0;
    settings.cropWidth = 0;
    settings.cropHeight = 0;
    updateAdjustmentDisplay();
    /* Post-Apply baseline: exclusive crop mode, no stacked inset marquee. */
    setMarqueeMode('crop', { quiet: true, force: true });
    clearInsetRegionQuiet();
    updateCropOverlay();
    saveSettings();
    /* Keep sci_calibrations_v1 — crop reset after Apply is Use-full on new baseline, not a cal clear. */
    if (science && science.onCropChanged) { science.onCropChanged(); }
    if (!quiet) { /* status owned by Apply caller */ }
  }



  function syncArtboardPreviewDetails() {
    var details = byId('artboardPreviewDetails');
    var status = byId('artboardPreviewSummaryStatus');
    if (status) {
      status.textContent = artboardPreviewActive ? t('artboardPreviewActiveShort') : '';
    }
    if (!details) { return; }
    if (artboardPreviewActive || artboardPreviewRunning) {
      details.open = true;
    }
  }

  function updateArtboardPreviewButtons() {
    var busy = applyRunning || artboardPreviewRunning || liveGeomBusy || panelProxyRunning;
    ['applyBtn','insetUpdateBtn','inspectBtn','resetBtn','rotateCcw','rotateCw','rotate180','flipHBtn','flipVBtn','straightenLineBtn',
      'savePresetBtn','loadPresetBtn','updatePresetBtn','deletePresetBtn','repeatLastBtn','importPresetBtn','exportPresetBtn','magentaGreenBtn','identityColorsBtn','prepareBatchBtn','pickBlackBtn','pickWhiteBtn','autoLevelsBtn','autoChannelLevelsBtn'].forEach(function(id) {
      if (byId(id)) { byId(id).disabled = busy; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.group input, .group select'), function(el) { el.disabled=busy; });
    byId('resetBtn').disabled = busy || !resetTabAvailable();
    if (!busy) { updateAdjustmentDisplay(); }

    syncBatchButtons();
    if(science)science.updateBusy();
    var previewBtn = byId('artboardPreviewBtn');
    var cancelBtn = byId('cancelPreviewBtn');
    if (previewBtn) {
      previewBtn.disabled = busy || (science&&science.active()) || !lastSelectedItem || !lastSelectedItem.linked;
      previewBtn.dataset.label = t('artboardPreview');
      previewBtn.textContent = artboardPreviewRunning
        ? t('previewing')
        : t('artboardPreview');
      previewBtn.classList.toggle('in-preview', !!artboardPreviewActive);
    syncArtboardPreviewDetails();
    }
    if (cancelBtn) {
      cancelBtn.disabled = busy || !artboardPreviewActive;
    }
  }

  function clearArtboardPreviewState(opts) {
    var key = artboardPreviewObjectKey;
    artboardPreviewActive = false;
    artboardPreviewOriginalPath = '';
    artboardPreviewFile = '';
    artboardPreviewObjectKey = '';
    artboardPreviewToken += 1;
    if (artboardPreviewDebounceTimer) {
      clearTimeout(artboardPreviewDebounceTimer);
      artboardPreviewDebounceTimer = null;
    }
    updateArtboardPreviewButtons();
    if (key) {
      /* Persist cleared state for this object. */
      var map = loadObjectMap(PREVIEW_STATE_KEY);
      delete map[key];
      storeObjectMap(PREVIEW_STATE_KEY, map);
    }
  }

  function scheduleArtboardPreviewRefresh() {
    if (!artboardPreviewActive) { return; }
    if (applyRunning || artboardPreviewRunning || liveGeomBusy || panelProxyRunning) { return; }
    if (artboardPreviewDebounceTimer) { clearTimeout(artboardPreviewDebounceTimer); }
    artboardPreviewDebounceTimer = setTimeout(function () {
      artboardPreviewDebounceTimer = null;
      runArtboardPreview({ auto: true });
    }, ARTBOARD_PREVIEW_DEBOUNCE_MS);
  }

  function onAdjustmentSettle() {
    updateAdjustmentDisplay();
    saveSettings();
    invalidateApplyReady();
    scheduleWarmApplyBuffer();
    scheduleArtboardPreviewRefresh();
  }

  /*
   * Cancel artboard preview: relink back to remembered original source.
   * Geometry (live rotate/flip already applied) is kept.
   */
  function cancelArtboardPreview(options) {
    if (applyRunning || artboardPreviewRunning || liveGeomBusy || panelProxyRunning) { return Promise.resolve(false); }
    var quiet=options && options.quiet;
    var key=artboardPreviewObjectKey, original=artboardPreviewOriginalPath;
    if (!artboardPreviewActive || !key || !original) { return Promise.resolve(false); }
    setApplyRunning(true);
    return captureOperationLock().then(function (lock) {
      if (lock.objectKey !== key || !artboardPreviewActive || artboardPreviewOriginalPath !== original) {
        throw new Error(t('errCancelWrongImage'));
      }
      return lockedReplace(original,0,false,false);
    }).then(parseHostResult).then(function (result) {
      clearArtboardPreviewState({keepFile:true}); rememberReplacementIdentity(result);
      lastFingerprint=null;
      if (!quiet) { notice(t('linkRestored')); }
      return refreshPanelPreviewAfterGeom().then(function () { return true; });
    }).catch(function (error) {
      // Persisted per-object recovery record and files remain intact on every failure.
      if (!quiet) { notice(t('cancelFailed', { msg: error.message }),'error'); }
      return false;
    }).then(function (ok) { setApplyRunning(false); return ok; });
  }

  function runArtboardPreview(options) { return workflowApply(true); }

  /* Build adjustment opts shared by Canvas Apply / Fiji Apply / artboard preview. */
  function buildAdjustmentOpts(extra) {
    var m;
    saveSettings();var opts=currentRecipe();
    ['cropLeft','cropTop','cropWidth','cropHeight','format','dpi'].forEach(function(k){opts[k]=settings[k];});
    opts.rotate=normalizeAngle(byId('rotateAngle').value)||0;opts.flipH=false;opts.flipV=false;
    /* Linked rotated preview: crop fields are flat overlay coords — bake matrix on Apply. */
    if (cropNeedsDisplayBake() && opts.cropWidth > 0 && opts.cropHeight > 0) {
      m = linkedPreviewMatrix();
      opts.displayMatrix = [m[0], m[1], m[2], m[3]];
      opts.cropDisplaySpace = true;
    }
    if(extra)merge(opts,extra);
    if(!isFinite(opts.dpi)||opts.dpi<36||opts.dpi>2400)throw new Error(t('errDpiRange'));
    return cropOptsForApply(opts);
  }

  /*
   * Canvas Apply (0.2.8): JPG/PNG/GIF/BMP — same pixel pipeline as panel preview, write file, relink.
   * No Fiji. LUT skipped (Fiji-only). Live rotate/flip already on the item (UI zeros).
   */
  function applyPipelineCanvas(exportedPath, opts) {
    var outPath;
    var lutNote = '';
    var timings = {};
    var tMark = Date.now();
    var stamp;
    var ready;
    var live;

    outPath = suggestCanvasOutPath(exportedPath);
    if (opts.lut && opts.lut !== 'None') {
      lutNote = ' · LUT skipped (Canvas Apply)';
    }
    try { stamp = sourceStamp(exportedPath); } catch (e) { stamp = ''; }

    return applyStage('加载', 'Load', 10, timings).then(function() {
      ready = takeApplyReady(exportedPath, stamp, opts);
      if (ready) {
        timings.reuse = Date.now() - tMark;
        return { raster: ready, reused: true };
      }
      live = tryRasterizeFromLivePreview(exportedPath, opts);
      if (live) {
        timings.preview = Date.now() - tMark;
        storeApplyReady(exportedPath, stamp, opts, live);
        return { raster: live, reused: true };
      }
      tMark = Date.now();
      return applyStage('处理', 'Process', 40, timings).then(function() {
        return rasterizeWithCanvas(exportedPath, opts).then(function(raster) {
          timings.process = Date.now() - tMark;
          storeApplyReady(exportedPath, stamp, opts, raster);
          return { raster: raster, reused: false };
        });
      });
    }).then(function(pack) {
      tMark = Date.now();
      return applyStage('写出', 'Encode ' + String(opts.format || 'PNG').toUpperCase(), 70, timings).then(function() {
        return writeRasterToFile(pack.raster, outPath, opts).then(function(processed) {
          timings.encode = Date.now() - tMark;
          processed.method = pack.reused ? (pack.raster.method || 'reuse') : processed.method;
          return processed;
        });
      });
    }).then(function(processed) {
      tMark = Date.now();
      return applyStage('写回画板', 'Relink artboard', 90, timings).then(function() {
        return lockedReplace(outPath, opts.rotate, opts.flipH, opts.flipV, geomOptsForCropReplace(opts, processed)).then(function(raw) {
          timings.relink = Date.now() - tMark;
          return { raw: raw, processed: processed };
        });
      });
    }).then(function(pack) {
      var replaced = assertAppliedLink(parseHostResult(pack.raw), outPath);
      var secs = ((Date.now() - operationStartedAt) / 1000).toFixed(1);
      var stageBits = [];
      var k;
      rememberReplacementIdentity(replaced);
      clearArtboardPreviewState({ keepFile: true });
      invalidatePanelPreviewCache(exportedPath);
      invalidateDecodedImage(outPath);
      invalidateApplyReady();
      resetAdjustmentsAfterApply(true);
      rerootAppliedBaseline(lastObjectKey, outPath);
      hostRelinkTimingBits(replaced, timings).forEach(function(b){ stageBits.push(b); });
      for (k in timings) {
        if (Object.prototype.hasOwnProperty.call(timings, k)) { stageBits.push(k + '=' + timings[k] + 'ms'); }
      }
      appliedStatus(t('appliedCanvas', { detail: (replaced.mode || 'replaced') + lutNote + ' · ' + secs + 's · ' + stageBits.join(' ') + ' · Undo (Ctrl/Cmd+Z) · ' + outPath }));
      lastFingerprint = null;
      lastSourcePath = outPath;
      if (!seedPreviewFromProcessed(pack.processed, replaced.info)) {
        return refreshPanelPreviewAfterGeom();
      }
      return replaced;
    }).catch(function(error) {
      if (outPath && window.require('fs').existsSync(outPath)) { error.message += ' · Processed file retained: '+outPath; }
      throw error;
    });
  }

  function applyPipeline() { var tab = resetTabName(); if (tab === 'scale' && science && science.scaleBar) { return science.scaleBar(); } if (tab === 'label' && science && science.figureLabel) { return science.figureLabel(); } if (marqueeMode === 'inset') { return applyInset(); } if(science && science.active())return science.apply();return workflowApply(false); }

  function detectFiji() {
    var found;
    try {
      found = window.SciBitmapFiji.detectCandidates();
      if (!found.length) {
        setFijiStatus('error', t('fijiNotFound'));
        return;
      }
      syncFijiPathFields(found[0]);
      saveSettings();
      setFijiStatus('ok', t('fijiDetected', { path: found[0] }));
    } catch (error) { setFijiStatus('error', error.message); }
  }

  function testFiji() {
    var button = byId('testBtn');
    var gateTest = byId('fijiGateTest');
    var input = byId('fijiPath').value;
    var macro = extensionPath + '/macros/ping.ijm';
    setBusy(button, true, t('testing'));
    if (gateTest) { setBusy(gateTest, true, t('testing')); }
    setFijiStatus('neutral', t('fijiLaunching'));
    window.SciBitmapFiji.testConnection(input, macro)
      .then(function (result) {
        syncFijiPathFields(result.executable);
        saveSettings();
        setFijiStatus('ok', t('fijiConnected') + ' ' + result.executable);
        if (result.executable) { hideFijiGate(); }
      })
      .catch(function (error) { setFijiStatus('error', error.message); })
      .then(function () {
        setBusy(button, false);
        if (gateTest) { setBusy(gateTest, false); }
      });
  }

  function saveAdjustmentPreset() { saveNamedPreset(false); }

  function loadAdjustmentPreset() { loadNamedPreset(); }

  function savedAdjustKind() {
    try {
      return localStorage.getItem('paperfig_adjust_kind') === 'photo' ? 'photo' : 'fluor';
    } catch (ignore) { return 'fluor'; }
  }

  function setAdjustKind(kind) {
    var fluor = kind !== 'photo';
    var photo = byId('adjustPhoto');
    var fluorPane = byId('adjustFluor');
    var fluorBtn = byId('adjustKindFluor');
    var photoBtn = byId('adjustKindPhoto');
    if (photo) { photo.hidden = fluor; }
    if (fluorPane) { fluorPane.hidden = !fluor; }
    if (fluorBtn) {
      fluorBtn.setAttribute('aria-pressed', fluor ? 'true' : 'false');
      fluorBtn.classList.toggle('active', fluor);
    }
    if (photoBtn) {
      photoBtn.setAttribute('aria-pressed', fluor ? 'false' : 'true');
      photoBtn.classList.toggle('active', !fluor);
    }
    try { localStorage.setItem('paperfig_adjust_kind', fluor ? 'fluor' : 'photo'); } catch (ignore) {}
  }

  function bindFluorTone(which) {
    var slider = byId(which === 'low' ? 'fluorToneLow' : 'fluorToneHigh');
    var num = byId(which === 'low' ? 'fluorToneLowValue' : 'fluorToneHighValue');
    var target = byId(which === 'low' ? 'toneLow' : 'toneHigh');
    if (!slider || !num || !target) { return; }
    function copy(fromSlider) {
      var value = Number(fromSlider ? slider.value : num.value);
      if (!isFinite(value)) { return; }
      target.value = String(Math.max(0, Math.min(255, Math.round(value))));
    }
    slider.addEventListener('mousedown', function () { sliderDragging = true; });
    slider.addEventListener('input', function () {
      sliderDragging = true;
      copy(true);
      updateAdjustmentDisplay();
      scheduleSaveSettings();
    });
    slider.addEventListener('change', function () {
      sliderDragging = false;
      copy(true);
      onAdjustmentSettle();
    });
    slider.addEventListener('mouseup', function () {
      sliderDragging = false;
      schedulePreviewRender();
      scheduleSaveSettings();
      if (artboardPreviewActive) { onAdjustmentSettle(); }
    });
    num.addEventListener('change', function () {
      copy(false);
      sliderDragging = false;
      onAdjustmentSettle();
    });
  }

  function bind() {
    document.addEventListener('pointerdown', function (event) {
      var node = event.target;
      var btn;
      while (node && node !== document) {
        if (node.tagName === 'BUTTON') { btn = node; break; }
        node = node.parentNode;
      }
      if (!btn || btn.disabled) { return; }
      btn.classList.add('pf-hit');
      setTimeout(function () { btn.classList.remove('pf-hit'); }, 140);
    }, true);
    bindInsetControls();
    var adjustmentIds = [
      'brightness', 'contrast', 'toneLow', 'toneHigh',
      'cyanRed', 'magentaGreen', 'yellowBlue',
      'grayscale', 'invert', 'softBlur', 'sharpen', 'lut'
    ];
    var cropIds = ['cropLeft', 'cropTop', 'cropWidth', 'cropHeight'];
    var settingIds = ['format', 'dpi', 'fijiPath', 'rotateAngle'];
    var i;
    setAdjustKind(savedAdjustKind());
    if (byId('adjustKindFluor')) {
      byId('adjustKindFluor').addEventListener('click', function () { setAdjustKind('fluor'); });
    }
    if (byId('adjustKindPhoto')) {
      byId('adjustKindPhoto').addEventListener('click', function () { setAdjustKind('photo'); });
    }
    bindFluorTone('low');
    bindFluorTone('high');
    for (i = 0; i < adjustmentIds.length; i += 1) {
      (function (id) {
        var el = byId(id);
        el.addEventListener('mousedown', function () { sliderDragging = true; });
        el.addEventListener('input', function () {
          sliderDragging = true;
          updateAdjustmentDisplay();
          scheduleSaveSettings();
        });
        /* change / mouseup = settle → full-res preview + optional artboard refresh. */
        el.addEventListener('change', function () {
          sliderDragging = false;
          onAdjustmentSettle();
        });
        el.addEventListener('mouseup', function () {
          sliderDragging = false;
          schedulePreviewRender();
          scheduleSaveSettings();
          if (artboardPreviewActive) { onAdjustmentSettle(); }
        });
      }(adjustmentIds[i]));
    }
    window.addEventListener('mouseup', function () {
      if (sliderDragging) {
        sliderDragging = false;
        schedulePreviewRender();
      }
    });
    for (i = 0; i < cropIds.length; i += 1) {
      (function (id) {
        byId(id).addEventListener('input', function () { onCropNumericInput(id); });
      }(cropIds[i]));
    }
    if (byId('cropAspectMode')) {
      byId('cropAspectMode').addEventListener('change', function () {
        applyAspectModeToCurrentCrop();
        saveSettings();
      });
    }
    ['cropAspectW', 'cropAspectH'].forEach(function (id) {
      if (!byId(id)) { return; }
      byId(id).addEventListener('change', function () {
        if (getCropAspectMode() === 'custom') { applyAspectModeToCurrentCrop(); }
        saveSettings();
      });
    });
    ['cropFixedW', 'cropFixedH'].forEach(function (id) {
      if (!byId(id)) { return; }
      byId(id).addEventListener('change', function () {
        var m = getCropAspectMode();
        if (m === 'fixed' || m === 'source-px') { applyAspectModeToCurrentCrop(); }
        saveSettings();
      });
    });
    for (i = 0; i < settingIds.length; i += 1) {
      byId(settingIds[i]).addEventListener('change', function () {
        saveSettings();
        updateExportUiHonesty();
      });
    }
    byId('rotateAngle').addEventListener('input', function () { saveSettings(); schedulePreviewRender(); });
    byId('rotateAngle').addEventListener('change', function () { applyFineAngleLive(); });
    byId('rotateCcw').addEventListener('click', function () { bumpRotate(90); });
    byId('rotateCw').addEventListener('click', function () { bumpRotate(-90); });
    byId('rotate180').addEventListener('click', function () { bumpRotate(180); });
    byId('flipHBtn').addEventListener('click', function () { liveFlip('h'); });
    byId('flipVBtn').addEventListener('click', function () { liveFlip('v'); });
    if (byId('straightenLineBtn')) {
      byId('straightenLineBtn').addEventListener('click', function () {
        setStraightenMode(!straightenMode);
      });
    }
    byId('pickBlackBtn').addEventListener('click', function () {
      setPickMode(pickMode === 'black' ? null : 'black');
    });
    byId('pickWhiteBtn').addEventListener('click', function () {
      setPickMode(pickMode === 'white' ? null : 'white');
    });
    byId('autoLevelsBtn').addEventListener('click', function () {
      setPickMode(null);
      autoLevelsFromPreview();
    });
    if (byId('autoChannelLevelsBtn')) {
      byId('autoChannelLevelsBtn').addEventListener('click', function () {
        setPickMode(null);
        autoLevelsPerChannelFromPreview();
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && pickMode) {
        setPickMode(null);
        notice(t('pickCancelled'));
      }
      if (event.key === 'Escape' && straightenMode && !straightenDrag) {
        setStraightenMode(false);
        notice(t('straightenLineCancelled'));
      }
    });
    byId('previewStage').addEventListener('wheel', onPreviewWheel);
    byId('previewStage').addEventListener('mousemove', function (event) {
      var p;
      var label;
      if (!(science && science.isPicking && science.isPicking())) { return; }
      p = pointerToImagePx(event.clientX, event.clientY);
      label = byId('previewZoomLabel');
      if (!p || !label) { return; }
      label.textContent = Math.round(previewViewZoom * 100) + '% · ' + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    });
    byId('previewStage').addEventListener('mouseleave', function () {
      if (science && science.isPicking && science.isPicking()) { updatePreviewZoomUi(); }
    });
    if (byId('previewZoomIn')) {
      byId('previewZoomIn').addEventListener('click', function () { setPreviewZoom(previewViewZoom * 1.25); });
    }
    if (byId('previewZoomOut')) {
      byId('previewZoomOut').addEventListener('click', function () { setPreviewZoom(previewViewZoom / 1.25); });
    }
    if (byId('previewZoomFit')) {
      byId('previewZoomFit').addEventListener('click', function () { setPreviewZoom(1); });
    }
    document.addEventListener('keydown', function (event) {
      var tag;
      if (event.code !== 'Space' && event.key !== ' ') { return; }
      tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
      previewSpaceDown = true;
      if (byId('previewStage')) { byId('previewStage').classList.add('pan-ready'); }
      if (event.preventDefault) { event.preventDefault(); }
    });
    document.addEventListener('keyup', function (event) {
      if (event.code !== 'Space' && event.key !== ' ') { return; }
      previewSpaceDown = false;
      if (byId('previewStage')) { byId('previewStage').classList.remove('pan-ready'); }
    });
    byId('previewStage').addEventListener('mousedown', function (event) {
      var stageEl = byId('previewStage');
      /* Class is the backup: selection polling must not clear the flag between the button and the click. */
      var endpointPick = !!(science && science.isPicking && science.isPicking()) || !!(stageEl && stageEl.classList.contains('endpoint-pick'));
      if (!window.PaperFigInteraction) { return; }
      var pointerAction = window.PaperFigInteraction.previewPointerAction({
          button: event.button,
          space: previewSpaceDown,
          endpointPick: endpointPick,
          samplePick: !!pickMode,
          straighten: !!straightenMode,
          marqueeMode: marqueeMode,
          cropArmed: !!cropDrawArmed,
          altKey: !!event.altKey,
          shiftKey: !!event.shiftKey,
          hasPreview: !!previewBase,
          cropDrag: !!cropDrag,
          onHandle: !!(event.target && event.target.getAttribute && event.target.getAttribute('data-handle'))
        });
      if (pointerAction === 'pick') {
        onCropPointerDown(event);
        return;
      }
      if (pointerAction === 'pan') {
        if (event.preventDefault) { event.preventDefault(); }
        try { beginPreviewPan(event); } catch (ignorePan) {}
        return;
      }
      /* Hold-to-compare: Space not required — middle/Alt or dedicated compare via long-press on empty? 
       * Use Alt/Option+mousedown OR button#compare — here: hold with button 0 while Ctrl/Meta shows original.
       * Also: dedicated hold on canvas with Shift. */
      if (pointerAction === 'compare') {
        comparingOriginal = true;
        schedulePreviewRender();
        var endCompare = function () {
          comparingOriginal = false;
          schedulePreviewRender();
          window.removeEventListener('mouseup', endCompare);
        };
        window.addEventListener('mouseup', endCompare);
        event.preventDefault();
        return;
      }
      onCropPointerDown(event);
    });
    /* Hold-to-compare without modifier: press-and-hold on previewStatus / meta hint via preview canvas */
    if (byId('previewCanvas')) {
      byId('previewCanvas').addEventListener('mousedown', function (event) {
        if (event.button !== 0 || pickMode || cropDrag) { return; }
        /* Right-half long press alternative: hold with middle button */
      });
    }
    if (byId('holdCompareBtn')) {
      byId('holdCompareBtn').addEventListener('mousedown', function (event) {
        event.preventDefault();
        comparingOriginal = true;
        schedulePreviewRender();
      });
      byId('holdCompareBtn').addEventListener('mouseup', function () {
        comparingOriginal = false;
        schedulePreviewRender();
      });
      byId('holdCompareBtn').addEventListener('mouseleave', function () {
        if (comparingOriginal) {
          comparingOriginal = false;
          schedulePreviewRender();
        }
      });
      byId('holdCompareBtn').addEventListener('touchstart', function (event) {
        event.preventDefault();
        comparingOriginal = true;
        schedulePreviewRender();
      }, { passive: false });
      byId('holdCompareBtn').addEventListener('touchend', function () {
        comparingOriginal = false;
        schedulePreviewRender();
      });
    }
    window.addEventListener('resize', function () {
      syncTransformBoxSize();
      updateCropOverlay();
    });
    byId('savePresetBtn').addEventListener('click',saveAdjustmentPreset);
    byId('loadPresetBtn').addEventListener('click',loadAdjustmentPreset);
    byId('inspectBtn').addEventListener('click', function () { inspectSelection({ quiet: false }); });
    byId('resetBtn').addEventListener('click', resetAdjustments);
    byId('applyBtn').addEventListener('click', applyPipeline);
    if (byId('artboardPreviewBtn')) {
      byId('artboardPreviewBtn').addEventListener('click', function () { runArtboardPreview({ auto: false }); });
    }
    if (byId('cancelPreviewBtn')) {
      byId('cancelPreviewBtn').addEventListener('click', function () { cancelArtboardPreview({ quiet: false }); });
    }
    /* Crop field settle can refresh artboard preview. */
    for (i = 0; i < cropIds.length; i += 1) {
      byId(cropIds[i]).addEventListener('change', function () {
        if (artboardPreviewActive) { scheduleArtboardPreviewRefresh(); }
      });
    }
    window.addEventListener('beforeunload', function () {
      saveSettings();
      persistArtboardPreviewState();
    });
    byId('detectBtn').addEventListener('click', detectFiji);
    byId('testBtn').addEventListener('click', testFiji);
    byId('browseBtn').addEventListener('click', function () { byId('fijiFile').click(); });
    bindFijiGate();
    byId('fijiFile').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (file) {
        syncFijiPathFields(file.path || file.name);
        saveSettings();
        setFijiStatus('neutral', t('fijiSelected', { path: file.path || file.name }));
      }
      this.value = '';
    });
  }

  
  
  var PANEL_COMPACT_KEY = 'sci_panel_compact';
  var PANEL_EXPANDED_W = 400;
  var PANEL_EXPANDED_H = 720;
  var PANEL_COLLAPSED_W = 400;
  var PANEL_COLLAPSED_H = 88;

  function isPanelCompact() {
    try { return localStorage.getItem(PANEL_COMPACT_KEY) === '1'; } catch (ignore) { return false; }
  }

  function setPanelCompact(compact) {
    var on = !!compact;
    try { localStorage.setItem(PANEL_COMPACT_KEY, on ? '1' : '0'); } catch (ignore) {}
    try { document.body.classList.toggle('panel-collapsed', on); } catch (ignoreBody) {}
    var btn = byId('panelCompactBtn');
    if (btn) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? t('panelExpand') : t('panelCompact');
      btn.title = on ? t('panelExpandTitle') : t('panelCompactTitle');
      if (btn.dataset) { btn.dataset.label = btn.textContent; }
    }
    /* Best-effort host resize; docked CEP panels often ignore this (CSInterface docs). */
    try {
      if (cs && typeof cs.resizeContent === 'function') {
        if (on) { cs.resizeContent(PANEL_COLLAPSED_W, PANEL_COLLAPSED_H); }
        else { cs.resizeContent(PANEL_EXPANDED_W, PANEL_EXPANDED_H); }
      }
    } catch (ignoreResize) {}
  }

  function bindPanelCompact() {
    var btn = byId('panelCompactBtn');
    if (!btn || btn.dataset.boundCompact === '1') { return; }
    btn.dataset.boundCompact = '1';
    btn.addEventListener('click', function () {
      setPanelCompact(!document.body.classList.contains('panel-collapsed'));
    });
    setPanelCompact(isPanelCompact());
  }
  function normalizeExternalUrl(raw) {
    var url = String(raw || '').trim();
    if (!url) { return ''; }
    /* CEP openURLInDefaultBrowser needs an absolute URL; keep website https-only. */
    if (url === 'zhaoli.dpdns.org' || url === '//zhaoli.dpdns.org' ||
        url === 'http://zhaoli.dpdns.org' || url === 'http://zhaoli.dpdns.org/' ||
        url === 'https://zhaoli.dpdns.org') {
      return 'https://zhaoli.dpdns.org/';
    }
    if (/^mailto:/i.test(url) || /^https?:\/\//i.test(url)) { return url; }
    if (/^[\w.-]+\.[a-z]{2,}([\/?#]|$)/i.test(url)) { return 'https://' + url; }
    return url;
  }
  function openExternalUrl(url) {
    url = normalizeExternalUrl(url);
    if (!url) { return false; }
    var opened = false;
    var result;
    try {
      if (cs && typeof cs.openURLInDefaultBrowser === 'function') {
        result = cs.openURLInDefaultBrowser(url);
        opened = (result === undefined || result === null || result === 0 || result === '0');
      }
    } catch (ignoreCs) {}
    if (!opened) {
      try {
        if (window.cep && window.cep.util && typeof window.cep.util.openURLInDefaultBrowser === 'function') {
          result = window.cep.util.openURLInDefaultBrowser(url);
          opened = (result === undefined || result === null || result === 0 || result === '0');
        }
      } catch (ignoreCep) {}
    }
    return opened;
  }
  function bindExternalLinks(rootEl) {
    var rootNode = rootEl || document;
    if (rootNode.__paperFigExternalLinksBound) { return; }
    rootNode.__paperFigExternalLinksBound = true;
    rootNode.addEventListener('click', function (e) {
      var target = e.target;
      var a = null;
      var node;
      if (target && target.closest) {
        a = target.closest('a.ext-link');
      } else {
        /* Older CEP Chromium: walk up (SVG path/circle clicks included). */
        node = target;
        while (node && node !== rootNode && node !== document) {
          if (node.tagName && String(node.tagName).toLowerCase() === 'a' &&
              node.classList && node.classList.contains('ext-link')) {
            a = node;
            break;
          }
          node = node.parentNode || node.parentElement;
        }
      }
      if (!a || (rootNode !== document && !rootNode.contains(a))) { return; }
      var url = normalizeExternalUrl(a.getAttribute('data-url') || a.getAttribute('href') || '');
      if (!url) { return; }
      e.preventDefault();
      e.stopPropagation();
      openExternalUrl(url);
    }, true);
  }
  function resolvePanelVersion() {
    try {
      if (extensionPath && window.require) {
        var fs = window.require('fs');
        var pathMod = window.require('path');
        var pkgPath = pathMod.join(extensionPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
          PANEL_VERSION = String(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || PANEL_VERSION);
          HOST_SCRIPT_VERSION = PANEL_VERSION;
        }
      }
    } catch (ignore) {}
    try {
      if (window.PaperFigI18n && typeof window.PaperFigI18n.setVersion === 'function') {
        window.PaperFigI18n.setVersion(PANEL_VERSION);
        window.PaperFigI18n.apply(document);
      }
    } catch (ignore2) {}
  }

  function init() {
    var hostReady;
    loadSettings();
    if (typeof CSInterface !== 'undefined') {
      cs = new CSInterface();
    try { bindExternalLinks(document); } catch (ignoreBind) {}
    try { bindPanelCompact(); } catch (ignoreCompact) {}
      try { extensionPath = cs.getSystemPath(SystemPath.EXTENSION).replace(/\\/g, '/'); } catch (ignore) {}
    }
    resolvePanelVersion();
    /* Start loading the Illustrator helpers while the rest of the panel initializes. */
    hostReady = ensureHostScript();
    populateSettings();
    initWorkflow();
    initScience();
    bind();
    if (cs && typeof cs.addEventListener === 'function') {
      try {
        cs.addEventListener('com.adobe.csxs.events.WindowVisibilityChanged', function (event) {
          notePanelVisibility(event && event.data);
          if (paperfigPanelActive()) { pollSelection(); }
        });
      } catch (ignoreVisEvt) {}
    }
    document.addEventListener('paperfig-feature-visibility', function (event) {
      if (!event.detail || event.detail.feature !== 'raw') { return; }
      updateArtboardPreviewButtons();
      if (lastSelectedItem) { refreshPanelPreviewAfterGeom(); }
    });
    updateArtboardPreviewButtons();
    updateExportUiHonesty();
    if (!window.SciBitmapFiji) { setFijiStatus('error', t('fijiBridgeFailed')); }
    else if (settings.fijiPath) { setFijiStatus('neutral', t('fijiConfiguredUntested')); }
    else { setFijiStatus('neutral', t('notConfigured')); }
    hostReady.then(function () { startSelectionPolling(); }).catch(function (error) {
      notice(error.message || String(error), 'error');
      startSelectionPolling();
    });
  }

  var W=window.SciBitmapWorkflow;
  var RECIPE_MAP_KEY='sci_bitmap_recipes_v1', PRESETS_KEY='sci_bitmap_presets_v1';
  var draftKey='', draftPath='', drafts={}, batchReview=null, batchStop=false, batchBusy=false;
  var decodedFiles={}, decodedOrder=[];
  function syncChannelColorPresetPressed(wrap, hex) {
    if (!wrap) return;
    var h = String(hex || '').toLowerCase();
    var list = wrap._presetButtons || (wrap.querySelectorAll ? wrap.querySelectorAll('button[data-hex]') : []);
    Array.prototype.forEach.call(list, function (btn) {
      var bh = btn._presetHex || (btn.getAttribute && btn.getAttribute('data-hex'));
      btn.setAttribute('aria-pressed', bh === h ? 'true' : 'false');
    });
  }
  function fillChannelColorPresets(wrap, colorInput, onPick) {
    if (!wrap || !colorInput || wrap.getAttribute('data-filled') === '1') return;
    wrap.setAttribute('data-filled', '1');
    wrap.setAttribute('aria-label', t('channelColorPresetsAria'));
    var presets = W.channelColorPresets();
    presets.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-hex', p.hex);
      btn._presetHex = p.hex;
      btn.style.backgroundColor = p.hex;
      if (p.id === 'gray') btn.className = 'preset-gray';
      var labelKey = 'colorPreset' + p.id.charAt(0).toUpperCase() + p.id.slice(1);
      btn.title = t(labelKey);
      btn.setAttribute('aria-label', t(labelKey));
      btn.setAttribute('data-i18n-title', labelKey);
      btn.setAttribute('data-i18n-aria', labelKey);
      btn.addEventListener('click', function () {
        colorInput.value = p.hex;
        syncChannelColorPresetPressed(wrap, p.hex);
        if (typeof onPick === 'function') onPick(p.hex);
        else {
          var ev;
          try { ev = new Event('change', { bubbles: true }); }
          catch (ignore) { ev = document.createEvent('HTMLEvents'); ev.initEvent('change', true, false); }
          colorInput.dispatchEvent(ev);
        }
      });
      wrap.appendChild(btn);
      if (!wrap._presetButtons) wrap._presetButtons = [];
      wrap._presetButtons.push(btn);
    });
    syncChannelColorPresetPressed(wrap, colorInput.value);
    colorInput.addEventListener('input', function () { syncChannelColorPresetPressed(wrap, colorInput.value); });
    colorInput.addEventListener('change', function () { syncChannelColorPresetPressed(wrap, colorInput.value); });
  }
  function refreshChannelColorPresetLabels() {
    Array.prototype.forEach.call(document.querySelectorAll('.channel-color-presets'), function (wrap) {
      wrap.setAttribute('aria-label', t('channelColorPresetsAria'));
      Array.prototype.forEach.call(wrap.querySelectorAll('button[data-hex]'), function (btn) {
        var key = btn.getAttribute('data-i18n-aria');
        if (!key) return;
        var label = t(key);
        btn.title = label;
        btn.setAttribute('aria-label', label);
      });
    });
  }

  function channelsFromUi() {
    var cs={enabled:byId('channelsEnabled').checked,components:[]};
    for(var i=0;i<3;i++)cs.components.push({name:byId('ch'+i+'Name').value,color:byId('ch'+i+'Color').value,low:Number(byId('ch'+i+'Low').value),high:Number(byId('ch'+i+'High').value),visible:byId('ch'+i+'Show').checked});
    // Keep-channel selection (any plane hidden) always maps on preview+Apply
    if(cs.components.some(function(c){return !c.visible;})){cs.enabled=true;byId('channelsEnabled').checked=true;}
    return cs;
  }
  function channelsToUi(cs) {
    cs=cs||W.channelsDefault();byId('channelsEnabled').checked=cs.enabled;
    cs.components.forEach(function(c,i){
      byId('ch'+i+'Name').value=c.name;byId('ch'+i+'Color').value=c.color;
      byId('ch'+i+'Low').value=c.low;byId('ch'+i+'High').value=c.high;
      if(byId('ch'+i+'LowSlider'))byId('ch'+i+'LowSlider').value=c.low;
      if(byId('ch'+i+'HighSlider'))byId('ch'+i+'HighSlider').value=c.high;
      byId('ch'+i+'Show').checked=c.visible;
      syncChannelColorPresetPressed(document.querySelector('[data-color-for="ch'+i+'Color"]'), c.color);
      /* Paint default/updated swatch fill (CEP native color chrome is unreliable). */
      if (window.PaperFigColorPicker && window.PaperFigColorPicker.sync) {
        window.PaperFigColorPicker.sync(byId('ch'+i+'Color'));
      }
    });
  }
  function currentRecipe() { return W.recipe(readPixelOpsFromUi()); }
  function putRecipe(value) {
    var r=W.recipe(value);
    ['brightness','contrast','toneLow','toneHigh','cyanRed','magentaGreen','yellowBlue','lut'].forEach(function(k){byId(k).value=r[k];});
    ['grayscale','invert','softBlur','sharpen'].forEach(function(k){byId(k).checked=r[k];});
    channelsToUi(r.channels);byId('channelView').value='merged';updateAdjustmentDisplay();
  }
  function sourceStamp(p, fresh) { return window.PaperFigFileStamp.contentStamp(p, fresh); }
  function stampOk(p, stored) { return window.PaperFigFileStamp.matches(p, stored); }
  /*
   * 0.8.1 provenance model
   *   <file>.json           processing record — written once per Apply, never
   *                         rewritten after its final status. Keeps source,
   *                         sourceStamp, recipe, crop: the audit trail.
   *   <file>.baseline.json  separate marker: "this output is now the panel
   *                         baseline"; recovery must not map it back to its
   *                         source. Deleting it only changes panel behaviour,
   *                         never the provenance.
   * 0.8.0 sidecars that were rewritten in place (role 'applied-baseline',
   * source === output) are still recognised as baselines.
   */
  var BASELINE_SUFFIX = '.baseline.json';
  function isAppliedBaseline(path, saved) {
    if (!path) { return false; }
    if (saved && saved.role === 'applied-baseline') { return true; }
    try {
      var fs = window.require('fs'), m;
      if (!fs.existsSync(path + BASELINE_SUFFIX)) { return false; }
      m = JSON.parse(fs.readFileSync(path + BASELINE_SUFFIX, 'utf8'));
      return !!m && m.schema === 'paperfig-baseline-marker' && m.path === path;
    } catch (ignore) { return false; }
  }
  function fileSha256(p) {
    try { return window.require('crypto').createHash('sha256').update(window.require('fs').readFileSync(p)).digest('hex'); }
    catch (ignore) { return null; }
  }
  function sourceRecord(key,path) {
    var rec=loadObjectMap(RECIPE_MAP_KEY)[key];
    if(rec && rec.outputs && (rec.originalPath===path || rec.outputs[path]))return rec;
    if(path && window.require) { try {
      var fs=window.require('fs'),sidecar=path+'.json';
      if(fs.existsSync(sidecar)&&fs.statSync(sidecar).size<1048576) {
        var saved=JSON.parse(fs.readFileSync(sidecar,'utf8'));
        if(saved.schema==='sci-bitmap-processing-record' && saved.version===1 && saved.status==='applied' && !isAppliedBaseline(path,saved) && saved.output===path && saved.source && saved.source!==path) {
          rec={originalPath:saved.source,originalStamp:saved.sourceStamp,outputs:{}};
          rec.outputs[path]={recipe:W.recipe(saved.recipe),crop:{cropLeft:saved.crop.left,cropTop:saved.crop.top,cropWidth:saved.crop.width,cropHeight:saved.crop.height}};
          var map=loadObjectMap(RECIPE_MAP_KEY);map[key]=rec;storeObjectMap(RECIPE_MAP_KEY,map);return rec;
        }
      }
    }catch(ignore){} }
    return null;
  }
  function sourceFor(key,path) {
    var rec=sourceRecord(key,path);
    if(rec && !stampOk(rec.originalPath, rec.originalStamp))throw new Error(t('errOriginalChanged'));
    return rec?rec.originalPath:path;
  }
  function rememberRecipe(key,source,output,opts) {
    var map=loadObjectMap(RECIPE_MAP_KEY),rec=map[key];
    if(!rec || rec.originalPath!==source)rec={originalPath:source,originalStamp:sourceStamp(source),outputs:{}};
    rec.outputs[output]={recipe:W.recipe(opts),crop:{cropLeft:opts.cropLeft||0,cropTop:opts.cropTop||0,cropWidth:opts.cropWidth||0,cropHeight:opts.cropHeight||0}};
    map[key]=rec;storeObjectMap(RECIPE_MAP_KEY,map);
    try{localStorage.setItem('sci_bitmap_last_recipe',JSON.stringify(W.recipe(opts)));}catch(ignore){}
  }
  /*
   * After Apply+reset, the new linked file is the panel baseline.
   * rememberRecipe/sidecar otherwise make sourceFor(out)→original and switchDraft
   * restore the just-applied crop — undoing seedPreviewFromProcessed (0.6.5 bug).
   */
  function rerootAppliedBaseline(key, outPath) {
    var map, fs, sidecar, saved;
    if (!key || !outPath) { return; }
    try {
      map = loadObjectMap(RECIPE_MAP_KEY);
      map[key] = {
        originalPath: outPath,
        originalStamp: sourceStamp(outPath),
        outputs: {}
      };
      storeObjectMap(RECIPE_MAP_KEY, map);
    } catch (ignoreMap) {}
    try { delete drafts[key]; } catch (ignoreDraft) {}
    draftKey = key;
    draftPath = outPath;
    /* Never touch <out>.json (provenance). Record baseline state separately. */
    try {
      fs = window.require('fs');
      sidecar = outPath + '.json';
      saved = {
        schema: 'paperfig-baseline-marker',
        version: 1,
        software: 'PaperFig for Illustrator ' + PANEL_VERSION,
        createdAt: new Date().toISOString(),
        path: outPath,
        stamp: sourceStamp(outPath),
        provenance: fs.existsSync(sidecar) ? sidecar : null,
        provenanceSha256: fs.existsSync(sidecar) ? fileSha256(sidecar) : null
      };
      writeJsonFile(outPath + BASELINE_SUFFIX, saved);
    } catch (ignoreSide) {}
  }
  function switchDraft(item) {
    var key=item?objectKeyFromItem(item):'',path=item&&item.sourcePath||'';
    var previewRec=restoreArtboardPreviewStateForKey(key);if(previewRec&&previewRec.previewFile===path)path=previewRec.originalPath;
    if(draftKey===key && draftPath===path)return;
    if(draftKey) { try { drafts[draftKey]={path:draftPath,recipe:currentRecipe(),crop:readCropRect()}; }catch(ignore){} }
    var rec=sourceRecord(key,path),saved=rec&&rec.outputs[path],draft=drafts[key];
    if(draft && draft.path===path) {
      putRecipe(draft.recipe);byId('cropLeft').value=draft.crop.left;byId('cropTop').value=draft.crop.top;byId('cropWidth').value=draft.crop.width;byId('cropHeight').value=draft.crop.height;
    } else if(saved) {
      putRecipe(saved.recipe);Object.keys(saved.crop).forEach(function(k){byId(k).value=saved.crop[k];});
    } else {
      /* No per-image draft/saved: geometry defaults to Use full image (W/H 0),
       * including first select after panel open (previously only cleared when draftKey was set). */
      if(draftKey){putRecipe({});}
      ['cropLeft','cropTop','cropWidth','cropHeight'].forEach(function(k){byId(k).value=0;});
    }
    draftKey=key;draftPath=path;
  }
  function verifiedProfile(path,opts) {
    var p=W.profile(Core.readMetadata(window.require('fs'),path,window.require('buffer').Buffer));
    if(p.width*p.height>64000000)throw new Error(t('errTooManyMp'));
    if(opts)W.compatible(W.recipe(opts),p);return p;
  }
  function loadWorkflowImage(path) {
    return Promise.resolve().then(function(){
      verifiedProfile(path);
      if(!/\.tiff?$/i.test(path))return loadImageElementFromPath(path);
      var fs=window.require('fs'),stamp=sourceStamp(path),key=path+'|'+stamp;
      if(decodedFiles[key] && fs.existsSync(decodedFiles[key]))return loadImageElementFromPath(decodedFiles[key]);
      return new Promise(function(resolve,reject){fs.readFile(path,function(e,b){if(e)return reject(e);try {
        var im=W.decodeTiff(b),c=document.createElement('canvas');c.width=im.width;c.height=im.height;var x=c.getContext('2d'),d=x.createImageData(im.width,im.height);d.data.set(im.data);x.putImageData(d,0,0);resolve(c);
      }catch(error){resolve(null);}});}).then(function(c){
        if(c)return c;
        var tiffInfo=Core.readMetadata(fs,path,window.require('buffer').Buffer);
        if(tiffInfo.samplesPerPixel>3)throw new Error(t('errTiffAlpha'));
        if(decodedFiles[key] && fs.existsSync(decodedFiles[key]))return loadImageElementFromPath(decodedFiles[key]);
        if(!settings.fijiPath){showFijiGate();throw new Error(t('errTiffNeedsFiji'));}
        if(!window.SciBitmapFiji || !window.SciBitmapFiji.runMacro)throw new Error(t('fijiBridgeFailed'));
        var out=suggestPanelProxyOutPath(path),macro=writeTempMacro('setBatchMode(true);\nopen("'+escapeIjString(ijPath(path))+'");\ngetDimensions(w,h,c,z,t);\nif (c*z*t!=1 || (bitDepth!=24 && bitDepth!=8)) exit("Requires one RGB8 or Gray8 image");\nsaveAs("PNG", "'+escapeIjString(ijPath(out))+'");\nclose();\nprint("SCI_RGB_DECODE_OK");\n');
        return window.SciBitmapFiji.runMacro(settings.fijiPath,macro,null,{timeoutMs:180000,successMarker:'SCI_RGB_DECODE_OK'}).then(function(result){
          if(((result.stdout||'')+'\n'+(result.stderr||'')).indexOf('SCI_RGB_DECODE_OK')<0 || !fs.existsSync(out))throw new Error(t('errFijiDecode'));
          if(sourceStamp(path)!==stamp)throw new Error(t('errSourceChangedDecode'));
          decodedFiles[key]=out;decodedOrder.push(key);
          while(decodedOrder.length>4){var old=decodedOrder.shift();try{fs.unlinkSync(decodedFiles[old]);}catch(ignore){}delete decodedFiles[old];}
          return loadImageElementFromPath(out);
        }).then(function(im){try{fs.unlinkSync(macro);}catch(ignore){}return im;},function(e){try{fs.unlinkSync(macro);}catch(ignore){}throw e;});
      });
    });
  }
  function recipeSidecar(source,output,opts,profile,key) {
    var fs=window.require('fs');
    var record={schema:'sci-bitmap-processing-record',version:1,software:'PaperFig for Illustrator '+PANEL_VERSION,role:'display-derivative',createdAt:new Date().toISOString(),objectKey:key,source:source,sourceStamp:sourceStamp(source),output:output,image:profile,recipe:W.recipe(opts),crop:{left:opts.cropLeft||0,top:opts.cropTop||0,width:opts.cropWidth||0,height:opts.cropHeight||0},export:{format:opts.format,dpi:opts.format==='TIFF'?opts.dpi:null},pipeline:'per-channel levels → RGB additive mapping → color gains → gray → tone → invert → blur → sharpen',status:'prepared'};
    /* Lineage: when the input is itself a PaperFig output, link to its record. */
    try{if(fs.existsSync(source+'.json')){var up=JSON.parse(fs.readFileSync(source+'.json','utf8'));if(up&&up.output===source&&(up.schema==='sci-bitmap-processing-record'||up.schema==='sci-raw-display')){record.parent={path:source,record:source+'.json',recordSha256:fileSha256(source+'.json'),source:up.source||null,origin:(up.parent&&up.parent.origin)||up.source||null};}}}catch(ignoreParent){}
    record.calibration=(science&&science.lookupCalibration?science.lookupCalibration({objectKey:key,sourcePath:output}):null)||loadObjectMap('sci_calibrations_v1')[key]||null;
    writeJsonFile(output+'.json', record);return record;
  }
  function writeJsonFile(filePath, value) {
    if (window.PaperFigOutput && window.PaperFigOutput.writeJsonAtomic) {
      window.PaperFigOutput.writeJsonAtomic(filePath, value);
      return;
    }
    var fs = window.require('fs');
    var partial = filePath + '.partial';
    fs.writeFileSync(partial, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(partial, filePath);
  }
  function markRecord(output,record,status,error) {
    record.status=status;if(error)record.error=String(error);
    try{writeJsonFile(output+'.json', record);}catch(e){return ' · Record status could not be updated: '+e.message;}return '';
  }
  var RGB_RECORD_RECOVERY='paperfig_rgb_record_recovery_v1';
  function pendingRgbRecords(){try{return JSON.parse(localStorage.getItem(RGB_RECORD_RECOVERY)||'{}')||{};}catch(ignore){return {};}}
  function rememberRgbRecord(output,record){try{var pending=pendingRgbRecords();pending[output]=record;localStorage.setItem(RGB_RECORD_RECOVERY,JSON.stringify(pending));}catch(ignore){}}
  function clearRgbRecord(output){try{var pending=pendingRgbRecords();delete pending[output];localStorage.setItem(RGB_RECORD_RECOVERY,JSON.stringify(pending));}catch(ignore){}}
  function recoverRgbRecords(){var pending=pendingRgbRecords(),output;for(output in pending){if(Object.prototype.hasOwnProperty.call(pending,output)){try{writeJsonFile(output+'.json',pending[output]);delete pending[output];}catch(ignore){}}}try{localStorage.setItem(RGB_RECORD_RECOVERY,JSON.stringify(pending));}catch(ignoreStore){}}
  function finishRgbRecord(output,record){var warning=markRecord(output,record,'applied');if(warning){rememberRgbRecord(output,record);notice(warning,'error');}else clearRgbRecord(output);return warning;}
  function workflowApply(preview) {
    if(applyRunning||artboardPreviewRunning||liveGeomBusy||panelProxyRunning){notice(t('busyWait'),'error');return Promise.resolve(false);}
    var opts,source,out,stamp,profile,key,record,prior,processed,t0,timings,tMark,ready,live,reused,imageReplaced=false,recordWarning='';
    if(preview){artboardPreviewRunning=true;updateArtboardPreviewButtons();}else setApplyRunning(true);
    try{opts=buildAdjustmentOpts(preview?{previewMaxEdge:ARTBOARD_PREVIEW_MAX_EDGE}:null);}catch(e){if(preview){artboardPreviewRunning=false;updateArtboardPreviewButtons();}else setApplyRunning(false);notice(e.message,'error');return Promise.resolve(false);}
    /* Prefer PNG for Apply speed unless user explicitly chose JPEG/TIFF. */
    if(!preview){
      var fmt=String(opts.format||settings.format||'PNG').toUpperCase();
      if(fmt!=='JPEG'&&fmt!=='TIFF'){opts.format='PNG';}
    }
    t0=Date.now();timings={};tMark=t0;reused=false;
    return (preview
      ? Promise.resolve()
      : applyStage('锁定', 'Lock selection', 5, timings)
    ).then(function(){
      return captureOperationLock();
    }).then(function(lock){
      timings.lock=Date.now()-tMark;tMark=Date.now();
      key=lock.objectKey;prior=lock.sourcePath;
      if(preview && (!prior || lock.typename!=='PlacedItem'))throw new Error(t('errPreviewNeedsLink'));
      if(lastBitmapCount>1)throw new Error(t('errMultiUseBatch'));
      if(artboardPreviewActive)prior=artboardPreviewOriginalPath;
      if(prior)return {path:prior};
      return lockedExport('PNG',opts.dpi);
    }).then(function(exported){
      source=sourceFor(key,exported.path);profile=verifiedProfile(source,opts);stamp=sourceStamp(source);
      out=preview?suggestCanvasPreviewOutPath(source):suggestOutPath(source,opts.format);
      timings.meta=Date.now()-tMark;tMark=Date.now();
      if(preview){
        return applyStage('处理', 'Process preview', 40, timings).then(function(){
          return processImageWithCanvas(source,out,opts);
        });
      }
      ready=takeApplyReady(source,stamp,opts);
      if(ready){
        timings.reuse=Date.now()-tMark;tMark=Date.now();reused=true;
        return applyStage('写出', 'Encode (warm cache) '+String(opts.format||'PNG').toUpperCase(), 70, timings).then(function(){
          return writeRasterToFile(ready,out,opts);
        });
      }
      live=tryRasterizeFromLivePreview(source,opts);
      if(live){
        timings.preview=Date.now()-tMark;tMark=Date.now();reused=true;
        storeApplyReady(source,stamp,opts,live);
        return applyStage('写出', 'Encode (preview pixels) '+String(opts.format||'PNG').toUpperCase(), 70, timings).then(function(){
          return writeRasterToFile(live,out,opts);
        });
      }
      return applyStage('加载/处理', 'Load+process '+profile.width+'\u00d7'+profile.height, 35, timings).then(function(){
        return rasterizeWithCanvas(source,opts);
      }).then(function(raster){
        timings.process=Date.now()-tMark;tMark=Date.now();
        storeApplyReady(source,stamp,opts,raster);
        return applyStage('写出', 'Encode '+String(opts.format||'PNG').toUpperCase(), 70, timings).then(function(){
          return writeRasterToFile(raster,out,opts);
        });
      });
    }).then(function(result){
      processed=result;
      if(sourceStamp(source,true)!==stamp)throw new Error(t('errSourceChangedProcessing'));
      timings.encode=timings.encode||(Date.now()-tMark);tMark=Date.now();
      if(!preview)record=recipeSidecar(source,out,opts,profile,key);
      return applyStage(preview?'替换预览':'写回画板', preview?'Relink preview':'Relink artboard', 90, timings).then(function(){
        /* Upright crop geometry only on Apply — preview keeps old frame so Cancel can restore. */
        return lockedReplace(out,opts.rotate||0,false,false, preview ? null : geomOptsForCropReplace(opts,processed));
      });
    }).then(parseHostResult).then(function(replaced){
      var secs=((Date.now()-t0)/1000).toFixed(1);
      var stageBits=[],hostBits,k;
      timings.relink=Date.now()-tMark;
      if(!preview){ assertAppliedLink(replaced, out); }
      imageReplaced=true;
      hostBits=hostRelinkTimingBits(replaced, timings);
      hostBits.forEach(function(b){ stageBits.push(b); });
      for(k in timings){if(Object.prototype.hasOwnProperty.call(timings,k))stageBits.push(k+'='+timings[k]+'ms');}
      if(preview){
        artboardPreviewOriginalPath=prior||source;artboardPreviewFile=out;artboardPreviewObjectKey=key;artboardPreviewActive=true;persistArtboardPreviewState();
        notice(t('artboardPreviewUpdated', { secs: secs, stages: stageBits.join(' ') }));
      }else{
        if(record){recordWarning=finishRgbRecord(out,record);record=null;}
        rememberReplacementIdentity(replaced);key=lastObjectKey;
        try{rememberRecipe(key,source,out,opts);}catch(saveErr){recordWarning+=' · '+saveErr.message;}
        clearArtboardPreviewState({keepFile:true});
        /* New linked file is baseline: clear crop UI, bust caches, show baked result (not old source). */
        invalidatePanelPreviewCache(source);
        invalidateDecodedImage(out);
        invalidateApplyReady();
        resetAdjustmentsAfterApply(true);
        rerootAppliedBaseline(key,out);
        lastFingerprint=null;
        lastSourcePath=out;
        if(!seedPreviewFromProcessed(processed, replaced.info)){
          return refreshPanelPreviewAfterGeom().then(function(){
            appliedStatus(t('appliedArtboard', { detail: secs+'s'+(reused?' · reused':'')+' · '+stageBits.join(' ')+' · Undo (Ctrl/Cmd+Z) · '+out+recordWarning }));
            return true;
          });
        }
        appliedStatus(t('appliedArtboard', { detail: secs+'s'+(reused?' · reused':'')+' · '+stageBits.join(' ')+' · Undo (Ctrl/Cmd+Z) · '+out+recordWarning }));
      }
      return true;
    }).catch(function(e){if(record){if(imageReplaced){record.status='applied';rememberRgbRecord(out,record);}else markRecord(out,record,'not-applied',e.message);}notice((e&&e.message?e.message:String(e))+(out?t('outputIfCreated',{path:out}):''),'error');return imageReplaced&&!preview;}).then(function(ok){
      if(preview){artboardPreviewRunning=false;updateArtboardPreviewButtons();}else setApplyRunning(false);return ok;
    });
  }

  function presets() { try{return W.parsePresets(localStorage.getItem(PRESETS_KEY)||'{"schema":"sci-bitmap-presets","version":1,"presets":[]}');}catch(e){notice(t('presetStorageInvalid', { msg: e.message }),'error');return [];} }
  function storePresets(list) {localStorage.setItem(PRESETS_KEY,JSON.stringify({schema:'sci-bitmap-presets',version:1,presets:list}));renderPresets();}
  function renderPresets(index) {
    var el=byId('presetSelect');while(el.firstChild)el.removeChild(el.firstChild);
    var placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=t('choosePreset');el.appendChild(placeholder);
    presets().forEach(function(p,i){var o=document.createElement('option');o.value=String(i);o.textContent=p.name;el.appendChild(o);});el.value=index==null?'':String(index);
  }
  function saveNamedPreset(overwrite) {
    try {
      var name=byId('presetName').value.trim(),list=presets(),value=byId('presetSelect').value,idx=Number(value);
      if(!name)throw new Error(t('errEnterPresetName'));
      if(overwrite && value==='')throw new Error(t('errChooseOverwrite'));
      if(!overwrite && list.length>=100)throw new Error(t('errMaxPresets'));
      var p={name:name,recipe:currentRecipe()};
      if(overwrite)list[idx]=p;else{list.push(p);idx=list.length-1;}
      storePresets(list);renderPresets(idx);notice(t('presetSaved', { name: name }));
    }catch(e){notice(e.message,'error');}
  }
  function loadNamedPreset() {
    try {var value=byId('presetSelect').value;if(value==='')throw new Error(t('errChoosePreset'));var p=presets()[Number(value)];putRecipe(p.recipe);byId('presetName').value=p.name;onAdjustmentSettle();notice(t('presetLoaded'));}catch(e){notice(e.message,'error');}
  }
  function writePresetExport() {
    try {var path=durableOutputPath(window.require('path').join(window.require('os').homedir(),'paperfig-presets'),'.json');window.require('fs').writeFileSync(path,JSON.stringify({schema:'sci-bitmap-presets',version:1,presets:presets()},null,2),'utf8');notice(t('presetsExported', { path: path }));}catch(e){notice(e.message,'error');}
  }
  function importPresetFile(file) {
    if(!file)return;var reader=new FileReader();
    if(file.size>1048576){notice(t('presetJsonTooBig'),'error');return;}
    reader.onload=function(){try{var incoming=W.parsePresets(reader.result),list=presets();if(list.length+incoming.length>100)throw new Error(t('errImportExceeds'));storePresets(list.concat(incoming));notice(t('presetsImported',{n:incoming.length}));}catch(e){notice(e.message,'error');}};
    reader.onerror=function(){notice(t('presetReadFail'),'error');};reader.readAsText(file);
  }
  function batchText(row,text) {row.status=text;if(row.label)row.label.textContent=row.name+' · '+text;}
  function prepareBatch() {
    if(science && science.active())return science.prepareBatch();
    if(applyRunning||artboardPreviewRunning||panelProxyRunning||liveGeomBusy)return;
    var opts;
    try{saveSettings();opts=currentRecipe();opts.format=settings.format;opts.dpi=settings.dpi;opts.cropLeft=opts.cropTop=opts.cropWidth=opts.cropHeight=0;}catch(e){notice(e.message,'error');return;}
    setApplyRunning(true);batchBusy=true;batchStop=false;byId('cancelBatchBtn').disabled=false;
    if(batchReview)evalHost('releaseBitmapBatch('+quoteExtendScript(batchReview.token)+')');
    batchReview=null;byId('batchList').textContent='';
    return ensureHostScript().then(function(){return evalHost('captureBitmapBatch()');}).then(parseHostResult).then(function(result){
      batchReview={token:result.token,opts:W.clone(opts),rows:[]};var chain=Promise.resolve();
      result.items.forEach(function(item,index){
        var row={item:item,index:index,name:item.name||window.require('path').basename(item.sourcePath||'Embedded image'),status:t('batchChecking'),valid:false};batchReview.rows.push(row);
        var div=document.createElement('div');div.className='batch-item';row.check=document.createElement('input');row.check.type='checkbox';row.check.disabled=true;row.thumb=document.createElement('canvas');row.thumb.width=48;row.thumb.height=36;row.label=document.createElement('span');div.appendChild(row.check);div.appendChild(row.thumb);div.appendChild(row.label);byId('batchList').appendChild(div);batchText(row,t('batchChecking'));
        chain=chain.then(function(){
          if(batchStop){batchText(row,t('batchCancelled'));return;}
          return Promise.resolve().then(function(){
            if(!item.linked||!item.sourcePath)throw new Error(t('errEmbeddedBatch'));
            var previewRec=restoreArtboardPreviewStateForKey(item.objectKey);
            if(previewRec && previewRec.previewFile===item.sourcePath)throw new Error(t('errCancelPreviewBatch'));
            row.source=sourceFor(item.objectKey,item.sourcePath);row.profile=verifiedProfile(row.source,opts);row.stamp=sourceStamp(row.source);
            return loadWorkflowImage(row.source);
          }).then(function(im){var scale=Math.min(48/im.width,42/im.height);row.thumb.width=Math.max(1,Math.round(im.width*scale));row.thumb.height=Math.max(1,Math.round(im.height*scale));row.thumb.getContext('2d').drawImage(im,0,0,row.thumb.width,row.thumb.height);row.valid=true;row.check.checked=true;batchText(row,t('batchReadyRow',{kind:row.profile.kind,w:row.profile.width,h:row.profile.height}));}).catch(function(e){batchText(row,t('batchSkipped',{msg:localizeMsg(e.message)}));});
        });
      });return chain;
    }).then(function(){
      var r=batchReview.opts;
      byId('batchSummary').textContent=t('batchReviewedSummary',{n:batchReview.rows.length,brightness:r.brightness,contrast:r.contrast,toneLow:r.toneLow,toneHigh:r.toneHigh,colors:((r.channels.enabled||W.levelsTouched(r.channels)||r.channels.components.some(function(c){return !c.visible;}))?t('batchColorsRgb',{detail:r.channels.components.map(function(c){return c.color+' ['+c.low+'–'+c.high+']'+(c.visible?'':' hidden');}).join(', ')}):t('batchColorsOriginal')),format:r.format});
      notice(t('batchReady'));
    }).catch(function(e){notice(e.message,'error');}).then(function(){batchBusy=false;setApplyRunning(false);byId('cancelBatchBtn').disabled=true;syncBatchButtons();});
  }
  function syncBatchButtons() {
    var busy=applyRunning||artboardPreviewRunning||panelProxyRunning||liveGeomBusy;
    byId('runBatchBtn').disabled=busy||!batchReview||!batchReview.rows.some(function(r){return r.valid;});
    if(batchReview)batchReview.rows.forEach(function(r){r.check.disabled=busy||!r.valid;});
    byId('cancelBatchBtn').disabled=!batchBusy;
  }
  function runBatch() {
    if(science && science.hasBatch())return science.runBatch();
    if(!batchReview||applyRunning||artboardPreviewRunning||panelProxyRunning||liveGeomBusy)return;
    var review=batchReview,rows=review.rows.filter(function(r){return r.valid&&r.check.checked;});
    if(!rows.length){notice(t('checkOneReady'));return;}
    batchBusy=true;batchStop=false;setApplyRunning(true);byId('cancelBatchBtn').disabled=false;
    var report={schema:'sci-bitmap-batch-report',version:1,createdAt:new Date().toISOString(),recipe:review.opts,results:[]},chain=Promise.resolve(),reportPath='';
    try { reportPath=durableOutputPath(rows[0].source,'.batch.json');window.require('fs').writeFileSync(reportPath,JSON.stringify(report,null,2),'utf8'); }
    catch(e){batchBusy=false;setApplyRunning(false);notice(t('batchReportFail', { msg: e.message }),'error');return;}
    report.skipped=review.rows.filter(function(r){return !r.valid||!r.check.checked;}).map(function(r){return {source:r.item.sourcePath,status:r.status,checked:r.check.checked};});
    rows.forEach(function(row){chain=chain.then(function(){
      var output,record,replaced=false;
      if(batchStop){batchText(row,t('batchCancelled'));report.results.push({source:row.source,status:'cancelled'});return;}
      batchText(row,t('batchProcessing'));
      return Promise.resolve().then(function(){
        if(sourceStamp(row.source,true)!==row.stamp)throw new Error(t('errSourceChangedReview'));
        verifiedProfile(row.source,review.opts);output=suggestOutPath(row.source,review.opts.format);
        return processImageWithCanvas(row.source,output,review.opts);
      }).then(function(){
        if(batchStop)throw new Error(t('errCancelledReplace'));
        if(sourceStamp(row.source,true)!==row.stamp)throw new Error(t('errSourceChangedProcessing'));
        record=recipeSidecar(row.source,output,review.opts,row.profile,row.item.objectKey);
        return evalHost('replaceBatchBitmap('+quoteExtendScript(review.token)+','+row.index+','+quoteExtendScript(output)+')');
      }).then(parseHostResult).then(function(result){
        assertAppliedLink(result, output);
        replaced=true;
        var warning=finishRgbRecord(output,record);
        try{rememberRecipe(result.info.objectKey,row.source,output,review.opts);}catch(e){warning+=' · '+e.message;}
        row.valid=false;batchText(row,t('batchDone')+warning);report.results.push({source:row.source,output:output,status:'applied',warning:warning});
      }).catch(function(e){if(replaced){record.status='applied';rememberRgbRecord(output,record);report.results.push({source:row.source,output:output,status:'applied',warning:e.message});notice(e.message,'error');return;}if(record)markRecord(output,record,'not-applied',e.message);batchText(row,batchStop?t('batchCancelledMsg',{msg:localizeMsg(e.message)}):t('batchFailed',{msg:localizeMsg(e.message)}));report.results.push({source:row.source,output:output||null,status:batchStop?'cancelled':'failed',error:e.message});});
    }).then(function(){window.require('fs').writeFileSync(reportPath,JSON.stringify(report,null,2),'utf8');});});
    return chain.then(function(){appliedStatus(t('batchFinished', { done: report.results.filter(function(r){return r.status==='applied';}).length, total: rows.length, path: reportPath }));}).catch(function(e){notice(t('batchStopped', { msg: e.message, path: reportPath }),'error');}).then(function(){
      return evalHost('releaseBitmapBatch('+quoteExtendScript(review.token)+')');
    }).then(function(){batchReview=null;batchBusy=false;setApplyRunning(false);lastFingerprint=null;return refreshPanelPreviewAfterGeom();});
  }
  function initWorkflow() {
    recoverRgbRecords();
    /* Fresh remapping defaults on every panel open; ignore settings.channels. */
    channelsToUi(W.channelsDefault());byId('channelView').value='merged';
    if(!localStorage.getItem(PRESETS_KEY)) { try {var old=JSON.parse(localStorage.getItem('sci_bitmap_adjustment_preset')||'null');if(old)storePresets([{name:'Imported 0.3 preset',recipe:W.recipe(old)}]);}catch(ignore){} }
    renderPresets();
    ['brightness','contrast','toneLow','toneHigh','cyanRed','magentaGreen','yellowBlue'].forEach(function(k){
      var input=byId(k+'Value');
      function commit(){var value=Number(input.value),slider=byId(k);if(input.value===''||!isFinite(value)){updateAdjustmentDisplay();return;}value=Math.max(Number(input.min),Math.min(Number(input.max),Math.round(value)));slider.value=value;sliderDragging=false;onAdjustmentSettle();}
      input.addEventListener('change',commit);input.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13){commit();input.blur();}});
    });
    for(var i=0;i<3;i++)(function(ch){
      ['Name','Color','Show'].forEach(function(part){byId('ch'+ch+part).addEventListener('change',function(){try{W.recipe(readPixelOpsFromUi());onAdjustmentSettle();}catch(e){notice(e.message,'error');}});});
      function syncLevel(kind,fromSlider){
        var num=byId('ch'+ch+kind),slider=byId('ch'+ch+kind+'Slider'),v;
        if(fromSlider){num.value=slider.value;}
        else if(slider){slider.value=num.value;}
        v=Number(num.value);
        if(kind==='Low'&&Number(byId('ch'+ch+'High').value)<=v){byId('ch'+ch+'High').value=Math.min(255,v+1);if(byId('ch'+ch+'HighSlider'))byId('ch'+ch+'HighSlider').value=byId('ch'+ch+'High').value;}
        if(kind==='High'&&Number(byId('ch'+ch+'Low').value)>=v){byId('ch'+ch+'Low').value=Math.max(0,v-1);if(byId('ch'+ch+'LowSlider'))byId('ch'+ch+'LowSlider').value=byId('ch'+ch+'Low').value;}
      }
      ['Low','High'].forEach(function(kind){
        byId('ch'+ch+kind).addEventListener('change',function(){syncLevel(kind,false);try{W.recipe(readPixelOpsFromUi());onAdjustmentSettle();}catch(e){notice(e.message,'error');}});
        var slider=byId('ch'+ch+kind+'Slider');
        if(slider){
          slider.addEventListener('mousedown',function(){sliderDragging=true;});
          slider.addEventListener('input',function(){sliderDragging=true;syncLevel(kind,true);schedulePreviewRender();scheduleSaveSettings();});
          slider.addEventListener('change',function(){sliderDragging=false;syncLevel(kind,true);try{W.recipe(readPixelOpsFromUi());onAdjustmentSettle();}catch(e){notice(e.message,'error');}});
          slider.addEventListener('mouseup',function(){sliderDragging=false;schedulePreviewRender();scheduleSaveSettings();});
        }
      });
    })(i);
    byId('channelsEnabled').addEventListener('change', function () {
      /* Enable remapping without requiring a live Illustrator selection.
         Preview refreshes from associated previewBase / lastSourcePath when present. */
      try { W.recipe(readPixelOpsFromUi()); } catch (e) { notice(e.message, 'error'); return; }
      onAdjustmentSettle();
    });
    byId('channelView').addEventListener('change',schedulePreviewRender);
    byId('magentaGreenBtn').addEventListener('click',function(){var cs=channelsFromUi();cs.enabled=true;cs.components[0].color='#ff00ff';cs.components[1].color='#00ff00';channelsToUi(cs);onAdjustmentSettle();});
    byId('identityColorsBtn').addEventListener('click',function(){channelsToUi(W.channelsDefault());onAdjustmentSettle();});
    /* Fiji presets live inside PaperFigColorPicker popup (not channel rows). */
    for (var pci = 0; pci < 3; pci++) (function (ch) {
      var colorEl = byId('ch' + ch + 'Color');
      if (colorEl && window.PaperFigColorPicker && window.PaperFigColorPicker.sync) {
        window.PaperFigColorPicker.sync(colorEl);
      }
      colorEl.addEventListener('change', function () {
        byId('channelsEnabled').checked = true;
        try { W.recipe(readPixelOpsFromUi()); onAdjustmentSettle(); }
        catch (e) { notice(e.message, 'error'); }
      });
    })(pci);

    function applyRgbKeep(mask){var cs=channelsFromUi();cs=W.keepMask(cs.components,mask);channelsToUi(cs);byId('channelView').value='merged';try{W.recipe(readPixelOpsFromUi());onAdjustmentSettle();}catch(e){notice(e.message,'error');}}
    [['keepAllBtn',[true,true,true]],['keepRGBtn',[true,true,false]],['keepRBBtn',[true,false,true]],['keepGBBtn',[false,true,true]],['keepRBtn',[true,false,false]],['keepGBtn',[false,true,false]],['keepBBtn',[false,false,true]]].forEach(function(pair){byId(pair[0]).addEventListener('click',function(){applyRgbKeep(pair[1]);});});

    byId('updatePresetBtn').addEventListener('click',function(){saveNamedPreset(true);});
    byId('deletePresetBtn').addEventListener('click',function(){var value=byId('presetSelect').value;if(value==='')return;var list=presets();list.splice(Number(value),1);storePresets(list);notice(t('presetDeleted'));});
    byId('repeatLastBtn').addEventListener('click',function(){try{var r=JSON.parse(localStorage.getItem('sci_bitmap_last_recipe')||'null');if(!r)throw new Error(t('errApplyOneFirst'));putRecipe(r);onAdjustmentSettle();notice(t('lastRecipeLoaded'));}catch(e){notice(e.message,'error');}});
    byId('exportPresetBtn').addEventListener('click',writePresetExport);
    byId('importPresetBtn').addEventListener('click',function(){byId('presetFile').click();});
    byId('presetFile').addEventListener('change',function(){importPresetFile(this.files&&this.files[0]);this.value='';});
    byId('presetSelect').addEventListener('change',function(){var p=presets()[Number(this.value)];if(this.value!==''&&p)byId('presetName').value=p.name;});
    byId('prepareBatchBtn').addEventListener('click',prepareBatch);byId('runBatchBtn').addEventListener('click',runBatch);byId('cancelBatchBtn').addEventListener('click',function(){if(science&&science.cancelBatch()){notice(t('stoppingRawBatch'));return;}batchStop=true;notice(t('stoppingBatch'));});
  }

  function initScience() {
    if(!window.SciScientificPanel)return;
    science=window.SciScientificPanel.create({
      byId:byId,extensionPath:extensionPath,fiji:function(){return byId('fijiPath').value.trim();},
      requireFiji:showFijiGate,
      info:function(){return lastSelectedItem;},busy:function(){return applyRunning||artboardPreviewRunning||panelProxyRunning||liveGeomBusy;},
      setBusy:setApplyRunning,notice:notice,footerStatus:footerStatus,appliedStatus:appliedStatus,count:function(){return lastBitmapCount;},capture:captureOperationLock,
      host:function(script){return ensureHostScript().then(function(){return evalHost(script);}).then(parseHostResult);},
      replace:function(out){return lockedReplace(out,0,false,false).then(parseHostResult).then(function(r){rememberReplacementIdentity(r);return r;});},
      refresh:refreshPanelPreviewAfterGeom,assertLink:assertAppliedLink,
      format:function(){return byId('format').value;},dpi:function(){return Number(byId('dpi').value)||300;},
      output:function(source,format){return suggestOutPath(source,format||byId('format').value);},
      exportPath:function(base){return durableOutputPath(window.require('path').join(window.require('os').homedir(),base),'.json');},
      write:function(canvas,out,dpi){return writeCanvasToImageFile(canvas,out,dpi||Number(byId('dpi').value)||300);},
      crop:function(w,h){return Core.cropRect(readUiCrop(),w,h);},
      pointer:pointerToImagePx,
      syncHand:function(){ try { syncMarqueeModeUi(); } catch (ignoreHand) {} },
      sourceSize:function(){
        if (sourceImageSize && sourceImageSize.width > 0 && sourceImageSize.height > 0) { return sourceImageSize; }
        if (previewBase && lastImageSize && lastImageSize.width > 0 && lastImageSize.height > 0) { return lastImageSize; }
        return null;
      },
      sourcePath:function(){return sourceFor(lastObjectKey,lastSourcePath);},
      isPreview:function(item){var r=restoreArtboardPreviewStateForKey(item.objectKey);return !!(r&&r.previewFile===item.sourcePath);},
      rawPreview:function(im,d){
        previewIsSource=true;sourceImageSize={width:d.width,height:d.height};setImageSizeHint(d.width,d.height);
        previewBase={width:im.width,height:im.height,data:im.data};previewBaseDrag=null;
        byId('previewCanvas').classList.remove('hidden');byId('previewStage').classList.add('has-canvas');byId('previewStage').classList.remove('has-image');
        byId('previewMessage').textContent='';setPreviewStatus(t('statusRawDisplay',{pct:im.compositeClippedPercent.toFixed(3)}));syncTransformBoxSize();updateCropOverlay();
      },
      displayWidth:function(cal,binding){
        /* umPerPixel is full-source; displayPixelsX = currently placed/export pixel width.
         * Crop UI before Apply does not change placed pixels — still full source width.
         * After Apply(+reroot), linked file may be a crop; µm/px still applies 1:1. */
        if(artboardPreviewActive)throw new Error(t('errCancelPreviewScale'));
        var item=lastSelectedItem,record=null,fs=window.require('fs'),path=item&&item.sourcePath,fileW,meta;
        if(!path||!cal||!(Number(cal.umPerPixelX)>0))return null;
        if(fs.existsSync(path+'.json')){try{record=JSON.parse(fs.readFileSync(path+'.json','utf8'));}catch(ignore){}}
        if(record&&record.status==='applied'&&record.output===path&&!isAppliedBaseline(path,record)){
          if(!(record.source===cal.source||cal.source===path||(record.parent&&(record.parent.source===cal.source||record.parent.origin===cal.source))||(cal.objectKey&&item&&item.objectKey===cal.objectKey)))throw new Error(t('errCalWrongSource'));
          if(record.crop&&record.crop.width>0)return record.crop.width;
          return record.width||(record.image&&record.image.width)||(cal.sourcePixels&&cal.sourcePixels.width);
        }
        if(path===cal.source||(binding&&binding.source===cal.source&&binding.displayPath===path)){
          return (cal.sourcePixels&&cal.sourcePixels.width)||(sourceImageSize&&sourceImageSize.width)||null;
        }
        /* Place-replaced / applied-baseline: calibration migrated; use current file px. */
        fileW=(sourceImageSize&&sourceImageSize.width)||(record&&record.image&&record.image.width)||0;
        if(!(fileW>0)){
          try{meta=Core.readMetadata(fs,path,window.require('buffer').Buffer);if(meta&&meta.width>0)fileW=meta.width;}catch(ignoreMeta){}
        }
        if(fileW>0)return fileW;
        throw new Error(t('errNoDisplayMapping'));
      }
    });

    /* i18n: seed dynamic strings (after SciScientificPanel.create) */
    try {
      if (byId('previewMessage') && !byId('previewStage').classList.contains('has-image') && !byId('previewStage').classList.contains('has-canvas')) {
        byId('previewMessage').textContent = t('previewEmpty');
      }
      if (byId('metaLine')) { byId('metaLine').textContent = t('metaEmpty'); }
      if (byId('exportCapability')) { byId('exportCapability').textContent = t('exportCap'); }
      if (byId('batchSummary') && !batchReview) { byId('batchSummary').textContent = t('batchSummary'); }
      updateAdjustmentDisplay();
    } catch (ignore) {}

    if (window.PaperFigI18n && window.PaperFigI18n.onChange) {
      window.PaperFigI18n.onChange(function () {
        try {
          if (window.PaperFigI18n) { window.PaperFigI18n.apply(document); }
          refreshBusyLabelsForLang();
          try { refreshChannelColorPresetLabels(); } catch (ignore) {}
          try { syncMarqueeModeUi(); } catch (ignore) {}
          /* Re-apply dynamic labels that overwrite data-i18n nodes. */
          try { updateAdjustmentDisplay(); } catch (ignore) {}
          try {
            var ec = byId('exportCapability');
            if (ec) { ec.textContent = t('exportCap'); }
          } catch (ignore) {}
          try {
            var bs = byId('batchSummary');
            if (bs && !batchReview) { bs.textContent = t('batchSummary'); }
          } catch (ignore) {}
          try {
            if (!fijiPathValue()) { setFijiStatus('neutral', t('notConfigured')); }
            else if (settings.fijiPath) { setFijiStatus('neutral', t('fijiConfiguredUntested')); }
          } catch (ignore) {}
          try {
            var noticeEl = byId('notice');
            if (noticeEl && noticeEl.textContent) {
              noticeEl.textContent = localizeMsg(noticeEl.textContent);
            }
            var foot = byId('footerStatus');
            if (foot && foot.textContent) {
              var locFoot = localizeMsg(foot.textContent);
              foot.textContent = locFoot;
              foot.title = locFoot;
            }
          } catch (ignore) {}
          var msg = byId('previewMessage');
          if (msg && !document.getElementById('previewStage').classList.contains('has-image') && !document.getElementById('previewStage').classList.contains('has-canvas')) {
            msg.textContent = t('previewEmpty');
          }
          var meta = byId('metaLine');
          /* Empty state: re-apply even if data-i18n was stripped by a prior textContent write. */
          if (meta && (!lastBitmapCount || lastBitmapCount < 1)) {
            meta.textContent = t('metaEmpty');
          }
        } catch (ignore) {}
      });
    }
  }
  function readUiCrop(){return {cropLeft:Number(byId('cropLeft').value),cropTop:Number(byId('cropTop').value),cropWidth:Number(byId('cropWidth').value),cropHeight:Number(byId('cropHeight').value)};}

  function previewShapeIdentity(item){
    if(!item)return null;
    return [objectKeyFromItem(item),item.docSessionId||item.docId,item.sourcePath||'',item.embedded?'e':'l',
      (item.matrix||[]).slice(0,4).join(','),Number(item.widthPt).toFixed(3),Number(item.heightPt).toFixed(3)].join('|');
  }
  function previewSourceIdentity(item){
    if(!item||!item.linked||!item.sourcePath)return null;
    try{var path=sourceFor(objectKeyFromItem(item),item.sourcePath);return {key:objectKeyFromItem(item),doc:item.docSessionId||item.docId,link:item.sourcePath,source:path,stamp:sourceStamp(path)};}catch(ignore){return null;}
  }
  function onCropEscape(event){
    if((event.key==='Escape'||event.keyCode===27)&&cropDrag){
      var original=cropStartRect;onCropPointerUp();
      if(original)writeCropRect(original.left,original.top,original.width,original.height);
      if(artboardPreviewActive)scheduleArtboardPreviewRefresh();
      notice(t('cropDragCancelled'));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
}());
