/*
 * Magis portal client for the XuperTV webOS port.
 *
 * PROVENANCE
 * ----------
 * Protocol recovered statically from Xuper.apk (4.34.4):
 *   - body crypto: fc/b.java (DESede/ECB/PKCS5) + dc/a.java (base64)
 *   - portal key : AndroidManifest meta-data PORTAL_KEY, decrypted with
 *                  jb/b.java + fc/b.java using the literal in k2/b.java
 *   - endpoints  : classes2.dex strings (/api/portalCore/...)
 *   - constants  : build config (portalCode masnew, apkVer header 43404)
 *
 * Only an ANONYMOUS device session is created (v3/snToken + v8/active).
 * No user credentials are read, stored or transmitted by this module.
 *
 * ES5/CommonJS on purpose: webOS 4 ships an old Node.js inside its services.
 */
'use strict';

var crypto = require('crypto');
var https = require('https');
var http = require('http');
var fs = require('fs');
var url = require('url');
var path = require('path');
var dnsx = require('./dnsx');
var upstream = require('./upstream');

/* --------------------------------------------------------------- constants */
var KEY_HEX = 'e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8';
var HOSTS = [
  'ftmrmy.jdfey0cd.com',
  'fuxok.nguvmqhpk.com',
  'eajmnp.hcgv1dt8.com',
  'mptec.dhkrxuzcy.com',
  'hinumz.a878kkoyc.com',
  'krdwvd.swcaw7qx.com',
  'osuhk.m3x8o50te.com',
  'oogoy.f30c96w8.com'
];
var PORTAL_CODE = 'masnew';
var APP_ID = 'com.android.msandroid';
var APK_VERSION = '49902';
var SPKG_VER = '2024-09-10 06:25:30_33_13_';
var APK_VER_HEADER = '43404';
var USER_AGENT = 'okhttp/3.12.12';
var CONTENT_TYPE = 'application/json;charset=utf-8';
var SNTOKEN_SALT = 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28';
var FIXED_MAC = '02:00:00:00:00:00';
var FIXED_RESERVE1 = '583442714b345572434a4d5769637461545a735936413d3d';
var FIXED_DRM_ID = '0iSGEyv2EqiS/nqI/I3hqdu12irw5Q3/uqrWvRFx9bM=';
var UA_CDN = 'Ranger/4.9.4-17294ac0';

var RATE_MS = 450;          // portal pacing (observed safe value)
var TREE_TTL = 10 * 60 * 1000;
var SEARCH_TTL = 3 * 60 * 1000;
var SLB_TTL = 5 * 60 * 1000;

/* ------------------------------------------------------------ seed rescue */
/* In some countries the portal answers `portal100024` (region blocked) to the
   anonymous activation.  The reference plugin solves it with borrowed device
   sessions ("seeds").  The pool is the ONLY way out of a blocked region, so it
   is cached, sampled, expired and dead-marked instead of fetching one seed. */
var SEED_URL = 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/seeds/seeds.json';
var SEED_FILE = '/tmp/xuper-seeds.json';
var SEED_DEAD_FILE = '/tmp/xuper-seeds-dead.json';
var SEED_MAX = 200;
var SEED_MIN_LIFE_MS = 5 * 60 * 1000;
var SEED_RESCUE_ROUNDS = 3;
var SEED_POOL_FRESH_MS = 10 * 60 * 1000;
var SEED_REFRESH_COOLDOWN_MS = 10 * 1000;
var SEED_FAILED_COOLDOWN_MS = 30 * 1000;
var DEAD_SEED_MS = 6 * 3600 * 1000;
var GEO_BLOCKED = 'portal100024';
var SESSION_DEAD = { aaa100027: 1, aaa100028: 1, aaa100080: 1, aaa100082: 1, aaa100083: 1 };
var SESSION_MAX_AGE_MS = 6 * 3600 * 1000;

var ROOT_CODES = {
  featured: 'masnew_featured',
  movies: 'masnew_movies',
  series: 'masnew_series',
  anime: 'masnew_anime',
  kids: 'masnew_kids',
  free: 'masnew_free'
};

var ROOT_CATEGORY = {
  featured: 'destacado',
  movies: 'pelicula',
  series: 'serie',
  anime: 'anime',
  kids: 'infantil',
  free: 'gratis'
};

var DEVICE_FIXED = {
  loginType: '2', appLanguage: 'en', hardwareInfo: 'ranchu',
  model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a',
  B29: '', reserve1: FIXED_RESERVE1, deviceToken: '', drmId: FIXED_DRM_ID, sdkVer: 33
};

var FINGERPRINT_FIXED = {
  board: 'goldfish_arm64', brand: 'google', cpuAbi: 'arm64-v8a', device: 'emu64a',
  diskInfo: '8GB', display: 'sdk_gphone64_arm64',
  fingerprint: 'google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys',
  hardware: 'ranchu', host: 'abfarm', manufacturer: 'Google', ramSize: '4GB',
  romSize: '8GB', tags: 'release-keys', verId: ''
};

/* ------------------------------------------------------------------ crypto */
function bufFrom(value, enc) {
  return Buffer.from ? Buffer.from(value, enc) : new Buffer(value, enc);
}
function bufAlloc(size) {
  if (Buffer.alloc) { return Buffer.alloc(size); }
  var b = new Buffer(size);
  b.fill(0);
  return b;
}

var EMPTY_IV = bufFrom('', 'binary');

function encryptBody(plain) {
  var c = crypto.createCipheriv('des-ede3', bufFrom(KEY_HEX, 'hex'), EMPTY_IV);
  var raw = Buffer.concat([c.update(bufFrom(plain, 'utf8')), c.final()]);
  return bufFrom(raw.toString('base64'), 'ascii').toString('hex');
}

function decryptBlob(wire) {
  var b64 = bufFrom(wire, 'hex').toString('ascii');
  var d = crypto.createDecipheriv('des-ede3', bufFrom(KEY_HEX, 'hex'), EMPTY_IV);
  return Buffer.concat([d.update(bufFrom(b64, 'base64')), d.final()]).toString('utf8');
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/* ----------------------------------------------------------------- helpers */
function text(value) {
  if (value === null || value === undefined) { return ''; }
  return String(value);
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

function imageOf(asset, type) {
  var list = asset && asset.posterList;
  if (list && list.length) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].fileType === type && trim(list[i].fileUrl) !== '') {
        return trim(list[i].fileUrl);
      }
    }
  }
  /* Fallback: campos planos de imagen (el portal los incluye en algunos endpoints). */
  if (type === 'icon') {
    return trim(asset.iconUrl || asset.icon || asset.coverUrl || asset.cover ||
      asset.posterUrl || asset.poster || asset.imageUrl || asset.image || '');
  }
  if (type === 'poster') {
    return trim(asset.posterUrl || asset.poster || asset.coverUrl || asset.cover ||
      asset.iconUrl || asset.icon || asset.imageUrl || asset.image || '');
  }
  if (type === 'stage') {
    return trim(asset.backdropUrl || asset.backdrop || asset.landscapeUrl || asset.landscape ||
      asset.wideImage || asset.bannerImage || '');
  }
  return '';
}

function genresOf(asset) {
  var raw = text(asset && asset.tags);
  if (!raw) { return []; }
  var parts = raw.split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var g = trim(parts[i]);
    if (g) { out.push(g); }
  }
  return out;
}

/* ----------------------------------------------------------------- session */
var session = { sn: '', userId: '', userToken: '', snToken: '', ready: false, busy: false, seed: null, usesSeed: false, at: 0 };

/* A rejected live authorization can leave the anonymous portal token stale.
 * Do not let one failed channel poison the shared session used by catalog and
 * VOD. The caller is responsible for allowing just one recovery attempt. */
function resetSessionAfterLiveFailure() {
  session.ready = false;
  session.userId = '';
  session.userToken = '';
  session.snToken = '';
  session.seed = null;
  session.usesSeed = false;
  session.at = 0;
  liveResolveCache = {};
}
var queue = [];
var lastCallAt = 0;

function enqueue(fn) {
  queue.push(fn);
  drain();
}

function drain() {
  if (session.busy || !queue.length) { return; }
  var wait = lastCallAt + RATE_MS - Date.now();
  if (wait > 0) {
    session.busy = true;
    setTimeout(function () { session.busy = false; drain(); }, wait);
    return;
  }
  var fn = queue.shift();
  session.busy = true;
  lastCallAt = Date.now();
  fn(function () {
    session.busy = false;
    drain();
  });
}

function deviceDict() {
  var d = {};
  for (var k in DEVICE_FIXED) {
    if (Object.prototype.hasOwnProperty.call(DEVICE_FIXED, k)) { d[k] = DEVICE_FIXED[k]; }
  }
  d.apkVersion = APK_VERSION;
  d.sysVersion = SPKG_VER;
  d.appId = APP_ID;
  d.sn = session.sn;
  return d;
}

var preferredHost = '';
var HOST_TIMEOUT = 6000;
var HOST_HEDGE = 1500;
var HTTP_FALLBACK_DELAY = 1200;

function hostOrder() {
  var out = [];
  if (preferredHost) { out.push(preferredHost); }
  for (var i = 0; i < HOSTS.length; i++) {
    if (HOSTS[i] !== preferredHost) { out.push(HOSTS[i]); }
  }
  return out;
}

/* One request to the portal.  Several hosts are started in a staggered race:
   the first host that speaks the portal protocol wins and the rest are
   aborted.  A carrier that drops one Cloudflare address (or a Cloudflare WAF
   that answers HTML) therefore no longer delays every catalogue call by a full
   timeout, which is what produced "portal: tiempo agotado" and a missing
   session on blocked networks. */
function post(path, body, done) {
  var payload;
  try {
    payload = encryptBody(JSON.stringify(body));
  } catch (encErr) {
    return done(new Error(path + ': error cifrando cuerpo: ' + encErr.message));
  }

  var order = hostOrder();
  var launched = 0;
  var active = 0;
  var settled = false;
  var lastError = null;
  var hedgeTimer = null;
  var requests = [];

  function finish(err, result) {
    if (settled) { return; }
    settled = true;
    if (hedgeTimer) { clearTimeout(hedgeTimer); hedgeTimer = null; }
    for (var i = 0; i < requests.length; i++) {
      try { requests[i].abort(); } catch (eAbort) { /* ignore */ }
    }
    done(err, result);
  }

  function maybeFinish() {
    if (settled || launched < order.length) { return; }
    if (active <= 0) { finish(lastError || new Error(path + ': el portal no respondió')); }
  }

  function attempt(host, transport, onNetworkError) {
    var plainHttp = transport === 'http';
    var baseOptions = {
      hostname: host,
      servername: host,
      rejectUnauthorized: false,
      protocol: plainHttp ? 'http:' : 'https:',
      port: plainHttp ? 80 : 443,
      agent: upstream.agentFor(!plainHttp, host, plainHttp ? 80 : 443),
      path: '/api/portalCore/' + path,
      method: 'POST',
      headers: {
        apk: APP_ID,
        apkVer: APK_VER_HEADER,
        spkgVer: SPKG_VER,
        'User-Agent': USER_AGENT,
        'Content-Type': CONTENT_TYPE,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    dnsx.prepare(baseOptions, function (prepErr, options) {
      if (settled) { return; }
      if (prepErr) {
        lastError = prepErr;
        active--;
        maybeFinish();
        return;
      }

      var reqFinished = false;
      var resStarted = false;
      var req = null;

      function fail(err) {
        if (reqFinished || settled) { return; }
        reqFinished = true;
        lastError = err;
        try { if (req) { req.abort(); } } catch (eA) { /* ignore */ }
        if (preferredHost === host) { preferredHost = ''; }
        /* TLS/SNI blocked: do not wait for the head start, go HTTP now. */
        if (!plainHttp && onNetworkError) {
          try { onNetworkError(); } catch (eOn) { /* ignore */ }
        }
        active--;
        maybeFinish();
      }

      function retryable(err) {
        /* Protocol/decrypt answers only make sense from the portal itself;
           network and HTML answers mean this host/IP is not usable. */
        lastError = err;
        if (preferredHost === host) { preferredHost = ''; }
        if (!plainHttp && onNetworkError) {
          try { onNetworkError(); } catch (eOnHttp) { /* ignore */ }
        }
        active--;
        maybeFinish();
      }

      try {
        req = (plainHttp ? http : https).request(options, function (res) {
          resStarted = true;
          var chunks = [];
          res.on('data', function (c) { chunks.push(c); });
          res.on('error', function (eRes) { fail(eRes); });
          res.on('end', function () {
            if (reqFinished || settled) { return; }
            reqFinished = true;
            var raw = Buffer.concat(chunks).toString('utf8');
            var answer;
            try {
              answer = JSON.parse(raw);
            } catch (eJson) {
              return retryable(new Error(path + ': respuesta no JSON (' + res.statusCode + ') en ' + host));
            }
            /* Any JSON answer proves this hostname/IP is reachable: keep it
               first for the next call and for the network diagnostic instead
               of starting from a dead one. */
            preferredHost = host;
            if (plainHttp) {
              console.log('[magis] portal respondió por HTTP plano en ' + host + ' (TLS/SNI filtrado por el operador)');
            }
            var hi = HOSTS.indexOf(host);
            if (hi > 0) {
              HOSTS.splice(hi, 1);
              HOSTS.unshift(host);
            }
            var code = answer.returnCode === undefined || answer.returnCode === null ? '' : String(answer.returnCode);
            if (code !== '' && code !== '0') {
              var err = new Error(path + ' -> ' + code + ' ' + text(answer.errorMessage));
              err.portalCode = code;
              return finish(err);
            }
            if (typeof answer.data === 'string' && answer.data !== '') {
              var plain;
              try {
                plain = decryptBlob(answer.data);
              } catch (e2) {
                return retryable(new Error(path + ': no se pudo descifrar la respuesta (' + e2.message + ')'));
              }
              var parsed;
              try {
                parsed = JSON.parse(plain);
              } catch (e3) {
                return retryable(new Error(path + ': respuesta descifrada no JSON'));
              }
              return finish(null, parsed);
            }
            finish(null, answer.data !== undefined && answer.data !== null ? answer.data : answer);
          });
        });
      } catch (eReq) {
        return fail(eReq);
      }

      requests.push(req);
      req.setTimeout(HOST_TIMEOUT, function () {
        fail(new Error(path + ': timeout en ' + host));
      });
      req.on('timeout', function () {
        fail(new Error(path + ': timeout en ' + host));
      });
      req.on('error', function (e) { fail(e); });
      req.on('close', function () {
        if (!resStarted) { fail(new Error(path + ': conexion cerrada en ' + host)); }
      });
      req.write(payload);
      req.end();
    });
  }

  function launchNext() {
    if (settled || launched >= order.length) { return; }
    var host = order[launched++];
    var httpStarted = false;
    var httpTimer = null;

    function startHttp() {
      if (httpStarted || settled) { return; }
      httpStarted = true;
      if (httpTimer) { clearTimeout(httpTimer); httpTimer = null; }
      attempt(host, 'http');
    }

    /* HTTPS va primero (certificado y SNI reales).  El HTTP plano solo arranca
       si el intento TLS falla o no contesta en 1,2 s: algunos operadores
       filtran TLS/SNI hacia el portal y dejan pasar el puerto 80, que es el
       mismo camino que usa el cliente nativo con {agreement}://{ip}. */
    active += 2;
    httpTimer = setTimeout(startHttp, HTTP_FALLBACK_DELAY);
    attempt(host, 'https', startHttp);
  }

  function scheduleHedge() {
    if (settled || launched >= order.length) { return; }
    hedgeTimer = setTimeout(function () {
      hedgeTimer = null;
      if (settled) { return; }
      launchNext();
      scheduleHedge();
    }, HOST_HEDGE);
  }

  launchNext();
  scheduleHedge();
}

function call(path, bean, opts, done) {
  if (typeof opts === 'function') { done = opts; opts = {}; }
  opts = opts || {};
  enqueue(function (release) {
    var body = {};
    var k;
    if (opts.baseFields !== false) {
      body.portalCode = PORTAL_CODE;
      body.userId = session.userId;
      body.userToken = session.userToken;
    }
    var dev = deviceDict();
    for (k in dev) {
      if (Object.prototype.hasOwnProperty.call(dev, k)) { body[k] = dev[k]; }
    }
    for (k in bean) {
      if (Object.prototype.hasOwnProperty.call(bean, k)) { body[k] = bean[k]; }
    }
    post(path, body, function (err, data) {
      release();
      var code = err && err.portalCode;
      var isDead = code && SESSION_DEAD[code];
      var isExpiredMsg = err && /未登录|sesi[oó]n|login|token.*expir|invalid.*sn/i.test(err.message || '');
      /* aaa100028 (not logged in) on OUR OWN anonymous session: mint a clean
         one.  A seed token cannot be renewed, so it goes to the seed rescue. */
      if (err && (code === 'aaa100028' || code === 'aaa100027' || isDead || isExpiredMsg) &&
          !opts._sessionRetried && !session.usesSeed) {
        console.log('[magis] sesión no iniciada (' + (code || err.message) + '). Renovando sesión limpia...');
        session.ready = false;
        session.userId = '';
        session.userToken = '';
        session.snToken = '';
        session.at = 0;
        return ensureSession(function (errSess) {
          if (errSess) { return done(err); }
          opts._sessionRetried = true;
          call(path, bean, opts, done);
        });
      }
      /* Region block (portal100024) or a dead token: try another pool seed,
         exactly like the reference plugin's rescue.  A seed the portal calls
         "not logged in" is marked dead so later launches skip it. */
      if (err && (code === GEO_BLOCKED || isDead || isExpiredMsg) &&
          (opts._seedTries || 0) < SEED_RESCUE_ROUNDS) {
        if (SESSION_DEAD[code] && session.usesSeed && session.seed) {
          markSeedDead(session.seed);
        }
        var tried = opts._seedTried || {};
        if (session.usesSeed && session.seed) { tried[seedIdentity(session.seed)] = true; }
        return rescueSeed(tried, function (seedErr, seed) {
          if (!seed) { return done(err); }
          opts._seedTried = tried;
          opts._seedTries = (opts._seedTries || 0) + 1;
          opts._sessionRetried = false;
          console.log('[magis] ' + (code || 'sesión caída') + ': probando otra semilla (' +
            opts._seedTries + '/' + SEED_RESCUE_ROUNDS + ')');
          call(path, bean, opts, done);
        });
      }
      done(err, data);
    });
  });
}

/* ------------------------------------------------------- seed pool helpers */
var seedPool = [];
var seedsAt = 0;
var seedInflight = false;
var seedWaiters = [];
var lastSeedFailure = 0;
var deadSeeds = {};

/* /tmp survives a service restart until the TV reboots: keep the pool there
   so a blocked region does not need the network on every launch. */
(function loadSeedCache() {
  try {
    var raw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    var list = raw && raw.seeds ? raw.seeds : raw;
    if (list && list.length) { seedPool = list; }
    if (raw && typeof raw.at === 'number') { seedsAt = raw.at; }
  } catch (eSeeds) { /* first run */ }
  if (!seedPool || !seedPool.length) {
    try {
      var fallbackPath = path.join(__dirname, 'seeds-fallback.json');
      var fallbackRaw = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      var fList = fallbackRaw && fallbackRaw.seeds ? fallbackRaw.seeds : fallbackRaw;
      if (fList && fList.length) {
        seedPool = fList;
        console.log('[magis] semillas iniciales cargadas desde fallback local: ' + seedPool.length);
      }
    } catch (eFb) { /* no fallback file */ }
  }
  try {
    var dead = JSON.parse(fs.readFileSync(SEED_DEAD_FILE, 'utf8'));
    if (dead && typeof dead === 'object') { deadSeeds = dead; }
  } catch (eDead) { /* none marked yet */ }
})();

function writeJsonSafe(file, value) {
  try { fs.writeFileSync(file, JSON.stringify(value)); } catch (eWrite) { /* read-only /tmp */ }
}

function seedIdentity(seed) {
  var tok = trim(seed && seed.userToken);
  return trim(seed && seed.sn) + '|' + tok.slice(-6);
}

function seedIsDead(seed) {
  var at = deadSeeds[seedIdentity(seed)];
  return typeof at === 'number' && Date.now() - at < DEAD_SEED_MS;
}

function markSeedDead(seed) {
  var id = seedIdentity(seed);
  if (!id || id === '|') { return; }
  deadSeeds[id] = Date.now();
  var keys = [];
  var k;
  for (k in deadSeeds) {
    if (Object.prototype.hasOwnProperty.call(deadSeeds, k)) { keys.push(k); }
  }
  keys.sort(function (a, b) { return deadSeeds[b] - deadSeeds[a]; });
  var keep = {};
  for (var i = 0; i < keys.length && i < SEED_MAX; i++) { keep[keys[i]] = deadSeeds[keys[i]]; }
  deadSeeds = keep;
  writeJsonSafe(SEED_DEAD_FILE, deadSeeds);
  console.log('[magis] semilla marcada como muerta: ' + id.slice(0, 16));
}

function seedIsUsable(seed) {
  if (!seed || !trim(seed.userId) || !trim(seed.userToken)) { return false; }
  if (typeof seed.exp === 'number' && seed.exp > 0) {
    if (seed.exp * 1000 - Date.now() < SEED_MIN_LIFE_MS) { return false; }
  }
  return !seedIsDead(seed);
}

function usableSeeds() {
  var out = [];
  for (var i = 0; i < seedPool.length; i++) {
    if (seedIsUsable(seedPool[i])) { out.push(seedPool[i]); }
  }
  return out;
}

/* `sampleSeeds` from the reference plugin: keep at most SEED_MAX, drawn at
   random per device so thousands of TVs do not all burn the same seeds. */
function storeSeeds(list) {
  var now = Date.now();
  var alive = [];
  var rest = [];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || !trim(e.userId) || !trim(e.userToken)) { continue; }
    var exp = typeof e.exp === 'number' && e.exp > 0 ? e.exp : 0;
    var entry = { userId: trim(e.userId), userToken: trim(e.userToken), sn: trim(e.sn).toLowerCase() };
    if (exp) { entry.exp = exp; }
    if (exp && exp * 1000 - now < SEED_MIN_LIFE_MS) { rest.push(entry); } else { alive.push(entry); }
  }
  var pool = alive.length >= SEED_MAX ? alive : alive.concat(rest);
  for (var j = pool.length - 1; j > 0; j--) {
    var r = Math.floor(Math.random() * (j + 1));
    var tmp = pool[j]; pool[j] = pool[r]; pool[r] = tmp;
  }
  seedPool = pool.slice(0, SEED_MAX);
  seedsAt = now;
  writeJsonSafe(SEED_FILE, { at: seedsAt, seeds: seedPool });
}

function refreshSeeds(cb) {
  cb = cb || function () {};
  if (seedInflight) { seedWaiters.push(cb); return; }
  var now = Date.now();
  if (seedPool.length && seedsAt && now - seedsAt < SEED_REFRESH_COOLDOWN_MS) {
    return cb(null, false);
  }
  if (lastSeedFailure && now - lastSeedFailure < SEED_FAILED_COOLDOWN_MS) {
    return cb(null, false);
  }
  seedInflight = true;

  function finish(err) {
    seedInflight = false;
    if (err) { lastSeedFailure = Date.now(); } else { lastSeedFailure = 0; }
    var waiters = seedWaiters.slice();
    seedWaiters = [];
    cb(err || null, !err);
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](err || null, !err); } catch (eW) { /* ignore */ }
    }
  }

  var seedOptions = url.parse(SEED_URL);
  seedOptions.method = 'GET';
  seedOptions.rejectUnauthorized = false;
  seedOptions.headers = { 'User-Agent': 'XuperTV/webOS' };
  dnsx.prepare(seedOptions, function (prepErr, seedOpts) {
    if (prepErr) { return finish(prepErr); }
    seedOpts.rejectUnauthorized = false;
    var req;
    try {
      req = https.request(seedOpts, function (res) {
        if (res.statusCode !== 200) { res.resume(); return finish(new Error('semillas HTTP ' + res.statusCode)); }
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('error', function (eRes) { finish(eRes); });
        res.on('end', function () {
          var seeds;
          try { seeds = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch (eJson) { return finish(eJson); }
          var list = seeds && seeds.seeds ? seeds.seeds : seeds;
          if (!list || !list.length) { return finish(new Error('lista de semillas vacía')); }
          storeSeeds(list);
          console.log('[magis] semillas actualizadas: ' + seedPool.length);
          finish(null);
        });
      });
    } catch (eReq) { return finish(eReq); }
    req.on('error', function (e) { finish(e); });
    req.setTimeout(6000, function () { req.abort(); finish(new Error('timeout de semillas')); });
    req.end();
  });
}

function pickSeed(tried) {
  var pool = usableSeeds();
  if (!pool.length) { return null; }
  for (var i = pool.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  for (var n = 0; n < pool.length; n++) {
    if (!tried[seedIdentity(pool[n])]) { return pool[n]; }
  }
  return null;
}

function adoptSeed(seed) {
  seed = seed || {};
  session.userId = trim(seed.userId);
  session.userToken = trim(seed.userToken);
  session.sn = trim(seed.sn).toLowerCase();
  session.snToken = '';
  session.ready = true;
  session.seed = seed;
  session.usesSeed = true;
  session.at = Date.now();
}

/* Pick a seed not tried yet.  The kept pool is reused while fresh; otherwise
   it is downloaded, bounded by the refresh/failure cooldowns. */
function rescueSeed(tried, cb) {
  tried = tried || {};
  var now = Date.now();
  var fresh = !!(seedPool.length && seedsAt && now - seedsAt < SEED_POOL_FRESH_MS && usableSeeds().length);
  function pick() {
    var seed = pickSeed(tried);
    if (!seed) { return cb(new Error('sin semillas disponibles')); }
    tried[seedIdentity(seed)] = true;
    adoptSeed(seed);
    return cb(null, seed);
  }
  if (fresh) { return pick(); }
  refreshSeeds(function () { pick(); });
}

var sessionStarting = false;
var sessionWaiters = [];

function ensureSession(done) {
  done = done || function () {};
  var now = Date.now();
  if (session.ready && session.userId && session.userToken) {
    if (!session.at || now - session.at < SESSION_MAX_AGE_MS) {
      return done(null, session);
    }
    console.log('[magis] sesión superó 6 horas en memoria. Renovando sesión preventiva...');
    session.ready = false;
  }
  sessionWaiters.push(done);
  if (sessionStarting) { return; }
  sessionStarting = true;
  session.ready = false;

  function finishSession(err, sess) {
    sessionStarting = false;
    var list = sessionWaiters.slice();
    sessionWaiters = [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](err, sess); } catch (eW) { /* ignore */ }
    }
  }

  var fp = {};
  var k;
  for (k in FINGERPRINT_FIXED) {
    if (Object.prototype.hasOwnProperty.call(FINGERPRINT_FIXED, k)) { fp[k] = FINGERPRINT_FIXED[k]; }
  }
  fp.androidId = randomHex(8);
  fp.cpuId = randomHex(8);
  fp.serialNumber = randomHex(8);
  fp.etheMac = randomHex(6).replace(/(..)(?=.)/g, '$1:');
  fp.gatewayMac = randomHex(6).replace(/(..)(?=.)/g, '$1:');
  fp.wifiMac = randomHex(6).replace(/(..)(?=.)/g, '$1:');

  /* Seeds are only useful when the portal itself answers but refuses to
     activate this device.  If every host timed out, the network is blocked and
     a borrowed userId/token cannot resolve a stream either, so fail fast and
     allow the diagnostics report to show the real cause. */
  function fetchSeedSession(origErr) {
    var tried = {};
    if (session.usesSeed && session.seed) { tried[seedIdentity(session.seed)] = true; }
    rescueSeed(tried, function (seedErr, seed) {
      if (!seed) {
        console.log('[magis] sin semilla utilizable: ' + (origErr && origErr.message));
        return finishSession(origErr);
      }
      console.log('[magis] sesión por semilla ' + seedIdentity(seed).slice(0, 16) + ' (bloqueo regional)');
      finishSession(null, session);
    });
  }

  function retrySessionOnce(origErr) {
    if (origErr && origErr._retried) { return fetchSeedSession(origErr); }
    console.log('[magis] sesión no activada por red (' + (origErr && origErr.message) + '). Reintentando una vez...');
    HOSTS.push(HOSTS.shift()); // rotar host y volver a intentar con otro IP
    var retryErr = origErr || new Error('reintento');
    retryErr._retried = true;
    setTimeout(function () {
      sessionStarting = false;
      ensureSession(function () {});
    }, 400);
  }

  call('v3/snToken', fp, { baseFields: false }, function (err, mint) {
    if (err) {
      /* No portal response at all: another host cycle cannot help, because the
         hedged post() already tried every hostname and every DNS address. */
      if (!err.portalCode) { return finishSession(err); }
      return fetchSeedSession(err);
    }
    var snToken = trim(mint && mint.snToken);
    if (!snToken) { return fetchSeedSession(new Error('el portal no devolvió snToken')); }
    var sn = mint && trim(mint.sn);
    if (!sn) {
      sn = crypto.createHash('md5').update(snToken + SNTOKEN_SALT).digest('hex');
    }
    session.snToken = snToken;
    session.sn = String(sn).toLowerCase();

    call('v8/active', {
      snToken: snToken, authVersion: '', authCode: '', preCode: '', macAddr: FIXED_MAC,
      reserve1: '', openNum: 4, channel: 'default', matadata: '', signdata: ''
    }, { baseFields: false }, function (err2, active) {
      if (err2) {
        if (err2.portalCode) { return fetchSeedSession(err2); }
        return retrySessionOnce(err2);
      }
      session.userId = trim(active && active.userId);
      session.userToken = trim(active && active.userToken);
      if (!session.userToken) { return fetchSeedSession(new Error('el portal no activó el dispositivo')); }
      session.ready = true;
      session.seed = null;
      session.usesSeed = false;
      session.at = Date.now();
      finishSession(null, session);
    });
  });
}

/* ------------------------------------------------------------ normalizers */
function itemFromAsset(asset, category, kind) {
  if (!asset || trim(asset.contentId) === '') { return null; }
  var type = trim(asset.programType) || 'movie';
  var isSeries = type === 'teleplay' || type === 'series' || (asset.volumnCount && parseInt(asset.volumnCount, 10) > 1);
  return {
    id: trim(asset.contentId),
    title: text(asset.name || asset.title),
    category: category || '',
    kind: kind || (isSeries ? 'serie' : 'película'),
    score: asset.score === undefined || asset.score === null || asset.score === '' ? '—' : text(asset.score),
    year: trim(asset.releaseTime || asset.releaseDate) ? trim(asset.releaseTime || asset.releaseDate).slice(0, 4) : '—',
    duration: text(asset.duration),
    genres: genresOf(asset),
    director: text(asset.director),
    actors: text(asset.actorDisplay || asset.actors),
    synopsis: text(asset.description || asset.synopsis),
    poster: imageOf(asset, 'icon') || imageOf(asset, 'poster'),
    landscape: imageOf(asset, 'poster') || imageOf(asset, 'stage'),
    backdrop: imageOf(asset, 'stage') || imageOf(asset, 'poster'),
    type: isSeries ? 'teleplay' : type,
    alias: text(asset.alias),
    country: trim(asset.originalCountry || asset.country),
    releaseDate: trim(asset.releaseTime || asset.releaseDate),
    tagline: trim(asset.viewPoint || asset.tagline),
    volumeCount: asset.volumnCount === undefined || asset.volumnCount === null ? (parseInt(asset.volumeCount, 10) || 0) : parseInt(asset.volumnCount, 10) || 0,
    updateCount: asset.updateCount === undefined || asset.updateCount === null ? 0 : parseInt(asset.updateCount, 10) || 0,
    moreAudio: asset.moreAudio !== undefined ? asset.moreAudio : 0,
    moreSubtitle: asset.moreSubtitle !== undefined ? asset.moreSubtitle : 0,
    row: '',
    streamUrl: '',
    portal: true
  };
}

/* ------------------------------------------------------------------- cache */
var treeCache = {};    // rootKey -> { at, rows }
var itemCache = {};    // contentId -> item (full, with synopsis)
var searchCache = {};  // q -> { at, items }
var slbCache = null;

function remember(item) {
  if (item && item.id) { itemCache[item.id] = item; }
}

function itemsFromTree(tree, rootKey) {
  var rows = tree && tree.recommendList;
  var out = [];
  var category = ROOT_CATEGORY[rootKey] || '';
  if (!rows || !rows.length) { return out; }
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var assets = row && row.assetList;
    if (!assets || !assets.length) { continue; }
    for (var a = 0; a < assets.length; a++) {
      var item = itemFromAsset(assets[a], category, null);
      if (!item) { continue; }
      item.row = text(row.name);
      if (rootKey === 'free' && /free\.kids/i.test(item.row) && item.category.indexOf('infantil') === -1) {
        item.category += ',infantil';
      }
      out.push(item);
      remember(item);
    }
  }
  return out;
}

/* -------------------------------------------------------------- public API */
function home(rootKey, pageNum, done) {
  if (typeof pageNum === 'function') { done = pageNum; pageNum = 1; }
  rootKey = ROOT_CODES[rootKey] ? rootKey : 'movies';
  pageNum = parseInt(pageNum, 10) || 1;
  if (pageNum < 1) { pageNum = 1; }
  var cacheKey = rootKey + ':' + pageNum;
  var cached = treeCache[cacheKey];
  if (cached && Date.now() - cached.at < TREE_TTL) {
    return done(null, { root: rootKey, pageNum: pageNum, items: cached.items, cached: true });
  }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('getNextColumns', {
      columnCode: ROOT_CODES[rootKey], pageNum: pageNum, pageSize: 60, version: ''
    }, function (err2, tree) {
      if (err2) { return done(err2); }
      var items = itemsFromTree(tree, rootKey);
      treeCache[cacheKey] = { at: Date.now(), items: items };
      done(null, { root: rootKey, pageNum: pageNum, items: items, cached: false });
    });
  });
}

/* Generic portal column fetch.  Used for roots that are not part of the six
   home roots (novelas), where guessing a column code must fail softly. */
function column(columnCode, pageNum, done) {
  if (typeof pageNum === 'function') { done = pageNum; pageNum = 1; }
  var code = trim(columnCode);
  if (!code) { return done(new Error('columnCode requerido')); }
  pageNum = Math.max(1, parseInt(pageNum, 10) || 1);
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('getNextColumns', {
      columnCode: code, pageNum: pageNum, pageSize: 60, version: ''
    }, function (err2, tree) {
      if (err2) { return done(err2); }
      done(null, { root: code, pageNum: pageNum, items: itemsFromTree(tree, '') });
    });
  });
}

function search(value, done) {
  var q = trim(value);
  if (!q) { return done(null, { items: [] }); }
  var key = q.toLowerCase();
  var cached = searchCache[key];
  if (cached && Date.now() - cached.at < SEARCH_TTL) {
    return done(null, { items: cached.items, cached: true });
  }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('v3/searchByName', {
      value: q, type: '0', columnId: '', filter: '', pageNum: 1, pageSize: 50
    }, function (err2, answer) {
      if (err2) { return done(err2); }
      var groups = answer && answer.searchItemList;
      var out = [];
      var seen = {};
      if (groups && groups.length) {
        for (var g = 0; g < groups.length; g++) {
          var list = groups[g] && groups[g].itemList;
          if (!list || !list.length) { continue; }
          for (var i = 0; i < list.length; i++) {
            var item = itemFromAsset(list[i], '', null);
            if (!item || seen[item.id]) { continue; }
            seen[item.id] = true;
            out.push(item);
            remember(item);
          }
        }
      }
      searchCache[key] = { at: Date.now(), items: out };
      done(null, { items: out, total: answer && answer.totalSize, cached: false });
    });
  });
}

function detail(contentId, done) {
  var id = trim(contentId);
  if (!id) { return done(new Error('falta contentId')); }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('v4/getItemData', {
      contentId: id, type: '0', sortType: '0', language: 'en', macAddr: FIXED_MAC
    }, function (err2, answer) {
      var cached = itemCache[id] || null;
      if (err2) {
        /* Movies answer portal100006 ("episode does not exist") or portal error codes
           because they do not have an episode tree in v4/getItemData. If cached is missing
           (e.g. after service restart), synthesize a minimal item so playback and detail view
           proceed without throwing. */
        if (err2.portalCode || /portal/i.test(err2.message)) {
          var fallbackItem = cached || { id: id, title: '', kind: 'película', episodes: [], seasons: [], portal: true };
          return done(null, { item: fallbackItem, episodes: [], seasons: [] });
        }
        return done(err2);
      }
      var data = answer && answer.assetData;
      if (!data) {
        return cached ? done(null, { item: cached, episodes: [], seasons: [] })
                      : done(new Error('el portal no devolvió datos del título'));
      }
      var item = itemFromAsset(data, cached ? cached.category : '', null);
      if (cached) {
        /* keep the row/alias context learned from the tree */
        item.row = cached.row;
        item.category = cached.category;
      }
      remember(item);

      var episodes = [];
      var list = data.simpleProgramList;
      if (list && list.length) {
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (!e) { continue; }
          episodes.push({
            id: trim(e.contentId),
            title: text(e.name),
            name: text(e.name),
            number: e.seriesNumber === undefined || e.seriesNumber === null ? i + 1 : e.seriesNumber,
            duration: text(e.duration),
            quality: text(e.quality),
            /* Optional artwork/synopsis used by the episode browser when the
               portal sends them; the list falls back to number+title. */
            picture: text(e.picture || e.pic || e.image || e.cover || e.posterUrl || e.poster),
            description: text(e.description || e.desc || e.synopsis || e.shortDescription || e.introduce)
          });
        }
      }
      var seasons = [];
      var sl = data.sameSeasonSeriesList;
      if (sl && sl.length) {
        for (var s = 0; s < sl.length; s++) {
          if (sl[s] && trim(sl[s].contentId)) {
            seasons.push({ id: trim(sl[s].contentId), number: sl[s].seasonNumber });
          }
        }
      }
      done(null, { item: item, episodes: episodes, seasons: seasons });
    });
  });
}

/* ------------------------------------------------------------------- play */
function slbBean() {
  return {
    hasPay: '0', userIdentity: '1', type: 'merge', appVer: APK_VERSION, lang: 'es',
    encMediaSupported: 1, liveCodeList: ['masnew_live'], appParams: '',
    reserve1: FIXED_RESERVE1, pipFlag: '0'
  };
}

function isCfl(url) {
  var q = url.slice(url.lastIndexOf('?') + 1).split('&');
  for (var i = 0; i < q.length; i++) {
    if (trim(q[i]) === 'sign_type=cfl') { return true; }
  }
  return false;
}

function withScheme(addr) {
  var clean = trim(addr).replace(/\/+$/, '');
  clean = clean.replace(/^http:\/\//i, 'https://');
  return /^https:\/\//.test(clean) ? clean : 'https://' + clean;
}

function vodCdns(slb) {
  var out = [];
  var list = slb && slb.cdn_list;
  if (!list || !list.length) { return out; }
  for (var i = 0; i < list.length; i++) {
    var cdn = list[i];
    if (!cdn || trim(cdn.tag) !== 'vod') { continue; }
    var urls = cdn.url_list || [];
    for (var u = 0; u < urls.length; u++) {
      var entry = urls[u];
      var url = trim(entry && entry.url);
      if ((isCfl(url) || trim(entry && entry.sign_type) === 'cfl') && trim(entry && entry.tag) === 'free') {
        var bases = [withScheme(cdn.main_addr)];
        var spare = trim(cdn.spared_addr);
        if (spare && bases.indexOf(withScheme(spare)) === -1) { bases.push(withScheme(spare)); }
        out.push({ bases: bases, auth: url });
        break;
      }
    }
  }
  // Secondary fallback: if no CacheFly CDN found, accept any free VOD CDN
  if (!out.length) {
    for (var j = 0; j < list.length; j++) {
      var cdn2 = list[j];
      if (!cdn2 || trim(cdn2.tag) !== 'vod') { continue; }
      var urls2 = cdn2.url_list || [];
      for (var u2 = 0; u2 < urls2.length; u2++) {
        var entry2 = urls2[u2];
        var url2 = trim(entry2 && entry2.url);
        if (url2 && (trim(entry2 && entry2.tag) === 'free' || url2.indexOf('tag=free') !== -1)) {
          var bases2 = [withScheme(cdn2.main_addr)];
          var spare2 = trim(cdn2.spared_addr);
          if (spare2 && bases2.indexOf(withScheme(spare2)) === -1) { bases2.push(withScheme(spare2)); }
          out.push({ bases: bases2, auth: url2 });
          break;
        }
      }
    }
  }
  return out;
}

function getSlb(done) {
  if (slbCache && Date.now() < slbCache.at + SLB_TTL) { return done(null, slbCache.slb); }
  firstCall([
    { path: 'v15/getSlbInfo', bean: slbBean() },
    { path: 'v14/getSlbInfo', bean: slbBean() }
  ], function (err, slb) {
    if (err) { return done(err); }
    if (!vodCdns(slb).length) { return done(new Error('el portal no expuso CDN de vod libre')); }
    slbCache = { at: Date.now(), slb: slb };
    done(null, slb);
  });
}

/* webOS 4 has hardware decode limits that are much lower than Android IjkPlayer.
 * The portal may return several files for the same episode but does not promise
 * that the first one is playable smoothly on a 2019 LG. Prefer an ordinary
 * H.264/MP4 rendition and reject high-frame-rate, UHD and very high bitrate
 * variants when a compatible alternative is present. */
function fieldNumber(value) {
  var match = text(value).match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function trackHeight(track) {
  var direct = fieldNumber(track && (track.videoHeight || track.height || track.pixelHeight));
  if (direct) { return direct; }
  var label = text(track && (track.resolution || track.videoResolution || track.quality)).toLowerCase();
  var byDimensions = label.match(/\d{3,4}\s*[x×]\s*(\d{3,4})/);
  if (byDimensions) { return parseInt(byDimensions[1], 10); }
  if (/\b(4k|uhd|2160)\b/.test(label)) { return 2160; }
  if (/\b1440\b/.test(label)) { return 1440; }
  if (/\b1080\b|\bfhd\b/.test(label)) { return 1080; }
  if (/\b720\b|\bhd\b/.test(label)) { return 720; }
  if (/\b480\b|\bsd\b/.test(label)) { return 480; }
  return 0;
}

function trackBitrateKbps(track) {
  var raw = track && (track.videoBitrate || track.videoBitRate || track.bitrate || track.bitRate || track.rate || '');
  var value = fieldNumber(raw);
  var label = text(raw).toLowerCase();
  if (/mbps|m\b/.test(label)) { return value * 1000; }
  /* Portal values without a suffix are normally bits per second. */
  return value > 10000 ? value / 1000 : value;
}

function trackFrameRate(track) {
  return fieldNumber(track && (track.frameRate || track.fps || track.videoFps));
}

function trackSummary(track) {
  return {
    codec: trim(track && track.encodeFormat).toUpperCase(),
    format: trim(track && track.videoFormat).toLowerCase(),
    quality: trim(track && track.quality),
    height: trackHeight(track),
    bitrateKbps: trackBitrateKbps(track),
    frameRate: trackFrameRate(track)
  };
}

function durationSeconds(value) {
  var raw = trim(value);
  if (!raw) { return 0; }
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) {
    var hms = raw.split(':');
    return (parseInt(hms[0], 10) * 3600) + (parseInt(hms[1], 10) * 60) + parseInt(hms[2], 10);
  }
  var seconds = fieldNumber(raw);
  /* Some portal records use milliseconds. */
  return seconds > 100000 ? seconds / 1000 : seconds;
}

function mediaScore(track) {
  var rawEnc = trim(track && track.encodeFormat).toLowerCase().replace(/[^a-z0-9]/g, '');
  var fmt = trim(track && track.videoFormat).toLowerCase();
  var isH264 = (rawEnc.indexOf('h264') !== -1 || rawEnc.indexOf('avc') !== -1);
  var isHevc = (rawEnc.indexOf('h265') !== -1 || rawEnc.indexOf('hevc') !== -1);
  var isMp4 = (fmt === 'mp4');
  var summary = trackSummary(track);

  var score = 0;
  if (isH264) {
    score += 0;
  } else if (isHevc) {
    score += 80;
  } else {
    score += 160;
  }
  if (/av1|vp9|10bit|hdr/.test(rawEnc)) { score += 500; }
  /* On webOS 4 the HTML5 MPEG-TS demuxer can keep the media clock moving
     while presenting uneven frames (even with a full network buffer).  The
     portal normally exposes the same VOD rendition as MP4, whose timestamps
     are handled by the native player reliably.  Make MP4 a true preference;
     TS remains the fallback only when no MP4 track is supplied. */
  if (!isMp4) { score += 2000; }
  if (summary.height > 1080) { score += 500 + summary.height; }
  if (summary.frameRate > 30) { score += 300 + summary.frameRate; }
  if (summary.bitrateKbps > 9000) { score += 250; }
  else if (summary.bitrateKbps > 6500) { score += 80; }
  return score;
}

function collectTracks(episode) {
  var tracks = [];
  var totals = (episode && episode.totalMovieList) || [];
  for (var t = 0; t < totals.length; t++) {
    var movies = (totals[t] && totals[t].movieList) || [];
    for (var m = 0; m < movies.length; m++) {
      if (movies[m] && trim(movies[m].contentId)) { tracks.push(movies[m]); }
    }
  }
  tracks.sort(function (a, b) { return mediaScore(a) - mediaScore(b); });
  return tracks;
}

function subtitleList(episode) {
  var out = [];
  var subs = (episode && episode.subtitleList) || [];
  for (var s = 0; s < subs.length && out.length < 30; s++) {
    var file = subs[s] && subs[s].file && subs[s].file[0];
    if (!file || !trim(file.url)) { continue; }
    out.push({
      lang: trim(subs[s].language),
      url: trim(file.url),
      format: trim(file.fileType) || 'srt'
    });
  }
  return out;
}

var PLAY_TTL = 60 * 1000;
var playCache = {};
var playWaiters = {};

/* Shared startPlayVOD step: both the playback resolver and the media-info
 * call need the same episode/track list. */
function loadPlay(contentId, seriesId, done) {
  var id = trim(contentId);
  if (!id) { return done(new Error('falta contentId')); }
  var cacheKey = id + ':' + trim(seriesId);
  if (playCache[cacheKey] && Date.now() < playCache[cacheKey].at + PLAY_TTL) {
    return done(null, playCache[cacheKey].data);
  }
  if (playWaiters[cacheKey]) {
    playWaiters[cacheKey].push(done);
    return;
  }
  playWaiters[cacheKey] = [done];

  function finishPlay(err, res) {
    var waiters = playWaiters[cacheKey] || [];
    delete playWaiters[cacheKey];
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](err, res); } catch (eW) { /* ignore */ }
    }
  }

  ensureSession(function (err) {
    if (err) { return finishPlay(err); }
    call('v10/startPlayVOD', {
      contentId: id,
      seriesContentId: trim(seriesId),
      startTime: 0, type: '1', columnId: 0, authType: ''
    }, function (err2, play) {
      if (err2) { return finishPlay(err2); }
      var episode = play && play.episodeList && play.episodeList[0];
      if (!episode) { return finishPlay(new Error('el portal no devolvió pistas de vídeo')); }
      var tracks = collectTracks(episode);
      if (!tracks.length) { return finishPlay(new Error('el portal no devolvió pistas de vídeo')); }
      var res = { play: play, episode: episode, tracks: tracks };
      playCache[cacheKey] = { at: Date.now(), data: res };
      finishPlay(null, res);
    });
  });
}

/* Language list and subtitle files for the audio/subtitle dialog.  It
 * deliberately exposes no playable URL, license or request headers, so the
 * page can call it from the detail screen before playback starts. */
function mediaInfo(contentId, seriesId, done) {
  loadPlay(contentId, seriesId, function (err, info) {
    if (err) { return done(err); }
    var track = info.tracks[0];
    done(null, {
      name: text(info.play && info.play.name),
      audio: trim(track.audioInfo),
      subtitles: subtitleList(info.episode),
      tracks: info.tracks.map(trackSummary),
      selected: trackSummary(track),
      duration: durationSeconds(track.duration || info.episode.duration || (info.play && info.play.duration))
    });
  });
}

function resolve(contentId, seriesId, options, done) {
  if (typeof options === 'function') { done = options; options = {}; }
  options = options || {};
  loadPlay(contentId, seriesId, function (err, info) {
    if (err) { return done(err); }
    var play = info.play;
    var episode = info.episode;
    var tracks = info.tracks;
    var index = parseInt(options.trackIndex, 10);
    if (!(index >= 0 && index < tracks.length)) { index = 0; }
    var track = tracks[index];
    /* Playback diagnostics deliberately contain only rendition metadata.
       They let us distinguish a TS-only title from a bad selector without
       exposing a playable URL, license, or request headers to the page. */
    var availableTracks = [];
    for (var a = 0; a < tracks.length; a++) {
      availableTracks.push(trackSummary(tracks[a]));
    }
    var license = trim((track.licenseList && track.licenseList[0] && track.licenseList[0].license) || '');
    if (!license) { return done(new Error('el portal no devolvió licencia de reproducción')); }

    getSlb(function (err3, slb) {
      if (err3) { return done(err3); }
      var cdns = vodCdns(slb);
      if (!cdns.length) { return done(new Error('el portal no expuso CDN de vod libre')); }
      var cdn = cdns[0];
      var ext = trim(track.videoFormat).toLowerCase() === 'ts' ? 'ts' : 'mp4';
      var contentPath = '/vod/' + trim(track.contentId) + '_media.' + ext;

      function cdnHeaders(auth) {
        return {
          'Content-Auth': auth,
          'Content-License': license,
          'User-Agent': UA_CDN,
          App: APP_ID,
          'App-Version': APK_VERSION
        };
      }

      var url = cdn.bases[0] + contentPath;
      /* The proxy already knows how to retry a failed CDN, but it needs the
         full candidate list.  Use the spare address of the same CDN plus every
         other free CDN, each with its own Content-Auth token. */
      var backupUrls = [];
      for (var ci = 0; ci < cdns.length; ci++) {
        for (var bi = 0; bi < cdns[ci].bases.length; bi++) {
          if (ci === 0 && bi === 0) { continue; }
          backupUrls.push({ url: cdns[ci].bases[bi] + contentPath, headers: cdnHeaders(cdns[ci].auth) });
        }
      }

      var mime = ext === 'ts' ? 'video/mp2t' : 'video/mp4';
      var codec = trim(track.encodeFormat).toUpperCase();
      done(null, {
        url: url,
        mime: mime,
        codec: codec,
        quality: trim(track.quality),
        duration: durationSeconds(track.duration || episode.duration || (play && play.duration)),
        selectedTrack: trackSummary(track),
        availableTracks: availableTracks,
        trackIndex: index,
        audio: trim(track.audioInfo),
        headers: cdnHeaders(cdn.auth),
        backupUrls: backupUrls,
        subtitles: subtitleList(episode),
        name: text(play && play.name)
      });
    });
  });
}

/* ------------------------------------------------------------------- live */
var LIVE_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd46f3085, 0x04881d05,
  0xd9d4d039, 0xe6bd99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffecc47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2da7d2bb, 0xeb86d391
];
var LIVE_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];
var LIVE_ROUND1 = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5];
var LIVE_G = [];
for (var iG = 0; iG < 64; iG++) {
  LIVE_G.push(iG < 16 ? LIVE_ROUND1[iG] : iG < 32 ? (5 * iG + 1) % 16 : iG < 48 ? (3 * iG + 5) % 16 : (7 * iG) % 16);
}
var LIVE_SALT = bufFrom([
  0x73, 0x61, 0x6c, 0x74, 0x33, 0x33, 0x33, 0x33, 0x3d, 0x34,
  0x98, 0x0d, 0x0a, 0x15, 0x32, 0xc9, 0xc3, 0x82, 0x17, 0x08, 0xc0
]);

function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

function liveCompress(st, block, off) {
  var m = new Array(16);
  for (var j = 0; j < 16; j++) {
    var p = off + j * 4;
    m[j] = (block[p] | (block[p + 1] << 8) | (block[p + 2] << 16) | (block[p + 3] << 24)) >>> 0;
  }
  var a = st[0], b = st[1], c = st[2], d = st[3];
  for (var i = 0; i < 64; i++) {
    var f;
    if (i < 16) f = (b & c) | (~b & d);
    else if (i < 32) f = (d & b) | (~d & c);
    else if (i < 48) f = b ^ c ^ d;
    else f = c ^ (b | ~d);
    var sum = (f + a + LIVE_K[i] + m[LIVE_G[i]]) >>> 0;
    a = d; d = c; c = b;
    b = (b + rotl(sum, LIVE_S[i])) >>> 0;
  }
  st[0] = (st[0] + a) >>> 0;
  st[1] = (st[1] + b) >>> 0;
  st[2] = (st[2] + c) >>> 0;
  st[3] = (st[3] + d) >>> 0;
}

function liveDigestHex(bytes) {
  var st = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  var len = bytes.length;
  var padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
  var total = bufAlloc(len + 1 + padLen + 8);
  bytes.copy(total, 0);
  total[len] = 0x80;
  var low = (len % 0x20000000) * 8;
  var high = Math.floor(len / 0x20000000);
  for (var i = 0; i < 4; i++) {
    total[len + 1 + padLen + i] = (low >>> (8 * i)) & 0xff;
    total[len + 5 + padLen + i] = (high >>> (8 * i)) & 0xff;
  }
  for (var off = 0; off < total.length; off += 64) {
    liveCompress(st, total, off);
  }
  var out = '';
  for (var w = 0; w < 4; w++) {
    for (var j = 0; j < 4; j++) {
      var byteVal = (st[w] >>> (8 * j)) & 0xff;
      var hex = byteVal.toString(16);
      if (hex.length < 2) hex = '0' + hex;
      out += hex;
    }
  }
  return out;
}

function signO3(token, startMomentMs) {
  var head = bufFrom('token=' + token + '&sign2_method=sign_o3&instance=0&start_moment=' + startMomentMs, 'utf8');
  var msg = Buffer.concat([head, LIVE_SALT]);
  return liveDigestHex(msg);
}

function bareHost(mainAddr) {
  var s = typeof mainAddr === 'string' ? mainAddr : '';
  if (s.indexOf('https://') === 0) s = s.slice(8);
  if (s.indexOf('http://') === 0) s = s.slice(7);
  var slash = s.indexOf('/');
  return slash >= 0 ? s.slice(0, slash) : s;
}

function getLiveChannels(columnId, pageNum, pageSize, done) {
  if (typeof columnId === 'function') {
    done = columnId;
    columnId = null;
    pageNum = 1;
    pageSize = 20;
  } else if (typeof pageNum === 'function') {
    done = pageNum;
    pageNum = 1;
    pageSize = 20;
  } else if (typeof pageSize === 'function') {
    done = pageSize;
    pageSize = 20;
  }
  pageNum = Math.max(1, parseInt(pageNum, 10) || 1);
  pageSize = Math.max(1, Math.min(250, parseInt(pageSize, 10) || 20));
  ensureSession(function (err) {
    if (err) { return done(err); }
    /* Return one portal page at a time.  The client paints page one first,
       then asks for the remaining pages in the background.  This avoids a
       blank TV screen while a large category (for example Deportes) loads. */
    var out = [];
    var seen = {};
    call('v6/getLiveData', {
      columnId: columnId || 76182,
      dataVersion: '',
      pageSize: pageSize,
      pageNum: pageNum,
      expireTimeStr: ''
    }, function (err2, res) {
      if (err2) { return done(err2); }
      var list = (res && res.channelList) || [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || !c.channelCode || seen[c.channelCode]) continue;
        seen[c.channelCode] = true;
        var poster = text(c.posterUrl);
        if (!poster && c.posterList && c.posterList.length) {
          poster = text(c.posterList[0].fileUrl);
        }
        var chItem = {
          channelCode: c.channelCode,
          index: c.channelNumber || out.length + 1,
          name: text(c.name || c.alias || ('Canal ' + (out.length + 1))),
          logo: poster,
          uhd: c.quality === '3',
          fav: c.isFav || false,
          now: 'En vivo',
          next: '',
          time: '',
          liveAddressList: c.liveAddressList || []
        };
        out.push(chItem);
        liveChannelCache[c.channelCode] = { at: Date.now(), channel: chItem };
      }
      done(null, out, list.length >= pageSize);
    });
  });
}

var liveChannelCache = {};
var liveCategoriesCache = null;
function getLiveCategories(done) {
  if (liveCategoriesCache && liveCategoriesCache.length) {
    return done(null, liveCategoriesCache);
  }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('getNextColumns', { columnCode: 'masnew_live', pageNum: 1, pageSize: 200, version: '' }, function (err2, res) {
      if (err2) { return done(err2); }
      var list = (res && res.recommendList) || [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || !c.columnId) continue;
        out.push({
          id: c.columnId,
          name: text(c.name || c.title || c.alias || 'Categoría ' + (i + 1)),
          code: c.code || ''
        });
      }
      liveCategoriesCache = out;
      done(null, out);
    });
  });
}

function parseM3u(content) {
  var lines = (content || '').split(/\r?\n/);
  var channels = [];
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf('#EXTINF:') === 0) {
      var commaIdx = line.indexOf(',');
      var meta = line.slice(8, commaIdx > 0 ? commaIdx : undefined);
      var title = commaIdx > 0 ? line.slice(commaIdx + 1).trim() : '';
      var logoMatch = /tvg-logo=["']([^"']+)["']/i.exec(meta);
      var groupMatch = /group-title=["']([^"']+)["']/i.exec(meta);
      var nameMatch = /tvg-name=["']([^"']+)["']/i.exec(meta);
      if (!title && nameMatch) { title = nameMatch[1]; }
      if (!title) { title = 'Canal ' + (channels.length + 1); }
      cur = {
        name: title,
        logo: logoMatch ? logoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : 'Addon',
        isAddon: true,
        now: 'En vivo',
        fav: false
      };
    } else if (line.indexOf('#EXTGRP:') === 0 && cur && cur.group === 'Addon') {
      cur.group = line.slice(8).trim() || 'Addon';
    } else if (line && line.indexOf('#') !== 0 && cur) {
      cur.url = line;
      cur.streamUrl = line;
      cur.channelCode = 'm3u_' + (channels.length + 1);
      cur.index = channels.length + 1;
      channels.push(cur);
      cur = null;
    }
  }
  return channels;
}

function fetchM3u(urlStr, done) {
  if (!urlStr) { return done(new Error('URL de addon requerida')); }
  var isHttps = urlStr.indexOf('https://') === 0;
  var mod = isHttps ? https : http;
  var opts = url.parse(urlStr);
  opts.rejectUnauthorized = false;
  opts.method = 'GET';
  opts.headers = {
    'User-Agent': 'Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/538.1+ (KHTML, like Gecko) Safari/538.1+'
  };
  dnsx.prepare(opts, function (prepErr, prepped) {
    if (prepErr) { return done(prepErr); }
    var req = mod.get(prepped, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchM3u(url.resolve(urlStr, res.headers.location), done);
      }
      if (res.statusCode !== 200) {
        return done(new Error('HTTP ' + res.statusCode + ' al descargar addon'));
      }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var chs = parseM3u(raw);
        done(null, chs);
      });
    });
    req.on('error', function (err) { done(err); });
    req.setTimeout(20000, function () { req.abort(); done(new Error('Tiempo de espera agotado al descargar addon')); });
  });
}

/* Live authorizations are short-lived but valid long enough to make channel
   surfing responsive.  Reusing one for two minutes avoids two portal round
   trips every time the viewer returns to a channel. */
var liveResolveCache = {};
var LIVE_RESOLVE_CACHE_MS = 120000;

/* Tries each attempt in order and stops at the first one that returns data.
   Portal builds differ per account: some require the live column id and the
   v15 SLB endpoint, older ones only answer columnId 0 / v14.  Calling the
   wrong form returns error 1, so live TV must never depend on a single guess. */
function firstCall(attempts, done) {
  var i = 0;
  function next(lastErr) {
    if (i >= attempts.length) {
      return done(lastErr || new Error('el portal no respondió'));
    }
    var attempt = attempts[i++];
    call(attempt.path, attempt.bean, function (err, data) {
      if (err) { return next(err); }
      done(null, data);
    });
  }
  next(null);
}

function liveCdnsOf(slb) {
  var cdns = (slb && slb.cdn_list) || [];
  var list = [];
  var seen = {};
  function addEntry(host, auth) {
    var bh = bareHost(host);
    if (bh && !seen[bh]) {
      seen[bh] = true;
      list.push({ cflHost: bh, authBase: auth });
    }
  }
  // 1st pass: prioritize cfl / CacheFly CDNs
  for (var c = 0; c < cdns.length; c++) {
    var cdn = cdns[c];
    if (!cdn || cdn.tag !== 'live') continue;
    var urls = cdn.url_list || [];
    for (var u = 0; u < urls.length; u++) {
      var entry = urls[u];
      var urlStr = (entry && entry.url) || '';
      if (entry.sign_type === 'cfl' || urlStr.indexOf('sign_type=cfl') !== -1) {
        addEntry(cdn.main_addr, urlStr);
        if (cdn.spared_addr) addEntry(cdn.spared_addr, urlStr);
      }
    }
  }
  // 2nd pass: fallback to any live CDN if cfl wasn't present or list is short
  for (var c2 = 0; c2 < cdns.length; c2++) {
    var cdn2 = cdns[c2];
    if (!cdn2 || cdn2.tag !== 'live') continue;
    var urls2 = cdn2.url_list || [];
    for (var u2 = 0; u2 < urls2.length; u2++) {
      var entry2 = urls2[u2];
      var urlStr2 = (entry2 && entry2.url) || '';
      if (urlStr2 && urlStr2.indexOf('token=') !== -1) {
        addEntry(cdn2.main_addr, urlStr2);
        if (cdn2.spared_addr) addEntry(cdn2.spared_addr, urlStr2);
      }
    }
  }
  return list;
}

function resolveLive(channelCode, done) {
  var cached = liveResolveCache[channelCode];
  if (cached && (Date.now() - cached.at) < LIVE_RESOLVE_CACHE_MS) {
    return setTimeout(function () { done(null, cached.stream); }, 0);
  }
  ensureSession(function (err) {
    if (err) { return done(err); }

    function getStreamAddr(cb, sessionRetried) {
      firstCall([
        { path: 'v4/startPlayLive', bean: { channelCode: channelCode, type: '1' } },
        { path: 'v4/startPlayLive', bean: { channelCode: channelCode, columnId: '76182', type: '1' } },
        { path: 'v4/startPlayLive', bean: { channelCode: channelCode, columnId: 0, type: '1' } }
      ], function (err2, play) {
        if (err2) {
          /* The portal sometimes invalidates the whole anonymous session when
             all startPlayLive variants fail. Rebuild it once; without this,
             the next catalog/detail/VOD request inherits the same bad token. */
          if (!sessionRetried) {
            resetSessionAfterLiveFailure();
            return ensureSession(function (refreshErr) {
              if (refreshErr) { return cb(err2); }
              getStreamAddr(cb, true);
            });
          }
          return cb(err2);
        }
        var addrList = (play && play.liveAddressList) || [];
        var addr = null;
        for (var a = 0; a < addrList.length; a++) {
          if (addrList[a] && addrList[a].playCode && addrList[a].license) {
            addr = addrList[a];
            break;
          }
        }
        if (!addr && addrList[0]) { addr = addrList[0]; }
        if (!addr || !addr.license) {
          return cb(new Error('el portal no devolvió licencia para el canal'));
        }
        cb(null, addr);
      });
    }

    getStreamAddr(function (err2, addr) {
      if (err2) { return done(err2); }
      var playCode = addr.playCode || channelCode;
      var license = addr.license;

      var bean = slbBean();
      bean.liveCodeList = ['masnew_live'];
      var slbPaths = ['v15/getSlbInfo', 'v14/getSlbInfo'];
      var slbIndex = 0;

      function trySlb(lastSlbErr) {
        if (slbIndex >= slbPaths.length) {
          return done(new Error('el portal no expuso CDN de vivo'));
        }
        call(slbPaths[slbIndex++], bean, function (err3, slb) {
          if (err3) { return trySlb(err3); }
          var liveCdns = liveCdnsOf(slb);
          if (!liveCdns.length) { return trySlb(new Error('CDN de vivo vacía')); }
          useCdns(liveCdns);
        });
      }

      function useCdns(liveCdns) {
        var chosen = liveCdns[0];
        var liveUrl = 'http://' + chosen.cflHost + '/live/' + playCode + '.m3u8';
        var tokenMatch = chosen.authBase.match(/token=([0-9a-fA-F]{32})/);
        var token = tokenMatch ? tokenMatch[1] : '';
        var moment = Math.floor(Date.now());
        var sign2 = signO3(token, moment);
        var authHeader = chosen.authBase + '&sign2_method=sign_o3&instance=0&start_moment=' + moment + '&sign2=' + sign2;
        var backupUrls = [];
        for (var b = 1; b < liveCdns.length; b++) {
          backupUrls.push('http://' + liveCdns[b].cflHost + '/live/' + playCode + '.m3u8');
        }
        var stream = {
          url: liveUrl,
          backupUrls: backupUrls,
          mime: 'application/x-mpegurl',
          headers: {
            'Content-Auth': authHeader,
            'Content-License': license,
            'User-Agent': 'Ranger/4.9.4-17294ac0',
            'App': 'com.android.msandroid',
            'App-Version': '49902',
            'X-Buffer': '0'
          },
          name: text((addr && addr.name) || (liveChannelCache[channelCode] && liveChannelCache[channelCode].channel && liveChannelCache[channelCode].channel.name) || channelCode)
        };
        liveResolveCache[channelCode] = { at: Date.now(), stream: stream };
        done(null, stream);
      }

      trySlb(null);
    });
  });
}

module.exports = {
  home: home,
  search: search,
  detail: detail,
  mediaInfo: mediaInfo,
  resolve: resolve,
  getLiveChannels: getLiveChannels,
  getLiveCategories: getLiveCategories,
  resolveLive: resolveLive,
  fetchM3u: fetchM3u,
  parseM3u: parseM3u,
  call: call,
  post: post,
  ensureSession: ensureSession,
  session: session,
  seedStatus: function () {
    var dead = 0;
    var k;
    for (k in deadSeeds) {
      if (Object.prototype.hasOwnProperty.call(deadSeeds, k) && Date.now() - deadSeeds[k] < DEAD_SEED_MS) { dead++; }
    }
    return {
      pool: usableSeeds().length,
      total: seedPool.length,
      freshAt: seedsAt,
      usingSeed: !!session.usesSeed,
      dead: dead
    };
  },
  constants: {
    APP_ID: APP_ID,
    APK_VERSION: APK_VERSION,
    UA_CDN: UA_CDN,
    FIXED_MAC: FIXED_MAC,
    ROOT_CODES: ROOT_CODES,
    HOSTS: HOSTS
  }
};
