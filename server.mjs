// Unified Production & Render Server for XUPER
// Single-port architecture: serves both API and Video Media Proxy
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svcDir = path.resolve(__dirname, "webos", "services", "com.webosflux.xuptertv.fidelity.service");

const magis = require(path.join(svcDir, "magis.js"));
const proxy = require(path.join(svcDir, "proxy.js"));
const dnsx = require(path.join(svcDir, "dnsx.js"));
const netdiag = require(path.join(svcDir, "netdiag.js"));

const PORT = Number(process.env.PORT || 8910);

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json;charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  // Determine public base URL dynamically from request headers
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const currentBaseUrl = process.env.PUBLIC_URL || `${proto}://${host}`;
  proxy.setBaseUrl(currentBaseUrl);

  const u = new URL(req.url, currentBaseUrl);

  // Preflight CORS
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "Content-Type, Range",
    });
    res.end();
    return;
  }

  // Route Media Proxy on same port (/media/*, /hls/*, /sub/*)
  if (
    u.pathname.startsWith("/media/") ||
    u.pathname.startsWith("/hls/") ||
    u.pathname.startsWith("/sub/")
  ) {
    return proxy.handler(req, res);
  }

  const done = (err, data) => {
    if (err) {
      if (
        (err.portalCode === "aaa100028" ||
          err.portalCode === "aaa100027" ||
          /未登录|sesi[oó]n|login|token/i.test(err.message || "")) &&
        magis.resetSession
      ) {
        console.warn("[server] Session dead detected in response. Resetting session...");
        magis.resetSession();
        magis.ensureSession(() => {});
      }
      return json(res, 502, {
        returnValue: false,
        errorText: String(err.message || err),
        errorCode: err.portalCode || 1,
      });
    }
    return json(res, 200, { returnValue: true, ...data });
  };

  // Health check & root status for Render
  if (u.pathname === "/" || u.pathname === "") {
    return json(res, 200, {
      name: "Streaming Cloud API",
      status: "online",
      version: "1.1.0",
      sessionReady: magis.session.ready,
      timestamp: new Date().toISOString(),
    });
  }

  if (u.pathname === "/health" || u.pathname === "/ping") {
    return json(res, 200, {
      returnValue: true,
      status: "ok",
      port: PORT,
      mode: "unified-single-port",
    });
  }

  if (u.pathname === "/status") {
    return json(res, 200, {
      returnValue: true,
      session: {
        ready: magis.session.ready,
        userId: magis.session.userId,
        sn: magis.session.sn,
        usesSeed: !!magis.session.usesSeed,
      },
      seeds: magis.seedStatus ? magis.seedStatus() : null,
    });
  }

  // API Routes
  if (u.pathname === "/home") {
    const root = u.searchParams.get("root") || "movies";
    const pageNum = parseInt(u.searchParams.get("page") || u.searchParams.get("pageNum") || "1", 10);
    return magis.home(root, pageNum, done);
  }

  if (u.pathname === "/search") {
    return magis.search(u.searchParams.get("value") || "", done);
  }

  if (u.pathname === "/detail") {
    return magis.detail(u.searchParams.get("contentId") || u.searchParams.get("id") || "", done);
  }

  if (u.pathname === "/resolve") {
    const contentId = u.searchParams.get("contentId") || u.searchParams.get("id") || "";
    const seriesId = u.searchParams.get("seriesContentId") || u.searchParams.get("series") || "";
    const trackIndex = u.searchParams.get("trackIndex") || u.searchParams.get("track");
    const options = {};
    if (trackIndex !== null && trackIndex !== undefined && trackIndex !== "") {
      options.trackIndex = parseInt(trackIndex, 10);
    }

    const handleStream = (stream) => {
      const isTs = stream.mime === "video/mp2t" || /\.ts(?:\?|$)/i.test(stream.url);
      const token = proxy.add(stream.url, stream.headers, stream.duration);
      if (isTs) {
        stream.proxyPath = `${currentBaseUrl}/media/${token}/stream.m3u8`;
        stream.mime = "application/vnd.apple.mpegurl";
        stream.isHls = true;
      } else {
        stream.proxyPath = `${currentBaseUrl}/media/${token}/stream.mp4`;
      }

      // Proxy and format subtitles (support WebVTT and SRT)
      if (Array.isArray(stream.subtitles) && stream.subtitles.length > 0) {
        const langNames = {
          es: "Español",
          spa: "Español",
          esp: "Español",
          "es-lat": "Español (Latino)",
          "es-es": "Español (Castellano)",
          en: "Inglés",
          eng: "Inglés",
          pt: "Portugués",
          por: "Portugués",
          fr: "Francés",
          it: "Italiano",
          de: "Alemán",
        };
        stream.subtitles = stream.subtitles.map((sub) => {
          const subToken = proxy.addSubtitleToken(sub.url);
          const langCode = (sub.lang || "es").toLowerCase();
          const label = langNames[langCode] || (sub.lang ? sub.lang.toUpperCase() : "Subtítulo");
          return {
            lang: langCode,
            label,
            format: "vtt",
            url: `${currentBaseUrl}/sub/${subToken}.vtt`,
            srtUrl: `${currentBaseUrl}/sub/${subToken}.srt`,
          };
        });
      } else {
        stream.subtitles = [];
      }

      // Parse audio language tracks
      if (typeof stream.audio === "string" && stream.audio.trim()) {
        const parts = stream.audio.split(/[,\/|]/).map((s) => s.trim()).filter(Boolean);
        const langMap = {
          spa: "Español (Latino)",
          es: "Español",
          esp: "Español",
          lat: "Español (Latino)",
          latino: "Español (Latino)",
          "es-lat": "Español (Latino)",
          "es-es": "Español (Castellano)",
          eng: "Inglés",
          en: "Inglés",
          ingles: "Inglés",
          jpn: "Japonés",
          ja: "Japonés",
          jap: "Japonés",
          japones: "Japonés",
          por: "Portugués",
          pt: "Portugués",
          kor: "Coreano",
          ko: "Coreano",
          fra: "Francés",
          fr: "Francés",
          ita: "Italiano",
          it: "Italiano",
          deu: "Alemán",
          de: "Alemán",
          rus: "Ruso",
          ru: "Ruso",
          chi: "Chino",
          zh: "Chino",
        };
        stream.audioLanguages = parts.map((code, idx) => ({
          id: idx,
          code: code.toLowerCase(),
          name: langMap[code.toLowerCase()] || code.toUpperCase(),
        }));
      } else {
        stream.audioLanguages = [];
      }

      done(null, stream);
    };

    const tryResolve = (cId, sId, allowSwap) => {
      magis.resolve(cId, sId, options, (err, stream) => {
        if (err && allowSwap && sId && sId !== cId) {
          console.log(`[resolve] Attempt with id=${cId}&series=${sId} failed. Retrying with swapped params id=${sId}&series=${cId}...`);
          return tryResolve(sId, cId, false);
        }
        if (err) return done(err);
        return handleStream(stream);
      });
    };

    return tryResolve(contentId, seriesId, true);
  }

  if (u.pathname === "/resetSession") {
    if (magis.resetSession) magis.resetSession();
    return magis.ensureSession((err) => {
      done(err, { message: "Session reset and initialized", session: magis.session });
    });
  }

  if (u.pathname === "/liveCategories") {
    const fetchCats = (retry = true) => {
      magis.getLiveCategories((err, categories) => {
        if (err && retry && (/aaa100028|aaa100027|未登录/i.test(err.message || "") || err.portalCode === "aaa100028")) {
          console.warn("[liveCategories] Session dead. Resetting session and retrying...");
          if (magis.resetSession) magis.resetSession();
          return magis.ensureSession(() => fetchCats(false));
        }
        done(err, { categories: categories || [] });
      });
    };
    return fetchCats(true);
  }

  if (u.pathname === "/liveChannels") {
    const colId = u.searchParams.get("columnId") || null;
    const pageNum = parseInt(u.searchParams.get("pageNum") || "1", 10);
    const pageSize = parseInt(u.searchParams.get("pageSize") || "250", 10);
    const fetchChs = (retry = true) => {
      magis.getLiveChannels(colId, pageNum, pageSize, (err, channels) => {
        if (err && retry && (/aaa100028|aaa100027|未登录/i.test(err.message || "") || err.portalCode === "aaa100028")) {
          console.warn("[liveChannels] Session dead. Resetting session and retrying...");
          if (magis.resetSession) magis.resetSession();
          return magis.ensureSession(() => fetchChs(false));
        }
        done(err, { channels: channels || [] });
      });
    };
    return fetchChs(true);
  }

  if (u.pathname === "/resolveLive") {
    const streamUrl = u.searchParams.get("streamUrl") || "";
    if (streamUrl) {
      const token = proxy.add(streamUrl, {}, 0, null, null, true);
      return done(null, {
        url: `${currentBaseUrl}/media/${token}/stream.m3u8`,
        proxyPath: `${currentBaseUrl}/media/${token}/stream.m3u8`,
        isHls: true,
      });
    }
    const channelCode = u.searchParams.get("channelCode") || "";
    const fetchResolve = (retry = true) => {
      magis.resolveLive(channelCode, (err, stream) => {
        if (err && retry && (/aaa100028|aaa100027|未登录/i.test(err.message || "") || err.portalCode === "aaa100028")) {
          console.warn("[resolveLive] Session dead. Resetting session and retrying...");
          if (magis.resetSession) magis.resetSession();
          return magis.ensureSession(() => fetchResolve(false));
        }
        if (err) return done(err);
        const token = proxy.add(stream.url, stream.headers, 0, null, stream.backupUrls, true);
        stream.proxyPath = `${currentBaseUrl}/media/${token}/stream.m3u8`;
        stream.isHls = true;
        done(null, stream);
      });
    };
    return fetchResolve(true);
  }

  json(res, 404, { returnValue: false, errorText: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Xuper Server] running on http://0.0.0.0:${PORT} (Single-port mode ready for Render & Cloud)`);
  magis.ensureSession((err, sess) => {
    if (err) {
      console.warn(`[Xuper Server] Pre-warm session warning:`, err.message);
    } else {
      console.log(`[Xuper Server] Session active (ready: ${sess?.ready}, user: ${sess?.userId}, usingSeed: ${sess?.usesSeed})`);
    }
  });
});
