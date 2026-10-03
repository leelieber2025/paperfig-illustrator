/* PaperFig: in-panel RGB color picker for CEP.
 * Native <input type=color> opens behind the panel. This intercepts and shows
 * an RGB picker PLUS Fiji / ImageJ Merge Channels presets inside the same popup.
 * Channel rows stay a simple color swatch — presets live in the picker, not the row.
 *
 * Close races guarded: mousedown opens; click only blocks native (no toggle);
 * outside/blur/scroll suppressed briefly after open so the opening gesture
 * and focus(hex) cannot auto-close; re-render sync does not tear down an open popup.
 * Never capture-stopPropagation on the popup itself -- that blocks Fiji preset clicks. */
(function () {
  'use strict';

  var openPopup = null;
  var openInput = null;
  var dragMode = null;
  var state = { h: 0, s: 1, v: 1 };
  /* Ignore outside/blur/scroll closes until this timestamp (ms since epoch). */
  var suppressCloseUntil = 0;
  var OPEN_GUARD_MS = 400;

  function nowMs() {
    return (typeof Date.now === 'function') ? Date.now() : (+new Date());
  }

  function armCloseGuard() {
    suppressCloseUntil = nowMs() + OPEN_GUARD_MS;
  }

  function closeSuppressed() {
    return nowMs() < suppressCloseUntil;
  }

  function t(key) {
    try {
      if (window.PaperFigI18n && typeof window.PaperFigI18n.t === 'function') {
        return window.PaperFigI18n.t(key);
      }
    } catch (ignore) {}
    return key;
  }

  function fire(el, type) {
    var evt;
    try { evt = new Event(type, { bubbles: true }); }
    catch (err) { evt = document.createEvent('HTMLEvents'); evt.initEvent(type, true, false); }
    el.dispatchEvent(evt);
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) { return lo; }
    if (n < lo) { return lo; }
    if (n > hi) { return hi; }
    return n;
  }

  function hexNormalize(h) {
    h = String(h || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(h)) { return h; }
    if (/^[0-9a-f]{6}$/.test(h)) { return '#' + h; }
    if (/^#[0-9a-f]{3}$/.test(h)) {
      return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    return null;
  }

  function hexToRgb(hex) {
    hex = hexNormalize(hex) || '#ffffff';
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }

  function rgbToHex(r, g, b) {
    function byte(v) {
      v = clamp(Math.round(v), 0, 255);
      return (v < 16 ? '0' : '') + v.toString(16);
    }
    return '#' + byte(r) + byte(g) + byte(b);
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) {
      if (max === r) { h = ((g - b) / d + (g < b ? 6 : 0)) / 6; }
      else if (max === g) { h = ((b - r) / d + 2) / 6; }
      else { h = ((r - g) / d + 4) / 6; }
    }
    return { h: h, s: s, v: v };
  }

  function hsvToRgb(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t_ = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t_; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t_; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t_; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  function fijiPresets() {
    var W = window.SciBitmapWorkflow;
    if (W && typeof W.channelColorPresets === 'function') { return W.channelColorPresets(); }
    return [
      { id: 'red', hex: '#ff0000' }, { id: 'green', hex: '#00ff00' }, { id: 'blue', hex: '#0000ff' },
      { id: 'gray', hex: '#ffffff' }, { id: 'cyan', hex: '#00ffff' }, { id: 'magenta', hex: '#ff00ff' },
      { id: 'yellow', hex: '#ffff00' }
    ];
  }

  function syncSwatch(input) {
    if (!input) { return; }
    var hex = hexNormalize(input.value) || '#000000';
    input.value = hex;
    input.style.backgroundColor = hex;
    input.setAttribute('data-pf-hex', hex);
  }

  function closePicker(commit) {
    dragMode = null;
    if (openPopup && openPopup.parentNode) { openPopup.parentNode.removeChild(openPopup); }
    if (commit && openInput) {
      fire(openInput, 'change');
      syncSwatch(openInput);
    }
    openPopup = null;
    openInput = null;
  }

  function paintSv(canvas, hue) {
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    var pure = hsvToRgb(hue, 1, 1), grd;
    grd = ctx.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, 'rgb(' + pure.r + ',' + pure.g + ',' + pure.b + ')');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, '#000000');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }

  function paintHue(canvas) {
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, i, rgb, grd;
    grd = ctx.createLinearGradient(0, 0, w, 0);
    for (i = 0; i <= 6; i++) {
      rgb = hsvToRgb(i / 6, 1, 1);
      grd.addColorStop(i / 6, 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
    }
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }

  function placePopup(popup, anchor) {
    var rect = anchor.getBoundingClientRect(), pad = 4;
    document.body.appendChild(popup);
    var pw = popup.offsetWidth || 220, ph = popup.offsetHeight || 280;
    var left = rect.left, top = rect.bottom + 4;
    if (top + ph > window.innerHeight - pad && rect.top > ph + pad) { top = rect.top - ph - 4; }
    if (left + pw > window.innerWidth - pad) { left = Math.max(pad, window.innerWidth - pw - pad); }
    if (left < pad) { left = pad; }
    if (top < pad) { top = pad; }
    popup.style.left = Math.round(left) + 'px';
    popup.style.top = Math.round(top) + 'px';
  }

  function openFor(input) {
    closePicker(false);
    if (!input || input.disabled) { return; }
    openInput = input;
    var rgb0 = hexToRgb(input.value);
    state = rgbToHsv(rgb0.r, rgb0.g, rgb0.b);

    var popup = document.createElement('div');
    popup.className = 'pf-color-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', t('channelColorPresetsAria'));
    /* Do NOT capture-stopPropagation on the popup: that runs before child
     * targets and blocks Fiji preset / OK / SV / hue mousedown handlers.
     * Document outside-close already ignores events when openPopup.contains(target). */

    /* Fiji presets INSIDE the picker window */
    var presetRow = document.createElement('div');
    presetRow.className = 'pf-color-presets';
    presetRow.setAttribute('role', 'group');
    presetRow.setAttribute('aria-label', t('channelColorPresetsAria'));
    var presetLabel = document.createElement('div');
    presetLabel.className = 'pf-color-presets-label';
    presetLabel.textContent = t('fijiColorPresets');
    if (presetLabel.textContent === 'fijiColorPresets') { presetLabel.textContent = 'Fiji'; }
    popup.appendChild(presetLabel);
    var presetBtns = [];
    fijiPresets().forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pf-color-preset' + (p.id === 'gray' ? ' preset-gray' : '');
      /* Clear global button gradient (background-image); gray keeps CSS checkerboard. */
      if (p.id !== 'gray') { btn.style.backgroundImage = 'none'; }
      btn.style.backgroundColor = p.hex;
      btn._presetHex = p.hex;
      var labelKey = 'colorPreset' + p.id.charAt(0).toUpperCase() + p.id.slice(1);
      btn.title = t(labelKey);
      btn.setAttribute('aria-label', t(labelKey));
      function pickPreset(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        applyHex(p.hex);
      }
      /* mousedown for immediate feedback; click covers keyboard / CEP activation */
      btn.addEventListener('mousedown', pickPreset);
      btn.addEventListener('click', pickPreset);
      presetRow.appendChild(btn);
      presetBtns.push(btn);
    });
    popup.appendChild(presetRow);

    var sv = document.createElement('canvas');
    sv.className = 'pf-color-sv';
    sv.width = 180;
    sv.height = 110;
    popup.appendChild(sv);

    var hue = document.createElement('canvas');
    hue.className = 'pf-color-hue';
    hue.width = 180;
    hue.height = 12;
    popup.appendChild(hue);

    var rgbRow = document.createElement('div');
    rgbRow.className = 'pf-color-rgb-row';
    var rIn = numInput('R', 0, 255);
    var gIn = numInput('G', 0, 255);
    var bIn = numInput('B', 0, 255);
    rgbRow.appendChild(rIn.wrap);
    rgbRow.appendChild(gIn.wrap);
    rgbRow.appendChild(bIn.wrap);
    popup.appendChild(rgbRow);

    var hexRow = document.createElement('div');
    hexRow.className = 'pf-color-hex-row';
    var preview = document.createElement('span');
    preview.className = 'pf-color-preview';
    var hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'pf-color-hex';
    hexInput.maxLength = 7;
    hexInput.setAttribute('aria-label', 'Hex');
    hexInput.addEventListener('change', function () {
      var h = hexNormalize(hexInput.value);
      if (h) { applyHex(h); }
      else { refreshUi(); }
    });
    hexInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        var h = hexNormalize(hexInput.value);
        if (h) { applyHex(h); closePicker(true); }
      }
    });
    hexRow.appendChild(preview);
    hexRow.appendChild(hexInput);
    popup.appendChild(hexRow);

    var actions = document.createElement('div');
    actions.className = 'pf-color-actions';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'pf-color-ok';
    ok.textContent = 'OK';
    function commitOk(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      closePicker(true);
    }
    ok.addEventListener('mousedown', commitOk);
    ok.addEventListener('click', commitOk);
    actions.appendChild(ok);
    popup.appendChild(actions);

    function numInput(label, min, max) {
      var wrap = document.createElement('label');
      wrap.className = 'pf-color-rgb';
      var span = document.createElement('span');
      span.textContent = label;
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.min = String(min);
      inp.max = String(max);
      inp.step = '1';
      wrap.appendChild(span);
      wrap.appendChild(inp);
      inp.addEventListener('change', function () {
        var r = clamp(rIn.inp.value, 0, 255);
        var g = clamp(gIn.inp.value, 0, 255);
        var b = clamp(bIn.inp.value, 0, 255);
        applyHex(rgbToHex(r, g, b));
      });
      return { wrap: wrap, inp: inp };
    }

    function syncPresetPressed(hex) {
      var h = String(hex || '').toLowerCase();
      presetBtns.forEach(function (b) {
        b.setAttribute('aria-pressed', b._presetHex === h ? 'true' : 'false');
      });
    }

    function refreshUi() {
      var rgb = hsvToRgb(state.h, state.s, state.v);
      var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      paintSv(sv, state.h);
      paintHue(hue);
      var ctx = sv.getContext('2d');
      ctx.strokeStyle = state.v > 0.55 ? '#111' : '#eee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(state.s * sv.width, (1 - state.v) * sv.height, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx = hue.getContext('2d');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(state.h * hue.width, 0);
      ctx.lineTo(state.h * hue.width, hue.height);
      ctx.stroke();
      preview.style.backgroundColor = hex;
      hexInput.value = hex;
      rIn.inp.value = String(rgb.r);
      gIn.inp.value = String(rgb.g);
      bIn.inp.value = String(rgb.b);
      syncPresetPressed(hex);
    }

    function applyHex(hex) {
      hex = hexNormalize(hex);
      if (!hex || !openInput) { return; }
      var rgb = hexToRgb(hex);
      state = rgbToHsv(rgb.r, rgb.g, rgb.b);
      openInput.value = hex;
      syncSwatch(openInput);
      fire(openInput, 'input');
      fire(openInput, 'change');
      refreshUi();
    }

    function applyState() {
      var rgb = hsvToRgb(state.h, state.s, state.v);
      var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      if (!openInput) { return; }
      openInput.value = hex;
      syncSwatch(openInput);
      fire(openInput, 'input');
      refreshUi();
    }

    function svFromEvent(e) {
      var r = sv.getBoundingClientRect();
      state.s = clamp((e.clientX - r.left) / r.width, 0, 1);
      state.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
      applyState();
    }
    function hueFromEvent(e) {
      var r = hue.getBoundingClientRect();
      state.h = clamp((e.clientX - r.left) / r.width, 0, 1);
      applyState();
    }

    sv.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation(); dragMode = 'sv'; svFromEvent(e);
    });
    hue.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation(); dragMode = 'hue'; hueFromEvent(e);
    });

    popup._pfOnDrag = function (e) {
      if (dragMode === 'sv') { svFromEvent(e); }
      else if (dragMode === 'hue') { hueFromEvent(e); }
    };

    refreshUi();
    placePopup(popup, input);
    openPopup = popup;
    armCloseGuard();
    /* Defer focus so CEP window blur from the opening click does not race-close. */
    setTimeout(function () {
      if (openPopup !== popup) { return; }
      try { hexInput.focus(); hexInput.select(); } catch (ignore) {}
      armCloseGuard();
    }, 0);
  }

  document.addEventListener('mousemove', function (e) {
    if (!dragMode || !openPopup || !openPopup._pfOnDrag) { return; }
    e.preventDefault();
    openPopup._pfOnDrag(e);
  }, true);

  document.addEventListener('mouseup', function () {
    if (dragMode) {
      dragMode = null;
      if (openInput) { fire(openInput, 'change'); }
    }
  }, true);

  function isColorInput(el) {
    return !!(el && el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'color');
  }

  /* Open / toggle only on mousedown — never on the trailing click (that was the auto-close race). */
  function openOrToggle(el) {
    if (openInput === el && openPopup) { closePicker(true); return; }
    openFor(el);
  }

  document.addEventListener('mousedown', function (e) {
    var el = e.target;
    if (isColorInput(el)) {
      e.preventDefault();
      e.stopPropagation();
      openOrToggle(el);
      return;
    }
    if (openPopup && el && !openPopup.contains(el) && el !== openInput) {
      if (closeSuppressed()) { return; }
      closePicker(true);
    }
  }, true);

  /* Block native color UI on click/focus without toggling the in-panel picker. */
  document.addEventListener('click', function (e) {
    if (!isColorInput(e.target)) { return; }
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.keyCode === 27) && openPopup) { closePicker(true); }
  }, true);

  window.addEventListener('resize', function () {
    if (openPopup && !closeSuppressed()) { closePicker(true); }
  });
  window.addEventListener('blur', function () {
    /* CEP often blurs the window when focusing an in-panel input after open. */
    if (!openPopup || closeSuppressed()) { return; }
    setTimeout(function () {
      if (!openPopup || closeSuppressed()) { return; }
      try {
        if (document.hasFocus && document.hasFocus()) { return; }
      } catch (ignore) {}
      closePicker(true);
    }, 0);
  });
  document.addEventListener('scroll', function (e) {
    if (!openPopup || closeSuppressed()) { return; }
    /* Ignore scrolls that originate inside the popup (RGB number steppers, etc.). */
    if (openPopup.contains && e.target && openPopup.contains(e.target)) { return; }
    closePicker(true);
  }, true);
  document.addEventListener('paperfig-tab', function () { closePicker(true); });

  function enhanceAll() {
    Array.prototype.forEach.call(document.querySelectorAll('input[type=color]'), syncSwatch);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceAll);
  } else {
    enhanceAll();
  }
  /* Re-sync after late panel init / channelsToUi so default R/G/B swatches paint. */
  setTimeout(enhanceAll, 0);
  setTimeout(enhanceAll, 50);

  window.PaperFigColorPicker = {
    sync: syncSwatch,
    syncAll: enhanceAll,
    open: openFor,
    close: function () { closePicker(true); }
  };
})();
