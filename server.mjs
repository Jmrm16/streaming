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

  const done = (err, data) =>
    err
      ? json(res, 502, {
          returnValue: false,
          errorText: String(err.message || err),
          errorCode: err.portalCode || 1,
        })
      : json(res, 200, { returnValue: true, ...data });

  // Health check for Render
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
    return magis.resolve(contentId, seriesId, (err, stream) => {
      if (err) return done(err);
      const isTs = stream.mime === "video/mp2t" || /\.ts(?:\?|$)/i.test(stream.url);
      const token = proxy.add(stream.url, stream.headers, stream.duration);
      if (isTs) {
        stream.proxyPath = `${currentBaseUrl}/media/${token}/stream.m3u8`;
        stream.mime = "application/vnd.apple.mpegurl";
        stream.isHls = true;
      } else {
        stream.proxyPath = `${currentBaseUrl}/media/${token}/stream.mp4`;
      }
      done(null, stream);
    });
  }

  if (u.pathname === "/liveCategories") {
    return magis.getLiveCategories((err, categories) => done(err, { categories }));
  }

  if (u.pathname === "/liveChannels") {
    const colId = u.searchParams.get("columnId") || null;
    const pageNum = parseInt(u.searchParams.get("pageNum") || "1", 10);
    const pageSize = parseInt(u.searchParams.get("pageSize") || "250", 10);
    return magis.getLiveChannels(colId, pageNum, pageSize, (err, channels) =>
      done(err, { channels: channels || [] })
    );
  }

  if (u.pathname === "/resolveLive") {
    const streamUrl = u.searchParams.get("streamUrl") || "";
    if (streamUrl) {
      return done(null, { url: streamUrl, proxyPath: streamUrl, isHls: true });
    }
    const channelCode = u.searchParams.get("channelCode") || "";
    return magis.resolveLive(channelCode, (err, stream) => {
      if (err) return done(err);
      const token = proxy.add(stream.url, stream.headers, 0);
      stream.proxyPath = `${currentBaseUrl}/media/${token}/stream.m3u8`;
      stream.isHls = true;
      done(null, stream);
    });
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
