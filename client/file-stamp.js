/* Content hash for source identity. mtime is only a cache key.
 * A legacy "size:mtime" stamp is not proof the bytes are unchanged.
 * Same size with different bytes used to match. Those records stay
 * "legacy" until the user confirms and the stamp is upgraded to sha256.
 * See LICENSE. */
(function (root) {
  'use strict';
  var cache = {};

  function req(name) {
    if (root && typeof root.require === 'function') { return root.require(name); }
    return require(name);
  }

  function fileTimes(filePath) {
    var fs = req('fs');
    var st = fs.statSync(filePath);
    var mtime = st.mtimeMs != null ? Number(st.mtimeMs) : Number(new Date(st.mtime).getTime());
    return { size: Number(st.size), mtime: mtime, ctime: Number(st.ctimeMs != null ? st.ctimeMs : new Date(st.ctime).getTime()), ino: st.ino, dev: st.dev };
  }

  function hashFdSync(fs, crypto, fd) {
    var hash = crypto.createHash('sha256');
    var buf = Buffer.alloc(1024 * 1024);
    var n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
    }
    return 'sha256:' + hash.digest('hex');
  }

  function sameFile(a, b) {
    return a.size === b.size && a.mtime === b.mtime && a.ctime === b.ctime && a.ino === b.ino && a.dev === b.dev;
  }

  function remember(filePath, times, stamp) {
    cache[filePath] = { size: times.size, mtime: times.mtime, ctime: times.ctime, ino: times.ino, dev: times.dev, stamp: stamp };
    return stamp;
  }

  function contentStamp(filePath, fresh) {
    var fs = req('fs');
    var crypto = req('crypto');
    var times = fileTimes(filePath);
    var hit = cache[filePath];
    if (!fresh && hit && sameFile(hit, times)) { return hit.stamp; }
    var fd = fs.openSync(filePath, 'r');
    try {
      var stamp = hashFdSync(fs, crypto, fd);
      if (!sameFile(times, fileTimes(filePath))) { throw new Error('Source changed while hashing'); }
      return remember(filePath, times, stamp);
    } finally {
      fs.closeSync(fd);
    }
  }

  /* Chunked read so the panel can paint read progress. Cache matches contentStamp. */
  function contentStampAsync(filePath, onProgress) {
    return new Promise(function (resolve, reject) {
      var fs;
      var crypto;
      var times;
      var hit;
      try {
        fs = req('fs');
        crypto = req('crypto');
        times = fileTimes(filePath);
        hit = cache[filePath];
      } catch (err) {
        reject(err);
        return;
      }
      if (hit && sameFile(hit, times)) {
        if (onProgress) { onProgress({ phase: 'read', done: times.size, total: times.size, pct: 100 }); }
        resolve(hit.stamp);
        return;
      }
      fs.open(filePath, 'r', function (openErr, fd) {
        if (openErr) { reject(openErr); return; }
        var hash = crypto.createHash('sha256');
        var buf = Buffer.alloc(1024 * 1024);
        var done = 0;
        function finish(err, stamp) {
          fs.close(fd, function () {
            if (err) { reject(err); return; }
            try {
              if (!sameFile(times, fileTimes(filePath))) { throw new Error('Source changed while hashing'); }
              resolve(remember(filePath, times, stamp));
            } catch (changed) { reject(changed); }
          });
        }
        function readChunk() {
          fs.read(fd, buf, 0, buf.length, null, function (readErr, n) {
            if (readErr) { finish(readErr); return; }
            if (!n) {
              if (onProgress) { onProgress({ phase: 'read', done: times.size, total: times.size, pct: 100 }); }
              finish(null, 'sha256:' + hash.digest('hex'));
              return;
            }
            hash.update(n === buf.length ? buf : buf.subarray(0, n));
            done += n;
            if (onProgress) {
              onProgress({
                phase: 'read',
                done: done,
                total: times.size,
                pct: times.size ? Math.min(100, Math.round(100 * done / times.size)) : 100
              });
            }
            setTimeout(readChunk, 0);
          });
        }
        readChunk();
      });
    });
  }

  function isLegacyStamp(stored) {
    return /^\d+:\d+$/.test(String(stored || ''));
  }

  /* match: sha256 equals current bytes.
     legacy: old size:mtime record, not treated as unchanged.
     changed: sha256 differs, or the stored text is not a known stamp.
     missing: no stored stamp. */
  function classify(filePath, stored) {
    if (stored == null || stored === '') { return 'missing'; }
    var text = String(stored);
    if (text.indexOf('sha256:') === 0) {
      return contentStamp(filePath, true) === text ? 'match' : 'changed';
    }
    if (isLegacyStamp(text)) { return 'legacy'; }
    return 'changed';
  }

  function matches(filePath, stored) {
    return classify(filePath, stored) === 'match';
  }

  function equivalent(filePath, a, b) {
    if (a === b && String(a).indexOf('sha256:') === 0) { return true; }
    if (!filePath || a == null || b == null) { return false; }
    return matches(filePath, a) && matches(filePath, b);
  }

  var api = {
    contentStamp: contentStamp,
    contentStampAsync: contentStampAsync,
    classify: classify,
    isLegacyStamp: isLegacyStamp,
    matches: matches,
    equivalent: equivalent
  };
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.PaperFigFileStamp = api; }
})(typeof window !== 'undefined' ? window : global);
