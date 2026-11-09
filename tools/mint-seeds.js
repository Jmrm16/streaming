#!/usr/bin/env node
"use strict";

/*
 * Minter de semillas para XuperTV.
 *
 * El portal Magis bloquea por región (portal100024) a muchos países: ahí la
 * activación real v8/active NUNCA funciona y la app solo puede entrar con una
 * sesión anónima prestada ("semilla"). Las semillas caducan, así que alguien
 * con una IP no bloqueada tiene que ir acuñando sesiones nuevas y publicarlas.
 *
 * Este script hace exactamente eso: acuña sesiones anónimas nuevas, comprueba
 * con el catálogo real que funcionan (una sesión bloqueada o muerta no se
 * publica) y las mezcla con el pool anterior en un JSON que la app descarga.
 *
 * Uso:
 *   node tools/mint-seeds.js [--count 30] [--pool <archivo>] [--out <archivo>]
 *                            [--max 200] [--ttl-hours 12]
 *
 * Sin --pool/--out, el pool vive en dist/seeds/seeds.json.
 * El script es Node moderno (lo corre GitHub Actions), no va dentro del IPK.
 */

var fs = require("fs");
var path = require("path");

var SVC_DIR = path.join(
  __dirname,
  "..",
  "webos",
  "services",
  "com.webosflux.xuptertv.fidelity.service"
);

function arg(name, fallback) {
  var i = process.argv.indexOf("--" + name);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

var COUNT = Math.max(1, parseInt(arg("count", "30"), 10) || 30);
var MAX = Math.max(1, parseInt(arg("max", "200"), 10) || 200);
var TTL_HOURS = Math.max(1, parseFloat(arg("ttl-hours", "12")) || 12);
var POOL_FILE = path.resolve(arg("pool", path.join(__dirname, "..", "dist", "seeds", "seeds.json")));
var OUT_FILE = path.resolve(arg("out", POOL_FILE));

/* magis.js guarda su pool en /tmp; en un proceso nuevo queremos empezar limpio
   para no confundir semillas viejas con la activación real que vamos a probar. */
["/tmp/xuper-seeds.json", "/tmp/xuper-seeds-dead.json"].forEach(function (f) {
  try {
    fs.unlinkSync(f);
  } catch (e) {}
});

var magis = require(path.join(SVC_DIR, "magis.js"));

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function log(msg) {
  console.log("[mint] " + msg);
}

function resetSession() {
  var s = magis.session;
  s.ready = false;
  s.userId = "";
  s.userToken = "";
  s.snToken = "";
  s.seed = null;
  s.usesSeed = false;
  s.at = 0;
  s.lastError = "";
}

/* Una semilla nueva: activación anónima real + catálogo real.
   Si el portal contesta portal100024 (zona bloqueada) o aaa100028 (sesión
   muerta), esta IP no sirve para acuñar y hay que abortar el lote. */
function mintOne(cb) {
  resetSession();
  var finished = false;
  var timer = setTimeout(function () {
    if (finished) return;
    finished = true;
    cb(new Error("timeout acuñando la semilla"));
  }, 90000);

  function finish(err, seed) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cb(err, seed);
  }

  magis.ensureSession(function (err) {
    if (err) return finish(err);
    var s = magis.session;
    if (s.usesSeed) return finish(new Error("el portal devolvió una semilla en vez de activar (zona bloqueada)"));
    if (!s.userId || !s.userToken) return finish(new Error("activación incompleta"));
    magis.home("movies", 1, function (err2, res) {
      if (err2) return finish(err2);
      var list = res && res.items ? res.items : res;
      var n = (list && list.length) || 0;
      if (n < 1) return finish(new Error("el catálogo vino vacío: sesión sin acceso"));
      finish(null, {
        sn: String(s.sn || "").toLowerCase(),
        userId: String(s.userId),
        userToken: String(s.userToken),
        mintedAt: nowSec(),
        exp: nowSec() + Math.round(TTL_HOURS * 3600),
        items: n,
      });
    });
  });
}

function readPool() {
  try {
    var raw = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
    var list = raw && raw.seeds ? raw.seeds : raw;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function usable(entry, at) {
  if (!entry || !entry.userId || !entry.userToken || !entry.sn) return false;
  if (typeof entry.exp === "number" && entry.exp > 0 && entry.exp - at < 600) return false;
  return true;
}

function merge(oldList, fresh) {
  var at = nowSec();
  var bySn = {};
  var order = [];

  function add(e) {
    if (!usable(e, at)) return;
    var sn = String(e.sn).toLowerCase();
    if (!bySn[sn]) {
      order.push(sn);
      bySn[sn] = {
        sn: sn,
        userId: String(e.userId),
        userToken: String(e.userToken),
        mintedAt: e.mintedAt || at,
        exp: e.exp || at + Math.round(TTL_HOURS * 3600),
      };
    } else if ((e.mintedAt || 0) >= (bySn[sn].mintedAt || 0)) {
      bySn[sn] = {
        sn: sn,
        userId: String(e.userId),
        userToken: String(e.userToken),
        mintedAt: e.mintedAt || at,
        exp: e.exp || at + Math.round(TTL_HOURS * 3600),
      };
    }
  }

  fresh.forEach(add);
  oldList.forEach(add);

  var list = order.map(function (sn) {
    return bySn[sn];
  });
  /* Más nuevas primero; si sobran, se quedan las de vida más larga. */
  list.sort(function (a, b) {
    return (b.exp || 0) - (a.exp || 0) || (b.mintedAt || 0) - (a.mintedAt || 0);
  });
  return list.slice(0, MAX);
}

function writePool(seeds) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ at: Date.now(), seeds: seeds }, null, 1) + "\n");
  log("pool escrito en " + OUT_FILE + " (" + seeds.length + " semillas)");
}

log("servicio: " + SVC_DIR);
log("acuñando " + COUNT + " semillas (vida declarada " + TTL_HOURS + " h)");

var fresh = [];
var i = 0;

function next() {
  if (i >= COUNT) return done();
  i++;
  var t0 = Date.now();
  mintOne(function (err, seed) {
    if (err) {
      log("intento " + i + "/" + COUNT + " FALLÓ: " + (err.message || err));
      /* Un bloqueo de zona no se arregla insistiendo: abortar el lote. */
      if (/portal100024|zona bloqueada|aaa10002[78]/i.test(String(err.message || err))) {
        return done(true);
      }
    } else {
      fresh.push(seed);
      log("intento " + i + "/" + COUNT + " ok: sn=" + seed.sn.slice(0, 12) + " items=" + seed.items + " (" + (Date.now() - t0) + " ms)");
    }
    setTimeout(next, 700);
  });
}

function done(aborted) {
  if (!fresh.length) {
    log(aborted ? "ABORTADO: esta IP está bloqueada por el portal; no se acuñó ninguna semilla." : "sin semillas nuevas; el pool queda como estaba.");
    process.exitCode = aborted ? 2 : 1;
    return;
  }
  var seeds = merge(readPool(), fresh);
  writePool(seeds);
  log("nuevas: " + fresh.length + " / pool final: " + seeds.length);
  process.exitCode = 0;
}

next();
