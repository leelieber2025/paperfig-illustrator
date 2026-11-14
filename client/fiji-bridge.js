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

  /* 1.2.9: Fiji ships the Jaunch launcher (fiji-<os>-<arch>) since 2025; Fiji-Latest has no
   * ImageJ-* launcher, and Apple silicon bundles only fiji-macos-arm64. Prefer the native arch. */
  function archOrder(list) {
    var arch = (typeof process !== 'undefined' && process.arch) || '';
    return list.slice().sort(function (a, b) {
      var ra = a.indexOf(arch) !== -1 ? 0 : 1, rb = b.indexOf(arch) !== -1 ? 0 : 1;
      return ra - rb;
    });
  }

  function executableNames(platform) {
    platform = platform || process.platform;
    if (platform === 'win32') {
      return archOrder(['fiji-windows-x64.exe', 'fiji-windows-arm64.exe']).concat(['ImageJ-win64.exe', 'ImageJ-win32.exe', 'ImageJ.exe', 'Fiji.exe']);
    }
    if (platform === 'darwin') {
      return archOrder(['Contents/MacOS/fiji-macos-arm64', 'Contents/MacOS/fiji-macos-x64']).concat([
        'Contents/MacOS/fiji-macos-universal', 'Contents/MacOS/fiji-macos',
        'Contents/MacOS/ImageJ-macosx', 'ImageJ-macosx'
      ]);
    }
    return archOrder(['fiji-linux-x64', 'fiji-linux-arm64']).concat(['ImageJ-linux64', 'ImageJ-linux32', 'ImageJ']);
  }

  /* Jaunch launchers reject legacy flags: "--ij2" is read as a macro name. */
  function isJaunchLauncher(executable) {
    return /^fiji-(windows|macos|linux)/i.test(String(executable || '').split(/[\\/]/).pop());
  }

  function launcherArgs(executable, mode, file) {
    var jaunch = isJaunchLauncher(executable);
    if (mode === 'script') {
      return jaunch ? ['--headless', '--run', file] : ['--ij2', '--headless', '--console', '--run', file];
    }
    return jaunch ? ['--headless', '-macro', file] : ['--headless', '--console', '-macro', file];
  }

  function findInDirectory(dir) {
    var names = executableNames(), bases = [dir], i, j, nested, st;
    /* New macOS layout: Fiji/Fiji.app (and an outer Fiji.app holding a nested Fiji.app). */
    if (process.platform === 'darwin') { bases.push(path.join(dir, 'Fiji.app')); }
    /* Launcher name first, folder second: a nested Jaunch fiji-* beats an outer legacy ImageJ-*. */
    for (i = 0; i < names.length; i += 1) {
      for (j = 0; j < bases.length; j += 1) {
        nested = path.join(bases[j], names[i]);
        st = exists(nested);
        if (st && st.isFile()) { return path.resolve(nested); }
      }
    }
    return '';
  }

  function resolveExecutable(inputPath) {
    requireNode();
    var candidate = cleanPath(inputPath);
    var stat;
    var found;

    if (!candidate) { throw new Error('Enter a Fiji path first.'); }
    stat = exists(candidate);
    if (stat && stat.isFile()) { return path.resolve(candidate); }

    if (stat && stat.isDirectory()) {
      found = findInDirectory(candidate);
      if (found) { return found; }
    }
    throw new Error('No Fiji/ImageJ executable found at: ' + candidate);
  }

  function candidateRoots() {
    var home = os ? os.homedir() : '';
    var env = process.env || {};
    if (process.platform === 'win32') {
      return [
        env.FIJI_HOME,
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Fiji'),
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Fiji.app'),
        env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Fiji'),
        env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Fiji.app'),
        env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Fiji.app'),
        home && path.join(home, 'Fiji'),
        home && path.join(home, 'Fiji.app'),
        home && path.join(home, 'Desktop', 'Fiji'),
        home && path.join(home, 'Desktop', 'Fiji.app')
      ];
    }
    if (process.platform === 'darwin') {
      return [
        env.FIJI_HOME,
        '/Applications/Fiji', '/Applications/Fiji.app',
        home && path.join(home, 'Applications', 'Fiji'),
        home && path.join(home, 'Applications', 'Fiji.app')
      ];
    }
    return [
      env.FIJI_HOME,
      '/opt/Fiji', '/opt/Fiji.app', '/opt/fiji/Fiji.app', '/usr/local/Fiji.app',
      home && path.join(home, 'Fiji'),
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
    var args = launcherArgs(resolvedExecutable, options.script ? 'script' : 'macro', resolvedMacro);

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
    executableNames: executableNames,
    isJaunchLauncher: isJaunchLauncher,
    launcherArgs: launcherArgs,
    testConnection: testConnection,
    runMacro: runMacro,
    runScript: function(executable,script,options){options=options||{};options.script=true;return runMacro(executable,script,null,options);}
  };
}(this));
