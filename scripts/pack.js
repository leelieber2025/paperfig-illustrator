#!/usr/bin/env node
/* Build dist/paperfig-VERSION.zip with top-level paperfig/ folder (like 0.8.1).
 * Users unzip to paperfig/ with CSXS/manifest.xml inside — no rename required.
 * Keeps package.json for version; excludes .github, .tools, package-lock.json, node_modules, dist, .git.
 * Sets Unix mode 0755 on *.sh / *.command so macOS double-click / ./install works after unzip. */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var root = path.resolve(__dirname, '..');
var ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
require('./sync-release-docs');
var distDir = path.join(root, 'dist');
var stageRoot = path.join(distDir, '_pack_stage');
var stage = path.join(stageRoot, 'paperfig');
var zipName = require('./release-name').releaseZip(ver);
var zipPath = path.join(distDir, zipName);

var EXCLUDE_DIRS = {
  '.git': 1, '.github': 1, '.tools': 1, node_modules: 1, dist: 1, '_pack_stage': 1
};
var EXCLUDE_FILES = {
  'package-lock.json': 1, '.gitignore': 1
};

var EXCLUDE_ROOT_FILES = {
  'index.html': 1, 'i18n.js': 1, 'scientific-panel.js': 1
};

function isExcludedName(n, parent) {
  if (EXCLUDE_DIRS[n] || EXCLUDE_FILES[n]) { return true; }
  if (/\.bak/i.test(n) || n === '.DS_Store' || n === 'Thumbs.db') { return true; }
  if (parent === root && EXCLUDE_ROOT_FILES[n]) { return true; }
  return false;
}

function rmrf(p) {
  if (!fs.existsSync(p)) { return; }
  var st = fs.lstatSync(p);
  if (st.isDirectory()) {
    fs.readdirSync(p).forEach(function (n) { rmrf(path.join(p, n)); });
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

function copyTree(src, dst) {
  var st = fs.lstatSync(src);
  if (st.isDirectory()) {
    if (!fs.existsSync(dst)) { fs.mkdirSync(dst, { recursive: true }); }
    fs.readdirSync(src).forEach(function (n) {
      if (isExcludedName(n, src)) { return; }
      if (n === zipName) { return; }
      copyTree(path.join(src, n), path.join(dst, n));
    });
  } else if (st.isFile()) {
    fs.copyFileSync(src, dst);
  }
}

/* A zip that fails the suite is how one fix shipped the next bug. */
cp.execFileSync(process.execPath, [path.join(root, 'tests/run-suite.js')], { stdio: 'inherit', cwd: root });

if (!fs.existsSync(distDir)) { fs.mkdirSync(distDir, { recursive: true }); }
rmrf(stageRoot);
fs.mkdirSync(stage, { recursive: true });
copyTree(root, stage);

if (fs.existsSync(zipPath)) { fs.unlinkSync(zipPath); }

/* Prefer Python zipfile (sets Unix exec bits); else zip(1); else PowerShell (no exec bits). */
var absZip = path.resolve(zipPath);
var EXEC_RE = /\.(sh|command)$/i;

function tryZipCli() {
  cp.execFileSync('zip', ['-r', '-q', absZip, 'paperfig'], { cwd: stageRoot, stdio: 'inherit' });
  /* zip(1) on Unix preserves modes from stage; on Windows often unavailable. */
}

function tryPythonZip(pythonBin) {
  var py = [
    'import os, zipfile, sys, time',
    'root = sys.argv[1]; out = sys.argv[2]',
    'EXEC_EXT = {".sh", ".command"}',
    'with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:',
    '  for dirpath, dirnames, filenames in os.walk(root):',
    '    for name in filenames:',
    '      full = os.path.join(dirpath, name)',
    '      arc = os.path.relpath(full, os.path.dirname(root)).replace(os.sep, "/")',
    '      st = os.stat(full)',
    '      zi = zipfile.ZipInfo(arc, time.localtime(st.st_mtime)[:6])',
    '      zi.compress_type = zipfile.ZIP_DEFLATED',
    '      zi.create_system = 3  # Unix',
    '      ext = os.path.splitext(name)[1].lower()',
    '      mode = 0o100755 if ext in EXEC_EXT else 0o100644',
    '      zi.external_attr = (mode & 0xFFFF) << 16',
    '      with open(full, "rb") as f:',
    '        z.writestr(zi, f.read())'
  ].join('\n');
  cp.execFileSync(pythonBin, ['-c', py, stage, absZip], { stdio: 'inherit' });
}

function tryPowerShell() {
  cp.execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    "Compress-Archive -Path (Join-Path '" + stageRoot.replace(/'/g, "''") + "' 'paperfig') -DestinationPath '" +
      absZip.replace(/'/g, "''") + "' -Force"
  ], { stdio: 'inherit' });
}

var packed = false;
var errors = [];
var used = '';

/* Python first: reliable Unix modes from Windows builders. */
((process.platform === 'win32') ? ['python', 'python3'] : ['python3', 'python']).forEach(function (bin) {
  if (packed) { return; }
  try { tryPythonZip(bin); packed = true; used = bin; } catch (e) { errors.push(e); }
});
if (!packed) {
  try { tryZipCli(); packed = true; used = 'zip'; } catch (e1) { errors.push(e1); }
}
if (!packed && process.platform === 'win32') {
  try { tryPowerShell(); packed = true; used = 'Compress-Archive'; } catch (e3) { errors.push(e3); }
}
if (!packed) {
  throw errors[errors.length - 1] || new Error('No zip tool available (python/zip/Compress-Archive)');
}

rmrf(stageRoot);
var st = fs.statSync(zipPath);
console.log('Wrote ' + zipPath + ' (' + st.size + ' bytes) via ' + used);
if (used === 'Compress-Archive') {
  console.warn('WARN: Compress-Archive does not set Unix +x on .sh/.command; Mac users may need chmod +x.');
}