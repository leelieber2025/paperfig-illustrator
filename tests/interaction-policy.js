#!/usr/bin/env node
'use strict';
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '../client/interaction-policy.js'));
const P = global.PaperFigInteraction;

const idle = { button: 0, space: false, endpointPick: false, samplePick: false, straighten: false, marqueeMode: 'crop', cropArmed: false };
assert.strictEqual(P.previewPointerAction(idle), 'pan');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { endpointPick: true })), 'pick');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { endpointPick: true, space: true })), 'pan');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { endpointPick: true, button: 1 })), 'pan');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { marqueeMode: 'inset' })), 'marquee');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { cropArmed: true })), 'marquee');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { samplePick: true })), 'marquee');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { altKey: true, hasPreview: true })), 'pan');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { cropArmed: true, altKey: true, hasPreview: true })), 'compare');
assert.strictEqual(P.previewPointerAction(Object.assign({}, idle, { altKey: true, hasPreview: true, endpointPick: true })), 'pick');

assert.strictEqual(P.shouldCancelEndpointPick(true, null, 'a'), false);
assert.strictEqual(P.shouldCancelEndpointPick(true, { objectKey: '' }, 'a'), false);
assert.strictEqual(P.shouldCancelEndpointPick(true, { objectKey: 'a' }, ''), false);
assert.strictEqual(P.shouldCancelEndpointPick(true, { objectKey: 'a' }, 'a'), false);
assert.strictEqual(P.shouldCancelEndpointPick(true, { objectKey: 'b' }, 'a'), true);

var user = { id: 'click', background: false };
var poll = { id: 'poll', background: true };
var parked = P.acceptHostJob([poll], false, user);
assert.strictEqual(parked.accepted, true);
assert.strictEqual(parked.queue[0], user);
assert.strictEqual(parked.dropped.length, 1);
assert.strictEqual(parked.dropped[0], poll);
var blocked = P.acceptHostJob([], true, poll);
assert.strictEqual(blocked.accepted, false);
assert.strictEqual(blocked.queue.length, 0);
var queued = P.acceptHostJob([], false, poll);
assert.strictEqual(queued.accepted, true);
assert.strictEqual(queued.queue[0], poll);

const html = require('fs').readFileSync(path.join(__dirname, '../client/index.html'), 'utf8');
const scripts = [];
html.replace(/<script src="([^"]+)"/g, function (_, src) { scripts.push(src.split('?')[0]); return _; });
function before(a, b) {
  assert.ok(scripts.indexOf(a) >= 0 && scripts.indexOf(a) < scripts.indexOf(b), a + ' must load before ' + b);
}
before('interaction-policy.js', 'scientific-panel.js');
before('interaction-policy.js', 'bitmap-panel-marquee.js');
before('interaction-policy.js', 'bitmap-panel.js');

console.log('interaction policy checks passed');
