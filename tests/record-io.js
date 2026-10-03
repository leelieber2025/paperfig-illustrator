'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const stamp = require(path.join(root, 'client/file-stamp'));
const output = require(path.join(root, 'client/bitmap-output'));
const sci = require(path.join(root, 'client/scientific-core'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfig-record-'));
const file = path.join(dir, 'src.bin');
fs.writeFileSync(file, Buffer.from('abc'));

stamp.contentStampAsync(file, function (info) {
  assert.equal(info.phase, 'read');
  assert(info.pct >= 0 && info.pct <= 100);
}).then(function (hashed) {
  assert.equal(hashed, stamp.contentStamp(file));
  const dest = path.join(dir, 'out.json');
  fs.writeFileSync(dest, '{"keep":true}');
  output.writeJsonAtomic(dest, { schema: 'sci-raw-display', status: 'applied' });
  assert.equal(fs.existsSync(dest + '.partial'), false);
  assert.equal(JSON.parse(fs.readFileSync(dest, 'utf8')).status, 'applied');
  const d = sci.prepare({
    width: 2, height: 2, bits: 8, names: ['C1'],
    planes: [Uint8Array.from([0, 10, 20, 30])],
    physical: {}, sizeZ: 1, sizeT: 1, seriesCount: 1, series: 0, z: 0, t: 0, reader: 'test'
  });
  return sci.renderAsync(d, null, null, function (info) {
    assert.equal(info.phase, 'process');
  });
}).then(function (im) {
  const sync = sci.render(sci.prepare({
    width: 2, height: 2, bits: 8, names: ['C1'],
    planes: [Uint8Array.from([0, 10, 20, 30])],
    physical: {}, sizeZ: 1, sizeT: 1, seriesCount: 1, series: 0, z: 0, t: 0, reader: 'test'
  }), null, null);
  assert.equal(im.width, sync.width);
  assert.equal(im.compositeClipped, sync.compositeClipped);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS async stamp, atomic record, chunked raw render');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
