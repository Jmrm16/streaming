import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svcDir = path.resolve(__dirname, "..", "webos", "services", "com.webosflux.xuptertv.fidelity.service");
const magis = require(path.join(svcDir, "magis.js"));

const SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28";
const FIXED_MAC = "02:00:00:00:00:00";

const FINGERPRINT_FIXED = {
  board: "goldfish_arm64",
  brand: "google",
  cpuAbi: "arm64-v8a",
  device: "emu64a",
  diskInfo: "8GB",
  display: "sdk_gphone64_arm64",
  fingerprint: "google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys",
  hardware: "ranchu",
  host: "abfarm",
  manufacturer: "Google",
  ramSize: "4GB",
  romSize: "8GB",
  tags: "release-keys",
  verId: "",
};

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function mintOne() {
  return new Promise((resolve, reject) => {
    const n = { ...FINGERPRINT_FIXED };
    n.androidId = randomHex(8);
    n.cpuId = randomHex(8);
    n.serialNumber = randomHex(8);
    n.etheMac = randomHex(6).replace(/(..)(?=.)/g, "$1:");
    n.gatewayMac = randomHex(6).replace(/(..)(?=.)/g, "$1:");
    n.wifiMac = randomHex(6).replace(/(..)(?=.)/g, "$1:");

    magis.call("v3/snToken", n, { baseFields: false, urgent: true }, (err, r) => {
      if (err) return reject(err);
      const snToken = ((r && r.snToken) || "").trim();
      let sn = ((r && r.sn) || "").trim();
      if (!sn) {
        sn = crypto.createHash("md5").update(snToken + SNTOKEN_SALT).digest("hex");
      }

      magis.session.sn = String(sn).toLowerCase();
      magis.session.snToken = snToken;

      magis.call(
        "v8/active",
        {
          snToken: snToken,
          authVersion: "",
          authCode: "",
          preCode: "",
          macAddr: FIXED_MAC,
          reserve1: "",
          openNum: 4,
          channel: "default",
          matadata: "",
          signdata: "",
        },
        { baseFields: false, urgent: true },
        (err2, r2) => {
          if (err2) return reject(err2);
          if (!r2 || !r2.userId || !r2.userToken) {
            return reject(new Error("Active response missing userId/userToken"));
          }
          const now = Math.floor(Date.now() / 1000);
          resolve({
            sn: String(sn).toLowerCase(),
            userId: String(r2.userId).trim(),
            userToken: String(r2.userToken).trim(),
            mintedAt: now,
            exp: now + 8 * 3600,
          });
        }
      );
    });
  });
}

async function main() {
  const TARGET_COUNT = 15;
  console.log(`[Mint] Generando ${TARGET_COUNT} semillas frescas locales + sincronizando nube...`);
  const seeds = [];

  for (let i = 0; i < TARGET_COUNT; i++) {
    try {
      const seed = await mintOne();
      seeds.push(seed);
      console.log(`[Mint] (${i + 1}/${TARGET_COUNT}) Semilla creada: user=${seed.userId} token=${seed.userToken.slice(0, 8)}...`);
      await new Promise((res) => setTimeout(res, 350));
    } catch (e) {
      console.warn(`[Mint] Advertencia en ciclo ${i + 1}:`, e.message || e);
      await new Promise((res) => setTimeout(res, 600));
    }
  }

  try {
    const cloudRes = await fetch("https://raw.githubusercontent.com/cristianco7/XUPER-HYDRA-PORT-WEBOS/seeds/seeds.json");
    if (cloudRes.ok) {
      const cloudJson = await cloudRes.json();
      const cloudList = Array.isArray(cloudJson?.seeds) ? cloudJson.seeds : [];
      const nowSec = Math.floor(Date.now() / 1000);
      for (const s of cloudList) {
        if (s && s.sn && s.userId && s.userToken && (!s.exp || s.exp - nowSec > 900)) {
          seeds.push({
            sn: String(s.sn).toLowerCase(),
            userId: String(s.userId),
            userToken: String(s.userToken),
            mintedAt: s.mintedAt || nowSec,
            exp: s.exp || nowSec + 8 * 3600,
          });
        }
      }
      console.log(`[Mint] Semillas activas fusionadas desde la nube: ${cloudList.length}`);
    }
  } catch (e) {
    console.warn(`[Mint] No se pudo consultar pool secundario:`, e.message);
  }

  if (seeds.length === 0) {
    console.error("[Mint] No se pudieron generar semillas.");
    process.exit(1);
  }

  const payload = {
    at: Date.now(),
    seeds: seeds,
  };

  const targetPath = path.join(svcDir, "seeds-fallback.json");
  const jsonStr = JSON.stringify(payload, null, 1);
  fs.writeFileSync(targetPath, jsonStr, "utf8");
  console.log(`[Mint] ¡ÉXITO! ${seeds.length} semillas guardadas en: ${targetPath}`);

  try {
    const res = await fetch("https://streaming-qste.onrender.com/feedSeeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonStr,
    });
    console.log(`[Mint] Enviadas en caliente a Render (/feedSeeds): HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[Mint] No se pudo enviar en caliente a Render:`, e.message);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[Mint] Error fatal:", err);
  process.exit(1);
});
