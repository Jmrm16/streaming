"use strict";
var Service = require("webos-service"),
  pkg = require("./package.json"),
  fs = require("fs"),
  urlmod = require("url"),
  loadErrors = {};
function loadModule(e) {
  try {
    return require(e);
  } catch (r) {
    loadErrors[e] = (r && r.message) || String(r);
    try {
      console.error(
        "[xuper-service] no se pudo cargar " + e + ": " + loadErrors[e],
      );
    } catch (e) {}
    return null;
  }
}
var magis = loadModule("./magis"),
  proxy = loadModule("./proxy"),
  relay = loadModule("./ffmpeg-relay"),
  dnsx = loadModule("./dnsx"),
  netdiag = loadModule("./netdiag"),
  upstream = loadModule("./upstream"),
  updater = loadModule("./updater");
try {
  var savedProxy = JSON.parse(fs.readFileSync("/tmp/xuper-proxy.json", "utf8"));
  savedProxy &&
    savedProxy.url &&
    upstream &&
    upstream.configure(savedProxy.url);
} catch (e) {}
try {
  var httpsMod = require("https"),
    httpMod = require("http");
  (httpsMod.globalAgent && (httpsMod.globalAgent.maxSockets = 32),
    httpMod.globalAgent && (httpMod.globalAgent.maxSockets = 32));
} catch (e) {}
var service = new Service(pkg.name);
(updater && updater.init && updater.init(service),
  process.on("uncaughtException", function (e) {
    console.error("[xuper-service] uncaughtException:", (e && e.stack) || e);
  }));
try {
  process.exit = function (e) {
    console.log(
      "[xuper-service] blocked process.exit(" + e + ") to keep streaming alive",
    );
  };
} catch (e) {}
if (service.activityManager)
  try {
    ((service.activityManager.idleTimeout = 86400),
      service.activityManager.create("keepAlive", function (e) {
        console.log("[xuper-service] persistent activity created");
      }));
  } catch (e) {
    console.log(
      "[xuper-service] activityManager init note: " + (e && e.message),
    );
  }
function fail(e, r, a) {
  e.respond({
    returnValue: !1,
    errorText: (r && r.message) || r || "error",
    errorCode: a || (r && r.portalCode) || 1,
  });
}
function respond(e, r, a) {
  if (r) return fail(e, r);
  var s = a || {};
  ((s.returnValue = !0), e.respond(s));
}
function safeValue(e, r) {
  try {
    var a = e();
    return void 0 === a ? r : a;
  } catch (e) {
    return r;
  }
}
function legacyPlayerNode() {
  var e = /^v(\d+)\./.exec(String(process.version || ""));
  return !!(e && parseInt(e[1], 10) < 4);
}
function needModule(e, r, a) {
  return (
    !!r ||
    (fail(
      e,
      new Error(
        "módulo " +
          a +
          " no cargó en esta TV: " +
          (loadErrors[a] || "desconocido"),
      ),
    ),
    !1)
  );
}
function attachSubtitles(e) {
  return e && e.subtitles && e.subtitles.length
    ? ((e.subtitles = e.subtitles.map(function (e) {
        return {
          lang: e.lang,
          format: e.format,
          url: proxy.addSubtitle(e.url),
        };
      })),
      e)
    : e;
}
function resolveStream(e, r) {
  if (
    needModule(e, magis, "./magis") &&
    needModule(e, proxy, "./proxy") &&
    needModule(e, relay, "./ffmpeg-relay") &&
    needModule(e, dnsx, "./dnsx")
  ) {
    var a = e.payload || {},
      s = { trackIndex: a.trackIndex };
    magis.resolve(a.contentId, a.seriesContentId, s, function (s, t) {
      if (s) return fail(e, s);
      var n =
          /hevc|h\.?265/i.test(t.codec || "") ||
          /hevc|h\.?265/i.test(t.mime || ""),
        o =
          r ||
          !0 === a.forceRelay ||
          "true" === a.forceRelay ||
          "smooth" === a.playbackMode ||
          "relay" === a.playbackMode;
      if (o && !relay.available())
        return fail(
          e,
          new Error(
            "Modo Fluido no disponible: ffmpeg no es ejecutable en esta TV",
          ),
        );
      if (o) {
        var i = Number(a.audioTrack) || 0;
        proxy.start(function (r) {
          if (r) return fail(e, r);
          var s = urlmod.parse(t.url || "").hostname || "";
          dnsx.resolve(s, function (r, s) {
            var o = (s && s.ips && s.ips[0]) || "",
              l = proxy.add(t.url, t.headers, t.duration, o, t.backupUrls),
              u = proxy.baseUrl() + "/media/" + l + "/stream.ts",
              d = legacyPlayerNode() || "ts" === a.container ? "ts" : "mp4",
              c = relay.register(t, {
                hevc: n,
                audio: i,
                proxyUrl: u,
                container: d,
              });
            (console.log(
              "[xuper-service] routing stream via ffmpeg relay (" +
                d +
                ", proxy local + fallback directo): " +
                c,
            ),
              (t.proxyPath = c),
              (t.mime = "ts" === d ? "video/mp2t" : "video/mp4"),
              (t.container = d),
              (t.isRelay = !0),
              (t.isHls = !1),
              respond(e, null, attachSubtitles(t)));
          });
        });
      } else {
        var l = urlmod.parse(t.url || "").hostname || "";
        dnsx.resolve(l, function (r, a) {
          var s = (a && a.ips && a.ips[0]) || "";
          proxy.start(function (r, a) {
            if (r) return fail(e, r);
            var n =
                /\.m3u8($|[?#])/i.test(t.url || "") ||
                /mpegurl/i.test(t.mime || ""),
              o = n ? "m3u8" : "video/mp4" === t.mime ? "mp4" : "ts",
              i = proxy.add(t.url, t.headers, t.duration, s, t.backupUrls);
            ((t.proxyPath = proxy.baseUrl() + "/media/" + i + "/stream." + o),
              (t.isHls = n),
              n && !t.mime && (t.mime = "application/x-mpegurl"),
              attachSubtitles(t),
              respond(e, null, t));
          });
        });
      }
    });
  }
}
(service.register("ping", function (e) {
  e.respond({
    returnValue: !0,
    service: pkg.name,
    version: pkg.version,
    node: process.version,
    platform: process.platform + "/" + process.arch,
    uptime: safeValue(function () {
      return Math.round(process.uptime());
    }, 0),
    loadErrors: loadErrors,
    portalHosts: safeValue(function () {
      return magis.constants.ROOT_CODES ? "magis" : "none";
    }, "none"),
    proxyPort: safeValue(function () {
      return proxy.port();
    }, 0),
    relayAvailable: safeValue(function () {
      return relay.available();
    }, !1),
    ffmpegPath: safeValue(function () {
      return relay.path();
    }, ""),
    relayState: safeValue(function () {
      return relay.state ? relay.state() : null;
    }, null),
    upstreamProxy: safeValue(function () {
      return upstream.describe();
    }, null),
    relayPort: safeValue(function () {
      return relay.port();
    }, 0),
    seeds: safeValue(function () {
      return magis.seedStatus ? magis.seedStatus() : null;
    }, null),
  });
}),
  service.register("setProxy", function (e) {
    if (needModule(e, upstream, "./upstream")) {
      var r = e.payload || {},
        a = String(null == r.url ? "" : r.url).replace(/^\s+|\s+$/g, "");
      if (a && !upstream.parse(a))
        return fail(
          e,
          new Error(
            "Dirección de proxy inválida. Usa http://usuario:clave@host:puerto",
          ),
        );
      upstream.configure(a);
      try {
        fs.writeFileSync("/tmp/xuper-proxy.json", JSON.stringify({ url: a }));
      } catch (e) {}
      (console.log(
        "[xuper-service] upstream proxy " +
          (a
            ? "enabled: " +
              upstream.describe().host +
              ":" +
              upstream.describe().port
            : "cleared"),
      ),
        e.respond({ returnValue: !0, proxy: upstream.describe() }));
    }
  }),
  service.register("keepAlive", function (e) {
    e.respond({ returnValue: !0, subscribed: !!e.isSubscription });
  }),
  service.register("heartbeat", function (e) {
    e.respond({
      returnValue: !0,
      alive: !0,
      proxyPort: safeValue(function () {
        return proxy.port();
      }, 0),
      timestamp: Date.now(),
    });
  }),
  service.register("home", function (e) {
    if (needModule(e, magis, "./magis")) {
      var r = (e.payload && e.payload.root) || "movies",
        a = e.payload && e.payload.pageNum;
      magis.home(r, a, function (r, a) {
        respond(e, r, a);
      });
    }
  }),
  service.register("search", function (e) {
    if (needModule(e, magis, "./magis")) {
      var r = (e.payload && e.payload.value) || "";
      magis.search(r, function (r, a) {
        respond(e, r, a);
      });
    }
  }),
  service.register("detail", function (e) {
    if (needModule(e, magis, "./magis")) {
      var r = e.payload && e.payload.contentId;
      magis.detail(r, function (r, a) {
        respond(e, r, a);
      });
    }
  }),
  service.register("resolve", function (e) {
    resolveStream(e, !1);
  }),
  service.register("resolveSmooth", function (e) {
    resolveStream(e, !0);
  }),
  service.register("mediaInfo", function (e) {
    if (needModule(e, magis, "./magis") && needModule(e, proxy, "./proxy")) {
      var r = e.payload || {};
      magis.mediaInfo(r.contentId, r.seriesContentId, function (r, a) {
        if (r) return fail(e, r);
        proxy.start(function (r) {
          if (r) return fail(e, r);
          respond(e, null, attachSubtitles(a));
        });
      });
    }
  }),
  service.register("liveChannels", function (e) {
    if (needModule(e, magis, "./magis")) {
      var r = e.payload || {};
      magis.getLiveChannels(
        r.columnId,
        r.pageNum,
        r.pageSize,
        function (a, s, t) {
          if (a) return fail(e, a);
          respond(e, null, {
            channels: s || [],
            pageNum: Math.max(1, parseInt(r.pageNum, 10) || 1),
            hasMore: !!t,
          });
        },
      );
    }
  }),
  service.register("liveCategories", function (e) {
    needModule(e, magis, "./magis") &&
      magis.getLiveCategories(function (r, a) {
        if (r) return fail(e, r);
        respond(e, null, { categories: a || [] });
      });
  }),
  service.register("fetchM3u", function (e) {
    if (needModule(e, magis, "./magis")) {
      var r = e.payload || {};
      if (!r.url) return fail(e, new Error("url requerida"));
      magis.fetchM3u(r.url, function (r, a) {
        if (r) return fail(e, r);
        respond(e, null, { channels: a || [] });
      });
    }
  }),
  service.register("resolveLive", function (e) {
    if (
      needModule(e, magis, "./magis") &&
      needModule(e, proxy, "./proxy") &&
      needModule(e, dnsx, "./dnsx")
    ) {
      var r = e.payload || {};
      if (r.streamUrl) {
        var a = r.streamUrl,
          s = urlmod.parse(a || "").hostname || "",
          t = function (r) {
            proxy.start(function (s) {
              if (s)
                return respond(e, null, { url: a, proxyPath: a, isHls: !0 });
              var t = proxy.add(a, {}, 0, r);
              respond(e, null, {
                url: a,
                proxyPath: proxy.baseUrl() + "/media/" + t + "/stream.m3u8",
                isHls: !0,
              });
            });
          };
        return s
          ? dnsx.resolve(s, function (e, r) {
              var a = (r && r.ips && r.ips[0]) || "";
              t(a);
            })
          : t("");
      }
      if (!r.channelCode) return fail(e, new Error("channelCode requerido"));
      magis.resolveLive(r.channelCode, function (r, a) {
        if (r) return fail(e, r);
        var s = urlmod.parse(a.url || "").hostname || "";
        dnsx.resolve(s, function (r, s) {
          var t = (s && s.ips && s.ips[0]) || "";
          proxy.start(function (r) {
            if (r) return fail(e, r);
            var s = proxy.add(a.url, a.headers, 0, t, a.backupUrls);
            ((a.proxyPath = proxy.baseUrl() + "/media/" + s + "/stream.m3u8"),
              (a.isHls = !0),
              respond(e, null, a));
          });
        });
      });
    }
  }),
  service.register("abortMedia", function (e) {
    try {
      relay.stop();
    } catch (e) {}
    try {
      proxy.killActiveStreams();
    } catch (e) {}
    e.respond({ returnValue: !0 });
  }),
  service.register("prewarm", function (e) {
    needModule(e, magis, "./magis") &&
      magis.ensureSession(function (r) {
        if (r) return fail(e, r);
        e.respond({
          returnValue: !0,
          sn: magis.session.sn,
          userId: magis.session.userId,
        });
      });
  }),
  service.register("netdiag", function (e) {
    if (
      needModule(e, magis, "./magis") &&
      needModule(e, netdiag, "./netdiag") &&
      needModule(e, dnsx, "./dnsx")
    ) {
      var r = e.payload || {},
        a = [],
        s = magis.constants || {};
      s.HOSTS && s.HOSTS.length && (a = s.HOSTS.slice(0));
      for (var t = dnsx.summary(), n = 0; n < t.length; n++)
        t[n] &&
          t[n].host &&
          t[n].ageMs < 12e4 &&
          -1 === a.indexOf(t[n].host) &&
          a.push(t[n].host);
      r.hosts && r.hosts.length && (a = r.hosts.concat(a));
      var o = null;
      Number(r.screenW) > 0 &&
        Number(r.screenH) > 0 &&
        (o = {
          w: Number(r.screenW),
          h: Number(r.screenH),
          scale: Number(r.screenScale) || 0,
          panelW: Number(r.panelW) || 0,
          panelH: Number(r.panelH) || 0,
        });
      var i = null,
        l = null,
        u = !1;
      netdiag.run({ hosts: a, screen: o }, function (e, r) {
        ((i =
          e || !r ? { verdict: "incompleto", hosts: [], providers: [] } : r),
          c());
      });
      var d = setTimeout(function () {
        if (!l) {
          var e = magis.session || {};
          ((l = {
            portal: { ok: !1, error: "sin respuesta del portal" },
            session: {
              userId: e.userId ? "✓" : "?",
              token: e.userToken ? "✓" : "?",
              ready: !!e.ready,
              error: "sin sesión: el portal no respondió",
            },
          }),
            c());
        }
      }, 24e3);
      magis.ensureSession(function (e) {
        var a = magis.session || {},
          s =
            (magis.constants &&
              magis.constants.HOSTS &&
              magis.constants.HOSTS[0]) ||
            "",
          t = {
            portalUrl: s ? "https://" + s + "/api/portalCore/v8/active" : "",
            session: {
              userId: a.userId || "",
              userToken: a.userToken || "",
              ready: !!a.ready,
              error: e ? e.message || "error" : "",
            },
            liveUrl: r.liveUrl || "",
            liveHeaders: r.liveHeaders || {},
            vodUrl: r.vodUrl || "",
            vodHeaders: r.vodHeaders || {},
          };
        netdiag.runLayers(t, function (e, r) {
          (clearTimeout(d), (l = r || {}), c());
        });
      });
    }
    function c() {
      !u &&
        i &&
        l &&
        ((u = !0),
        (i.version = pkg.version),
        (i.layers = l),
        (i.relay = relay.state ? relay.state() : null),
        (i.codec = {
          h264: r.codecH264 || "",
          hevc: r.codecHEVC || "",
          hls: r.codecHLS || "",
        }),
        respond(e, null, i));
    }
  }),
  service.register("checkUpdate", function (e) {
    if (needModule(e, updater, "./updater")) {
      var r = (e.payload || {}).currentVersion || pkg.version;
      updater.checkUpdate(r, function (r, a) {
        if (r) return fail(e, r);
        respond(e, null, a);
      });
    }
  }),
  service.register("applyUpdate", function (e) {
    if (needModule(e, updater, "./updater")) {
      var r = (e.payload || {}).ipkUrl;
      if (!r) return fail(e, new Error("URL de actualizacion no especificada"));
      updater.applyUpdate(
        r,
        function (r, a, s) {
          try {
            e.respond({ returnValue: !0, state: r, percent: a, message: s });
          } catch (e) {}
        },
        function (r, a) {
          if (r) return fail(e, r);
          respond(e, null, { success: !0, finished: !0 });
        },
      );
    }
  }),
  console.log("[xuper-service] started " + pkg.name + " v" + pkg.version));
