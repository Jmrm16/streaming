/*
 * Network diagnostics for the XuperTV webOS port.
 *
 * WHY
 * ---
 * When a carrier blocks the service it does not usually block the video: it
 * poisons the DNS answer for the catalogue/CDN hostnames.  The TV then reports
 * a generic "stream could not be opened" error and there is no way for the
 * user to tell a blocked DNS from a dead server or a dead Wi-Fi link.
 *
 * This module answers, from inside the TV:
 *   - what the local (ISP) resolver says for every host,
 *   - what Cloudflare/Google DoH say for the same host,
 *   - whether a TCP connection to each address actually opens,
 *   - whether the DoH resolvers themselves are reachable.
 *
 * It only reads and reports.  It never changes playback and never resolves a
 * stream by itself: the DoH bypass lives in dnsx.js.
 *
 * ES5/CommonJS on purpose: webOS 4 ships an old Node.js inside its services.
 */
'use strict';

var https = require('https');
var dnsx = require('./dnsx');

var TCP_TIMEOUT = 3000;
var HTTP_TIMEOUT = 4000;
var MAX_HOSTS = 4;
/* The whole report must fit in the Luna timeout plus a wide margin, even on a
   TV whose resolver never answers. */
var HOST_DEADLINE = 9000;
var PROVIDER_DEADLINE = 4000;
var GLOBAL_DEADLINE = 14000;
var LAYER_DEADLINE = 5000;

function now() { return Date.now(); }

function parallel(tasks, done) {
  var pending = tasks.length;
  var results = [];
  if (!pending) { return done(results); }
  tasks.forEach(function (task, index) {
    var settled = false;
    task(function (value) {
      if (settled) { return; }
      settled = true;
      results[index] = value;
      pending--;
      if (pending === 0) { done(results); }
    });
  });
}

/* Hard cap for a single probe.  On webOS 4 the platform DNS stub (dns.lookup)
   can stay pending for ever when the ISP resolver is silent, and then the
   whole report never comes back: the viewer presses "Analizar red" and nothing
   ever appears.  Every task must answer, even if the answer is "no sé". */
function withDeadline(task, ms, fallback) {
  return function (cb) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) { return; }
      settled = true;
      cb(fallback());
    }, ms);
    if (timer && typeof timer.unref === 'function') { timer.unref(); }
    task(function (value) {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      cb(value);
    });
  };
}

/* TCP: does the address accept a connection at all? */
function tcpCheck(ip, port, done) {
  if (!ip) { return done({ ip: ip, port: port, ok: false, error: 'sin direccion' }); }
  dnsx.probe(ip, port, function (err, ms) {
    done({
      ip: ip,
      port: port,
      ok: !err,
      ms: ms,
      error: err ? (err.code || err.message) : ''
    });
  });
}

/* TLS + HTTP: is the service answering on this address with this SNI? */
function httpsCheck(host, ip, done) {
  var finished = false;
  var t0 = now();

  function finish(value) {
    if (finished) { return; }
    finished = true;
    done(value);
  }

  try {
    var req = https.request({
      hostname: ip,
      servername: host,
      rejectUnauthorized: false,
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'XuperTV/webOS',
        Host: host,
        Connection: 'close'
      }
    }, function (res) {
      var status = res.statusCode;
      res.resume();
      res.on('end', function () {
        finish({ host: host, ip: ip, ok: status > 0, status: status, ms: now() - t0 });
      });
    });

    req.setTimeout(HTTP_TIMEOUT, function () {
      try { req.abort(); } catch (eAbort) { /* ignore */ }
      finish({ host: host, ip: ip, ok: false, error: 'tiempo agotado', ms: now() - t0 });
    });
    req.on('error', function (err) {
      finish({ host: host, ip: ip, ok: false, error: err.code || err.message, ms: now() - t0 });
    });
    req.end();
  } catch (eReq) {
    finish({ host: host, ip: ip, ok: false, error: eReq.message || 'error https', ms: now() - t0 });
  }
}

function first(list) { return list && list.length ? list[0] : ''; }

/* A poisoned answer has NOTHING in common with the real one.  Cloudflare
 * rotates a subset of its two addresses, so a partial difference is normal and
 * must not be reported as a block. */
function hasCommon(a, b) {
  if (!a || !b) { return false; }
  for (var i = 0; i < a.length; i++) {
    if (b.indexOf(a[i]) !== -1) { return true; }
  }
  return false;
}

/* One host: local DNS, DoH, TCP and TLS on both answers. */
function checkHost(host, done) {
  var result = {
    host: host,
    system: { ok: false, ips: [], ms: 0, error: '' },
    doh: { ok: false, ips: [], ms: 0, error: '' },
    mismatch: false,
    tcp443: null,
    http: null,
    verdict: 'unknown'
  };
  var pending = 2;

  function afterResolvers() {
    pending--;
    if (pending > 0) { return; }
    result.mismatch = result.system.ok && result.doh.ok && !hasCommon(result.system.ips, result.doh.ips);

    /* Prefer the DoH answer: it is the one the bypass will use. */
    var dialIp = first(result.doh.ips) || first(result.system.ips);
    if (!dialIp) {
      result.verdict = (!result.system.ok && !result.doh.ok) ? 'sin-salida' : 'sin-tcp';
      return done(result);
    }
    tcpCheck(dialIp, 443, function (tcp) {
      result.tcp443 = tcp;
      if (!tcp.ok) {
        result.verdict = 'sin-tcp';
        return done(result);
      }
      httpsCheck(host, dialIp, function (http) {
        result.http = http;
        if (!http.ok) { result.verdict = 'tls-falla'; return done(result); }
        if (result.mismatch) { result.verdict = 'dns-distinto'; return done(result); }
        if (!result.system.ok) { result.verdict = 'dns-local-falla'; return done(result); }
        result.verdict = 'ok';
        done(result);
      });
    });
  }

  var tSys = now();
  dnsx.systemLookup(host, function (err, ips) {
    result.system.ms = now() - tSys;
    if (err) {
      result.system.error = err.code || err.message;
    } else {
      result.system.ok = true;
      result.system.ips = ips;
    }
    afterResolvers();
  });

  var tDoh = now();
  dnsx.queryDoh(host, function (dohErr, dohIps) {
    result.doh.ms = now() - tDoh;
    if (dohErr) {
      result.doh.error = dohErr.message;
    } else {
      result.doh.ok = true;
      result.doh.ips = dohIps;
    }
    afterResolvers();
  });
}

/* A single query per provider, measured, to know whether DoH itself works. */
function checkProvider(provider, done) {
  var t0 = now();
  tcpCheck(provider.ip, 443, function (tcp) {
    if (!tcp.ok) {
      return done({
        ip: provider.ip,
        sni: provider.sni,
        reachable: false,
        ms: tcp.ms,
        error: tcp.error
      });
    }
    done({
      ip: provider.ip,
      sni: provider.sni,
      reachable: true,
      ms: tcp.ms,
      queryMs: 0,
      error: ''
    });
  });
}

function verdictOf(hosts, providers) {
  /* Entries that hit the deadline carry no information: counting them as a
     block would tell the viewer that the carrier is blocking when the truth is
     that the TV never answered. */
  var knownProviders = [];
  var i;
  for (i = 0; i < providers.length; i++) {
    if (providers[i] && !providers[i].timeout) { knownProviders.push(providers[i]); }
  }
  var knownHosts = [];
  for (i = 0; i < hosts.length; i++) {
    if (hosts[i] && hosts[i].verdict !== 'sin-tiempo') { knownHosts.push(hosts[i]); }
  }
  if (!knownProviders.length || !knownHosts.length) { return 'incompleto'; }

  var reachable = 0;
  var anyDoh = false;
  var anyMismatch = false;
  var anyLocalFail = false;
  var anyTcpFail = false;
  var tcpFailCount = 0;
  for (i = 0; i < knownProviders.length; i++) {
    if (knownProviders[i].reachable) { reachable++; }
  }
  for (var j = 0; j < knownHosts.length; j++) {
    var host = knownHosts[j];
    if (host.doh && host.doh.ok) { anyDoh = true; }
    if (host.mismatch) { anyMismatch = true; }
    if (host.verdict === 'dns-local-falla') { anyLocalFail = true; }
    if (host.verdict === 'sin-tcp' || host.verdict === 'tls-falla') {
      anyTcpFail = true;
      tcpFailCount++;
    }
  }
  if (!reachable) { return 'doh-bloqueado'; }
  /* A rotating CDN always leaves one address cold; only a total failure means
     the network cannot reach the service at all. */
  if (anyTcpFail && tcpFailCount >= knownHosts.length) { return 'sin-salida'; }
  if (anyMismatch) { return 'dns-distinto'; }
  /* The ISP resolver answered nothing at all: that is a DNS block even when
     DoH saves the day, and the viewer must be told so. */
  if (anyLocalFail) { return 'dns-local-falla'; }
  if (anyTcpFail) { return 'algun-servidor'; }
  if (!anyDoh) { return 'doh-sin-respuesta'; }
  return 'ok';
}

/* run({hosts:[...], screen:{w,h,scale}}, cb) -> report */
function run(options, cb) {
  options = options || {};
  var hosts = (options.hosts || []).filter(function (h) { return typeof h === 'string' && h; });
  var extra = options.dnsxHosts || [];
  for (var e = 0; e < extra.length; e++) {
    if (hosts.indexOf(extra[e]) === -1) { hosts.push(extra[e]); }
  }
  hosts = hosts.slice(0, MAX_HOSTS);

  var t0 = now();
  var hostTasks = hosts.map(function (host) {
    return withDeadline(function (done) { checkHost(host, done); }, HOST_DEADLINE, function () {
      return {
        host: host,
        timeout: true,
        verdict: 'sin-tiempo',
        system: { ok: false, ips: [], ms: HOST_DEADLINE, error: 'sin respuesta' },
        doh: { ok: false, ips: [], ms: HOST_DEADLINE, error: 'sin respuesta' },
        mismatch: false,
        tcp443: null,
        http: null
      };
    });
  });
  var providerTasks = dnsx.providers.map(function (provider) {
    return withDeadline(function (done) { checkProvider(provider, done); }, PROVIDER_DEADLINE, function () {
      return {
        ip: provider.ip,
        sni: provider.sni,
        reachable: false,
        timeout: true,
        ms: PROVIDER_DEADLINE,
        error: 'sin respuesta'
      };
    });
  });

  var finished = false;
  var pending = 2;
  var provResults = [];
  var hostResults = [];

  function finish(partial) {
    if (finished) { return; }
    finished = true;
    clearTimeout(globalTimer);
    cb(null, {
      at: now(),
      tookMs: now() - t0,
      mode: dnsx.mode(),
      verdict: verdictOf(hostResults, provResults),
      providers: provResults,
      hosts: hostResults,
      cache: dnsx.summary(),
      screen: options.screen || null,
      partial: !!partial
    });
  }

  /* Last resort: answer with whatever arrived.  A report that never comes back
     leaves the panel empty, which is exactly what some TVs report. */
  var globalTimer = setTimeout(function () { finish(true); }, GLOBAL_DEADLINE);
  if (globalTimer && typeof globalTimer.unref === 'function') { globalTimer.unref(); }

  function checkDone() {
    pending--;
    if (pending > 0) { return; }
    finish(false);
  }

  parallel(providerTasks, function (providers) {
    provResults = providers;
    checkDone();
  });
  parallel(hostTasks, function (results) {
    hostResults = results;
    checkDone();
  });
}


/* ─── Layer diagnostics: portal, session, live, VOD ─────────────────────── */

/* Quick HEAD/GET to a URL via DoH-resolved IP.  Returns {ok, status, ms, error}. */
function layerProbe(url, headers, done) {
  if (!url) { return done({ ok: false, error: 'sin-url' }); }
  var t0 = now();
  var finished = false;
  function finish(v) { if (finished) { return; } finished = true; done(v); }

  var urlmod = require('url');
  var dnsx2  = require('./dnsx');
  var https2 = require('https');
  var http2  = require('http');

  try {
    var parsed = urlmod.parse(url);
    var host = parsed.hostname;
    var secure = parsed.protocol === 'https:';

    function doRequest(ip) {
      var connectHost = ip || host;
      var defaultPort = secure ? 443 : 80;
      var port = parsed.port ? parseInt(parsed.port, 10) : defaultPort;
      var reqHeaders = { 'User-Agent': 'Ranger/4.9.4-17294ac0', Host: parsed.host || host };
      for (var k in (headers || {})) {
        if (Object.prototype.hasOwnProperty.call(headers, k)) { reqHeaders[k] = headers[k]; }
      }
      var reqOpts = {
        hostname: connectHost, servername: host,
        rejectUnauthorized: false, port: port,
        path: parsed.path || '/', method: 'HEAD',
        headers: reqHeaders
      };
      var mod = secure ? https2 : http2;
      var req = mod.request(reqOpts, function (res) {
        res.resume();
        res.on('end', function () {
          finish({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode, ms: now() - t0 });
        });
      });
      req.setTimeout(HTTP_TIMEOUT, function () {
        try { req.abort(); } catch (e) {}
        finish({ ok: false, error: 'timeout', ms: now() - t0 });
      });
      req.on('error', function (err) {
        finish({ ok: false, error: err.code || err.message, ms: now() - t0 });
      });
      req.end();
    }

    if (!host || dnsx2.isIpv4(host)) { return doRequest(host); }
    var hit = dnsx2.cached(host);
    if (hit && hit.ips && hit.ips.length) { return doRequest(hit.ips[0]); }
    dnsx2.resolve(host, function (err, res) {
      doRequest((res && res.ips && res.ips.length) ? res.ips[0] : host);
    });
  } catch (e) {
    finish({ ok: false, error: e.message || 'excepción', ms: now() - t0 });
  }
}

/* Check whether the session object is fresh (has userId+userToken set). */
function checkSession(session, done) {
  if (!session) { return done({ ok: false, error: 'sin-sesion' }); }
  var hasUser  = session.userId  && String(session.userId).length > 2;
  var hasToken = session.userToken && String(session.userToken).length > 2;
  done({
    ok: !!(hasUser && hasToken),
    userId:  hasUser  ? '✓' : '✗',
    token:   hasToken ? '✓' : '✗',
    ready:   !!session.ready,
    error:   (!hasUser || !hasToken) ? 'sesion-incompleta' : ''
  });
}

/* Run layer probes for portal, live-CDN and VOD-CDN.
   options = { portalUrl, liveUrl, vodUrl, liveHeaders, vodHeaders, session } */
function runLayers(options, done) {
  options = options || {};
  var tasks = [];
  var labels = [];

  function probe(url, headers) {
    return withDeadline(function (cb) { layerProbe(url, headers || {}, cb); }, LAYER_DEADLINE, function () {
      return { ok: false, timeout: true, error: 'sin respuesta', ms: LAYER_DEADLINE };
    });
  }

  if (options.portalUrl) {
    labels.push('portal');
    tasks.push(probe(options.portalUrl, null));
  }

  labels.push('session');
  tasks.push(function (cb) { checkSession(options.session, cb); });

  if (options.liveUrl) {
    labels.push('live');
    tasks.push(probe(options.liveUrl, options.liveHeaders || {}));
  }

  if (options.vodUrl) {
    labels.push('vod');
    tasks.push(probe(options.vodUrl, options.vodHeaders || {}));
  }

  parallel(tasks, function (results) {
    var layers = {};
    for (var i = 0; i < labels.length; i++) {
      layers[labels[i]] = results[i] || { ok: false, timeout: true, error: 'sin-resultado' };
    }
    done(null, layers);
  });
}

module.exports = {
  run: run,
  runLayers: runLayers,
  checkHost: checkHost,
  checkProvider: checkProvider,
  verdictOf: verdictOf
};
