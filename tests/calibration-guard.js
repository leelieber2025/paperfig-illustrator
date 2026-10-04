'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfig-cal-'));
const storage = {};
const file = path.join(dir, 'img.bin');
fs.writeFileSync(file, Buffer.from('pixels'));
function cls() {
  const set = new Set();
  return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
function element() {
  return {
    value: '', checked: false, disabled: false, textContent: '', classList: cls(), options: [],
    style: {}, dataset: {}, parentElement: { classList: cls() },
    addEventListener() {}, removeEventListener() {}, appendChild(child) { this.options.push(child); }, remove(i) { this.options.splice(i, 1); },
    setAttribute() {}, getAttribute() { return null; }, click() {}
  };
}
const els = new Proxy({}, { get(t, id) { if (!t[id]) t[id] = element(); return t[id]; } });
const ctx = {
  console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Buffer: Buffer,
  localStorage: {
    getItem(k) { return storage[k] == null ? null : storage[k]; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; }
  },
  document: {
    addEventListener() {},
    getElementById(id) { return els[id]; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    documentElement: {}
  },
  window: {
    require: function (name) {
      if (name === 'os') {
        return Object.assign({}, require('os'), { homedir: function () { return dir; }, tmpdir: function () { return dir; } });
      }
      return require(name);
    },
    addEventListener() {},
    confirm: function () { return ctx.window._confirm; }
  }
};
ctx.window.window = ctx.window;
vm.createContext(ctx);
ctx.window.SciScientific = require(path.join(root, 'client/scientific-core.js'));
['file-stamp.js', 'i18n.js', 'raw-bridge.js', 'interaction-policy.js', 'scientific-panel.js'].forEach(function (name) {
  vm.runInContext(fs.readFileSync(path.join(root, 'client', name), 'utf8'), ctx);
});
const info = { objectKey: 'obj-a', sourcePath: file, linked: true, typename: 'PlacedItem' };
ctx.window._size = { width: 100, height: 50 };
els.scaleMethod.value = 'two-point';
els.scaleUnit.value = 'um';
const api = ctx.window.SciScientificPanel.create({
  byId: function (id) { return els[id]; },
  info: function () { return info; },
  sourcePath: function () { return file; },
  sourceSize: function () { return ctx.window._size; },
  busy: function () { return false; },
  notice: function (m) { ctx.window._notice = m; },
  host: function () { return Promise.resolve({ fonts: [] }); },
  setBusy: function () {},
  refresh: function () {},
  extensionPath: root,
  fiji: function () { return ''; }
});
const saved = ctx.window.SciScientific.calibration({ method: 'field', width: 200, unit: 'um', pixelsX: 100, pixelsY: 50 });
saved.source = file;
saved.sourceStamp = ctx.window.PaperFigFileStamp.contentStamp(file);
saved.sourcePixels = { width: 100, height: 50 };
saved.objectKey = 'obj-a';
storage.sci_calibrations_v1 = JSON.stringify({ 'obj-a': saved });
storage.sci_calibration_last_v1 = JSON.stringify(saved);
assert(saved.umPerPixelX > 0, 'legacy field calibration remains readable');
const sidecar = file + '.json';
fs.writeFileSync(sidecar, JSON.stringify({ calibration: saved }));
api.clearCalibration();
const map = JSON.parse(storage.sci_calibrations_v1);
assert.equal(map['obj-a'].cleared, true);
assert.equal(api.lookupCalibration(info), null);
assert.equal(JSON.parse(storage.sci_calibrations_v1)['obj-a'].cleared, true, 'status refresh must not revive the sidecar');
ctx.window._confirm = false;
ctx.window._size = { width: 40, height: 20 };
api.reuseLastCalibration();
assert.equal(api.lookupCalibration(info), null, 'size mismatch without confirm stays cleared');
ctx.window._confirm = true;
api.reuseLastCalibration();
const reused = api.lookupCalibration(info);
assert(reused && reused.umPerPixelX === saved.umPerPixelX);
assert.equal(reused.originSourcePixels.width, 100);
assert.equal(reused.sourcePixels.width, 40);
assert.equal(reused.sourceStamp.indexOf('sha256:'), 0);
const touched = new Date(Date.now() + 5000);
fs.utimesSync(file, touched, touched);
assert.equal(ctx.window.PaperFigFileStamp.matches(file, reused.sourceStamp), true);
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS calibration clear tombstone, reuse confirm, content hash');
