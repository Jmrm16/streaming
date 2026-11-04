/*
 * XuperTV webOS service: portal catalog + playback resolver.
 *
 * Why a service: the Magis portal sends no Access-Control-Allow-Origin and
 * rejects OPTIONS, so a packaged web app cannot POST to it directly. Node
 * services are not bound by the page's CORS rules, so the encrypted protocol
 * runs here and the app receives plain JSON through Luna.
 */
'use strict';

var Service = require('webos-service');
var pkg = require('./package.json');
var fs = require('fs');
var urlmod = require('url');

/* Every module is loaded defensively.  webOS 3 runs Node 0.12 / V8 3.28 and if
   one single statement of one module is not understood the whole service dies
   before registering anything, which the viewer sees as "el servicio no
   arrancó".  Capturing the failure here keeps `ping` alive and reports the
   exact reason (module + message) to the app's Diagnóstico screen. */
var loadErrors = {};
function loadModule(name) {
  try {
    return require(name);
  } catch (eLoad) {
    loadErrors[name] = (eLoad && eLoad.message) || String(eLoad);
    try { console.error('[xuper-service] no se pudo cargar ' + name + ': ' + loadErrors[name]); } catch (eLog) { /* ignore */ }
    return null;
  }
}
var magis = loadModule('./magis');
var proxy = loadModule('./proxy');
var relay = loadModule('./ffmpeg-relay');
var dnsx = loadModule('./dnsx');
var netdiag = loadModule('./netdiag');
var upstream = loadModule('./upstream');
var updater = loadModule('./updater');

/* Restore a proxy saved from Ajustes.  /tmp survives service restarts until the
   TV reboots, which is enough to keep the setting between app launches. */
try {
  var savedProxy = JSON.parse(fs.readFileSync('/tmp/xuper-proxy.json', 'utf8'));
  if (savedProxy && savedProxy.url && upstream) { upstream.configure(savedProxy.url); }
} catch (eProxyFile) { /* no saved proxy */ }

try {
  var httpsMod = require('https');
  var httpMod = require('http');
  if (httpsMod.globalAgent) { httpsMod.globalAgent.maxSockets = 32; }
  if (httpMod.globalAgent) { httpMod.globalAgent.maxSockets = 32; }
} catch (eAgent) { /* ignore */ }

var service = new Service(pkg.name);
if (updater && updater.init) { updater.init(service); }

/* Prevent unexpected network errors or aborts from terminating the service */
process.on('uncaughtException', function (err) {
  console.error('[xuper-service] uncaughtException:', (err && err.stack) || err);
});

/* Intercept process.exit so idle timers in webos-service do not kill the proxy */
try {
  process.exit = function (code) {
    console.log('[xuper-service] blocked process.exit(' + code + ') to keep streaming alive');
  };
} catch (eExit) { /* ignore */ }

/* Prolong idleTimeout to 24h and create a persistent activity */
if (service.activityManager) {
  try {
    service.activityManager.idleTimeout = 86400;
    service.activityManager.create('keepAlive', function (act) {
      console.log('[xuper-service] persistent activity created');
    });
  } catch (eAct) {
    console.log('[xuper-service] activityManager init note: ' + (eAct && eAct.message));
  }
}

function fail(message, err, code) {
  message.respond({
    returnValue: false,
    errorText: (err && err.message) || err || 'error',
    errorCode: code || (err && err.portalCode) || 1
  });
}

function respond(message, err, payload) {
  if (err) { return fail(message, err); }
  var out = payload || {};
  out.returnValue = true;
  message.respond(out);
}

function safeValue(fn, fallback) {
  try {
    var value = fn();
    return value === undefined ? fallback : value;
  } catch (eSafe) {
    return fallback;
  }
}

/* Any method that depends on a module that failed to load answers with the
   reason instead of never answering (a Luna call with no respond() leaves the
   app waiting until its timeout). */
function needModule(message, module, name) {
  if (module) { return true; }
  fail(message, new Error('módulo ' + name + ' no cargó en esta TV: ' + (loadErrors[name] || 'desconocido')));
  return false;
}

service.register('ping', function (message) {
  message.respond({
    returnValue: true,
    service: pkg.name,
    version: pkg.version,
    /* webOS 3.x answers v0.12.2, webOS 5/6 v8.12.0, webOS 22+ v12+. */
    node: process.version,
    platform: process.platform + '/' + process.arch,
    uptime: safeValue(function () { return Math.round(process.uptime()); }, 0),
    loadErrors: loadErrors,
    portalHosts: safeValue(function () { return magis.constants.ROOT_CODES ? 'magis' : 'none'; }, 'none'),
    proxyPort: safeValue(function () { return proxy.port(); }, 0),
    relayAvailable: safeValue(function () { return relay.available(); }, false),
    ffmpegPath: safeValue(function () { return relay.path(); }, ''),
    relayState: safeValue(function () { return relay.state ? relay.state() : null; }, null),
    upstreamProxy: safeValue(function () { return upstream.describe(); }, null),
    relayPort: safeValue(function () { return relay.port(); }, 0),
    seeds: safeValue(function () { return magis.seedStatus ? magis.seedStatus() : null; }, null)
  });
});

/* setProxy({url}) -> stores the viewer's HTTP proxy (empty clears it). */
service.register('setProxy', function (message) {
  if (!needModule(message, upstream, './upstream')) { return; }
  var payload = message.payload || {};
  var url = String(payload.url == null ? '' : payload.url).replace(/^\s+|\s+$/g, '');
  if (url && !upstream.parse(url)) {
    return fail(message, new Error('Dirección de proxy inválida. Usa http://usuario:clave@host:puerto'));
  }
  upstream.configure(url);
  try { fs.writeFileSync('/tmp/xuper-proxy.json', JSON.stringify({ url: url })); } catch (eWrite) { /* optional */ }
  console.log('[xuper-service] upstream proxy ' + (url ? 'enabled: ' + upstream.describe().host + ':' + upstream.describe().port : 'cleared'));
  message.respond({ returnValue: true, proxy: upstream.describe() });
});

/* keepAlive subscription keeps the Luna bus connection alive so the service never terminates */
service.register('keepAlive', function (message) {
  message.respond({
    returnValue: true,
    subscribed: !!message.isSubscription
  });
});

/* heartbeat method for periodic pings */
service.register('heartbeat', function (message) {
  message.respond({
    returnValue: true,
    alive: true,
    proxyPort: safeValue(function () { return proxy.port(); }, 0),
    timestamp: Date.now()
  });
});

/* home({root}) -> { items:[...] } for one portal root */
service.register('home', function (message) {
  if (!needModule(message, magis, './magis')) { return; }
  var root = (message.payload && message.payload.root) || 'movies';
  var pageNum = message.payload && message.payload.pageNum;
  magis.home(root, pageNum, function (err, data) { respond(message, err, data); });
});

/* search({value}) -> { items:[...], total } */
service.register('search', function (message) {
  if (!needModule(message, magis, './magis')) { return; }
  var value = (message.payload && message.payload.value) || '';
  magis.search(value, function (err, data) { respond(message, err, data); });
});

/* detail({contentId}) -> { item, episodes, seasons } */
service.register('detail', function (message) {
  if (!needModule(message, magis, './magis')) { return; }
  var id = message.payload && message.payload.contentId;
  magis.detail(id, function (err, data) { respond(message, err, data); });
});

/* Subtitle files live on a CDN without CORS headers, so the page cannot read
 * them directly.  Rewrite every subtitle URL to a loopback proxy URL. */
function attachSubtitles(payload) {
  if (!payload || !payload.subtitles || !payload.subtitles.length) { return payload; }
  payload.subtitles = payload.subtitles.map(function (sub) {
    return {
      lang: sub.lang,
      format: sub.format,
      url: proxy.addSubtitle(sub.url)
    };
  });
  return payload;
}

/* resolve({contentId, seriesContentId, playbackMode, trackIndex}) */
function resolveStream(message, forceRelay) {
  if (!needModule(message, magis, './magis') || !needModule(message, proxy, './proxy') ||
      !needModule(message, relay, './ffmpeg-relay') || !needModule(message, dnsx, './dnsx')) { return; }
  var payload = message.payload || {};
  var options = { trackIndex: payload.trackIndex };
  magis.resolve(payload.contentId, payload.seriesContentId, options, function (err, stream) {
    if (err) { return fail(message, err); }

    var isHevc = /hevc|h\.?265/i.test(stream.codec || '') || /hevc|h\.?265/i.test(stream.mime || '');
    /* 1.4.2 renamed the UI modes to direct/relay; accept both spellings so an
       older app build and the current one both reach the relay. */
    var useSmoothMode = forceRelay || payload.forceRelay === true || payload.forceRelay === 'true' ||
      payload.playbackMode === 'smooth' || payload.playbackMode === 'relay';
    /* When smooth mode (Modo Fluido) is requested by the user, always route via
       the on-device FFmpeg relay so the native player receives clean fragmented MP4. */
    if (useSmoothMode && !relay.available()) {
      return fail(message, new Error('Modo Fluido no disponible: ffmpeg no es ejecutable en esta TV'));
    }

    /* Keep the proven Fluent path single-hop: FFmpeg consumes the resolved
       portal stream itself and emits fragmented MP4 on :8787.  Sending the
       same stream through proxy -> FFmpeg adds a second local HTTP consumer;
       on webOS it can leave both waiting for the other side and the player
       remains permanently at "Conectando…".  The proxy is still started for
       subtitle URLs only. */
    if (useSmoothMode) {
      var smoothAudio = Number(payload.audioTrack) || 0;
      /* Igual que la 1.6.17: FFmpeg lee del proxy local, que conserva el
         camuflaje SNI y los reintentos del CDN.  El relay cae al CDN directo
         si ese camino no emite, así no se pierde la compatibilidad nueva. */
      proxy.start(function (perr) {
        if (perr) { return fail(message, perr); }
        var smoothHost = (urlmod.parse(stream.url || '').hostname) || '';
        dnsx.resolve(smoothHost, function (dnsErr, dnsRes) {
          var smoothIp = (dnsRes && dnsRes.ips && dnsRes.ips[0]) || '';
          var proxyToken = proxy.add(stream.url, stream.headers, stream.duration, smoothIp, stream.backupUrls);
          var localUrl = proxy.baseUrl() + '/media/' + proxyToken + '/stream.ts';
          var relayContainer = payload.container === 'ts' ? 'ts' : 'mp4';
          var relayUrl = relay.register(stream, { hevc: isHevc, audio: smoothAudio, proxyUrl: localUrl, container: relayContainer });
          console.log('[xuper-service] routing stream via ffmpeg relay (' + relayContainer + ', proxy local + fallback directo): ' + relayUrl);
          stream.proxyPath = relayUrl;
          /* webOS 3.x/3.5 reproduce TS de forma nativa; el fMP4 les deja la
             pantalla negra o el audio desincronizado.  El contenedor lo elige
             la app según la versión del televisor. */
          stream.mime = relayContainer === 'ts' ? 'video/mp2t' : 'video/mp4';
          stream.container = relayContainer;
          stream.isRelay = true;
          stream.isHls = false;
          respond(message, null, attachSubtitles(stream));
        });
      });
      return;
    }

    var streamHost = (urlmod.parse(stream.url || '').hostname) || '';
    dnsx.resolve(streamHost, function (dnsErr, dnsRes) {
      var resolvedIp = (dnsRes && dnsRes.ips && dnsRes.ips[0]) || '';

      proxy.start(function (perr, port) {
        if (perr) { return fail(message, perr); }
        var isHls = /\.m3u8($|[?#])/i.test(stream.url || '') || /mpegurl/i.test(stream.mime || '');
        var extension = isHls ? 'm3u8' : (stream.mime === 'video/mp4' ? 'mp4' : 'ts');
        var token = proxy.add(stream.url, stream.headers, stream.duration, resolvedIp, stream.backupUrls);
        stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.' + extension;
        stream.isHls = isHls;
        if (isHls && !stream.mime) { stream.mime = 'application/x-mpegurl'; }
        attachSubtitles(stream);
        respond(message, null, stream);
      });
    });
  });
}
service.register('resolve', function (message) { resolveStream(message, false); });
/* Separate Luna method: avoids older webOS bridges dropping custom boolean
   fields from a resolve payload. */
service.register('resolveSmooth', function (message) { resolveStream(message, true); });

/* mediaInfo({contentId, seriesContentId}) -> { audio, subtitles, tracks }
 * Audio languages and subtitle files for the in-player dialog.  It runs
 * before playback and returns no playable URL, license or headers. */
service.register('mediaInfo', function (message) {
  if (!needModule(message, magis, './magis') || !needModule(message, proxy, './proxy')) { return; }
  var payload = message.payload || {};
  magis.mediaInfo(payload.contentId, payload.seriesContentId, function (err, info) {
    if (err) { return fail(message, err); }
    proxy.start(function (perr) {
      if (perr) { return fail(message, perr); }
      respond(message, null, attachSubtitles(info));
    });
  });
});

service.register('liveChannels', function (message) {
  if (!needModule(message, magis, './magis')) { return; }
  var payload = message.payload || {};
  magis.getLiveChannels(payload.columnId, payload.pageNum, payload.pageSize, function (err, channels, hasMore) {
    if (err) { return fail(message, err); }
    respond(message, null, {
      channels: channels || [],
      pageNum: Math.max(1, parseInt(payload.pageNum, 10) || 1),
      hasMore: !!hasMore
    });
  });
});

service.register('liveCategories', function (message) {
  if (!needModule(message, magis, './magis')) { return; }
  magis.getLiveCategories(function (err, categories) {
    if (err) { return fail(message, err); }
    respond(message, null, { categories: categories || [] });
  });
});

service.register('fetchM3u', function (message) {
  if (!needModule(message, magis, './magis')) { return; }
  var payload = message.payload || {};
  if (!payload.url) { return fail(message, new Error('url requerida')); }
  magis.fetchM3u(payload.url, function (err, channels) {
    if (err) { return fail(message, err); }
    respond(message, null, { channels: channels || [] });
  });
});

service.register('resolveLive', function (message) {
  if (!needModule(message, magis, './magis') || !needModule(message, proxy, './proxy') ||
      !needModule(message, dnsx, './dnsx')) { return; }
  var payload = message.payload || {};
  if (payload.streamUrl) {
    /* Addon (M3U) live URL: route it through the same DoH + loopback proxy as
       the portal channels so a hijacked DNS or a blocked CDN cannot stop it.
       If the proxy cannot start, fall back to the raw URL: the media pipeline
       may still reach it, and a raw URL is better than no channel at all. */
    var m3uUrl = payload.streamUrl;
    var m3uHost = (urlmod.parse(m3uUrl || '').hostname) || '';
    /* Function expression, not a declaration: webOS 3.x ships V8 3.28, which
       rejects a function declaration inside a block ("functions can only be
       declared at top level") and the whole service fails to load. */
    var startM3uProxy = function (resolvedIp) {
      proxy.start(function (perr) {
        if (perr) {
          return respond(message, null, {
            url: m3uUrl,
            proxyPath: m3uUrl,
            isHls: true
          });
        }
        var token = proxy.add(m3uUrl, {}, 0, resolvedIp);
        respond(message, null, {
          url: m3uUrl,
          proxyPath: proxy.baseUrl() + '/media/' + token + '/stream.m3u8',
          isHls: true
        });
      });
    };
    if (!m3uHost) { return startM3uProxy(''); }
    return dnsx.resolve(m3uHost, function (dnsErr, dnsRes) {
      var resolvedIp = (dnsRes && dnsRes.ips && dnsRes.ips[0]) || '';
      startM3uProxy(resolvedIp);
    });
  }
  if (!payload.channelCode) { return fail(message, new Error('channelCode requerido')); }
  magis.resolveLive(payload.channelCode, function (err, stream) {
    if (err) { return fail(message, err); }
    var streamHost = (urlmod.parse(stream.url || '').hostname) || '';
    dnsx.resolve(streamHost, function (dnsErr, dnsRes) {
      var resolvedIp = (dnsRes && dnsRes.ips && dnsRes.ips[0]) || '';
      proxy.start(function (perr) {
        if (perr) { return fail(message, perr); }
        var token = proxy.add(stream.url, stream.headers, 0, resolvedIp, stream.backupUrls);
        stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.m3u8';
        stream.isHls = true;
        respond(message, null, stream);
      });
    });
  });
});

/* abortMedia(): immediately kills all upstream sockets and buffers in proxy & relay */
service.register('abortMedia', function (message) {
  try { relay.stop(); } catch (eRelay) { /* ignore */ }
  try {
    proxy.killActiveStreams();
  } catch (eKill) { /* ignore */ }
  message.respond({ returnValue: true });
});

/* prewarm(): start the anonymous session so the first home call is fast */
service.register('prewarm', function (message) {
  if (!needModule(message, magis, './magis')) { return; }
  magis.ensureSession(function (err) {
    if (err) { return fail(message, err); }
    message.respond({ returnValue: true, sn: magis.session.sn, userId: magis.session.userId });
  });
});

/* netdiag(): read-only report used by "Diagnóstico de red".
 * It resolves the portal/CDN hostnames with the TV resolver and with DoH,
 * then tests TCP/TLS, so a blocked DNS can be told apart from a dead server. */
service.register('netdiag', function (message) {
  if (!needModule(message, magis, './magis') || !needModule(message, netdiag, './netdiag') ||
      !needModule(message, dnsx, './dnsx')) { return; }
  var payload = message.payload || {};
  var hosts = [];
  var constants = magis.constants || {};
  if (constants.HOSTS && constants.HOSTS.length) {
    hosts = constants.HOSTS.slice(0);
  }
  /* CDN hosts seen recently are the ones that actually serve the video.  Stale
     entries would make an old, already-changed CDN look like a network fault. */
  var cached = dnsx.summary();
  for (var i = 0; i < cached.length; i++) {
    if (cached[i] && cached[i].host && cached[i].ageMs < 120000 && hosts.indexOf(cached[i].host) === -1) {
      hosts.push(cached[i].host);
    }
  }
  if (payload.hosts && payload.hosts.length) {
    hosts = payload.hosts.concat(hosts);
  }
  /* The page reports its real viewport so a cropped UI can be diagnosed from
     a photo of this screen (720p / 2K / 4K sets differ). */
  var screen = null;
  if (Number(payload.screenW) > 0 && Number(payload.screenH) > 0) {
    screen = {
      w: Number(payload.screenW),
      h: Number(payload.screenH),
      scale: Number(payload.screenScale) || 0,
      panelW: Number(payload.panelW) || 0,
      panelH: Number(payload.panelH) || 0
    };
  }
  var reportData = null;
  var layersData = null;
  var settled = false;

  function finish() {
    if (settled || !reportData || !layersData) { return; }
    settled = true;
    reportData.version = pkg.version;
    reportData.layers = layersData;
    reportData.relay = relay.state ? relay.state() : null;
    /* Codec info forwarded from the browser page */
    reportData.codec = {
      h264: payload.codecH264 || '',
      hevc: payload.codecHEVC || '',
      hls:  payload.codecHLS  || ''
    };
    respond(message, null, reportData);
  }

  /* 1. Run DNS and host reachability check */
  netdiag.run({ hosts: hosts, screen: screen }, function (err, report) {
    reportData = (err || !report) ? { verdict: 'incompleto', hosts: [], providers: [] } : report;
    finish();
  });

  /* 2. Run session and layer check in parallel with a deadline that covers a
     blocked network: the hedged portal race needs up to ~17 s before every
     hostname and DNS address has been tried. */
  var layerTimer = setTimeout(function () {
    if (!layersData) {
      var s = magis.session || {};
      layersData = {
        portal:  { ok: false, error: 'sin respuesta del portal' },
        session: { userId: s.userId ? '✓' : '?', token: s.userToken ? '✓' : '?', ready: !!s.ready, error: 'sin sesión: el portal no respondió' }
      };
      finish();
    }
  }, 24000);

  magis.ensureSession(function (sessErr) {
    var sess = magis.session || {};
    var portalHost = (magis.constants && magis.constants.HOSTS && magis.constants.HOSTS[0]) || '';
    var portalUrl  = portalHost ? ('https://' + portalHost + '/api/portalCore/v8/active') : '';
    var layerOpts = {
      portalUrl:   portalUrl,
      session:     { userId: sess.userId || '', userToken: sess.userToken || '', ready: !!sess.ready, error: sessErr ? (sessErr.message || 'error') : '' },
      liveUrl:     payload.liveUrl  || '',
      liveHeaders: payload.liveHeaders || {},
      vodUrl:      payload.vodUrl   || '',
      vodHeaders:  payload.vodHeaders  || {}
    };

    netdiag.runLayers(layerOpts, function (lerr, layers) {
      clearTimeout(layerTimer);
      layersData = layers || {};
      finish();
    });
  });
});

/* checkUpdate({ currentVersion }) -> returns update metadata */
service.register('checkUpdate', function (message) {
  if (!needModule(message, updater, './updater')) { return; }
  var payload = message.payload || {};
  var currentVer = payload.currentVersion || pkg.version;
  updater.checkUpdate(currentVer, function (err, result) {
    if (err) { return fail(message, err); }
    respond(message, null, result);
  });
});

/* applyUpdate({ ipkUrl }) -> downloads IPK, installs via appInstallService, relaunches */
service.register('applyUpdate', function (message) {
  if (!needModule(message, updater, './updater')) { return; }
  var payload = message.payload || {};
  var ipkUrl = payload.ipkUrl;
  if (!ipkUrl) {
    return fail(message, new Error('URL de actualizacion no especificada'));
  }

  var onStatus = function (state, percent, msg) {
    try {
      message.respond({
        returnValue: true,
        state: state,
        percent: percent,
        message: msg
      });
    } catch (eResp) { /* ignore */ }
  };

  updater.applyUpdate(ipkUrl, onStatus, function (err, result) {
    if (err) { return fail(message, err); }
    respond(message, null, { success: true, finished: true });
  });
});

console.log('[xuper-service] started ' + pkg.name + ' v' + pkg.version);
