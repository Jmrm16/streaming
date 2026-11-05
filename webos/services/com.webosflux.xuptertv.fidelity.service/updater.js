"use strict";
var http = require("http"),
  https = require("https"),
  urlmod = require("url"),
  fs = require("fs"),
  path = require("path"),
  spawn = require("child_process").spawn,
  dnsx = require("./dnsx"),
  UPDATE_MANIFEST_URLS = [
    "https://raw.githubusercontent.com/cristianco7/XUPER-HYDRA-PORT-WEBOS/main/version.json",
    "https://raw.githubusercontent.com/cristianco7/XUPER-HYDRA-PORT-WEBOS/feature/catalog-webos-compat/version.json",
    "https://cdn.jsdelivr.net/gh/cristianco7/XUPER-HYDRA-PORT-WEBOS@main/version.json",
  ],
  TARGET_IPK_PATH = "/tmp/xuper-ota.ipk",
  APP_ID = "com.webosflux.xuptertv.fidelity",
  lunaService = null;
function setLunaService(e) {
  lunaService = e;
}
function parseVer(e) {
  for (
    var t = String(e || "")
        .replace(/^[^\d]*/, "")
        .split("."),
      n = [],
      r = 0;
    r < t.length;
    r++
  ) {
    var a = parseInt(t[r], 10);
    n.push(isNaN(a) ? 0 : a);
  }
  return n;
}
function compareSemVer(e, t) {
  for (
    var n = parseVer(e),
      r = parseVer(t),
      a = Math.max(n.length, r.length),
      o = 0;
    o < a;
    o++
  ) {
    var s = n[o] || 0,
      i = r[o] || 0;
    if (s > i) return 1;
    if (s < i) return -1;
  }
  return 0;
}
var resolveHostIp = function (e, t) {
    if (!e || (dnsx && dnsx.isIpv4 && dnsx.isIpv4(e))) return t(null, e);
    if (!dnsx || "function" != typeof dnsx.resolve) return t(null, e);
    var n = "function" == typeof dnsx.cached ? dnsx.cached(e) : null;
    if (n && n.ips && n.ips.length) {
      var r = "function" == typeof dnsx.dial ? dnsx.dial(e, n.ips) : n.ips[0];
      return t(null, r || e);
    }
    dnsx.resolve(e, function (n, r) {
      if (!n && r && r.ips && r.ips.length) {
        var a = "function" == typeof dnsx.dial ? dnsx.dial(e, r.ips) : r.ips[0];
        return t(null, a || e);
      }
      t(null, e);
    });
  },
  fetchJson = function (e, t, n) {
    if ((void 0 === n && (n = 5), n < 0))
      return t(new Error("Demasiadas redirecciones HTTP"));
    var r;
    try {
      r = urlmod.parse(e);
    } catch (e) {
      return t(e);
    }
    resolveHostIp(r.hostname, function (a, o) {
      var s = "http:" === r.protocol ? http : https,
        i = {
          protocol: r.protocol,
          hostname: o || r.hostname,
          port: r.port || ("http:" === r.protocol ? 80 : 443),
          path: r.path,
          servername: r.hostname,
          rejectUnauthorized: !1,
          headers: {
            Host: r.hostname,
            "User-Agent":
              "Mozilla/5.0 (SmartHub; SMART-TV; webOS) XuperTV-OTA/1.0",
            Accept: "application/json, text/plain, */*",
          },
          timeout: 12e3,
        },
        c = s.get(i, function (r) {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
            var a = urlmod.resolve(e, r.headers.location);
            return fetchJson(a, t, n - 1);
          }
          if (404 === r.statusCode)
            return t(
              new Error(
                'No se encontró version.json en GitHub (HTTP 404). Debes hacer "git push" a tu repositorio.',
              ),
            );
          if (r.statusCode < 200 || r.statusCode >= 300)
            return t(
              new Error("HTTP " + r.statusCode + " al consultar actualización"),
            );
          var o = "";
          (r.setEncoding("utf8"),
            r.on("data", function (e) {
              o += e;
            }),
            r.on("end", function () {
              var e;
              try {
                e = JSON.parse(o);
              } catch (e) {
                return t(
                  new Error(
                    "Formato JSON inválido en servidor de actualización: " +
                      (e && e.message),
                  ),
                );
              }
              t(null, e);
            }));
        });
      (c.on("error", function (e) {
        t(e);
      }),
        c.on("timeout", function () {
          try {
            c.abort();
          } catch (e) {}
          t(
            new Error(
              "Tiempo de espera agotado al consultar servidor de actualización",
            ),
          );
        }));
    });
  },
  checkManifestInList = function (e, t, n, r) {
    if (t >= e.length) {
      var a =
        (n && n.message) ||
        "No se pudo contactar con los servidores de actualización";
      return r(new Error(a));
    }
    var o = e[t] + "?t=" + Date.now();
    fetchJson(o, function (a, o) {
      if (!a && o && o.version) return r(null, o);
      checkManifestInList(e, t + 1, a || n, r);
    });
  };
function checkUpdate(e, t) {
  checkManifestInList(UPDATE_MANIFEST_URLS, 0, null, function (n, r) {
    if (n) return t(n);
    var a = r.version || "0.0.0",
      o = compareSemVer(a, e) > 0;
    t(null, {
      updateAvailable: o,
      currentVersion: e,
      latestVersion: a,
      ipkUrl: r.ipkUrl || "",
      changelog: r.changelog || "",
      releaseDate: r.releaseDate || "",
    });
  });
}
var downloadFile = function (e, t, n, r, a) {
    if ((void 0 === a && (a = 6), a < 0))
      return r(new Error("Demasiadas redirecciones descargando el archivo"));
    var o;
    try {
      o = urlmod.parse(e);
    } catch (e) {
      return r(e);
    }
    resolveHostIp(o.hostname, function (s, i) {
      var c = "http:" === o.protocol ? http : https,
        u = {
          protocol: o.protocol,
          hostname: i || o.hostname,
          port: o.port || ("http:" === o.protocol ? 80 : 443),
          path: o.path,
          servername: o.hostname,
          rejectUnauthorized: !1,
          headers: {
            Host: o.hostname,
            "User-Agent":
              "Mozilla/5.0 (SmartHub; SMART-TV; webOS) AppleWebKit/537.36 (KHTML, like Gecko)",
            Accept: "*/*",
          },
          timeout: 45e3,
        },
        l = c.get(u, function (o) {
          if (o.statusCode >= 300 && o.statusCode < 400 && o.headers.location) {
            var s = urlmod.resolve(e, o.headers.location);
            return downloadFile(s, t, n, r, a - 1);
          }
          if (o.statusCode < 200 || o.statusCode >= 300)
            return r(
              new Error("HTTP " + o.statusCode + " al descargar el paquete"),
            );
          var i = parseInt(o.headers["content-length"], 10) || 0,
            c = 0,
            u = -1;
          try {
            fs.existsSync(t) && fs.unlinkSync(t);
          } catch (e) {}
          var p = fs.createWriteStream(t),
            d = !1,
            f = function (e, t) {
              d || ((d = !0), r(e, t));
            };
          (p.on("error", function (e) {
            try {
              l.abort();
            } catch (e) {}
            f(e);
          }),
            o.on("data", function (e) {
              if (((c += e.length), i > 0)) {
                var t = Math.floor((c / i) * 100);
                t !== u && ((u = t), n && n(t, c, i));
              } else n && n(-1, c, 0);
            }),
            o.on("error", function (e) {
              try {
                p.close();
              } catch (e) {}
              f(e);
            }),
            o.pipe(p),
            p.on("finish", function () {
              p.close(function () {
                f(null, t);
              });
            }));
        });
      (l.on("error", function (e) {
        r(e);
      }),
        l.on("timeout", function () {
          try {
            l.abort();
          } catch (e) {}
          r(new Error("Tiempo de espera agotado descargando la actualización"));
        }));
    });
  },
  installViaLunaSend = function (e, t, n) {
    var r,
      a = JSON.stringify({ id: APP_ID, ipkUrl: e, subscribe: !0 }),
      o = fs.existsSync("/usr/bin/luna-send-pub")
        ? "/usr/bin/luna-send-pub"
        : "luna-send-pub";
    try {
      r = spawn(o, [
        "-i",
        "-f",
        "luna://com.webos.appInstallService/dev/install",
        a,
      ]);
    } catch (e) {
      return n(
        new Error("No se pudo ejecutar luna-send-pub: " + (e && e.message)),
      );
    }
    var s = !1,
      i = function (e, t) {
        if (!s) {
          s = !0;
          try {
            r.kill("SIGKILL");
          } catch (e) {}
          n(e, t);
        }
      },
      c = setTimeout(function () {
        i(new Error("Tiempo límite de instalación superado"));
      }, 18e4),
      u = "";
    (r.stdout.on("data", function (e) {
      var n = (u += e.toString()).split(/\r?\n/);
      u = n.pop();
      for (var r = 0; r < n.length; r++) {
        var a = n[r];
        if (a) {
          if (/installed/i.test(a))
            return (clearTimeout(c), i(null, { state: "installed", raw: a }));
          if (
            /FAILED_IPKG_INSTALL/i.test(a) ||
            (/"returnValue":\s*false/i.test(a) && /errorCode/i.test(a))
          )
            return (
              clearTimeout(c),
              i(new Error("La TV rechazó la instalación: " + a))
            );
          t && t(a);
        }
      }
    }),
      r.on("error", function (e) {
        (clearTimeout(c), i(e));
      }),
      r.on("close", function (e) {
        return (
          clearTimeout(c),
          /installed/i.test(u)
            ? i(null, { state: "installed" })
            : 0 === e
              ? i(null, { state: "completed" })
              : void i(
                  new Error(
                    "El instalador finalizó con código " + e + ": " + u,
                  ),
                )
        );
      }));
  },
  relaunchApp = function () {
    var e = fs.existsSync("/usr/bin/luna-send-pub")
        ? "/usr/bin/luna-send-pub"
        : "luna-send-pub",
      t = JSON.stringify({ id: APP_ID });
    try {
      var n = spawn(
        e,
        ["-n", "1", "-f", "luna://com.webos.applicationManager/launch", t],
        { detached: !0, stdio: "ignore" },
      );
      n.unref && n.unref();
    } catch (e) {
      console.error("[updater] error relanzando app:", e);
    }
  };
function applyUpdate(e, t, n) {
  (t("downloading", 0, "Iniciando descarga de la actualización..."),
    downloadFile(
      e,
      TARGET_IPK_PATH,
      function (e, n, r) {
        var a =
          e >= 0
            ? "Descargando paquete: " + e + "%"
            : "Descargando paquete (" + Math.round(n / 1048576) + " MB)...";
        t("downloading", e >= 0 ? e : 0, a);
      },
      function (e, r) {
        if (e) {
          try {
            fs.existsSync(TARGET_IPK_PATH) && fs.unlinkSync(TARGET_IPK_PATH);
          } catch (e) {}
          return n(new Error("Error en la descarga: " + (e && e.message)));
        }
        (t("installing", 100, "Instalando actualización en el televisor..."),
          installViaLunaSend(
            r,
            function (e) {
              t("installing", 100, "Instalando en webOS: " + e);
            },
            function (e) {
              try {
                fs.existsSync(TARGET_IPK_PATH) &&
                  fs.unlinkSync(TARGET_IPK_PATH);
              } catch (e) {}
              if (e)
                return n(
                  new Error("Error en instalación: " + (e && e.message)),
                );
              (t(
                "success",
                100,
                "¡Instalación completada! Reiniciando XuperTV...",
              ),
                setTimeout(function () {
                  try {
                    "function" == typeof process.reallyExit
                      ? process.reallyExit(0)
                      : process.kill(process.pid, "SIGKILL");
                  } catch (e) {}
                }, 6e3),
                setTimeout(function () {
                  relaunchApp();
                }, 1e3),
                n(null, { success: !0 }));
            },
          ));
      },
    ));
}
module.exports = {
  init: setLunaService,
  checkUpdate: checkUpdate,
  applyUpdate: applyUpdate,
  compareSemVer: compareSemVer,
};
