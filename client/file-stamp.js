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
    return { size: Number(st.size), mtime: mtime };
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

  function remember(filePath, size, mtime, stamp) {
    cache[filePath] = { size: size, mtime: mtime, stamp: stamp };
    return stamp;
  }

  function contentStamp(filePath) {
    var fs = req('fs');
    var crypto = req('crypto');
    var times = fileTimes(filePath);
    var hit = cache[filePath];
    if (hit && hit.size === times.size && hit.mtime === times.mtime) { return hit.stamp; }
    var fd = fs.openSync(filePath, 'r');
    try {
      return remember(filePath, times.size, times.mtime, hashFdSync(fs, crypto, fd));
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
      if (hit && hit.size === times.size && hit.mtime === times.mtime) {
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
            resolve(remember(filePath, times.size, times.mtime, stamp));
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
      return contentStamp(filePath) === text ? 'match' : 'changed';
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
