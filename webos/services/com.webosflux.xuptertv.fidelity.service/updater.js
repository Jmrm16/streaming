/*
 * updater.js - Over-The-Air (OTA) update manager for XuperTV webOS
 *
 * Checks GitHub for published updates, downloads the IPK to /tmp/,
 * invokes webOS appInstallService, and relaunches the app.
 *
 * Uses dnsx DoH resolver to bypass ISP DNS blocks in Colombia/Chile.
 * ES5 strict compliance for Node 0.12 / V8 3.28 (webOS 1/2/3).
 */
'use strict';

var http = require('http');
var https = require('https');
var urlmod = require('url');
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var dnsx = require('./dnsx');

var UPDATE_MANIFEST_URLS = [
  'https://raw.githubusercontent.com/cristianco7/XUPER-HYDRA-PORT-WEBOS/main/version.json',
  'https://raw.githubusercontent.com/cristianco7/XUPER-HYDRA-PORT-WEBOS/feature/catalog-webos-compat/version.json',
  'https://cdn.jsdelivr.net/gh/cristianco7/XUPER-HYDRA-PORT-WEBOS@main/version.json'
];

var TARGET_IPK_PATH = '/tmp/xuper-ota.ipk';
var APP_ID = 'com.webosflux.xuptertv.fidelity';

var lunaService = null;

function setLunaService(svc) {
  lunaService = svc;
}

function parseVer(v) {
  var str = String(v || '').replace(/^[^\d]*/, '');
  var parts = str.split('.');
  var res = [];
  for (var i = 0; i < parts.length; i++) {
    var n = parseInt(parts[i], 10);
    res.push(isNaN(n) ? 0 : n);
  }
  return res;
}

function compareSemVer(v1, v2) {
  var a = parseVer(v1);
  var b = parseVer(v2);
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    var numA = a[i] || 0;
    var numB = b[i] || 0;
    if (numA > numB) { return 1; }
    if (numA < numB) { return -1; }
  }
  return 0;
}

var resolveHostIp = function (host, cb) {
  if (!host || (dnsx && dnsx.isIpv4 && dnsx.isIpv4(host))) {
    return cb(null, host);
  }
  if (!dnsx || typeof dnsx.resolve !== 'function') {
    return cb(null, host);
  }
  var hit = (typeof dnsx.cached === 'function') ? dnsx.cached(host) : null;
  if (hit && hit.ips && hit.ips.length) {
    var cachedIp = (typeof dnsx.dial === 'function') ? dnsx.dial(host, hit.ips) : hit.ips[0];
    return cb(null, cachedIp || host);
  }
  dnsx.resolve(host, function (err, res) {
    if (!err && res && res.ips && res.ips.length) {
      var ip = (typeof dnsx.dial === 'function') ? dnsx.dial(host, res.ips) : res.ips[0];
      return cb(null, ip || host);
    }
    cb(null, host);
  });
};

var fetchJson = function (urlStr, cb, maxRedirects) {
  if (maxRedirects === undefined) { maxRedirects = 5; }
  if (maxRedirects < 0) {
    return cb(new Error('Demasiadas redirecciones HTTP'));
  }

  var parsed;
  try {
    parsed = urlmod.parse(urlStr);
  } catch (eParse) {
    return cb(eParse);
  }

  resolveHostIp(parsed.hostname, function (errDns, targetHost) {
    var client = parsed.protocol === 'http:' ? http : https;
    var opts = {
      protocol: parsed.protocol,
      hostname: targetHost || parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.path,
      servername: parsed.hostname,
      rejectUnauthorized: false,
      headers: {
        'Host': parsed.hostname,
        'User-Agent': 'Mozilla/5.0 (SmartHub; SMART-TV; webOS) XuperTV-OTA/1.0',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 12000
    };

    var req = client.get(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var nextUrl = urlmod.resolve(urlStr, res.headers.location);
        return fetchJson(nextUrl, cb, maxRedirects - 1);
      }
      if (res.statusCode === 404) {
        return cb(new Error('No se encontró version.json en GitHub (HTTP 404). Debes hacer "git push" a tu repositorio.'));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return cb(new Error('HTTP ' + res.statusCode + ' al consultar actualización'));
      }

      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        var data;
        try {
          data = JSON.parse(body);
        } catch (eJson) {
          return cb(new Error('Formato JSON inválido en servidor de actualización: ' + (eJson && eJson.message)));
        }
        cb(null, data);
      });
    });

    req.on('error', function (err) {
      cb(err);
    });

    req.on('timeout', function () {
      try { req.abort(); } catch (eAbort) { /* ignore */ }
      cb(new Error('Tiempo de espera agotado al consultar servidor de actualización'));
    });
  });
};

var checkManifestInList = function (urls, index, lastError, cb) {
  if (index >= urls.length) {
    var msg = (lastError && lastError.message) || 'No se pudo contactar con los servidores de actualización';
    return cb(new Error(msg));
  }

  var targetUrl = urls[index] + '?t=' + Date.now();
  fetchJson(targetUrl, function (err, manifest) {
    if (!err && manifest && manifest.version) {
      return cb(null, manifest);
    }
    checkManifestInList(urls, index + 1, err || lastError, cb);
  });
};

function checkUpdate(currentVersion, cb) {
  checkManifestInList(UPDATE_MANIFEST_URLS, 0, null, function (err, manifest) {
    if (err) {
      return cb(err);
    }

    var remoteVer = manifest.version || '0.0.0';
    var isNewer = compareSemVer(remoteVer, currentVersion) > 0;

    cb(null, {
      updateAvailable: isNewer,
      currentVersion: currentVersion,
      latestVersion: remoteVer,
      ipkUrl: manifest.ipkUrl || '',
      changelog: manifest.changelog || '',
      releaseDate: manifest.releaseDate || ''
    });
  });
}

var downloadFile = function (urlStr, destPath, onProgress, cb, maxRedirects) {
  if (maxRedirects === undefined) { maxRedirects = 6; }
  if (maxRedirects < 0) {
    return cb(new Error('Demasiadas redirecciones descargando el archivo'));
  }

  var parsed;
  try {
    parsed = urlmod.parse(urlStr);
  } catch (eParse) {
    return cb(eParse);
  }

  resolveHostIp(parsed.hostname, function (errDns, targetHost) {
    var client = parsed.protocol === 'http:' ? http : https;
    var opts = {
      protocol: parsed.protocol,
      hostname: targetHost || parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.path,
      servername: parsed.hostname,
      rejectUnauthorized: false,
      headers: {
        'Host': parsed.hostname,
        'User-Agent': 'Mozilla/5.0 (SmartHub; SMART-TV; webOS) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': '*/*'
      },
      timeout: 45000
    };

    var req = client.get(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var nextUrl = urlmod.resolve(urlStr, res.headers.location);
        return downloadFile(nextUrl, destPath, onProgress, cb, maxRedirects - 1);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return cb(new Error('HTTP ' + res.statusCode + ' al descargar el paquete'));
      }

      var totalBytes = parseInt(res.headers['content-length'], 10) || 0;
      var downloadedBytes = 0;
      var lastPercent = -1;

      try {
        if (fs.existsSync(destPath)) { fs.unlinkSync(destPath); }
      } catch (eUnlink) { /* ignore */ }

      var fileStream = fs.createWriteStream(destPath);
      var finished = false;

      var finish = function (err, path) {
        if (finished) { return; }
        finished = true;
        cb(err, path);
      };

      fileStream.on('error', function (err) {
        try { req.abort(); } catch (e) { /* ignore */ }
        finish(err);
      });

      res.on('data', function (chunk) {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          var pct = Math.floor((downloadedBytes / totalBytes) * 100);
          if (pct !== lastPercent) {
            lastPercent = pct;
            if (onProgress) { onProgress(pct, downloadedBytes, totalBytes); }
          }
        } else {
          if (onProgress) { onProgress(-1, downloadedBytes, 0); }
        }
      });

      res.on('error', function (err) {
        try { fileStream.close(); } catch (eClose) { /* ignore */ }
        finish(err);
      });

      res.pipe(fileStream);

      fileStream.on('finish', function () {
        fileStream.close(function () {
          finish(null, destPath);
        });
      });
    });

    req.on('error', function (err) {
      cb(err);
    });

    req.on('timeout', function () {
      try { req.abort(); } catch (eAbort) { /* ignore */ }
      cb(new Error('Tiempo de espera agotado descargando la actualización'));
    });
  });
};

var installViaLunaSend = function (ipkPath, onProgress, cb) {
  var payload = JSON.stringify({
    id: APP_ID,
    ipkUrl: ipkPath,
    subscribe: true
  });

  var binPath = fs.existsSync('/usr/bin/luna-send-pub') ? '/usr/bin/luna-send-pub' : 'luna-send-pub';
  var child;
  try {
    child = spawn(binPath, ['-i', '-f', 'luna://com.webos.appInstallService/dev/install', payload]);
  } catch (eSpawn) {
    return cb(new Error('No se pudo ejecutar luna-send-pub: ' + (eSpawn && eSpawn.message)));
  }

  var finished = false;
  var finish = function (err, result) {
    if (finished) { return; }
    finished = true;
    try { child.kill('SIGKILL'); } catch (eKill) { /* ignore */ }
    cb(err, result);
  };

  var timer = setTimeout(function () {
    finish(new Error('Tiempo límite de instalación superado'));
  }, 180000);

  var stdoutBuf = '';
  child.stdout.on('data', function (d) {
    stdoutBuf += d.toString();
    var lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) { continue; }
      if (/installed/i.test(line)) {
        clearTimeout(timer);
        return finish(null, { state: 'installed', raw: line });
      }
      if (/FAILED_IPKG_INSTALL/i.test(line) || (/"returnValue":\s*false/i.test(line) && /errorCode/i.test(line))) {
        clearTimeout(timer);
        return finish(new Error('La TV rechazó la instalación: ' + line));
      }
      if (onProgress) {
        onProgress(line);
      }
    }
  });

  child.on('error', function (err) {
    clearTimeout(timer);
    finish(err);
  });

  child.on('close', function (code) {
    clearTimeout(timer);
    if (/installed/i.test(stdoutBuf)) {
      return finish(null, { state: 'installed' });
    }
    if (code === 0) {
      return finish(null, { state: 'completed' });
    }
    finish(new Error('El instalador finalizó con código ' + code + ': ' + stdoutBuf));
  });
};

var relaunchApp = function () {
  var binPath = fs.existsSync('/usr/bin/luna-send-pub') ? '/usr/bin/luna-send-pub' : 'luna-send-pub';
  var payload = JSON.stringify({ id: APP_ID });
  try {
    var p = spawn(binPath, ['-n', '1', '-f', 'luna://com.webos.applicationManager/launch', payload], {
      detached: true,
      stdio: 'ignore'
    });
    if (p.unref) { p.unref(); }
  } catch (eLaunch) {
    console.error('[updater] error relanzando app:', eLaunch);
  }
};

function applyUpdate(ipkUrl, onStatus, cb) {
  onStatus('downloading', 0, 'Iniciando descarga de la actualización...');

  downloadFile(ipkUrl, TARGET_IPK_PATH, function (pct, downloaded, total) {
    var msg = pct >= 0 ? ('Descargando paquete: ' + pct + '%') : ('Descargando paquete (' + Math.round(downloaded / 1048576) + ' MB)...');
    onStatus('downloading', pct >= 0 ? pct : 0, msg);
  }, function (errDownload, savedPath) {
    if (errDownload) {
      try { if (fs.existsSync(TARGET_IPK_PATH)) { fs.unlinkSync(TARGET_IPK_PATH); } } catch (e) { /* ignore */ }
      return cb(new Error('Error en la descarga: ' + (errDownload && errDownload.message)));
    }

    onStatus('installing', 100, 'Instalando actualización en el televisor...');

    installViaLunaSend(savedPath, function (rawProgress) {
      onStatus('installing', 100, 'Instalando en webOS: ' + rawProgress);
    }, function (errInstall) {
      try { if (fs.existsSync(TARGET_IPK_PATH)) { fs.unlinkSync(TARGET_IPK_PATH); } } catch (eUnlink) { /* ignore */ }

      if (errInstall) {
        return cb(new Error('Error en instalación: ' + (errInstall && errInstall.message)));
      }

      onStatus('success', 100, '¡Instalación completada! Reiniciando XuperTV...');
      /* The installed IPK replaces the files, but this Node process keeps the
         old code in memory.  If it survives the update, Luna answers the next
         launch with the old method list ("Denied method call checkUpdate for
         category /").  Exit once the app has been relaunched so ls-hubd starts
         the service again from the new package. */
      setTimeout(function () {
        try {
          if (typeof process.reallyExit === 'function') { process.reallyExit(0); }
          else { process.kill(process.pid, 'SIGKILL'); }
        } catch (eRestart) { /* ignore */ }
      }, 6000);
      setTimeout(function () {
        relaunchApp();
      }, 1000);

      cb(null, { success: true });
    });
  });
}

module.exports = {
  init: setLunaService,
  checkUpdate: checkUpdate,
  applyUpdate: applyUpdate,
  compareSemVer: compareSemVer
};
