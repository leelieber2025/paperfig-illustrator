#!/usr/bin/env node
'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const always = [
  'tests/regression.js',
  'tests/scientific.js',
  'tests/raw-service.js',
  'tests/calibration-guard.js',
  'tests/interaction-policy.js',
  'tests/record-io.js'
];
const optional = [
  ['tests/workflow.js', 'sharp'],
  ['tests/interaction.js', '@napi-rs/canvas'],
  ['tests/integration.js', '@napi-rs/canvas'],
  ['tests/scientific-integration.js', '@napi-rs/canvas']
];

function run(file) {
  cp.execFileSync(process.execPath, [path.join(root, file)], { stdio: 'inherit', cwd: root });
}

/* Syntax-check every panel script before behavior tests. A parse error used to show up later as a dead button. */
fs.readdirSync(path.join(root, 'client')).filter(function (name) {
  return name.slice(-3) === '.js';
}).forEach(function (name) {
  cp.execFileSync(process.execPath, ['--check', path.join(root, 'client', name)], { stdio: 'inherit' });
});

always.forEach(run);
optional.forEach(function (pair) {
  const file = pair[0];
  const dep = pair[1];
  try {
    require.resolve(dep, { paths: [root] });
  } catch (err) {
    console.log('SKIP ' + file + ' — optional dependency ' + dep + ' is not installed (npm install)');
    return;
  }
  run(file);
});
console.log('npm test finished');
