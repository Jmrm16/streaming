#!/usr/bin/env node
"use strict";

var fs = require("fs");
var path = require("path");
var https = require("https");

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

var COUNT = Math.max(1, parseInt(arg("count", "25"), 10) || 25);
var MAX = Math.max(1, parseInt(arg("max", "200"), 10) || 200);
var TTL_HOURS = Math.max(1, parseFloat(arg("ttl-hours", "12")) || 12);
var POOL_FILE = path.resolve(
  arg("pool", path.join(SVC_DIR, "seeds-fallback.json"))
);
var OUT_FILE = path.resolve(arg("out", POOL_FILE));
var SOFT_FAIL = process.argv.indexOf("--soft-fail") !== -1;

["/tmp/xuper-seeds.json", "/tmp/xuper-seeds-dead.json"].forEach(function (f) {
  try {
    fs.unlinkSync(f);
  } catch (e) {}
});

var magis = require(path.join(SVC_DIR, "magis.js"));
var upstream = require(path.join(SVC_DIR, "upstream.js"));

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

function fetchLatamProxies(cb) {
  var url =
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=CO,MX,PE,EC,CL,AR&ssl=yes";
  https
    .get(url, function (res) {
      var data = "";
      res.on("data", function (c) {
        data += c;
      });
      res.on("end", function () {
        var list = data
          .split(/\r?\n/)
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        cb(null, list);
      });
    })
    .on("error", function () {
      cb(null, []);
    });
}

function probeProxy(proxy, cb) {
  upstream.configure("http://" + proxy);
  resetSession();
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    cb(new Error("timeout"));
  }, 6000);

  magis.ensureSession(function (err) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (err) return cb(err);
    if (magis.session.usesSeed || !magis.session.userId)
      return cb(new Error("bloqueado"));
    cb(null, proxy);
  });
}

function ensureWorkingRoute(cb) {
  var forcedProxy = arg("proxy", "");
  if (forcedProxy) {
    log("usando proxy forzado por argumento: " + forcedProxy);
    upstream.configure(forcedProxy);
    return cb(null);
  }

  log("verificando conectividad directa con el portal...");
  resetSession();
  magis.ensureSession(function (err) {
    if (!err && !magis.session.usesSeed && magis.session.userId) {
      log("conexión directa funcional (zona no bloqueada)");
      return cb(null);
    }
    log(
      "conexión directa bloqueada por región (portal100024); buscando proxy regional LatAm..."
    );
    fetchLatamProxies(function (err2, list) {
      if (!list || !list.length) {
        log("no se obtuvieron proxies de la lista");
        return cb(new Error("sin proxies disponibles"));
      }
      log("analizando " + list.length + " proxies candidatos de LatAm...");
      var idx = 0;
      function tryNext() {
        if (idx >= list.length) {
          return cb(new Error("ningún proxy LatAm respondió"));
        }
        var p = list[idx++];
        probeProxy(p, function (err3, ok) {
          if (!err3 && ok) {
            log("proxy LatAm activo y desbloqueado: " + ok);
            return cb(null);
          }
          tryNext();
        });
      }
      tryNext();
    });
  });
}

function mintOne(cb) {
  resetSession();
  var finished = false;
  var timer = setTimeout(function () {
    if (finished) return;
    finished = true;
    cb(new Error("timeout acuñando la semilla"));
  }, 45000);

  function finish(err, seed) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cb(err, seed);
  }

  magis.ensureSession(function (err) {
    if (err) return finish(err);
    var s = magis.session;
    if (s.usesSeed)
      return finish(
        new Error(
          "el portal devolvió una semilla en vez de activar (zona bloqueada)"
        )
      );
    if (!s.userId || !s.userToken)
      return finish(new Error("activación incompleta"));
    finish(null, {
      sn: String(s.sn || "").toLowerCase(),
      userId: String(s.userId),
      userToken: String(s.userToken),
      mintedAt: nowSec(),
      exp: nowSec() + Math.round(TTL_HOURS * 3600),
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
  if (typeof entry.exp === "number" && entry.exp > 0 && entry.exp - at < 600)
    return false;
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
  list.sort(function (a, b) {
    return (b.exp || 0) - (a.exp || 0) || (b.mintedAt || 0) - (a.mintedAt || 0);
  });
  return list.slice(0, MAX);
}

function writePool(seeds) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ at: Date.now(), seeds: seeds }, null, 1) + "\n"
  );
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
      if (
        /portal100024|zona bloqueada|aaa10002[78]/i.test(
          String(err.message || err)
        )
      ) {
        return done(true);
      }
    } else {
      fresh.push(seed);
      log(
        "intento " +
          i +
          "/" +
          COUNT +
          " ok: sn=" +
          seed.sn.slice(0, 12) +
          " (" +
          (Date.now() - t0) +
          " ms)"
      );
    }
    setTimeout(next, 500);
  });
}

function done(aborted) {
  if (!fresh.length) {
    log(
      aborted
        ? "ABORTADO: esta IP está bloqueada por el portal; no se acuñó ninguna semilla."
        : "sin semillas nuevas; el pool queda como estaba."
    );
    process.exitCode = SOFT_FAIL ? 0 : aborted ? 2 : 1;
    return;
  }
  var seeds = merge(readPool(), fresh);
  writePool(seeds);
  log("nuevas: " + fresh.length + " / pool final: " + seeds.length);
  process.exitCode = 0;
}

ensureWorkingRoute(function (err) {
  if (err) {
    log("No se pudo establecer ruta sin bloqueo: " + (err.message || err));
    return done(true);
  }
  next();
});
