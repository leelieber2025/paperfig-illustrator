'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '../client/index.html'), 'utf8');
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];

function node(name, attributes) {
  const attrs = Object.assign({}, attributes);
  const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
  const handlers = {};
  return {
    name, attrs, handlers, checked: false,
    classList: {
      toggle(key, on) { if (on) classes.add(key); else classes.delete(key); },
      contains(key) { return classes.has(key); }
    },
    getAttribute(key) { return attrs[key] == null ? null : attrs[key]; },
    setAttribute(key, value) { attrs[key] = String(value); },
    removeAttribute(key) { delete attrs[key]; },
    addEventListener(key, fn) { handlers[key] = fn; }
  };
}

function boot(saved) {
  const storage = Object.assign({}, saved);
  const tabs = [...html.matchAll(/<button[^>]*class="tab-btn[^"]*"[^>]*data-tab="([^"]+)"[^>]*>/g)]
    .map(m => node(m[1], { 'data-tab': m[1], class: /class="([^"]+)"/.exec(m[0])[1] }));
  const panes = [...html.matchAll(/<div[^>]*class="tab-pane[^"]*"[^>]*data-pane="([^"]+)"[^>]*>/g)]
    .map(m => node(m[1], { 'data-pane': m[1], class: /class="([^"]+)"/.exec(m[0])[1] }));
  const inputs = { showRawFeature: node('raw'), showExportFeature: node('export') };
  const events = [];
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) { return selector === '.tab-pane' ? panes : tabs; },
    querySelector(selector) {
      const tab = /\.tab-bar \[data-tab="([^"]+)"\]/.exec(selector);
      if (tab) return tabs.find(t => t.name === tab[1]) || null;
      const match = /\.tab-pane\[data-pane="([^"]+)"\]/.exec(selector);
      return match ? panes.find(p => p.name === match[1]) || null : null;
    },
    getElementById(id) { return inputs[id] || null; },
    dispatchEvent(event) { events.push(event); }
  };
  const localStorage = {
    getItem(key) { return storage[key] == null ? null : storage[key]; },
    setItem(key, value) { storage[key] = String(value); }
  };
  vm.runInNewContext(script, { document, localStorage, CustomEvent: function (name, options) { return { type: name, detail: options.detail }; } });
  return { storage, tabs, panes, inputs, events };
}

const first = boot({});
assert.deepEqual(first.tabs.map(t => t.name), ['adjust', 'scale', 'geometry', 'crop', 'inset', 'label', 'raw', 'export', 'settings']);
assert(/<div class="tab-tools" role="presentation">[\s\S]*?<\/div>\s*<button[^>]*class="tab-btn tab-settings-btn"[^>]*data-tab="settings"/.test(html));
assert(first.tabs.find(t => t.name === 'raw').classList.contains('hidden'));
assert(first.tabs.find(t => t.name === 'export').classList.contains('hidden'));
assert(first.tabs.find(t => t.name === 'scale').classList.contains('active'));
assert(html.indexOf('id="cropHeading"') > html.indexOf('id="tab-crop"'));
assert(html.indexOf('id="insetGroup"') > html.indexOf('id="tab-inset"'));
assert(html.indexOf('id="fijiSetupDetails"') > html.indexOf('id="tab-settings"'));
first.inputs.showRawFeature.checked = true;
first.inputs.showRawFeature.handlers.change();
assert.equal(first.storage.paperfig_show_raw_v1, '1');
assert(!first.tabs.find(t => t.name === 'raw').classList.contains('hidden'));
first.tabs.find(t => t.name === 'raw').handlers.click.call(first.tabs.find(t => t.name === 'raw'));
assert(first.tabs.find(t => t.name === 'raw').classList.contains('active'));
first.inputs.showRawFeature.checked = false;
first.inputs.showRawFeature.handlers.change();
assert(first.tabs.find(t => t.name === 'scale').classList.contains('active'));
first.inputs.showExportFeature.checked = true;
first.inputs.showExportFeature.handlers.change();
assert(!first.tabs.find(t => t.name === 'export').classList.contains('hidden'));
assert(first.events.some(e => e.type === 'paperfig-feature-visibility' && e.detail.feature === 'raw'));
const savedRaw = boot({ sci_bitmap_active_tab: 'raw' });
assert(savedRaw.tabs.find(t => t.name === 'scale').classList.contains('active'));
console.log('PASS default advanced tab visibility, persisted toggles, crop/inset tabs, and Fiji settings placement');
