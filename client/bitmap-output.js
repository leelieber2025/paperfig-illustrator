/* Durable linked-file paths. Avoid Downloads/Desktop/cloud folders and OS temp.
 * See LICENSE. */
(function (root) {
  'use strict';

  function req(name) {
    if (root && typeof root.require === 'function') { return root.require(name); }
    return require(name);
  }

  function isSlowRelinkDir(dir) {
    var n = String(dir || '').replace(/\\/g, '/').toLowerCase();
    if (!n) { return true; }
    if (/(^|\/)downloads(\/|$)/.test(n)) { return true; }
    if (/(^|\/)desktop(\/|$)/.test(n)) { return true; }
    if (n.indexOf('/onedrive') >= 0 || n.indexOf('/dropbox') >= 0 || n.indexOf('/google drive') >= 0) { return true; }
    if (n.indexOf('/下载') >= 0 || n.indexOf('/桌面') >= 0) { return true; }
    return false;
  }

  function durableFallbackDir() {
    var fs = req('fs');
    var path = req('path');
    var os = req('os');
    var base;
    var env = (typeof process !== 'undefined' && process.env) ? process.env : {};
    try {
      if (env.LOCALAPPDATA) {
        base = path.join(env.LOCALAPPDATA, 'paperfig-out');
      } else if (env.XDG_DATA_HOME) {
        base = path.join(env.XDG_DATA_HOME, 'paperfig-out');
      } else {
        base = path.join(os.homedir(), 'paperfig-out');
      }
    } catch (ignore) {
      base = path.join(os.homedir(), 'paperfig-out');
    }
    if (!fs.existsSync(base)) { fs.mkdirSync(base); }
    return base;
  }

  function durableOutputPath(sourcePath, ext) {
    var fs = req('fs');
    var path = req('path');
    var os = req('os');
    var dir = path.dirname(sourcePath);
    var base = path.basename(sourcePath, path.extname(sourcePath));
    var temp = path.resolve(os.tmpdir());
    var resolved = path.resolve(dir);
    var fallback = durableFallbackDir();
    var isEphemeral = resolved === temp || resolved.indexOf(temp + path.sep) === 0 ||
      resolved.indexOf(path.join(temp, 'paperfig-out')) === 0;
    var useFallback = isEphemeral || isSlowRelinkDir(resolved);
    if (!useFallback) {
      try { fs.accessSync(dir, fs.constants ? fs.constants.W_OK : 2); }
      catch (ignore) { useFallback = true; }
    }
    if (useFallback) { dir = fallback; }
    return path.join(dir, base + '_sci_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + ext);
  }

  /* Write a sibling partial, then rename over the destination. A crash keeps the previous file. */
  function writeJsonAtomic(filePath, value) {
    var fs = req('fs');
    var text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    var partial = filePath + '.partial';
    var fd = fs.openSync(partial, 'w');
    try {
      fs.writeSync(fd, text, 0, 'utf8');
      if (typeof fs.fsyncSync === 'function') { fs.fsyncSync(fd); }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(partial, filePath);
  }

  var api = {
    isSlowRelinkDir: isSlowRelinkDir,
    durableFallbackDir: durableFallbackDir,
    durableOutputPath: durableOutputPath,
    writeJsonAtomic: writeJsonAtomic
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.PaperFigOutput = api; }
})(typeof window !== 'undefined' ? window : global);
