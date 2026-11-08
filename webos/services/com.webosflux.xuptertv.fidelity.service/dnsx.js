"use strict";
var dns = require("dns"),
  https = require("https"),
  net = require("net");
try {
  https.globalAgent && (https.globalAgent.maxSockets = 32);
} catch (e) {}
var CACHE_MS = 6e5,
  SYSTEM_CACHE_MS = 6e4,
  DOH_TIMEOUT = 5e3,
  PROBE_TIMEOUT = 4e3,
  PROVIDERS = [
    { ip: "1.1.1.1", sni: "cloudflare-dns.com", path: "/dns-query" },
    { ip: "1.0.0.1", sni: "cloudflare-dns.com", path: "/dns-query" },
    { ip: "1.1.1.2", sni: "security.cloudflare-dns.com", path: "/dns-query" },
    { ip: "1.0.0.2", sni: "security.cloudflare-dns.com", path: "/dns-query" },
    { ip: "8.8.8.8", sni: "dns.google", path: "/resolve" },
    { ip: "8.8.4.4", sni: "dns.google", path: "/resolve" },
    { ip: "94.140.14.14", sni: "dns.adguard-dns.com", path: "/resolve" },
    { ip: "94.140.15.15", sni: "dns.adguard-dns.com", path: "/resolve" },
    {
      ip: "94.140.14.140",
      sni: "unfiltered.adguard-dns.com",
      path: "/resolve",
    },
    {
      ip: "94.140.14.141",
      sni: "unfiltered.adguard-dns.com",
      path: "/resolve",
    },
    { ip: "223.5.5.5", sni: "dns.alidns.com", path: "/resolve" },
    { ip: "223.6.6.6", sni: "dns.alidns.com", path: "/resolve" },
    { ip: "185.222.222.222", sni: "doh.dns.sb", path: "/dns-query" },
    { ip: "45.11.45.11", sni: "doh.dns.sb", path: "/dns-query" },
    { ip: "45.90.28.0", sni: "dns.nextdns.io", path: "/dns-query" },
    { ip: "45.90.30.0", sni: "dns.nextdns.io", path: "/dns-query" },
    /* Respaldo adicional: algunos operadores bloquean de noche las IP anycast
       mas conocidas (1.1.1.1, 8.8.8.8). Estos proveedores de otras redes
       mantienen el rescate cuando eso pasa. */
    { ip: "193.110.81.0", sni: "dns0.eu", path: "/dns-query" },
    { ip: "185.253.5.0", sni: "dns0.eu", path: "/dns-query" },
    { ip: "76.76.2.0", sni: "freedns.controld.com", path: "/p0/dns-query" },
    { ip: "116.202.176.26", sni: "doh.libredns.gr", path: "/dns-query" },
  ],
  cache = {},
  dialIndex = {},
  mode = "auto";
function now() {
  return Date.now();
}
function isIpv4(e) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(e || ""));
}
function uniq(e) {
  for (var n = [], r = 0; r < e.length; r++)
    e[r] && -1 === n.indexOf(e[r]) && n.push(e[r]);
  return n;
}
function keep(e, n, r, t) {
  return (
    (cache[e] = { ips: uniq(n), at: now(), ttl: t || CACHE_MS, source: r }),
    cache[e]
  );
}
function cached(e) {
  var n = cache[e];
  return n ? (now() - n.at > n.ttl ? null : n) : null;
}
function dohQuery(e, n, r) {
  var t = n.path + "?name=" + encodeURIComponent(e) + "&type=A",
    o = !1,
    s = now();
  function i(e, n) {
    o || ((o = !0), r(e, n || [], now() - s));
  }
  var a = https.request(
    {
      hostname: n.ip,
      servername: n.sni,
      rejectUnauthorized: !1,
      path: t,
      method: "GET",
      headers: {
        accept: "application/dns-json",
        host: n.sni,
        "User-Agent": "XuperTV/webOS",
      },
    },
    function (e) {
      var r = [];
      (e.on("data", function (e) {
        r.push(e);
      }),
        e.on("end", function () {
          if (200 !== e.statusCode) {
            var se = new Error("DoH " + n.ip + ": HTTP " + e.statusCode);
            /* 4xx (salvo 429) significa que el proveedor contestó: el nombre
               no existe ahí, pero el proveedor está sano. No se castiga. */
            se.soft =
              e.statusCode >= 400 && e.statusCode < 500 && 429 !== e.statusCode;
            return i(se);
          }
          var t;
          try {
            t = JSON.parse(Buffer.concat(r).toString("utf8"));
          } catch (e) {
            return i(new Error("DoH " + n.ip + ": respuesta no JSON"));
          }
          for (var o = (t && t.Answer) || [], s = [], a = 0; a < o.length; a++)
            o[a] && 1 === o[a].type && isIpv4(o[a].data) && s.push(o[a].data);
          if (!s.length) {
            var nx = new Error("DoH " + n.ip + ": sin registros A");
            nx.soft = !0;
            return i(nx);
          }
          i(null, s);
        }));
    }
  );
  return (
    a.setTimeout(DOH_TIMEOUT, function () {
      try {
        a.abort();
      } catch (e) {}
    }),
    a.on("timeout", function () {
      i(new Error("DoH " + n.ip + ": tiempo agotado"));
    }),
    a.on("error", function (e) {
      i(e);
    }),
    a.end(),
    a
  );
}
function systemLookup(e, n) {
  var r = !1,
    t = setTimeout(function () {
      o(new Error("DNS del televisor: tiempo agotado"));
    }, 2500);
  function o(e, o) {
    if (!r) {
      r = !0;
      try {
        clearTimeout(t);
      } catch (e) {}
      n(e, o || []);
    }
  }
  try {
    var s = function (e, n) {
      if (e) return o(e);
      var r = [];
      if ("string" == typeof n) isIpv4(n) && r.push(n);
      else if (Array.isArray(n))
        for (var t = 0; t < n.length; t++) {
          var s = n[t],
            i = "string" == typeof s ? s : s && s.address;
          isIpv4(i) && r.push(i);
        }
      if (!r.length) return o(new Error("DNS del televisor: sin respuesta"));
      o(null, r);
    };
    try {
      dns.lookup(e, 4, s);
    } catch (n) {
      dns.lookup(e, s);
    }
  } catch (e) {
    o(e);
  }
}
/* Antes, si una consulta fallaba en TODOS los proveedores se apagaba DoH
   durante 5 minutos para cualquier dominio. En redes que filtran por franjas
   horarias eso dejaba a la app resolviendo con el DNS envenenado del operador
   justo cuando el bloqueo estaba activo. Ahora cada proveedor entra en
   cuarentena corta por separado y DoH se reintenta continuamente. */
var DOH_DOWN_MS = 2e4,
  dohDownUntil = 0,
  PROVIDER_COOLDOWN_MS = 45e3,
  providerDown = {};
function providerReady(e) {
  return now() >= (providerDown[e.ip] || 0);
}
function providerFailed(e) {
  providerDown[e.ip] = now() + PROVIDER_COOLDOWN_MS;
}
function providerOk(e) {
  ((providerDown[e.ip] = 0), (dohDownUntil = 0));
}
function queryDoh(e, n) {
  var list = [],
    i,
    pending,
    done = !1,
    socks = [],
    errs = [],
    timer = null;
  for (i = 0; i < PROVIDERS.length; i++)
    providerReady(PROVIDERS[i]) && list.push(PROVIDERS[i]);
  if (!list.length) {
    /* Todos en cuarentena: respuesta inmediata para que la app caiga al DNS
       del televisor sin esperar, y en 45 s se vuelve a intentar DoH. */
    return n(new Error("DoH en cuarentena en esta red"), []);
  }
  pending = list.length;
  var finish = function (err, ips) {
    if (done) return;
    done = !0;
    if (timer) (clearTimeout(timer), (timer = null));
    for (var k = 0; k < socks.length; k++)
      try {
        socks[k].abort();
      } catch (e) {}
    if (err) return ((dohDownUntil = now() + DOH_DOWN_MS), n(err, []));
    ((dohDownUntil = 0), n(null, ips));
  };
  var attempt = function (p) {
    var req = dohQuery(e, p, function (err, ips) {
      pending--;
      if (err) {
        err.soft || providerFailed(p);
        errs.push(err.message);
        if (0 === pending && !done) finish(new Error(errs.join(" | ")), []);
        return;
      }
      (providerOk(p), finish(null, ips));
    });
    socks.push(req);
  };
  for (i = 0; i < 6 && i < list.length; i++) attempt(list[i]);
  list.length > 6 &&
    (timer = setTimeout(function () {
      if (((timer = null), !done))
        for (var k = 6; k < list.length; k++) attempt(list[k]);
    }, 600));
}
function resolve(e, n, a) {
  a = a || {};
  if (!(e = String(e || ""))) return n(new Error("host vacio"));
  if (isIpv4(e)) return n(null, { host: e, ips: [e], source: "ip", at: now() });
  var r = cached(e);
  if (r && !(a.preferDoh && "system" === r.source))
    return n(null, { host: e, ips: r.ips, source: r.source, at: r.at });
  var t = function (r) {
    if ("doh" === mode || a.dohOnly)
      return n(r || new Error("DoH sin respuesta"));
    systemLookup(e, function (t, o) {
      if (t) return n(r || t);
      var s = keep(e, o, "system", SYSTEM_CACHE_MS);
      n(null, { host: e, ips: s.ips, source: s.source, at: s.at });
    });
  };
  if ("system" === mode && !a.dohOnly) return t(null);
  queryDoh(e, function (r, o) {
    if (r || !o.length) return t(r);
    var s = keep(e, o, "doh", CACHE_MS);
    n(null, { host: e, ips: s.ips, source: s.source, at: s.at });
  });
}
function dial(e, n) {
  return n && n.length
    ? 1 === n.length
      ? n[0]
      : ((dialIndex[e] = ((dialIndex[e] || 0) + 1) % n.length), n[dialIndex[e]])
    : "";
}
function prepare(e, n) {
  var r = String((e && (e.hostname || e.host)) || "");
  return r
    ? isIpv4(r)
      ? n(null, e)
      : void resolve(r, function (t, o) {
          if (t) return n(t);
          var s,
            i = {};
          for (s in e)
            Object.prototype.hasOwnProperty.call(e, s) && (i[s] = e[s]);
          ((i.hostname = dial(r, o.ips)),
            void 0 !== i.host && (i.host = i.hostname),
            i.servername || (i.servername = r));
          var a = {};
          for (s in e.headers || {})
            Object.prototype.hasOwnProperty.call(e.headers, s) &&
              (a[s] = e.headers[s]);
          var u = "https:" === String(e.protocol || "") || !0 === e.secure,
            c = String(e.port || (u ? "443" : "80")),
            l = u ? "443" : "80";
          ((a.Host = r + (c !== l ? ":" + c : "")),
            (i.headers = a),
            (i._ip = i.hostname),
            (i._hostname = r),
            n(null, i));
        })
    : n(new Error("sin host para conectar"));
}
function lookup(e, n, r) {
  ("function" == typeof n && ((r = n), (n = {})),
    (n = n || {}),
    resolve(e, function (t, o) {
      if (t) return r(t);
      var s = dial(e, o.ips);
      if (n.all) return r(null, [{ address: s, family: 4 }]);
      r(null, s, 4);
    }));
}
function probe(e, n, r) {
  var t = now(),
    o = !1,
    s = null;
  function i(e) {
    if (!o) {
      if (((o = !0), s))
        try {
          s.destroy();
        } catch (e) {}
      r(e, now() - t);
    }
  }
  try {
    ((s = net.connect({ host: e, port: n })).setTimeout(
      PROBE_TIMEOUT,
      function () {
        i(new Error("tiempo agotado"));
      }
    ),
      s.on("connect", function () {
        i(null);
      }),
      s.on("error", function (e) {
        i(e);
      }));
  } catch (e) {
    i(e);
  }
}
function setMode(e) {
  return (mode = "doh" === e || "system" === e ? e : "auto");
}
function clearCache(e) {
  e ? delete cache[e] : ((cache = {}), (dialIndex = {}));
}
function summary() {
  var e = [];
  for (var n in cache)
    Object.prototype.hasOwnProperty.call(cache, n) &&
      e.push({
        host: n,
        ips: cache[n].ips,
        source: cache[n].source,
        ageMs: now() - cache[n].at,
      });
  return e;
}
module.exports = {
  resolve: resolve,
  prepare: prepare,
  lookup: lookup,
  probe: probe,
  systemLookup: systemLookup,
  queryDoh: queryDoh,
  setMode: setMode,
  mode: function () {
    return mode;
  },
  clearCache: clearCache,
  cached: cached,
  dial: dial,
  summary: summary,
  isIpv4: isIpv4,
  providers: PROVIDERS,
};
