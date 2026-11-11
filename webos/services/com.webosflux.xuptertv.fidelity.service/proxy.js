"use strict";
var http = require("http"),
  https = require("https"),
  crypto = require("crypto"),
  urlmod = require("url"),
  streamMod = require("stream"),
  tsIndexer = require("./ts-indexer"),
  dnsx = require("./dnsx"),
  upstream = require("./upstream"),
  MAX_TOKENS = 200,
  tokens = {},
  order = [],
  subtitleTokens = {},
  subtitleOrder = [],
  MAX_SUBTITLES = 500,
  server = null,
  port = 0,
  httpAgent = new http.Agent({
    keepAlive: !0,
    maxSockets: 32,
    keepAliveMsecs: 15e3,
  }),
  httpsAgent = new https.Agent({
    keepAlive: !0,
    maxSockets: 32,
    keepAliveMsecs: 15e3,
    rejectUnauthorized: !1,
  }),
  activeToken = null,
  activeUpstreams = [],
  TS_PACKET_BYTES = 188,
  HLS_SEGMENT_SECONDS = 10,
  /* Contadores de diagnóstico: permiten saber desde la app si los cortes son
     de red (errores/timeouts del CDN) o del reproductor (sin errores aquí). */
  stats = {
    reqs: 0,
    errors: 0,
    timeouts: 0,
    badStatus: 0,
    lastError: "",
    lastStatus: 0,
    lastAt: 0,
  };
function destroyConnection(e) {
  if (e) {
    if (e.up) {
      try {
        e.up.unpipe();
      } catch (e) {}
      try {
        "function" == typeof e.up.destroy && e.up.destroy();
      } catch (e) {}
      try {
        e.up.socket && e.up.socket.destroy();
      } catch (e) {}
      e.up = null;
    }
    try {
      e.upstream && e.upstream.abort();
    } catch (e) {}
    try {
      e.upstream && e.upstream.socket && e.upstream.socket.destroy();
    } catch (e) {}
    try {
      e.res && !e.res.finished && e.res.destroy();
    } catch (e) {}
    ((e.upstream = null), (e.res = null), (e.req = null));
  }
}
function killActiveStreams() {
  for (; activeUpstreams.length > 0;) {
    destroyConnection(activeUpstreams.shift());
  }
}
function remember(e, t) {
  for (tokens[e] = t, order.push(e); order.length > MAX_TOKENS;) {
    var r = order.shift();
    r && delete tokens[r];
  }
}
function isCacheFlyIp(e) {
  return (
    !!e &&
    (/^66\.225\./.test(e) || /^205\.234\./.test(e) || /^167\.99\./.test(e))
  );
}
function resolveHostIp(e, t) {
  if (!e) return t("");
  if (e.resolvedIp && dnsx.isIpv4(e.resolvedIp)) return t(e.resolvedIp);
  var r = urlmod.parse(e.url || "").hostname;
  if (!r || dnsx.isIpv4(r)) return ((e.resolvedIp = r || ""), t(e.resolvedIp));
  var n = dnsx.cached(r);
  if (n && n.ips && n.ips.length)
    return ((e.resolvedIp = dnsx.dial(r, n.ips)), t(e.resolvedIp));
  dnsx.resolve(r, function (n, o) {
    (!n && o && o.ips && o.ips.length
      ? (e.resolvedIp = dnsx.dial(r, o.ips))
      : (e.resolvedIp = r),
      t(e.resolvedIp));
  });
}
function normalizeBackups(e) {
  var t = [];
  if (!Array.isArray(e)) return t;
  for (var r = 0; r < e.length; r++) {
    var n = e[r];
    n &&
      ("string" == typeof n
        ? t.push({ url: n, headers: null })
        : n.url && t.push({ url: n.url, headers: n.headers || null }));
  }
  return t;
}
function add(e, t, r, n, o, live) {
  var s = crypto.randomBytes(12).toString("hex"),
    a = {
      url: e,
      backupUrls: normalizeBackups(o),
      backupIndex: 0,
      headers: t || {},
      duration: Number(r) || 0,
      contentLength: 0,
      lengthWaiters: null,
      resolvedIp: n || "",
      /* TV en vivo: sus segmentos se piden de nuevo cada pocos segundos y el
         CDN a veces cierra el socket justo al reutilizarlo (ECONNRESET). */
      isLive: !!live,
      at: Date.now(),
    };
  remember(s, a);
  var i = urlmod.parse(e || "");
  if (i.hostname && !dnsx.isIpv4(i.hostname) && !a.resolvedIp) {
    var l = dnsx.cached(i.hostname);
    (l &&
      l.ips &&
      l.ips.length &&
      (a.resolvedIp = dnsx.dial(i.hostname, l.ips)),
      dnsx.resolve(i.hostname, function (e, t) {
        !e &&
          t &&
          t.ips &&
          t.ips.length &&
          (a.resolvedIp = dnsx.dial(i.hostname, t.ips));
      }));
  }
  return s;
}
function addSubtitleToken(e) {
  var t = crypto.randomBytes(12).toString("hex");
  subtitleTokens[t] = { url: e, at: Date.now() };
  subtitleOrder.push(t);
  while (subtitleOrder.length > MAX_SUBTITLES) {
    var r = subtitleOrder.shift();
    r && delete subtitleTokens[r];
  }
  return t;
}
function addSubtitle(e) {
  var t = addSubtitleToken(e);
  return baseUrl() + "/sub/" + t + ".srt";
}
function srtToVtt(str) {
  str = String(str || "").replace(/^\uFEFF/, "");
  str = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  str = str.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + str.trim() + "\n";
}
function sendSubtitle(e, t, r, isVtt) {
  resolveHostIp(r, function (e) {
    var n = urlmod.parse(r.url || ""),
      o = "https:" === n.protocol,
      s = n.hostname,
      a = e || s,
      i = o ? 443 : 80,
      l = n.port || i,
      u = {
        hostname: a,
        host: a,
        servername: s,
        rejectUnauthorized: !1,
        port: l,
        path: n.path,
        method: "GET",
        headers: {
          "User-Agent": "Ranger/4.9.4-17294ac0",
          Accept: "*/*",
          Host: n.host || s + (l !== i ? ":" + l : ""),
        },
        agent: upstream.agentFor(o, a, l) || (o ? httpsAgent : httpAgent),
      },
      c = !1,
      p = (o ? https : http).request(u, function (e) {
        var chunks = [];
        e.on("data", function (chunk) {
          chunks.push(chunk);
        });
        e.on("end", function () {
          if (!c) {
            var raw = Buffer.concat(chunks);
            var ok = e.statusCode >= 200 && e.statusCode < 300;
            if (!ok) {
              try {
                t.writeHead(502, {
                  "Content-Type": "text/plain",
                  "Access-Control-Allow-Origin": "*",
                });
                t.end("subtitle upstream error " + e.statusCode);
              } catch (err) {}
              return;
            }
            if (isVtt) {
              var vttText = srtToVtt(raw.toString("utf8"));
              var vttBuf = Buffer.from(vttText, "utf8");
              t.writeHead(200, {
                "Content-Type": "text/vtt; charset=utf-8",
                "Content-Length": vttBuf.length,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600",
              });
              t.end(vttBuf);
            } else {
              t.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Length": raw.length,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600",
              });
              t.end(raw);
            }
          }
        });
      });
    p.setTimeout(2e4, function () {
      try {
        p.abort();
      } catch (e) {}
    });
    p.on("error", function () {
      if (!c) {
        c = !0;
        try {
          t.writeHead(502, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
          });
          t.end("subtitle upstream error");
        } catch (e) {}
      }
    });
    p.end();
  });
}
function isCacheFlyHost(e, t) {
  return (
    !!isCacheFlyIp(t) ||
    /swzablvpm|kyalbhxgw|m3x8o50te|qnrgmzpcw|faolmbghu/i.test(String(e || ""))
  );
}
function mediaRequest(e, t, r, n) {
  var o = urlmod.parse(e.url || ""),
    s = o.hostname,
    a = n || e.resolvedIp;
  if (!a && s) {
    var i = dnsx.cached(s);
    i &&
      i.ips &&
      i.ips.length &&
      ((a = dnsx.dial(s, i.ips)), (e.resolvedIp = a));
  }
  a || (a = s);
  var l = "https:" === o.protocol,
    u = !(!e._maskSni || !isCacheFlyHost(s, a));
  u && (l = !0);
  var c,
    p = {};
  for (c in e.headers)
    Object.prototype.hasOwnProperty.call(e.headers, c) && (p[c] = e.headers[c]);
  for (c in r || {})
    Object.prototype.hasOwnProperty.call(r, c) && (p[c] = r[c]);
  var d = l ? 443 : 80,
    h = u && "80" === o.port ? 443 : o.port || d;
  (p.Host = o.host || s + (h !== d ? ":" + h : ""));
  var ag = upstream.agentFor(l, a, h);
  /* Los segmentos de TV en vivo no usan el pool keep-alive: en Node 0.12 un
     socket ocioso que el CDN cierra justo al reutilizarlo provoca ECONNRESET a
     mitad del segmento y el <video> se queda congelado hasta 12 s. */
  ag || (ag = e._noKeepAlive ? !1 : l ? httpsAgent : httpAgent);
  return {
    secure: l,
    options: {
      hostname: a,
      host: a,
      servername: u ? "cachefly.net" : s,
      rejectUnauthorized: !1,
      port: h,
      path: o.path,
      method: t,
      headers: p,
      agent: ag,
    },
  };
}
function sourceLength(e, t) {
  if (e.contentLength > 0) return t(null, e.contentLength);
  e.lengthWaiters
    ? e.lengthWaiters.push(t)
    : ((e.lengthWaiters = [t]),
      resolveHostIp(e, function (t) {
        var r = mediaRequest(e, "GET", { Range: "bytes=0-0" }, t),
          n = (r.secure ? https : http).request(r.options, function (t) {
            var r = /\/(\d+)$/.exec(String(t.headers["content-range"] || "")),
              n = r
                ? parseInt(r[1], 10)
                : parseInt(t.headers["content-length"], 10);
            t.resume();
            var o = e.lengthWaiters || [];
            ((e.lengthWaiters = null), n > 0 && (e.contentLength = n));
            for (var s = 0; s < o.length; s++)
              o[s](n > 0 ? null : new Error("el CDN no informó el tamaño"), n);
          });
        (n.setTimeout(15e3, function () {
          try {
            n.abort();
          } catch (e) {}
        }),
          n.on("error", function (t) {
            var r = e.lengthWaiters || [];
            e.lengthWaiters = null;
            for (var n = 0; n < r.length; n++) r[n](t);
          }),
          n.end());
      }));
}
function readRange(e, t, r, n) {
  resolveHostIp(e, function (o) {
    var s = mediaRequest(e, "GET", { Range: "bytes=" + t + "-" + r }, o),
      a = (s.secure ? https : http).request(s.options, function (e) {
        var t = [];
        (e.on("data", function (e) {
          t.push(e);
        }),
          e.on("end", function () {
            n(
              e.statusCode >= 200 && e.statusCode < 300
                ? null
                : new Error("rango rechazado"),
              Buffer.concat(t)
            );
          }));
      });
    (a.setTimeout(25e3, function () {
      try {
        a.abort();
      } catch (e) {}
    }),
      a.on("error", function (e) {
        n(e);
      }),
      a.end());
  });
}
function createAudioPidTransform(audioTrackIndex) {
  var stream = new streamMod.Transform();
  var targetPid = 257 + audioTrackIndex;
  var basePid = 257;
  var remainder = Buffer.alloc(0);

  stream._transform = function (chunk, encoding, callback) {
    var data = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
    var len = data.length;
    var validLen = len - (len % 188);
    remainder = data.slice(validLen);

    if (validLen > 0) {
      for (var i = 0; i < validLen; i += 188) {
        if (data[i] !== 0x47) continue;
        var pid = ((data[i + 1] & 0x1f) << 8) | data[i + 2];
        if (pid === basePid) {
          data[i + 1] = (data[i + 1] & 0xe0) | ((targetPid >> 8) & 0x1f);
          data[i + 2] = targetPid & 0xff;
        } else if (pid === targetPid) {
          data[i + 1] = (data[i + 1] & 0xe0) | ((basePid >> 8) & 0x1f);
          data[i + 2] = basePid & 0xff;
        } else if (pid === 4096) {
          var spaIdx = data.indexOf(Buffer.from("spa\0"), i);
          var engIdx = data.indexOf(Buffer.from("eng\0"), i);
          if (spaIdx !== -1 && engIdx !== -1 && spaIdx < i + 188 && engIdx < i + 188) {
            data.write("eng\0", spaIdx);
            data.write("spa\0", engIdx);
          }
        }
      }
      this.push(data.slice(0, validLen));
    }
    callback();
  };

  stream._flush = function (callback) {
    if (remainder.length > 0) {
      this.push(remainder);
      remainder = Buffer.alloc(0);
    }
    callback();
  };

  return stream;
}
function transformTsBuffer(buf, audioTrackIndex) {
  if (!audioTrackIndex || audioTrackIndex <= 0) return buf;
  var targetPid = 257 + audioTrackIndex;
  var basePid = 257;
  for (var i = 0; i + 188 <= buf.length; i += 188) {
    if (buf[i] !== 0x47) continue;
    var pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    if (pid === basePid) {
      buf[i + 1] = (buf[i + 1] & 0xe0) | ((targetPid >> 8) & 0x1f);
      buf[i + 2] = targetPid & 0xff;
    } else if (pid === targetPid) {
      buf[i + 1] = (buf[i + 1] & 0xe0) | ((basePid >> 8) & 0x1f);
      buf[i + 2] = basePid & 0xff;
    } else if (pid === 4096) {
      var spaIdx = buf.indexOf(Buffer.from("spa\0"), i);
      var engIdx = buf.indexOf(Buffer.from("eng\0"), i);
      if (spaIdx !== -1 && engIdx !== -1 && spaIdx < i + 188 && engIdx < i + 188) {
        buf.write("eng\0", spaIdx);
        buf.write("spa\0", engIdx);
      }
    }
  }
  return buf;
}
function sendVirtualHls(e, t, r, n) {
  var parsedReq = urlmod.parse(e.url, true);
  var audioTrack = parseInt(parsedReq.query.audio || "0", 10);
  sourceLength(n, function (o, s) {
    if (o)
      return (
        t.writeHead(502, {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        }),
        void t.end("no se pudo crear el manifiesto HLS")
      );
    n.indexer ||
      ((n.indexer = tsIndexer.create(s, function (e, t, r) {
        readRange(n, e, t, r);
      })),
      n.indexer.start());
    var a = n.indexer;
    if (a.segments.length || a.complete) {
      for (
        var i = [
            "#EXTM3U",
            "#EXT-X-VERSION:4",
            a.complete ? "#EXT-X-PLAYLIST-TYPE:VOD" : "#EXT-X-PLAYLIST-TYPE:EVENT",
            "#EXT-X-TARGETDURATION:" + HLS_SEGMENT_SECONDS,
            "#EXT-X-MEDIA-SEQUENCE:0",
          ],
          l = 0;
        l < a.segments.length;
        l++
      ) {
        var u = a.segments[l];
        (i.push("#EXTINF:" + u.duration.toFixed(3) + ","),
          i.push("#EXT-X-BYTERANGE:" + (u.end - u.start + 1) + "@" + u.start),
          i.push(audioTrack > 0 ? "stream.ts?audio=" + audioTrack : "stream.ts"));
      }
      a.complete && i.push("#EXT-X-ENDLIST");
      var c = i.join("\n") + "\n";
      (t.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Content-Length": Buffer.byteLength(c),
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      }),
        t.end(c));
    } else
      a.when(function () {
        sendVirtualHls(e, t, r, n);
      });
  });
}
function base64Url(e) {
  return new Buffer(String(e), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function fromBase64Url(e) {
  for (var t = String(e).replace(/-/g, "+").replace(/_/g, "/"); t.length % 4;)
    t += "=";
  return new Buffer(t, "base64").toString("utf8");
}
function hlsChildUrl(e, t, r) {
  return r && 0 !== r.indexOf("data:")
    ? baseUrl() + "/hls/" + e + "/" + base64Url(urlmod.resolve(t, r))
    : r;
}
function rewriteHlsManifest(e, t, r) {
  for (
    var n = String(e || "")
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/),
      o = 0;
    o < n.length;
    o++
  ) {
    var s = n[o];
    s &&
      ("#" !== s.charAt(0)
        ? (n[o] = hlsChildUrl(t, r, s))
        : -1 !== s.indexOf("URI=") &&
          (n[o] = s.replace(/URI=("|')([^"']+)\1/g, function (e, n, o) {
            return "URI=" + n + hlsChildUrl(t, r, o) + n;
          })));
  }
  return n.join("\n");
}
function forward(e, t, r, n) {
  activeToken = n;
  var o = {};
  (e.headers.range && (o.Range = e.headers.range),
    e.headers["if-range"] && (o["If-Range"] = e.headers["if-range"]),
    resolveHostIp(r, function (s) {
      if (!t.finished) {
        var a = mediaRequest(r, "HEAD" === e.method ? "HEAD" : "GET", o, s),
          i = a.secure,
          l = a.options;
        if (t.socket)
          try {
            t.socket.setNoDelay(!0);
          } catch (e) {}
        var u = { upstream: null, res: t, req: e, up: null };
        (activeUpstreams.push(u),
          e.on("close", p),
          e.on("aborted", p),
          t.on("close", p),
          t.on("finish", p),
          t.on("error", p));
        var retryUpstream = null,
          c = (i ? https : http).request(l, function (o) {
          if (((u.up = o), o.socket))
            try {
              o.socket.setNoDelay(!0);
            } catch (e) {}
          (stats.reqs++,
            (stats.lastStatus = o.statusCode || 0),
            (stats.lastAt = Date.now()),
            o.statusCode >= 400 && stats.badStatus++);
          if ((c.setTimeout(0), c.socket))
            try {
              c.socket.setTimeout(0);
            } catch (e) {}
          if (
            [301, 302, 303, 307, 308].indexOf(o.statusCode) !== -1 &&
            o.headers &&
            o.headers.location &&
            !t.headersSent &&
            (r._redirects || 0) < 5
          ) {
            var redirUrl = urlmod.resolve(r.url || "", o.headers.location);
            return (
              o.resume(),
              (r._redirects = (r._redirects || 0) + 1),
              (r.url = redirUrl),
              (r.resolvedIp = ""),
              p(),
              forward(e, t, r, n)
            );
          }
          if (
            !r._maskSni &&
            isCacheFlyHost(urlmod.parse(r.url || "").hostname, s) &&
            (403 === o.statusCode || 451 === o.statusCode)
          )
            return (
              o.resume(),
              console.log(
                "[proxy] CDN CacheFly respondió " +
                  o.statusCode +
                  ", reintentando con SNI camuflado..."
              ),
              (r._maskSni = !0),
              (r.resolvedIp = ""),
              p(),
              forward(e, t, r, n)
            );
          if (
            o.statusCode >= 400 &&
            !t.headersSent &&
            r &&
            !r._isHlsChild &&
            r.backupUrls &&
            r.backupIndex < r.backupUrls.length
          ) {
            var bItem = r.backupUrls[r.backupIndex++],
              bUrl = bItem && "string" == typeof bItem ? bItem : bItem && bItem.url;
            if (bUrl)
              return (
                o.resume(),
                console.log(
                  "[proxy] upstream respondió HTTP " +
                    o.statusCode +
                    " en " +
                    r.url +
                    ", reintentando con CDN alternativa: " +
                    bUrl
                ),
                (r.url = bUrl),
                bItem && bItem.headers && (r.headers = bItem.headers),
                (r.resolvedIp = ""),
                (r._redirects = 0),
                (r._retriedProtocol = !1),
                (r._maskSni = !1),
                (r._dnsRetry = !1),
                p(),
                forward(e, t, r, n)
              );
          }
          r && ((r._redirects = 0), (r._freshRetry = !1), (r._noKeepAlive = !1));
          var a = (o.headers["content-type"] || "").toLowerCase(),
            i = "video/mp2t";
          -1 !== a.indexOf("mp4")
            ? (i = "video/mp4")
            : (-1 !== a.indexOf("mpegurl") ||
                (r.url && -1 !== r.url.indexOf(".m3u8"))) &&
              (i = "application/vnd.apple.mpegurl");
          var l = "application/vnd.apple.mpegurl" === i,
            d = {
              "Content-Type": i,
              "Accept-Ranges": o.headers["accept-ranges"] || "bytes",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": l
                ? "no-cache, no-store"
                : "private, max-age=120",
              Connection: "keep-alive",
            };
          if (
            (o.headers["content-length"] &&
              (d["Content-Length"] = o.headers["content-length"]),
            o.headers["content-range"] &&
              (d["Content-Range"] = o.headers["content-range"]),
            "HEAD" === e.method)
          )
            return (
              t.writeHead(o.statusCode || 200, d),
              t.end(),
              void o.resume()
            );
          if (l) {
            var h = [];
            return (
              o.on("data", function (e) {
                h.push(e);
              }),
              o.on("error", function () {
                p();
              }),
              void o.on("end", function () {
                var e = rewriteHlsManifest(
                  Buffer.concat(h).toString("utf8"),
                  n,
                  r.url
                );
                (delete d["Content-Length"],
                  delete d["Content-Range"],
                  (d["Content-Length"] = Buffer.byteLength(e)));
                try {
                  (t.writeHead(o.statusCode || 200, d), t.end(e));
                } catch (e) {
                  p();
                }
              })
            );
          }
          if (r._segBuf && "GET" === e.method && (o.statusCode || 200) < 400) {
            /* Segmento de TV en vivo: se descarga completo antes de entregarlo.
               Si el CDN corta el socket a mitad (ECONNRESET), se reintenta y el
               <video> recibe el segmento entero en vez de uno truncado que lo
               dejaba congelado hasta que saltaba el vigilante. */
            var sc = [],
              sb = 0,
              sdone = !1,
              sstream = !1,
              stm = null,
              sonData,
              sonEnd,
              sstop = function () {
                stm && (clearTimeout(stm), (stm = null));
              },
              skick = function () {
                sstop();
                stm = setTimeout(function () {
                  (stats.timeouts++, (stats.lastError = "segmento sin datos"));
                  sfail(new Error("segmento sin datos"));
                }, 1e4);
              },
              sfail = function (x) {
                if (sdone) return;
                sdone = !0;
                sstop();
                try {
                  (o.removeListener("data", sonData),
                    o.removeListener("end", sonEnd),
                    o.removeListener("error", sfail));
                } catch (x) {}
                try {
                  o.destroy();
                } catch (x) {}
                if (sstream || t.headersSent) {
                  try {
                    t.destroy();
                  } catch (x) {}
                  return void p();
                }
                r._segTries = (r._segTries || 0) + 1;
                /* Primero se reintenta el mismo segmento con conexión nueva;
                   si el CDN sigue fallando se entra en la cadena de rescate
                   (DoH, SNI camuflado, protocolo, CDN alternativa). */
                if (r._segTries <= 2) {
                  p();
                  return void forward(e, t, r, n);
                }
                if (r._segTries <= 4) return void retryUpstream(x);
                try {
                  (t.writeHead(502, {
                    "Content-Type": "text/plain",
                    "Access-Control-Allow-Origin": "*",
                  }),
                    t.end("segmento incompleto"));
                } catch (x) {}
                p();
              };
            sonData = function (chunk) {
              if (sdone) return;
              if (sstream) return void t.write(chunk);
              (sc.push(chunk), (sb += chunk.length));
              if (sb > 16777216) {
                /* Segmento enorme: se entrega en streaming para no llenar la
                   memoria del televisor. */
                sstream = !0;
                try {
                  (t.writeHead(o.statusCode || 200, d),
                    t.write(Buffer.concat(sc, sb)));
                } catch (x) {
                  return void sfail(x);
                }
                (sc = []), (sb = 0);
                return;
              }
              skick();
            };
            sonEnd = function () {
              if (sdone) return;
              sdone = !0;
              sstop();
              if (sstream) {
                try {
                  t.end();
                } catch (x) {
                  p();
                }
                return;
              }
              var b = Buffer.concat(sc, sb);
              var parsedUrlBuf = urlmod.parse(e.url, true);
              var audioTrackBuf = parseInt(parsedUrlBuf.query.audio || "0", 10);
              if (audioTrackBuf > 0) {
                b = transformTsBuffer(b, audioTrackBuf);
              }
              (delete d["Content-Length"], (d["Content-Length"] = b.length));
              try {
                (t.writeHead(o.statusCode || 200, d), t.end(b));
              } catch (x) {
                p();
              }
            };
            return (
              o.on("data", sonData),
              o.on("end", sonEnd),
              o.on("error", sfail),
              void skick()
            );
          }
          var parsedUrlStream = urlmod.parse(e.url, true);
          var audioTrackStream = parseInt(parsedUrlStream.query.audio || "0", 10);
          if (audioTrackStream > 0) {
            var audioTransform = createAudioPidTransform(audioTrackStream);
            (t.writeHead(o.statusCode || 200, d),
              o.on("error", function () {
                p();
              }),
              o.pipe(audioTransform).pipe(t));
          } else {
            (t.writeHead(o.statusCode || 200, d),
              o.on("error", function () {
                p();
              }),
              o.pipe(t));
          }
        });
        if (((u.upstream = c), c.socket))
          try {
            c.socket.setNoDelay(!0);
          } catch (e) {}
        (c.setTimeout(r && r.isLive ? 6500 : 15e3, function () {
          /* Antes, un CDN con la IP filtrada se quedaba 25 s colgado y luego
             devolvía 504 sin probar nada más. Ahora el tiempo agotado entra
             en la misma cadena de rescate que un error de conexión. */
          (stats.timeouts++, (stats.lastError = "tiempo agotado"));
          if (retryUpstream) return retryUpstream(new Error("tiempo agotado"));
          try {
            c.abort();
          } catch (e) {}
          p();
        }),
          (retryUpstream = function (o) {
            if (e.aborted || t.finished) return void p();
            (stats.errors++,
              (stats.lastError = String((o && (o.code || o.message)) || "error")),
              (stats.lastAt = Date.now()));
            if (!t.headersSent && r && !r._freshRetry) {
              return (
                (r._freshRetry = !0),
                (r._noKeepAlive = !0),
                p(),
                forward(e, t, r, n)
              );
            }
            if (r && r.url) {
              var s = urlmod.parse(r.url).hostname,
                a = dnsx.cached(s);
              a &&
                a.ips &&
                a.ips.length > 1 &&
                (r.resolvedIp = dnsx.dial(s, a.ips));
            }
            if (
              !t.headersSent &&
              r &&
              !r._maskSni &&
              isCacheFlyHost(urlmod.parse(r.url || "").hostname, r.resolvedIp)
            )
              return (
                console.log(
                  "[proxy] upstream CacheFly falló (" +
                    (o && (o.code || o.message)) +
                    "), reintentando con SNI camuflado cachefly.net..."
                ),
                (r._maskSni = !0),
                (r.resolvedIp = ""),
                p(),
                forward(e, t, r, n)
              );
            if (
              !t.headersSent &&
              r &&
              !r._retriedProtocol &&
              /^https?:\/\//i.test(r.url || "")
            )
              return (
                (r._retriedProtocol = !0),
                (r._dnsRetry = !1),
                /^https:\/\//i.test(r.url)
                  ? (console.log(
                      "[proxy] upstream HTTPS falló (" +
                        (o && (o.code || o.message)) +
                        "), reintentando con HTTP compatible..."
                    ),
                    (r.url = r.url.replace(/^https:\/\//i, "http://")),
                    (r.resolvedIp = ""),
                    p(),
                    forward(e, t, r, n))
                  : (console.log(
                      "[proxy] upstream HTTP falló (" +
                        (o && (o.code || o.message)) +
                        "), reintentando con HTTPS por posible bloqueo DPI..."
                    ),
                    (r.url = r.url.replace(/^http:\/\//i, "https://")),
                    (r.resolvedIp = ""),
                    p(),
                    forward(e, t, r, n))
              );
            /* El DNS del operador puede devolver una IP envenenada que no
               conecta (bloqueo de anoche). Se descarta la caché y se vuelve a
               resolver, forzando DoH, una sola vez por petición. */
            if (
              !t.headersSent &&
              r &&
              !r._dnsRetry &&
              r.url &&
              /^https?:\/\//i.test(r.url)
            ) {
              var dh = urlmod.parse(r.url).hostname;
              if (dh && !dnsx.isIpv4(dh)) {
                return (
                  (r._dnsRetry = !0),
                  dnsx.clearCache(dh),
                  (r.resolvedIp = ""),
                  console.log(
                    "[proxy] upstream falló en " +
                      dh +
                      " (" +
                      (o && (o.code || o.message)) +
                      "), renovando DNS por DoH..."
                  ),
                  p(),
                  forward(e, t, r, n)
                );
              }
            }
            if (
              !t.headersSent &&
              r &&
              r.backupUrls &&
              r.backupIndex < r.backupUrls.length
            ) {
              var i = r.backupUrls[r.backupIndex++],
                l = i && "string" == typeof i ? i : i && i.url;
              if (l)
                return (
                  console.log(
                    "[proxy] upstream falló (" +
                      (o && (o.code || o.message)) +
                      "), reintentando con CDN alternativa: " +
                      l
                  ),
                  (r.url = l),
                  i && i.headers && (r.headers = i.headers),
                  (r.resolvedIp = ""),
                  (r._retriedProtocol = !1),
                  (r._maskSni = !1),
                  (r._dnsRetry = !1),
                  p(),
                  forward(e, t, r, n)
                );
            }
            if (t.headersSent)
              try {
                t.destroy();
              } catch (e) {}
            else
              try {
                (t.writeHead(502, {
                  "Content-Type": "text/plain",
                  "Access-Control-Allow-Origin": "*",
                }),
                  t.end("upstream error"));
              } catch (e) {}
            p();
          }),
          c.on("error", retryUpstream),
          c.end());
      }
      function p() {
        var e;
        if (
          (-1 !== (e = activeUpstreams.indexOf(u)) &&
            activeUpstreams.splice(e, 1),
          u.up)
        ) {
          try {
            u.up.unpipe();
          } catch (e) {}
          try {
            "function" == typeof u.up.destroy && u.up.destroy();
          } catch (e) {}
          try {
            u.up.socket && u.up.socket.destroy();
          } catch (e) {}
          u.up = null;
        }
        try {
          u.upstream && u.upstream.abort();
        } catch (e) {}
        try {
          u.upstream && u.upstream.socket && u.upstream.socket.destroy();
        } catch (e) {}
        ((u.upstream = null), (u.res = null), (u.req = null));
      }
    }));
}
function handler(e, t) {
  try {
    e.setTimeout(0);
  } catch (e) {}
  try {
    t.setTimeout(0);
  } catch (e) {}
  if ("OPTIONS" === e.method)
    return (
      t.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
      }),
      void t.end()
    );
  if ("/media/abort" === e.url)
    return (
      killActiveStreams(),
      (activeToken = null),
      t.writeHead(200, {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      }),
      void t.end("aborted")
    );
  var r = /^\/sub\/([a-f0-9]{24})\.(srt|vtt)$/.exec(e.url || "");
  if (r) {
    var n = subtitleTokens[r[1]];
    var isVtt = r[2] === "vtt";
    return n
      ? void sendSubtitle(e, t, n, isVtt)
      : (t.writeHead(410, {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        }),
        void t.end("expired"));
  }
  var o = /^\/hls\/([a-f0-9]{24})\/([A-Za-z0-9_-]+)$/.exec(
    (e.url || "").split("?")[0]
  );
  if (o) {
    var s = tokens[o[1]];
    if (!s)
      return (
        t.writeHead(410, {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        }),
        void t.end("expired")
      );
    var a = fromBase64Url(o[2]);
    return /^https?:\/\//i.test(a)
      ? void forward(
          e,
          t,
          {
            url: a,
            headers: s.headers,
            duration: 0,
            backupUrls: [],
            backupIndex: 0,
            isLive: s.isLive,
            _isHlsChild: !0,
            _segBuf: !1,
            _noKeepAlive: !1,
          },
          o[1]
        )
      : (t.writeHead(400, {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
        }),
        void t.end("invalid hls child"));
  }
  var i = /^\/media\/([a-f0-9]{24})(?:\/([^\?#]*))?(?:[?#].*)?$/.exec(
    e.url || ""
  );
  if (!i)
    return (
      t.writeHead(404, {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      }),
      void t.end("not found")
    );
  var l = i[1],
    u = i[2] || "",
    c = tokens[l];
  if (!c)
    return (
      t.writeHead(410, {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      }),
      void t.end("expired")
    );
  -1 !== c.url.indexOf(".m3u8") || -1 === u.indexOf(".m3u8")
    ? forward(e, t, c, l)
    : sendVirtualHls(e, t, l, c);
}
function start(e) {
  if (server && port) return e(null, port);
  (((server = http.createServer(handler)).timeout = 0),
    "function" == typeof server.setTimeout && server.setTimeout(0),
    server.on("error", function (t) {
      e(t);
    }),
    server.listen(0, "127.0.0.1", function () {
      ((port = server.address().port), e(null, port));
    }));
}
var customBaseUrl = "";
function baseUrl() {
  return customBaseUrl || (port ? "http://127.0.0.1:" + port : "");
}
module.exports = {
  handler: handler,
  setBaseUrl: function (u) { customBaseUrl = u; },
  start: start,
  add: add,
  addSubtitle: addSubtitle,
  addSubtitleToken: addSubtitleToken,
  baseUrl: baseUrl,
  port: function () {
    return port;
  },
  killActiveStreams: killActiveStreams,
  stats: function () {
    return {
      reqs: stats.reqs,
      errors: stats.errors,
      timeouts: stats.timeouts,
      badStatus: stats.badStatus,
      lastError: stats.lastError,
      lastStatus: stats.lastStatus,
      lastAt: stats.lastAt,
    };
  },
};
