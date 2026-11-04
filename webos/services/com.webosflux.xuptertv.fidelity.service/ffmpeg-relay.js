'use strict';
// ffmpeg-relay.js  (solo ES5: el Node de la TV es muy antiguo)
// Remuxea TS -> MP4 fragmentado (sin recodificar) y lo sirve por HTTP local,
// para que el <video> use el reproductor nativo de la TV con un MP4 en vez del TS.

var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var urlmod = require('url');
var spawn = require('child_process').spawn;
var dnsx = require('./dnsx');

/* Services run in a restricted namespace where /media/developer may not be
 * visible even though it is visible through SSH. Keep the executable next to
 * this service so the spawned process sees the same filesystem. */
var FFMPEG_SRC = __dirname + '/ffmpeg';
var FFMPEG = FFMPEG_SRC;
var FFMPEG_TMP = '/tmp/xuper-ffmpeg';
var HOST = '127.0.0.1';   // solo local: no es un relay abierto
var PORT = 8787;

/* webOS 6/22 mounts some app directories noexec, so the packaged binary can
 * exist with 0755 and still fail with EACCES/ENOEXEC.  Verify it once by
 * running `ffmpeg -version`; if the app copy cannot run, retry from /tmp
 * (tmpfs is executable) and expose the result to the diagnostics panel. */
var execState = 'pending';   // pending | ok | noexec | missing
var execError = '';

var sessions = {};        // token -> { url, headers, audio, hevc }
var current = null;       // { ff } stream activo (solo uno a la vez)

function log() {
  var args = Array.prototype.slice.call(arguments);
  try { fs.appendFileSync('/tmp/xuper-relay.log', args.join(' ') + '\n'); } catch (eLog) { /* diagnostic log is optional */ }
  console.log.apply(console, ['[relay]'].concat(args));
}

function setExecState(state, err) {
  execState = state;
  execError = err || '';
  log('ffmpeg ' + state + (execError ? ': ' + execError : '') + ' (' + FFMPEG + ')');
}

function verifyExecutable(path, cb) {
  var finished = false;
  function finish(ok, err) {
    if (finished) { return; }
    finished = true;
    cb(ok, err);
  }
  var child;
  try {
    child = spawn(path, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (eSpawn) {
    return finish(false, eSpawn.code || eSpawn.message);
  }
  var timer = setTimeout(function () {
    try { child.kill('SIGKILL'); } catch (eKill) { /* ignore */ }
    finish(false, 'timeout');
  }, 5000);
  child.stdout.on('data', function () { /* consume */ });
  child.on('error', function (e) {
    clearTimeout(timer);
    finish(false, e.code || e.message);
  });
  child.on('close', function (code) {
    clearTimeout(timer);
    finish(code === 0, code === 0 ? '' : ('exit ' + code));
  });
}

function copyExecutable(cb) {
  try {
    if (fs.copyFileSync) {
      fs.copyFileSync(FFMPEG_SRC, FFMPEG_TMP);
    } else {
      fs.writeFileSync(FFMPEG_TMP, fs.readFileSync(FFMPEG_SRC));
    }
    fs.chmodSync(FFMPEG_TMP, parseInt('755', 8));
    cb('');
  } catch (eCopy) {
    cb(eCopy.message);
  }
}

function ensureExecutable(cb, force) {
  cb = cb || function () {};
  if (execState === 'ok') { return cb(true, ''); }
  /* Do not copy 30 MB on every playback attempt once it is known to fail;
     selfTest(true) is the explicit way to retry after a reinstall. */
  if (!force && execState !== 'pending') { return cb(false, execError); }
  verifyExecutable(FFMPEG_SRC, function (ok) {
    if (ok) { FFMPEG = FFMPEG_SRC; setExecState('ok', ''); return cb(true, ''); }
    /* ares-package on Windows can drop the mode: try chmod once */
    try { fs.chmodSync(FFMPEG_SRC, parseInt('755', 8)); } catch (eChmod) { /* root-owned */ }
    verifyExecutable(FFMPEG_SRC, function (ok2, err2) {
      if (ok2) { FFMPEG = FFMPEG_SRC; setExecState('ok', ''); return cb(true, ''); }
      copyExecutable(function (copyErr) {
        if (copyErr) { setExecState('noexec', err2 || copyErr); return cb(false, execError); }
        verifyExecutable(FFMPEG_TMP, function (ok3, err3) {
          if (ok3) { FFMPEG = FFMPEG_TMP; setExecState('ok', 'tmp'); return cb(true, ''); }
          setExecState('noexec', err3 || err2 || 'no ejecutable');
          cb(false, execError);
        });
      });
    });
  });
}

/* Never test ffmpeg before Luna is ready: on a 1 GB webOS 3.x TV the cold
 * start plus a 31 MB copy to /tmp can delay the first `ping` past the app's
 * 25 s deadline, which looks like "el servicio no arrancó".  Defer the probe
 * so the service answers Luna first and the relay is validated on demand. */
setTimeout(function () { ensureExecutable(function () {}); }, 4000);

function stopCurrent() {
  if (current) {
    try { current.ff.kill('SIGKILL'); } catch (e) { /* ya termino */ }
    current = null;
  }
}

// Separa User-Agent (ffmpeg lo quiere en -user_agent) del resto de cabeceras.
function splitHeaders(h) {
  var ua = null;
  var rest = [];
  Object.keys(h || {}).forEach(function (k) {
    if (k.toLowerCase() === 'user-agent') ua = h[k];
    else rest.push(k + ': ' + h[k] + '\r\n');
  });
  return { ua: ua, rest: rest.join('') };
}

// Registra una sesion y devuelve la URL local para el <video>.
// stream: { url, headers } tal como lo devuelve magis.resolve
// opts.container: 'mp4' (fMP4, webOS 4+) | 'ts' (MPEG-TS, webOS 3.x/3.5)
function register(stream, opts) {
  opts = opts || {};
  var token = crypto.randomBytes(8).toString('hex');
  var container = opts.container === 'ts' ? 'ts' : 'mp4';
  sessions[token] = {
    url: stream.url,
    headers: stream.headers || {},
    /* Loopback URL of the authenticated proxy.  FFmpeg reads from it first,
       exactly like the 1.6.17 build, so the CDN keeps the proxy's retries and
       CacheFly SNI camouflage.  The direct CDN URL stays as the fallback. */
    proxyUrl: opts.proxyUrl || '',
    audio: opts.audio || 0,
    hevc: !!opts.hevc,
    container: container
  };
  return 'http://' + HOST + ':' + PORT + (container === 'ts' ? '/t/' : '/s/') +
    token + (container === 'ts' ? '.ts' : '.mp4');
}

/* Mapa de la pista de audio.  Con '?' FFmpeg acepta en silencio un índice que
 * no existe y entrega un MP4 solo de vídeo: es el "se ve la película pero no
 * se oye" de los televisores antiguos.  Para índices > 0 se exige la pista y,
 * si no está, el reintento baja a la 0. */
function audioMap(audio, optional) {
  var index = Math.max(0, Number(audio) || 0);
  return '0:a:' + index + (optional ? '?' : '');
}

function buildArgs(s, start, audio, plan, container) {
  plan = plan || {};
  var ts = container === 'ts';
  var viaProxy = !!(plan.viaProxy && s.proxyUrl);
  var sourceUrl = viaProxy ? s.proxyUrl : s.url;
  var h = viaProxy ? { ua: null, rest: '' } : splitHeaders(s.headers);
  var args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-probesize', '1M', '-analyzeduration', '1M'
  ];
  if (/^https?:\/\//i.test(sourceUrl)) {   // estas opciones solo existen para entradas HTTP(S)
    args.push('-rw_timeout', '15000000');
    if (/^https:/i.test(sourceUrl)) { args.push('-tls_verify', '0'); }
    if (h.ua) args.push('-user_agent', h.ua);
    if (h.rest) args.push('-headers', h.rest);
  }
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', sourceUrl, '-map', '0:v:0');
  if (plan.aac) {
    /* Fallback de compatibilidad: el decodificador de webOS 2/3 no reproduce
       AC-3, E-AC-3 ni DTS dentro de MP4.  Recodificar solo el audio a AAC
       estéreo cuesta muy poca CPU y devuelve sonido a esos televisores.
       aresample=async=1 mantiene el audio pegado a los timestamps del vídeo:
       sin él, el audio recodificado arranca en 0 y se desincroniza. */
    args.push(
      '-map', audioMap(audio, true),
      '-c:v', 'copy',
      '-af', 'aresample=async=1',
      '-c:a', 'aac', '-ac', '2', '-b:a', '160k', '-ar', '48000'
    );
  } else {
    args.push('-map', audioMap(audio, !audio), '-c', 'copy');
    /* En TS el audio ya viaja en ADTS: aac_adtstoasc solo vale para MP4. */
    if (!ts && plan.bsf !== false) {
      // ADTS AAC dentro de TS -> MP4.  Solo válido para AAC: con AC-3 este
      // filtro hace fallar a FFmpeg, por eso el plan siguiente lo omite.
      args.push('-bsf:a', 'aac_adtstoasc');
    }
    if (!ts) {
      /* Con -c copy y un seek (o un TS con timestamps negativos) el muxer
         desplazaba el vídeo pero no el audio: el "audio desincronizado".
         make_zero normaliza ambos flujos al mismo origen. */
      args.push('-avoid_negative_ts', 'make_zero');
    }
  }
  if (s.hevc && !ts) args.push('-tag:v', 'hvc1');   // hvc1 es la etiqueta que el reproductor nativo acepta bien
  if (ts) {
    args.push('-mpegts_flags', '+resend_headers', '-f', 'mpegts', 'pipe:1');
  } else {
    args.push(
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4', 'pipe:1'
    );
  }
  return args;
}

/*
 * The bundled static ffmpeg occasionally cannot use webOS's local DNS stub
 * (127.0.0.1), while the platform resolver can. Resolve HTTP CDN names with
 * DoH (dnsx) or the platform utility and preserve the original Host header for the CDN.
 */
function resolveForFfmpeg(s, done) {
  var parsed = urlmod.parse(s.url || '');
  if (!/^https?:$/i.test(parsed.protocol || '') || !parsed.hostname || /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) {
    return done(s);
  }

  dnsx.resolve(parsed.hostname, function (err, res) {
    var ip = (res && res.ips && res.ips[0]) || '';
    if (!err && ip) {
      var headers = {};
      Object.keys(s.headers || {}).forEach(function (key) {
        if (key.toLowerCase() !== 'host') headers[key] = s.headers[key];
      });
      headers.Host = parsed.host;
      parsed.hostname = ip;
      parsed.host = ip + (parsed.port ? ':' + parsed.port : '');
      parsed.href = null;
      log('CDN resuelto por DoH (' + (res && res.source) + ') para ffmpeg: ' + parsed.hostname + ' -> ' + ip);
      return done({
        url: urlmod.format(parsed),
        headers: headers,
        audio: s.audio,
        hevc: s.hevc
      });
    }

    log('DoH no devolvio IP para ' + parsed.hostname + ' (' + (err && err.message) + '), probando DNS nativo...');
    var lookup;
    try { lookup = spawn('/usr/bin/getent', ['ahostsv4', parsed.hostname]); } catch (eSpawn) { return done(s); }
    var out = '';
    lookup.stdout.on('data', function (chunk) { out += String(chunk); });
    lookup.on('error', function () { done(s); });
    lookup.on('close', function () {
      var match = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(out);
      if (!match) {
        log('DNS nativo no devolvio IPv4; se usa hostname');
        return done(s);
      }
      var headers2 = {};
      Object.keys(s.headers || {}).forEach(function (key) {
        if (key.toLowerCase() !== 'host') headers2[key] = s.headers[key];
      });
      headers2.Host = parsed.host;
      parsed.hostname = match[1];
      parsed.host = match[1] + (parsed.port ? ':' + parsed.port : '');
      parsed.href = null;
      log('CDN resuelto por webOS para ffmpeg');
      done({
        url: urlmod.format(parsed),
        headers: headers2,
        audio: s.audio,
        hevc: s.hevc
      });
    });
  });
}

var server = http.createServer(function (req, res) {
  var u = urlmod.parse(req.url, true);

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  if (u.pathname === '/abort' || u.pathname === '/media/abort') {
    stopCurrent();
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end('aborted');
  }

  var m = /^\/(s|t)\/([0-9a-f]+)\.(mp4|ts)$/.exec(u.pathname || '');
  var s = m && sessions[m[2]];
  if (!s) {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }
  var container = s.container === 'ts' ? 'ts' : 'mp4';
  var contentType = container === 'ts' ? 'video/mp2t' : 'video/mp4';

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Accept-Ranges': 'none',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end();
  }

  var start = Math.max(0, Number(u.query.start) || 0);
  var audio = Number(u.query.a != null ? u.query.a : s.audio) || 0;
  var forceAac = String(u.query.aac || '') === '1';

  /* Cada plan se intenta solo si el anterior no llegó a emitir ni un byte.
     Así una pista inexistente, un AC-3 que el MP4 del TV no decodifica o un
     filtro incompatible no dejan al espectador con imagen y sin sonido.
     El primer intento de cada combinación lee del proxy local (como 1.6.17);
     si ese camino no emite, el siguiente plan va directo al CDN. */
  var plans = [];
  function addPlans(base) {
    if (s.proxyUrl) {
      plans.push({ audio: base.audio, aac: base.aac, bsf: base.bsf, viaProxy: true });
    }
    plans.push({ audio: base.audio, aac: base.aac, bsf: base.bsf, viaProxy: false });
  }
  if (forceAac) {
    addPlans({ audio: audio, aac: true, bsf: false });
  } else {
    addPlans({ audio: audio, aac: false, bsf: true });
    addPlans({ audio: audio, aac: false, bsf: false });
    addPlans({ audio: 0, aac: true, bsf: false });
  }

  stopCurrent();   // el player a veces abre y aborta peticiones; no dejamos procesos huerfanos

  function startAttempt(index) {
    var plan = plans[index];
    ensureExecutable(function (execOk, execErr) {
      if (!execOk) {
        log('no se puede ejecutar ffmpeg en esta TV:', execErr);
        if (!res.finished) {
          try {
            res.writeHead(503, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('ffmpeg no ejecutable: ' + execErr);
          } catch (e503) { /* cliente ya cerrado */ }
        }
        return;
      }
      var source = (plan.viaProxy && s.proxyUrl)
        ? { url: s.proxyUrl, headers: {}, audio: s.audio, hevc: s.hevc }
        : s;
      resolveForFfmpeg(source, function (input) {
        if (res.finished) { return; }
        var ff = spawn(FFMPEG, buildArgs(input, start, plan.audio, plan, container), { stdio: ['ignore', 'pipe', 'pipe'] });
        current = { ff: ff };
        var started = false;
        var retried = false;
        /* Un ffmpeg colgado en el proxy no debe dejar la TV en "Conectando…". */
        var startTimer = setTimeout(function () {
          if (!started && current && current.ff === ff) {
            log('ffmpeg no emitió en 12 s con el plan ' + (index + 1) + '/' + plans.length + '; probando el siguiente');
            try { ff.kill('SIGKILL'); } catch (eKill) { /* ignore */ }
          }
        }, 12000);

        ff.on('error', function (e) {
          clearTimeout(startTimer);
          log('no se pudo lanzar ffmpeg:', e.message);
          if (!started) {
            res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
            started = true;
          }
          res.end();
        });

        ff.stderr.on('data', function (d) { log('ffmpeg:', String(d).trim()); });

        ff.stdout.on('data', function (chunk) {
          if (!started) {
            clearTimeout(startTimer);
            res.writeHead(200, {
              'Content-Type': contentType,
              'Accept-Ranges': 'none',
              'Cache-Control': 'no-cache',
              'Connection': 'close',
              'Access-Control-Allow-Origin': '*'
            });
            started = true;
          }
          // backpressure: si el player va lento, ffmpeg deja de leer del portal
          if (!res.write(chunk)) {
            ff.stdout.pause();
            res.once('drain', function () { ff.stdout.resume(); });
          }
        });

        ff.on('close', function (code) {
          clearTimeout(startTimer);
          if (current && current.ff === ff) current = null;
          if (!started && !retried && index + 1 < plans.length && !res.finished) {
            retried = true;
            log('ffmpeg no emitió con el plan ' + (index + 1) + '/' + plans.length +
                ' (código ' + code + '); reintentando audio=' + plans[index + 1].audio +
                (plans[index + 1].aac ? ' AAC' : ''));
            return startAttempt(index + 1);
          }
          if (!started && !res.finished) {
            res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
            started = true;
          }   // ffmpeg no produjo nada
          try { res.end(); } catch (eEnd) { /* cliente ya cerrado */ }
          if (code) log('ffmpeg termino con codigo', code);
        });

        res.on('close', function () { try { ff.kill('SIGKILL'); } catch (e) { /* ya termino */ } });
      });
    });
  }

  startAttempt(0);
});

server.on('error', function (e) { log('error del servidor:', e.message); });
server.listen(PORT, HOST, function () { log('escuchando en', HOST + ':' + PORT); });

module.exports = {
  register: register,
  stop: stopCurrent,
  available: function () {
    /* A packaged file can exist but lack +x (ares-package on Windows writes
       0666) or live on a noexec mount.  The self-test decides definitively;
       while it is pending we stay optimistic and let the app fall back to
       Normal if the relay cannot emit. */
    if (execState === 'ok') { return true; }
    if (execState === 'noexec' || execState === 'missing') { return false; }
    try {
      if (fs.accessSync) {
        fs.accessSync(FFMPEG, (fs.constants && fs.constants.X_OK) || fs.X_OK || 1);
        return true;
      }
      var st = fs.statSync(FFMPEG);
      if (process.platform === 'win32') { return true; }
      return !!(st && (st.mode & parseInt('111', 8)));
    } catch (eAccess) {
      return false;
    }
  },
  /* Exposed so the Luna ping / diagnostics can name the real reason when
     Modo Fluido does not start on a specific TV. */
  state: function () {
    return { state: execState, error: execError, path: FFMPEG, tmp: FFMPEG_TMP };
  },
  selfTest: function (cb) { ensureExecutable(cb, true); },
  path: function () { return FFMPEG; },
  port: function () { return PORT; }
};
