/* Fiji process bridge for PaperFig for Illustrator. See LICENSE. */
(function (root) {
  'use strict';

  var nodeRequire = (typeof window !== 'undefined' && window.require) ||
    (typeof require === 'function' && require);
  var fs = nodeRequire ? nodeRequire('fs') : null;
  var path = nodeRequire ? nodeRequire('path') : null;
  var os = nodeRequire ? nodeRequire('os') : null;
  var childProcess = nodeRequire ? nodeRequire('child_process') : null;

  var MAX_OUTPUT = 65536;


  function requireNode() {
    if (!fs || !path || !childProcess) {
      throw new Error('Node.js is unavailable. Confirm --enable-nodejs in the CEP manifest.');
    }
  }

  function exists(filePath) {
    try { return fs.statSync(filePath); } catch (error) { return null; }
  }

  function expandHome(value) {
    if (!value || value.charAt(0) !== '~' || !os) { return value; }
    return path.join(os.homedir(), value.slice(1).replace(/^[\\/]/, ''));
  }

  function cleanPath(value) {
    var result = String(value || '').replace(/^\s+|\s+$/g, '');
    if ((result.charAt(0) === '"' && result.charAt(result.length - 1) === '"') ||
        (result.charAt(0) === "'" && result.charAt(result.length - 1) === "'")) {
      result = result.slice(1, -1);
    }
    return expandHome(result);
  }

  function executableNames() {
    if (process.platform === 'win32') {
      return ['ImageJ-win64.exe', 'ImageJ-win32.exe', 'ImageJ.exe', 'Fiji.exe'];
    }
    if (process.platform === 'darwin') {
      return ['Contents/MacOS/ImageJ-macosx', 'ImageJ-macosx'];
    }
    return ['ImageJ-linux64', 'ImageJ-linux32', 'ImageJ'];
  }

  function resolveExecutable(inputPath) {
    requireNode();
    var candidate = cleanPath(inputPath);
    var stat;
    var names;
    var i;
    var nested;

    if (!candidate) { throw new Error('Enter a Fiji path first.'); }
    stat = exists(candidate);
    if (stat && stat.isFile()) { return path.resolve(candidate); }

    names = executableNames();
    if (stat && stat.isDirectory()) {
      for (i = 0; i < names.length; i += 1) {
        nested = path.join(candidate, names[i]);
        if (exists(nested) && exists(nested).isFile()) { return path.resolve(nested); }
      }
      nested = path.join(candidate, 'Fiji.app', 'Contents', 'MacOS', 'ImageJ-macosx');
      if (exists(nested) && exists(nested).isFile()) { return path.resolve(nested); }
    }

    if (/\.app[\\/]?$/i.test(candidate)) {
      nested = path.join(candidate, 'Contents', 'MacOS', 'ImageJ-macosx');
      if (exists(nested) && exists(nested).isFile()) { return path.resolve(nested); }
    }
    throw new Error('No Fiji/ImageJ executable found at: ' + candidate);
  }

  function candidateRoots() {
    var home = os ? os.homedir() : '';
    var env = process.env || {};
    if (process.platform === 'win32') {
      return [
        env.FIJI_HOME,
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Fiji.app'),
        env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Fiji.app'),
        env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Fiji.app'),
        home && path.join(home, 'Fiji.app')
      ];
    }
    if (process.platform === 'darwin') {
      return [env.FIJI_HOME, '/Applications/Fiji.app', home && path.join(home, 'Applications', 'Fiji.app')];
    }
    return [
      env.FIJI_HOME,
      '/opt/Fiji.app', '/opt/fiji/Fiji.app', '/usr/local/Fiji.app',
      home && path.join(home, 'Fiji.app'),
      home && path.join(home, 'Applications', 'Fiji.app')
    ];
  }

  function detectCandidates() {
    requireNode();
    var roots = candidateRoots();
    var found = [];
    var seen = {};
    var i;
    var resolved;
    for (i = 0; i < roots.length; i += 1) {
      if (!roots[i]) { continue; }
      try {
        resolved = resolveExecutable(roots[i]);
        if (!seen[resolved]) { seen[resolved] = true; found.push(resolved); }
      } catch (ignore) {}
    }
    return found;
  }

  function runMacro(executable, macroPath, macroArgument, options) {
    requireNode();
    options = options || {};
    var resolvedExecutable = resolveExecutable(executable);
    var resolvedMacro = path.resolve(cleanPath(macroPath));
    var macroStat = exists(resolvedMacro);
    var timeoutMs = Number(options.timeoutMs || 120000);
    var args = options.script ? ['--ij2', '--headless', '--console', '--run', resolvedMacro] : ['--headless', '--console', '-macro', resolvedMacro];

    if (!macroStat || !macroStat.isFile()) {
      return Promise.reject(new Error('Macro not found: ' + resolvedMacro));
    }
    if (macroArgument !== undefined && macroArgument !== null && String(macroArgument) !== '') {
      args.push(String(macroArgument));
    }

    return new Promise(function (resolve, reject) {
      var stdout = '';
      var stderr = '';
      var settled = false;
      var timer;
      var proc;

      try {
        proc = childProcess.spawn(resolvedExecutable, args, {
          cwd: options.cwd || path.dirname(resolvedMacro),
          env: options.env || process.env,
          windowsHide: true
        });
      } catch (error) {
        reject(error);
        return;
      }

      timer = setTimeout(function () {
        if (settled) { return; }
        settled = true;
        try { proc.kill(); } catch (ignore) {}
        reject(new Error('Fiji timed out after ' + timeoutMs + ' ms.'));
      }, timeoutMs);

      /* 0.8.1: cap captured output; Fiji start-up can be very chatty. */
      proc.stdout.on('data', function (chunk) { stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT); });
      proc.stderr.on('data', function (chunk) { stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT); });
      proc.on('error', function (error) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      proc.on('close', function (code, signal) {
        var combined;
        var hasSuccess;
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        combined = stdout + '\n' + stderr;
        /* Fiji often exits non-zero even after a successful macro. Accept known
         * success markers (SCI_BITMAP_*_OK / SCI_BITMAP_PONG) regardless of code. */
        /* 0.8.1: callers may name the exact marker they expect; otherwise accept
         * any SCI_*_OK marker (the old SCI_BITMAP_-only regex rejected
         * SCI_RGB_DECODE_OK whenever Fiji exited non-zero). */
        hasSuccess = options.successMarker ?
          combined.indexOf(options.successMarker) !== -1 :
          /SCI_BITMAP_PONG|SCI_[A-Z0-9_]+_OK/.test(combined);
        if (code === 0 || hasSuccess) {
          resolve({ code: code, signal: signal, stdout: stdout, stderr: stderr, executable: resolvedExecutable });
        } else {
          reject(new Error('Fiji exited with code ' + code + '. ' + (stderr || stdout)));
        }
      });
    });
  }

  function testConnection(executable, pingMacroPath) {
    return runMacro(executable, pingMacroPath, 'SCI_BITMAP_TEST', { timeoutMs: 45000, successMarker: 'SCI_BITMAP_PONG' })
      .then(function (result) {
        var combined = result.stdout + '\n' + result.stderr;
        if (combined.indexOf('SCI_BITMAP_PONG') === -1) {
          throw new Error('Fiji launched, but the ping response was not found.');
        }
        return {
          ok: true,
          executable: result.executable,
          message: 'Connected to Fiji/ImageJ.',
          output: combined
        };
      });
  }

  root.SciBitmapFiji = {
    detectCandidates: detectCandidates,
    resolveExecutable: resolveExecutable,
    testConnection: testConnection,
    runMacro: runMacro,
    runScript: function(executable,script,options){options=options||{};options.script=true;return runMacro(executable,script,null,options);}
  };
}(this));
