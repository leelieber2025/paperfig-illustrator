'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
const picker = fs.readFileSync(path.join(root, 'client/color-picker.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'client/scientific-panel.js'), 'utf8');

assert(/id="figureLabelPosition"[^>]*><option value="outside-top-left"[^>]*selected/.test(html));
assert(/id="figureLabelMargin"[^>]*min="-200"/.test(html));
assert(/id="figureLabelVerticalOffset"[^>]*min="-200"/.test(html));
assert(/id="figureLabelColor"[^>]*value="#000000"/.test(html));
assert(/id="figureStainPosition"[^>]*>[\s\S]*?value="top-left"[^>]*selected/.test(html));
assert(/id="figureStainFont"/.test(html) && /id="figureStainStyle"/.test(html) && /id="figureStainSize"/.test(html));
assert(/id: 'black', hex: '#000000'/.test(picker) && /id: 'white', hex: '#ffffff'/.test(picker));
assert(/verticalOffset:Number\(\$\('figureLabelVerticalOffset'\)\.value\)/.test(panel));

const groups = [];
const layer = { typename: 'Layer' };
const image = { typename: 'PlacedItem', parent: layer, geometricBounds: [0, 100, 100, 0] };
const doc = { selection: [image], groupItems: groups };
groups.add = function () {
  const group = {
    typename: 'GroupItem', parent: layer, pageItems: [], name: '', note: '', removed: false,
    pathItems: { add() { return { setEntirePath(points) { this.points = points; } }; } },
    textFrames: { add() { const frame = { width: 20, height: 12, textRange: { characterAttributes: {} } }; (group.texts ||= []).push(frame); return frame; } },
    move(relative, placement) { this.parent = placement === 'end' ? relative : relative.parent; },
    zOrder() {},
    remove() { this.removed = true; const i = groups.indexOf(this); if (i >= 0) groups.splice(i, 1); }
  };
  groups.push(group);
  return group;
};
image.move = function (relative, placement) { this.parent = placement === 'end' ? relative : relative.parent; };
const fonts = [
  { family: 'Arial', name: 'ArialMT', style: 'Regular' },
  { family: 'Arial', name: 'Arial-BoldMT', style: 'Bold' },
  { family: 'Song', name: 'Song', style: 'Regular' }
];
const ctx = {
  app: { activeDocument: doc, textFonts: fonts, redraw() {} },
  ElementPlacement: { PLACEBEFORE: 'before', PLACEAFTER: 'after', PLACEATEND: 'end' },
  ZOrderMethod: { BRINGTOFRONT: 'front' },
  RGBColor: function () {},
  sciBitmapAssertLock() { return { objectKey: 'image-1', sourcePath: '/image.png' }; },
  sciBitmapFirstBitmapEntry() { return { item: image }; },
  sciBitmapCollectBitmaps(selection) {
    const found = [];
    function visit(item) {
      if (item.typename === 'PlacedItem' || item.typename === 'RasterItem') found.push({ item });
      else if (item.pageItems) item.pageItems.forEach(visit);
    }
    selection.forEach(visit);
    return found;
  },
  sciBitmapJSON: JSON.stringify,
  sciBitmapResult: JSON.stringify,
  sciBitmapFailure(error) { return JSON.stringify({ ok: false, error: error.message }); },
  sciBitmapHexColor(hex) { return { hex }; }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'jsx/science.jsx'), 'utf8'), ctx);
ctx.sciBitmapCorners = () => [[0, 100], [100, 100], [100, 0], [0, 0]];
ctx.sciBitmapHexColor = hex => ({ hex });

const available = JSON.parse(ctx.sciBitmapFigureFontFamilies());
assert.deepEqual(available.fonts.map(font => font.name), ['Arial-BoldMT', 'ArialMT', 'Song']);
assert.equal(ctx.sciBitmapFigureFont('', 'regular'), fonts[0]);
assert.equal(ctx.sciBitmapFigureFont('', 'bold'), fonts[1]);
assert.equal(ctx.sciBitmapFigureFont('Arial', 'bold'), fonts[1]);
assert.equal(ctx.sciBitmapFigureFont('Arial', 'regular'), fonts[0]);
assert.equal(ctx.sciBitmapFigureFont('Arial-BoldMT', 'regular'), fonts[1]);
assert.equal(ctx.sciBitmapFigureFont('Song', 'bold'), fonts[2]);

function label(overrides) {
  const spec = Object.assign({ text: 'A', font: '', style: 'regular', size: 14, margin: 8, verticalOffset: 0, position: 'outside-top-left', color: '#000000' }, overrides);
  const result = JSON.parse(ctx.sciBitmapFigureLabel('{}', JSON.stringify(spec)));
  assert(result.ok, result.error);
  return groups.filter(g => g.note.indexOf('SCI_FIGLABEL_V1:') === 0)[0].textFrames.added;
}
groups.add = (function (add) {
  return function () {
    const group = add();
    const original = group.textFrames.add;
    group.textFrames.add = function () { const frame = original(); if (!group.textFrames.added) group.textFrames.added = frame; (group.textFrames.items ||= []).push(frame); return frame; };
    return group;
  };
})(groups.add);

let frame = label({});
assert.deepEqual([...frame.position], [8, 120]);
assert.equal(frame.textRange.characterAttributes.fillColor.hex, '#000000');
frame = label({ margin: -12, verticalOffset: -15, font: 'Arial', style: 'bold' });
assert.deepEqual([...frame.position], [-12, 105]);
assert.equal(frame.textRange.characterAttributes.textFont, fonts[1]);
frame = label({ font: '', style: 'bold' });
assert.equal(frame.textRange.characterAttributes.textFont, fonts[1]);
assert.equal(frame.textRange.characterAttributes.fauxBold, undefined);
frame = label({ font: 'Song', style: 'bold' });
assert.equal(frame.textRange.characterAttributes.textFont, fonts[2]);
assert.equal(frame.textRange.characterAttributes.fauxBold, true);
frame = label({ font: 'Arial-BoldMT', style: 'regular' });
assert.equal(frame.textRange.characterAttributes.textFont, fonts[1]);
assert.equal(frame.textRange.characterAttributes.fauxBold, undefined);
assert.equal(groups.filter(g => g.note.indexOf('SCI_FIGLABEL_V1:') === 0).length, 1);
frame = label({ stains: [
  { text: 'TUBB3', color: '#ff0000' },
  { text: 'TX', color: '#00ff00' },
  { text: 'RUNX2', color: '#ffffff' }
], stainFont: 'Arial', stainStyle: 'bold', stainSize: 12, stainPosition: 'top-left', stainMargin: 8, stainVerticalOffset: 0 });
let stainGroup = groups.filter(g => g.note.indexOf('SCI_FIGLABEL_V1:') === 0)[0];
assert.deepEqual(stainGroup.textFrames.items.map(f => f.contents), ['A', 'TUBB3', 'TX', 'RUNX2']);
assert.deepEqual(stainGroup.textFrames.items.slice(1).map(f => [...f.position]), [[8, 92], [34, 92], [60, 92]]);
assert.deepEqual(stainGroup.textFrames.items.slice(1).map(f => f.textRange.characterAttributes.fillColor.hex), ['#ff0000', '#00ff00', '#ffffff']);
assert(stainGroup.textFrames.items.slice(1).every(f => f.textRange.characterAttributes.textFont === fonts[1] && f.textRange.characterAttributes.size === 12));
frame = label({ stains: [
  { text: 'TUBB3', color: '#ff0000' },
  { text: '', color: '#00ff00' },
  { text: 'RUNX2', color: '#ffffff' }
], stainSize: 12, stainPosition: 'outside-bottom-right', stainMargin: -5, stainVerticalOffset: 3 });
stainGroup = groups.filter(g => g.note.indexOf('SCI_FIGLABEL_V1:') === 0)[0];
assert.deepEqual(stainGroup.textFrames.items.map(f => f.contents), ['A', 'TUBB3', 'RUNX2']);
assert.deepEqual(stainGroup.textFrames.items.slice(1).map(f => [...f.position]), [[59, -5], [85, -5]]);
assert.equal(groups.filter(g => g.note.indexOf('SCI_FIGLABEL_V1:') === 0).length, 1);
const bad = JSON.parse(ctx.sciBitmapFigureLabel('{}', JSON.stringify({ text: 'A', size: 14, margin: 201, verticalOffset: 0, position: 'outside-top-left', color: '#000000' })));
assert.equal(bad.ok, false);

const scale = { fraction: 0.2, lineWidth: 1, fontSize: 9, margin: 5, position: 'bottom-left', color: '#000000', label: '20 µm', includeText: true };
let result = JSON.parse(ctx.sciBitmapScaleBar('{}', JSON.stringify(scale)));
assert(result.ok, result.error);
assert.equal(groups.filter(g => g.note.indexOf('SCI_SCALE_V1:') === 0)[0].texts[0].textRange.characterAttributes.textFont, fonts[0]);
const wrapper = image.parent;
assert.equal(wrapper.typename, 'GroupItem');
assert.equal(groups.filter(g => g.note.indexOf('SCI_SCALE_V1:') === 0)[0].parent, wrapper);
result = JSON.parse(ctx.sciBitmapScaleBar('{}', JSON.stringify(scale)));
assert(result.ok, result.error);
assert.equal(image.parent, wrapper);
assert.equal(groups.filter(g => g.note.indexOf('SCI_SCALE_V1:') === 0).length, 1);
wrapper.clipped = true;
result = JSON.parse(ctx.sciBitmapScaleBar('{}', JSON.stringify(scale)));
assert.equal(result.ok, false);
assert(/clipping group/.test(result.error));
wrapper.clipped = false;
doc.selection = [{ typename: 'GroupItem', pageItems: [image, { typename: 'PlacedItem' }] }];
result = JSON.parse(ctx.sciBitmapScaleBar('{}', JSON.stringify(scale)));
assert.equal(result.ok, false);
assert(/exactly one image/.test(result.error));

console.log('PASS label defaults, signed offsets, fonts, replacement, scale grouping and guards');
