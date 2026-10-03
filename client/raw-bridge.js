/* Reusable Fiji inbox service. No HTTP listener, no shell interpolation. See LICENSE. */
(function (root) {
  'use strict';
  var S = root.SciScientific;
  var JOB_TIMEOUT_MS = 180000;
  var NATIVE_TIFF_MAX = 268435456;

  function create(extensionPath, getFiji) {
    var fs = root.require('fs');
    var path = root.require('path');
    var os = root.require('os');
    var cp = root.require('child_process');
    var service = null;
    var queue = Promise.resolve();

    /* Recursive best-effort removal (0.8.1: also removes nested data-* dirs). */
    function cleanup(dir) {
      try {
        fs.readdirSync(dir).forEach(function (n) {
          var p = path.join(dir, n);
          try {
            if (fs.statSync(p).isDirectory()) { cleanup(p); } else { fs.unlinkSync(p); }
          } catch (ignore) {}
        });
        fs.rmdirSync(dir);
      } catch (ignore) {}
    }

    function start() {
      if (service && !service.dead) { return service; }
      if (service && service.dir) { cleanup(service.dir); }
      var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfig-engine-'));
      var script = path.join(dir, 'engine.groovy');
      var code = fs.readFileSync(path.join(extensionPath, 'scripts/raw-service.groovy'), 'utf8');
      var marker = 'def processRequest =';
      if (code.indexOf(marker) === -1) { throw new Error('raw-service.groovy: injection marker missing'); }
      /* 0.8.1: pass the inbox via the PAPERFIG_INBOX environment variable
       * instead of splicing a path literal into Groovy source (a GString
       * would interpolate "$" in the temp path). */
      fs.writeFileSync(script, code, 'utf8');
      var proc = cp.spawn(root.SciBitmapFiji.resolveExecutable(getFiji()),
        ['--ij2', '--headless', '--console', '--run', script],
        { windowsHide: true, cwd: dir, env: Object.assign({}, (typeof process !== 'undefined' && process.env) || {}, { PAPERFIG_INBOX: dir }) });
      service = { dir: dir, proc: proc, dead: false, log: '' };
      var own = service;
      function log(b) { own.log = (own.log + b.toString()).slice(-12000); }
      proc.stdout.on('data', log);
      proc.stderr.on('data', log);
      proc.on('error', function (e) { own.dead = true; log(e.message); });
      proc.on('close', function () { own.dead = true; });
      return service;
    }

    function stopping(own) {
      return own.dead || fs.existsSync(path.join(own.dir, 'stopping'));
    }

    function decodePlane(file, d) {
      var bytes = fs.readFileSync(file);
      var n = d.width * d.height;
      if (bytes.length !== n * d.bits / 8) { throw new Error('Raw plane length mismatch'); }
      if (d.bits === 16) {
        /* Engine guarantees little-endian; copy into an aligned buffer. */
        var ab = new ArrayBuffer(bytes.length);
        new Uint8Array(ab).set(bytes);
        return new Uint16Array(ab);
      }
      return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    }

    function submitOnce(req) {
      var own = start();
      if (stopping(own)) { return Promise.reject({ retry: true }); }
      var id = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      var jobDir = fs.mkdtempSync(path.join(own.dir, 'data-'));
      var requestPath = path.join(own.dir, id + '.request.json');
      var responsePath = path.join(own.dir, id + '.response.json');
      var job = Object.assign({}, req, { output: path.join(jobDir, 'metadata.json') });
      fs.writeFileSync(requestPath + '.partial', JSON.stringify(job), 'utf8');
      fs.renameSync(requestPath + '.partial', requestPath);

      return new Promise(function (resolve, reject) {
        var began = Date.now();
        function finish(error, d) {
          cleanup(jobDir);
          try { fs.unlinkSync(responsePath); } catch (ignore) {}
          if (error) { reject(error); } else { resolve(d); }
        }
        function poll() {
          try {
            if (fs.existsSync(responsePath)) {
              var status = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
              if (!status.ok) { throw new Error(status.error || 'Raw engine failed'); }
              var d = JSON.parse(fs.readFileSync(job.output, 'utf8'));
              if (!d.ok) { throw new Error(d.error); }
              if (!Array.isArray(d.files) || d.files.length > 8) { throw new Error('Invalid raw engine response'); }
              if (!(d.width > 0 && d.height > 0 && (d.bits === 8 || d.bits === 16))) { throw new Error('Invalid raw engine geometry'); }
              d.planes = d.files.map(function (f) {
                if (path.dirname(path.resolve(f)) !== path.resolve(jobDir)) { throw new Error('Unexpected plane path'); }
                return decodePlane(f, d);
              });
              delete d.files;
              return finish(null, S.prepare(d));
            }
            /* Request never consumed and service went away (idle exit race): retry on a fresh service. */
            if (stopping(own) && fs.existsSync(requestPath)) {
              try { fs.unlinkSync(requestPath); } catch (ignore) {}
              return finish({ retry: true });
            }
            if (own.dead) { throw new Error('Fiji service exited: ' + own.log); }
            if (Date.now() - began > JOB_TIMEOUT_MS) {
              own.proc.kill(); own.dead = true;
              throw new Error('Fiji service timed out after ' + (JOB_TIMEOUT_MS / 1000) + ' seconds');
            }
            setTimeout(poll, 150);
          } catch (e) { finish(e); }
        }
        poll();
      });
    }

    function submit(req) {
      return submitOnce(req).catch(function (e) {
        if (e && e.retry) {
          if (service && !service.dead) { try { service.proc.kill(); } catch (ignore) {} service.dead = true; }
          return submitOnce(req).catch(function (e2) {
            throw (e2 && e2.retry) ? new Error('Fiji service restarted during request; try again.') : e2;
          });
        }
        throw e;
      });
    }

    function readNative(source, req) {
      /* Async read keeps the CEP panel responsive for large TIFFs. */
      return new Promise(function (resolve, reject) {
        fs.readFile(source, function (err, buf) { if (err) { reject(err); } else { resolve(buf); } });
      }).then(function (buf) { return S.nativeTiff(buf, req); });
    }

    function load(source, plane) {
      plane = plane || {};
      var req = { source: source, series: Number(plane.series || 0), z: Number(plane.z || 0), t: Number(plane.t || 0) };
      var task = function () {
        return Promise.resolve().then(function () {
          var st = fs.statSync(source);
          if (st.size <= NATIVE_TIFF_MAX && /\.tiff?$/i.test(source)) {
            return readNative(source, req).catch(function (nativeError) {
              if (!getFiji()) { throw new Error(nativeError.message + ' · Configure Fiji + Bio-Formats for this layout.'); }
              return submit(req);
            });
          }
          if (!getFiji()) { throw new Error('Configure Fiji for raw data'); }
          return submit(req);
        });
      };
      var result = queue.then(task, task);
      queue = result.catch(function () {});
      return result;
    }

    function stop() {
      if (!service) { return; }
      var own = service;
      if (!own.dead) {
        try { fs.writeFileSync(path.join(own.dir, 'shutdown'), '1'); } catch (ignore) {}
      }
      setTimeout(function () {
        if (!own.dead) { try { own.proc.kill(); } catch (ignore) {} }
        setTimeout(function () { cleanup(own.dir); }, 500);
      }, 2000);
    }

    return {
      load: load,
      stop: stop,
      status: function () { return service ? (service.dead ? 'stopped' : 'running') : 'not started'; }
    };
  }

  root.SciRawBridge = { create: create };
}(window));
