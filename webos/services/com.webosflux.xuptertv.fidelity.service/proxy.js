/*
 * Loopback media proxy for the webOS port.
 *
 * The CDN only serves a title with two headers (Content-Auth and
 * Content-License) that an HTML5 <video> element cannot set. This tiny server
 * listens on 127.0.0.1 and replays the request with those headers, so the app
 * can use a plain URL. Range requests are forwarded verbatim.
 *
 * The tokens live in memory only and expire with the service process.
 */
'use strict';

var http = require('http');
var https = require('https');
var crypto = require('crypto');
var urlmod = require('url');
var tsIndexer = require('./ts-indexer');
var dnsx = require('./dnsx');
var upstream = require('./upstream');

var MAX_TOKENS = 6;
var tokens = {};      // token -> { url, headers, at }
var order = [];
/* Subtitle files are small text downloads that must not disturb the active
 * media stream, so they get their own token table and route. */
var subtitleTokens = {};
var subtitleOrder = [];
var MAX_SUBTITLES = 12;
var server = null;
var port = 0;

var httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 15000 });
var httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, keepAliveMsecs: 15000, rejectUnauthorized: false });

var activeToken = null;
var activeUpstreams = [];

/* Keep virtual HLS ranges on MPEG-TS packet boundaries.  The CDN already
 * supports Range and the proxy keeps its required headers private. */
var TS_PACKET_BYTES = 188;
var HLS_SEGMENT_SECONDS = 10;

function destroyConnection(c) {
  if (!c) { return; }
  if (c.up) {
    try { c.up.unpipe(); } catch (e1) { /* ignore */ }
    try { if (typeof c.up.destroy === 'function') c.up.destroy(); } catch (e2) { /* ignore */ }
    try { if (c.up.socket) c.up.socket.destroy(); } catch (e3) { /* ignore */ }
    c.up = null;
  }
  try { if (c.upstream) c.upstream.abort(); } catch (e4) { /* ignore */ }
  try { if (c.upstream && c.upstream.socket) c.upstream.socket.destroy(); } catch (e5) { /* ignore */ }
  try { if (c.res && !c.res.finished) c.res.destroy(); } catch (e6) { /* ignore */ }
  c.upstream = null;
  c.res = null;
  c.req = null;
}

function killActiveStreams() {
  while (activeUpstreams.length > 0) {
    var c = activeUpstreams.shift();
    destroyConnection(c);
  }
}

function remember(token, entry) {
  tokens[token] = entry;
  order.push(token);
  while (order.length > MAX_TOKENS) {
    var old = order.shift();
    if (old) { delete tokens[old]; }
  }
}

function isCacheFlyIp(ip) {
  if (!ip) { return false; }
  return /^66\.225\./.test(ip) || /^205\.234\./.test(ip) || /^167\.99\./.test(ip);
}

function resolveHostIp(entry, cb) {
  if (!entry) { return cb(''); }
  if (entry.resolvedIp && dnsx.isIpv4(entry.resolvedIp)) {
    return cb(entry.resolvedIp);
  }
  var parsed = urlmod.parse(entry.url || '');
  var host = parsed.hostname;
  if (!host || dnsx.isIpv4(host)) {
    entry.resolvedIp = host || '';
    return cb(entry.resolvedIp);
  }
  var hit = dnsx.cached(host);
  if (hit && hit.ips && hit.ips.length) {
    entry.resolvedIp = dnsx.dial(host, hit.ips);
    return cb(entry.resolvedIp);
  }
  dnsx.resolve(host, function (err, res) {
    if (!err && res && res.ips && res.ips.length) {
      entry.resolvedIp = dnsx.dial(host, res.ips);
    } else {
      entry.resolvedIp = host;
    }
    cb(entry.resolvedIp);
  });
}

function normalizeBackups(list) {
  var out = [];
  if (!Array.isArray(list)) { return out; }
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item) { continue; }
    if (typeof item === 'string') {
      out.push({ url: item, headers: null });
    } else if (item.url) {
      out.push({ url: item.url, headers: item.headers || null });
    }
  }
  return out;
}

function add(target, headers, duration, resolvedIp, backupUrls) {
  var token = crypto.randomBytes(12).toString('hex');
  var entry = {
    url: target,
    backupUrls: normalizeBackups(backupUrls),
    backupIndex: 0,
    headers: headers || {},
    duration: Number(duration) || 0,
    contentLength: 0,
    lengthWaiters: null,
    resolvedIp: resolvedIp || '',
    at: Date.now()
  };
  remember(token, entry);

  var parsed = urlmod.parse(target || '');
  if (parsed.hostname && !dnsx.isIpv4(parsed.hostname) && !entry.resolvedIp) {
    var hit = dnsx.cached(parsed.hostname);
    if (hit && hit.ips && hit.ips.length) {
      entry.resolvedIp = dnsx.dial(parsed.hostname, hit.ips);
    }
    dnsx.resolve(parsed.hostname, function (err, res) {
      if (!err && res && res.ips && res.ips.length) {
        entry.resolvedIp = dnsx.dial(parsed.hostname, res.ips);
      }
    });
  }

  return token;
}

/* Registers a subtitle URL and returns a loopback URL the page can XHR.
 * The page cannot read the CDN directly (no Access-Control-Allow-Origin). */
function addSubtitle(target) {
  var token = crypto.randomBytes(12).toString('hex');
  subtitleTokens[token] = { url: target, at: Date.now() };
  subtitleOrder.push(token);
  while (subtitleOrder.length > MAX_SUBTITLES) {
    var old = subtitleOrder.shift();
    if (old) { delete subtitleTokens[old]; }
  }
  return baseUrl() + '/sub/' + token + '.srt';
}

function sendSubtitle(req, res, entry) {
  resolveHostIp(entry, function (ip) {
    var parsed = urlmod.parse(entry.url || '');
    var secure = parsed.protocol === 'https:';
    var host = parsed.hostname;
    var connectHost = ip || host;
    var defaultPort = secure ? 443 : 80;
    var port = parsed.port || defaultPort;
    var servername = host;
    var options = {
      hostname: connectHost,
      host: connectHost,
      servername: servername,
      rejectUnauthorized: false,
      port: port,
      path: parsed.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Ranger/4.9.4-17294ac0',
        'Accept': '*/*',
        Host: parsed.host || (host + (port !== defaultPort ? ':' + port : ''))
      },
      agent: upstream.agentFor(secure, connectHost, port) || (secure ? httpsAgent : httpAgent)
    };
    var failed = false;
    /* Do not shadow the shared `upstream` module: it selected the agent
       above. Shadowing it made every loopback subtitle request throw before
       opening a socket, leaving the UI switched ON with no visible captions. */
    var subtitleRequest = (secure ? https : http).request(options, function (up) {
      var parts = [];
      up.on('data', function (chunk) { parts.push(chunk); });
      up.on('end', function () {
        if (failed) { return; }
        var body = Buffer.concat(parts);
        var ok = up.statusCode >= 200 && up.statusCode < 300;
        res.writeHead(ok ? 200 : 502, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': body.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'private, max-age=300'
        });
        res.end(body);
      });
    });
    subtitleRequest.setTimeout(20000, function () { try { subtitleRequest.abort(); } catch (eAbort) { /* ignore */ } });
    subtitleRequest.on('error', function () {
      if (failed) { return; }
      failed = true;
      try {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('subtitle upstream error');
      } catch (e502) { /* ignore */ }
    });
    subtitleRequest.end();
  });
}

/* CacheFly-backed CDNs are the ones where the operator-level SNI block hits
 * hardest (Chile, Argentina, Colombia).  The 1.6.x builds survived by forcing
 * TLS and sending `cachefly.net` as SNI.  We keep the real hostname first and
 * use that camouflage only as a retry, so a network that does not block the
 * real name keeps normal TLS. */
function isCacheFlyHost(host, ip) {
  if (isCacheFlyIp(ip)) { return true; }
  return /swzablvpm|kyalbhxgw|m3x8o50te|qnrgmzpcw|faolmbghu/i.test(String(host || ''));
}

function mediaRequest(entry, method, extraHeaders, resolvedIp) {
  var parsed = urlmod.parse(entry.url || '');
  var host = parsed.hostname;
  var connectHost = resolvedIp || entry.resolvedIp;
  if (!connectHost && host) {
    var hit = dnsx.cached(host);
    if (hit && hit.ips && hit.ips.length) {
      connectHost = dnsx.dial(host, hit.ips);
      entry.resolvedIp = connectHost;
    }
  }
  if (!connectHost) {
    connectHost = host;
  }

  /* Conexión transparente: respeta el protocolo original y el hostname real en
     el SNI.  Si el reintento camuflado está activo para este recurso CacheFly,
     se fuerza HTTPS y se envía `cachefly.net` como SNI (comportamiento 1.6.17). */
  var secure = parsed.protocol === 'https:';
  var masked = !!(entry._maskSni && isCacheFlyHost(host, connectHost));
  if (masked) { secure = true; }

  var headers = {};
  var k;
  for (k in entry.headers) {
    if (Object.prototype.hasOwnProperty.call(entry.headers, k)) { headers[k] = entry.headers[k]; }
  }
  for (k in extraHeaders || {}) {
    if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) { headers[k] = extraHeaders[k]; }
  }

  var defaultPort = secure ? 443 : 80;
  var port = (masked && parsed.port === '80') ? 443 : (parsed.port || defaultPort);
  headers.Host = parsed.host || (host + (port !== defaultPort ? ':' + port : ''));

  return {
    secure: secure,
    options: {
      hostname: connectHost,
      host: connectHost,
      servername: masked ? 'cachefly.net' : host,
      rejectUnauthorized: false,
      port: port,
      path: parsed.path,
      method: method,
      headers: headers,
      agent: upstream.agentFor(secure, connectHost, port) || (secure ? httpsAgent : httpAgent)
    }
  };
}

function sourceLength(entry, done) {
  if (entry.contentLength > 0) { return done(null, entry.contentLength); }
  if (entry.lengthWaiters) { entry.lengthWaiters.push(done); return; }
  entry.lengthWaiters = [done];
  resolveHostIp(entry, function (ip) {
    var requestInfo = mediaRequest(entry, 'GET', { Range: 'bytes=0-0' }, ip);
    var req = (requestInfo.secure ? https : http).request(requestInfo.options, function (up) {
      var match = /\/(\d+)$/.exec(String(up.headers['content-range'] || ''));
      var length = match ? parseInt(match[1], 10) : parseInt(up.headers['content-length'], 10);
      up.resume();
      var waiters = entry.lengthWaiters || [];
      entry.lengthWaiters = null;
      if (length > 0) { entry.contentLength = length; }
      for (var i = 0; i < waiters.length; i++) {
        waiters[i](length > 0 ? null : new Error('el CDN no informó el tamaño'), length);
      }
    });
    req.setTimeout(15000, function () { try { req.abort(); } catch (eAbort) {} });
    req.on('error', function (err) {
      var waiters = entry.lengthWaiters || [];
      entry.lengthWaiters = null;
      for (var i = 0; i < waiters.length; i++) { waiters[i](err); }
    });
    req.end();
  });
}

function readRange(entry, start, end, done) {
  resolveHostIp(entry, function (ip) {
    var info = mediaRequest(entry, 'GET', { Range: 'bytes=' + start + '-' + end }, ip);
    var req = (info.secure ? https : http).request(info.options, function (up) {
      var parts = []; up.on('data', function (c) { parts.push(c); });
      up.on('end', function () { done(up.statusCode >= 200 && up.statusCode < 300 ? null : new Error('rango rechazado'), Buffer.concat(parts)); });
    });
    req.setTimeout(25000, function () { try { req.abort(); } catch (eAbort) {} });
    req.on('error', function (err) { done(err); }); req.end();
  });
}

function sendVirtualHls(req, res, token, entry) {
  sourceLength(entry, function (err, length) {
    if (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('no se pudo crear el manifiesto HLS');
      return;
    }
    if (!entry.indexer) { entry.indexer = tsIndexer.create(length, function (start, end, cb) { readRange(entry, start, end, cb); }); entry.indexer.start(); }
    var indexer = entry.indexer;
    if (!indexer.segments.length && !indexer.complete) { indexer.when(function () { sendVirtualHls(req, res, token, entry); }); return; }
    var lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:4',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-TARGETDURATION:' + HLS_SEGMENT_SECONDS,
      '#EXT-X-MEDIA-SEQUENCE:0'
    ];
    for (var i = 0; i < indexer.segments.length; i++) {
      var segment = indexer.segments[i];
      lines.push('#EXTINF:' + segment.duration.toFixed(3) + ',');
      lines.push('#EXT-X-BYTERANGE:' + (segment.end - segment.start + 1) + '@' + segment.start);
      lines.push('stream.ts');
    }
    if (indexer.complete) { lines.push('#EXT-X-ENDLIST'); }
    var body = lines.join('\n') + '\n';
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
}

/* Modern webOS HLS players strictly resolve a playlist's relative segment,
 * key and nested-playlist URLs against the loopback manifest URL.  Those
 * child requests must keep the portal's authorization headers too.  Rewrite
 * every URI to an opaque local route and proxy it with the parent token. */
function base64Url(value) {
  return new Buffer(String(value), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  var raw = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (raw.length % 4) { raw += '='; }
  return new Buffer(raw, 'base64').toString('utf8');
}

function hlsChildUrl(token, manifestUrl, reference) {
  if (!reference || reference.indexOf('data:') === 0) { return reference; }
  return baseUrl() + '/hls/' + token + '/' + base64Url(urlmod.resolve(manifestUrl, reference));
}

function rewriteHlsManifest(body, token, manifestUrl) {
  var lines = String(body || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) { continue; }
    if (line.charAt(0) !== '#') {
      lines[i] = hlsChildUrl(token, manifestUrl, line);
    } else if (line.indexOf('URI=') !== -1) {
      lines[i] = line.replace(/URI=("|')([^"']+)\1/g, function (all, quote, reference) {
        return 'URI=' + quote + hlsChildUrl(token, manifestUrl, reference) + quote;
      });
    }
  }
  return lines.join('\n');
}

function forward(req, res, entry, token) {
  /* When switching to a different movie or episode, immediately abort all previous video streams */
  if (activeToken !== token) {
    killActiveStreams();
    activeToken = token;
  }

  var rangeHeaders = {};
  if (req.headers.range) { rangeHeaders.Range = req.headers.range; }
  if (req.headers['if-range']) { rangeHeaders['If-Range'] = req.headers['if-range']; }

  resolveHostIp(entry, function (ip) {
    if (res.finished) { return; }

    var requestInfo = mediaRequest(entry, req.method === 'HEAD' ? 'HEAD' : 'GET', rangeHeaders, ip);
    var secure = requestInfo.secure;
    var opts = requestInfo.options;

    if (res.socket) {
      try { res.socket.setNoDelay(true); } catch (eNd1) { /* ignore */ }
    }

    var connRecord = { upstream: null, res: res, req: req, up: null };
    activeUpstreams.push(connRecord);

    function untrack() {
      var idx = activeUpstreams.indexOf(connRecord);
      if (idx !== -1) { activeUpstreams.splice(idx, 1); }
    }
    /* Tear down only the upstream connection.  The downstream response belongs
       to req/res: destroying it here made every protocol/CDN retry write to a
       dead socket and could truncate the tail of a piped stream. */
    function cleanup() {
      untrack();
      if (connRecord.up) {
        try { connRecord.up.unpipe(); } catch (e1) { /* ignore */ }
        try { if (typeof connRecord.up.destroy === 'function') connRecord.up.destroy(); } catch (e2) { /* ignore */ }
        try { if (connRecord.up.socket) connRecord.up.socket.destroy(); } catch (e3) { /* ignore */ }
        connRecord.up = null;
      }
      try { if (connRecord.upstream) connRecord.upstream.abort(); } catch (e4) { /* ignore */ }
      try { if (connRecord.upstream && connRecord.upstream.socket) connRecord.upstream.socket.destroy(); } catch (e5) { /* ignore */ }
      connRecord.upstream = null;
      connRecord.res = null;
      connRecord.req = null;
    }

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);

    var upstream = (secure ? https : http).request(opts, function (up) {
      connRecord.up = up;
      if (up.socket) {
        try { up.socket.setNoDelay(true); } catch (eNd2) { /* ignore */ }
      }
      upstream.setTimeout(0);
      if (upstream.socket) {
        try { upstream.socket.setTimeout(0); } catch (e1) { /* ignore */ }
      }

      /* DPI block pages usually arrive as 403/451 (HTML), not as a socket
         error.  For CacheFly CDNs retry once with the 1.6.17 camouflage. */
      if (!entry._maskSni && isCacheFlyHost(urlmod.parse(entry.url || '').hostname, ip) &&
          (up.statusCode === 403 || up.statusCode === 451)) {
        up.resume();
        console.log('[proxy] CDN CacheFly respondió ' + up.statusCode + ', reintentando con SNI camuflado...');
        entry._maskSni = true;
        entry.resolvedIp = '';
        cleanup();
        return forward(req, res, entry, token);
      }

      var rawMime = (up.headers['content-type'] || '').toLowerCase();
      var contentType = 'video/mp2t';
      if (rawMime.indexOf('mp4') !== -1) {
        contentType = 'video/mp4';
      } else if (rawMime.indexOf('mpegurl') !== -1 || (entry.url && entry.url.indexOf('.m3u8') !== -1)) {
        contentType = 'application/vnd.apple.mpegurl';
      }
      var isM3u8 = (contentType === 'application/vnd.apple.mpegurl');

      var out = {
        'Content-Type': contentType,
        'Accept-Ranges': up.headers['accept-ranges'] || 'bytes',
        'Access-Control-Allow-Origin': '*',
        /* This is a loopback-only authenticated proxy.  no-store makes the
           webOS media pipeline discard every received range, leaving it with a
           tiny buffer and visible micro-pauses.  A short private cache permits
           normal read-ahead/retry without sharing the licensed response. */
        'Cache-Control': isM3u8 ? 'no-cache, no-store' : 'private, max-age=120',
        'Connection': 'keep-alive'
      };
      if (up.headers['content-length']) { out['Content-Length'] = up.headers['content-length']; }
      if (up.headers['content-range']) { out['Content-Range'] = up.headers['content-range']; }

      if (req.method === 'HEAD') {
        res.writeHead(up.statusCode || 200, out);
        res.end();
        up.resume();
        return;
      }

      if (isM3u8) {
        var chunks = [];
        up.on('data', function (chunk) { chunks.push(chunk); });
        up.on('error', function () { cleanup(); });
        up.on('end', function () {
          var body = rewriteHlsManifest(Buffer.concat(chunks).toString('utf8'), token, entry.url);
          delete out['Content-Length'];
          delete out['Content-Range'];
          out['Content-Length'] = Buffer.byteLength(body);
          try {
            res.writeHead(up.statusCode || 200, out);
            res.end(body);
          } catch (eManifest) { cleanup(); }
        });
        return;
      }

      res.writeHead(up.statusCode || 200, out);

      up.on('error', function () { cleanup(); });
      /* Do not clean up on 'end'/'close': cleanup() unpipes, and unpiping from
         inside an 'end' listener runs before pipe's own onend, so the response
         would never be ended.  res 'finish'/'close' releases the entry. */
      up.pipe(res);
    });

    connRecord.upstream = upstream;

    if (upstream.socket) {
      try { upstream.socket.setNoDelay(true); } catch (eNd3) { /* ignore */ }
    }

    /* Connect timeout only - aborted only if headers do not arrive in 25s */
    upstream.setTimeout(25000, function () {
      if (!res.headersSent) {
        try { upstream.abort(); } catch (e) { /* ignore */ }
        try {
          res.writeHead(504, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('gateway timeout');
        } catch (e504) { /* ignore */ }
      }
      cleanup();
    });

    upstream.on('error', function (uErr) {
      if (entry && entry.url) {
        var h = urlmod.parse(entry.url).hostname;
        var hit = dnsx.cached(h);
        if (hit && hit.ips && hit.ips.length > 1) {
          entry.resolvedIp = dnsx.dial(h, hit.ips);
        }
      }
      /* Si el CDN es CacheFly, probar una vez el camuflaje de la 1.6.17 antes
         de cambiar de protocolo: en Claro/ETB el bloqueo llega por SNI. */
      if (!res.headersSent && entry && !entry._maskSni &&
          isCacheFlyHost(urlmod.parse(entry.url || '').hostname, entry.resolvedIp)) {
        console.log('[proxy] upstream CacheFly falló (' + (uErr && (uErr.code || uErr.message)) + '), reintentando con SNI camuflado cachefly.net...');
        entry._maskSni = true;
        entry.resolvedIp = '';
        cleanup();
        return forward(req, res, entry, token);
      }
      /* Fallback adaptativo: si falla HTTP por bloqueo DPI del operador en el
         puerto 80 (RST/timeout), reintenta por HTTPS; si falla HTTPS por la
         pila TLS antigua de webOS 1/2/3, reintenta por HTTP compatible.  Se
         hace una sola vez por recurso y sin destruir la respuesta del cliente. */
      if (!res.headersSent && entry && !entry._retriedProtocol && /^https?:\/\//i.test(entry.url || '')) {
        entry._retriedProtocol = true;
        var isSecure = /^https:\/\//i.test(entry.url);
        if (!isSecure) {
          console.log('[proxy] upstream HTTP falló (' + (uErr && (uErr.code || uErr.message)) + '), reintentando con HTTPS por posible bloqueo DPI...');
          entry.url = entry.url.replace(/^http:\/\//i, 'https://');
          entry.resolvedIp = '';
          cleanup();
          return forward(req, res, entry, token);
        }
        console.log('[proxy] upstream HTTPS falló (' + (uErr && (uErr.code || uErr.message)) + '), reintentando con HTTP compatible...');
        entry.url = entry.url.replace(/^https:\/\//i, 'http://');
        entry.resolvedIp = '';
        cleanup();
        return forward(req, res, entry, token);
      }
      if (!res.headersSent && entry && entry.backupUrls && entry.backupIndex < entry.backupUrls.length) {
        var next = entry.backupUrls[entry.backupIndex++];
        var nextUrl = (next && typeof next === 'string') ? next : (next && next.url);
        if (nextUrl) {
          console.log('[proxy] upstream falló (' + (uErr && (uErr.code || uErr.message)) + '), reintentando con CDN alternativa: ' + nextUrl);
          entry.url = nextUrl;
          if (next && next.headers) { entry.headers = next.headers; }
          entry.resolvedIp = '';
          /* A different CDN deserves its own HTTP<->HTTPS attempt and its own
             SNI decision (it may not be CacheFly). */
          entry._retriedProtocol = false;
          entry._maskSni = false;
          cleanup();
          return forward(req, res, entry, token);
        }
      }
      if (!res.headersSent) {
        try {
          res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('upstream error');
        } catch (e502) { /* ignore */ }
      } else {
        /* Mid-stream failure: abort the incomplete response instead of
           leaving the TV waiting for the rest of the body. */
        try { res.destroy(); } catch (eDestroy) { /* ignore */ }
      }
      cleanup();
    });

    upstream.end();
  });
}

function handler(req, res) {
  try { req.setTimeout(0); } catch (eT1) { /* ignore */ }
  try { res.setTimeout(0); } catch (eT2) { /* ignore */ }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range'
    });
    res.end();
    return;
  }
  if (req.url === '/media/abort') {
    killActiveStreams();
    activeToken = null;
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('aborted');
    return;
  }
  var sub = /^\/sub\/([a-f0-9]{24})\.srt$/.exec(req.url || '');
  if (sub) {
    var subEntry = subtitleTokens[sub[1]];
    if (!subEntry) {
      res.writeHead(410, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('expired');
      return;
    }
    sendSubtitle(req, res, subEntry);
    return;
  }
  var hls = /^\/hls\/([a-f0-9]{24})\/([A-Za-z0-9_-]+)$/.exec((req.url || '').split('?')[0]);
  if (hls) {
    var hlsEntry = tokens[hls[1]];
    if (!hlsEntry) {
      res.writeHead(410, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('expired');
      return;
    }
    var childUrl = fromBase64Url(hls[2]);
    if (!/^https?:\/\//i.test(childUrl)) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('invalid hls child');
      return;
    }
    forward(req, res, {
      url: childUrl,
      headers: hlsEntry.headers,
      duration: 0,
      backupUrls: hlsEntry.backupUrls,
      backupIndex: hlsEntry.backupIndex
    }, hls[1]);
    return;
  }
  var m = /^\/media\/([a-f0-9]{24})(?:\/([^\?#]*))?(?:[?#].*)?$/.exec(req.url || '');
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('not found');
    return;
  }
  var token = m[1];
  var subpath = m[2] || '';
  var entry = tokens[token];
  if (!entry) {
    res.writeHead(410, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('expired');
    return;
  }
  if (entry.url.indexOf('.m3u8') === -1 && subpath.indexOf('.m3u8') !== -1) {
    sendVirtualHls(req, res, token, entry);
    return;
  }
  forward(req, res, entry, token);
}

function start(cb) {
  if (server && port) { return cb(null, port); }
  server = http.createServer(handler);
  server.timeout = 0;
  if (typeof server.setTimeout === 'function') {
    server.setTimeout(0);
  }
  server.on('error', function (err) { cb(err); });
  server.listen(0, '127.0.0.1', function () {
    port = server.address().port;
    cb(null, port);
  });
}

function baseUrl() {
  return port ? 'http://127.0.0.1:' + port : '';
}

module.exports = {
  start: start,
  add: add,
  addSubtitle: addSubtitle,
  baseUrl: baseUrl,
  port: function () { return port; },
  killActiveStreams: killActiveStreams
};

