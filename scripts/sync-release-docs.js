#!/usr/bin/env node
/* Point README and INSTALL download names at package.json's version. */
'use strict';
var fs = require('fs');
var path = require('path');
var releaseZip = require('./release-name').releaseZip;

var root = path.resolve(__dirname, '..');
var ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
var zip = releaseZip(ver);
var files = ['README.md', 'INSTALL.md', 'HOWTO.md'];

files.forEach(function (name) {
  var file = path.join(root, name);
  var text = fs.readFileSync(file, 'utf8');
  var next = text
    .replace(/paperfig-\d+\.\d+\.\d+\.zip/g, zip)
    .replace(/paperfig-illustrator-\d+\.\d+\.\d+/g, 'paperfig-illustrator-' + ver)
    .replace(/(Release|release) v\d+\.\d+\.\d+/g, function (all, word) { return word + ' v' + ver; })
    .replace(/\*\*Version \d+\.\d+\.\d+\*\*/g, '**Version ' + ver + '**')
    .replace(/Version \*\*\d+\.\d+\.\d+\*\*/g, 'Version **' + ver + '**')
    .replace(/footer \*\*\d+\.\d+\.\d+\*\*/g, 'footer **' + ver + '**')
    .replace(/shows \*\*\d+\.\d+\.\d+\*\*/g, 'shows **' + ver + '**')
    .replace(/页脚应为 \*\*\d+\.\d+\.\d+\*\*/g, '页脚应为 **' + ver + '**')
    .replace(/页脚为 \*\*\d+\.\d+\.\d+\*\*/g, '页脚为 **' + ver + '**')
    .replace(/tag\/v\d+\.\d+\.\d+/g, 'tag/v' + ver);
  if (next !== text) { fs.writeFileSync(file, next); }
});

console.log('release docs use ' + ver + ' / ' + zip);
