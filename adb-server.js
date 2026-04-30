/**
 * ADB Web Shell - Backend Server
 * Works in two modes:
 *   1. PC mode   — connects to device via USB ADB
 *   2. Termux mode — connects to localhost:5555 (wireless ADB on same device)
 *
 * Run: node adb-server.js
 */

const http     = require("http");
const { execFile, exec } = require("child_process");
const url      = require("url");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");

const PORT     = 3000;
const ADB_HOST = "localhost:5555"; // wireless ADB port on the device itself

// ── Detect if running inside Termux ──
const IS_TERMUX = fs.existsSync("/data/data/com.termux") ||
                  (process.env.PREFIX || "").includes("com.termux");

console.log(`Mode: ${IS_TERMUX ? "🤖 Termux → ADB localhost:5555" : "💻 PC → ADB USB"}`);

// ── Car property cache/history ──
const POLL_INTERVAL_MS = 10_000;
const CACHE_FILE       = path.join(__dirname, "car_props_cache.json");
const HISTORY_FILE     = path.join(__dirname, "car_props_history.json");
const HISTORY_MAX_ROWS = 20_000;

// ── ABRP OAuth / token storage ──
const ABRP_CLIENT_ID  = "SEALION 7 PILOT";
const ABRP_REDIRECT_URI = "https://aliboumrah.github.io/Sealion7Store/";
const ABRP_TOKEN_FILE = path.join(__dirname, "abrp_token.json");
let ABRP_TOKEN = "";
let ABRP_USER  = null;
let ABRP_OAUTH_STATE = null;
let ABRP_OAUTH_REDIRECT_URI = null;

function loadAbrpToken() {
  try {
    if (fs.existsSync(ABRP_TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(ABRP_TOKEN_FILE, "utf8"));
      ABRP_TOKEN = data.access_token || data.token || "";
      ABRP_USER  = data.user || null;
    }
  } catch(e) { console.warn("Failed to load ABRP token:", e.message); }
}

function saveAbrpToken(token, user = ABRP_USER) {
  ABRP_TOKEN = token || "";
  ABRP_USER = user || null;
  try {
    if (ABRP_TOKEN) fs.writeFileSync(ABRP_TOKEN_FILE, JSON.stringify({ access_token: ABRP_TOKEN, user: ABRP_USER, savedAt: Date.now() }, null, 2));
    else if (fs.existsSync(ABRP_TOKEN_FILE)) fs.unlinkSync(ABRP_TOKEN_FILE);
  } catch(e) { console.warn("Failed to save ABRP token:", e.message); }
}

function httpsJsonGet(fullUrl) {
  return new Promise((resolve, reject) => {
    require("https").get(fullUrl, { headers: { "User-Agent": "SEALION 7 PILOT" } }, (r) => {
      let body = "";
      r.on("data", c => body += c);
      r.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(body || e.message)); }
      });
    }).on("error", reject);
  });
}

async function fetchAbrpUserInfo(token) {
  if (!token) return null;
  try {
    const meUrl = "https://api.iternio.com/1/oauth/me?access_token=" + encodeURIComponent(token);
    const data = await httpsJsonGet(meUrl);
    if (data && !data.error) {
      ABRP_USER = data;
      saveAbrpToken(token, data);
      return data;
    }
  } catch(e) { console.warn("ABRP user info failed:", e.message); }
  return null;
}

function getPublicBaseUrl(req) {
  return `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
}

function buildAbrpAuthUrl(req) {
  const redirectUri = ABRP_REDIRECT_URI;
  const state = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const scope = "set_telemetry";
  ABRP_OAUTH_STATE = state;
  ABRP_OAUTH_REDIRECT_URI = redirectUri;
  console.log("ABRP OAuth start", { client_id: ABRP_CLIENT_ID, redirect_uri: redirectUri, state });
  return "https://abetterrouteplanner.com/oauth/auth" +
    "?client_id=" + encodeURIComponent(ABRP_CLIENT_ID) +
    "&scope=" + encodeURIComponent(scope) +
    "&response_type=code" +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&state=" + encodeURIComponent(state);
}

loadAbrpToken();

let carPropsCache     = readJsonFile(CACHE_FILE, {});
let carPropsHistory   = normalizeHistory(readJsonFile(HISTORY_FILE, []));
let carPollRunning    = false;
let carLastPollTs     = 0;
let carLastPollError  = null;
let carLastChangedIds = [];

function readJsonFile(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.warn(`Could not read ${path.basename(file)}:`, e.message);
  }
  return fallback;
}

function writeJsonFile(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn(`Could not write ${path.basename(file)}:`, e.message);
  }
}

function sendJsonFileDownload(res, file, fallbackData, filename) {
  let payload;
  try {
    if (fs.existsSync(file)) payload = fs.readFileSync(file);
    else payload = Buffer.from(JSON.stringify(fallbackData, null, 2));
  } catch (e) {
    payload = Buffer.from(JSON.stringify({ success: false, error: e.message }, null, 2));
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": payload.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Disposition, Content-Length"
  });
  res.end(payload);
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseCarServiceProperties(text) {
  const evStart = text.indexOf("*All Events");
  const evEnd   = text.indexOf("*Property handlers*", evStart);
  const evBody  = evStart > -1 ? text.slice(evStart, evEnd > -1 ? evEnd : undefined) : "";

  const prStart = text.indexOf("*All properties*");
  const prEnd   = text.indexOf("*All Events", prStart);
  const prBody  = prStart > -1 ? text.slice(prStart, prEnd > -1 ? prEnd : undefined) : "";

  const idToName = {};
  const propNameRe = /Property:(0x[0-9a-fA-F]+),\s*Property name:([^,]+),/g;
  for (const m of prBody.matchAll(propNameRe)) {
    idToName[m[1].toLowerCase()] = m[2].trim();
  }

  const evRe = /lastEvent:Property:(0x[0-9a-fA-F]+),status:\s*(\d+),timestamp:(\d+),zone:[^,]+,floatValues:\s*\[([^\]]*)\],int32Values:\s*\[([^\]]*)\],int64Values:\s*\[([^\]]*)\],bytes:\s*\[[^\]]*\],string:\s*([^,\r\n]*)/g;
  const properties = {};
  const eventChunks = evBody.split(/(?=event count:)/);

  for (const chunk of eventChunks) {
    const m = evRe.exec(chunk);
    evRe.lastIndex = 0;
    if (!m) continue;

    const id     = m[1].toLowerCase();
    const status = parseInt(m[2], 10);
    const floats = m[4].trim().split(",").map(v => v.trim()).filter(Boolean).map(Number);
    const ints   = m[5].trim().split(",").map(v => v.trim()).filter(Boolean).map(Number);
    const str    = m[7] ? m[7].trim() : "";
    const name   = idToName[id] || id;

    let value;
    if (floats.length > 0 && floats.some(v => v !== 0)) {
      value = floats.length === 1 ? floats[0] : floats;
    } else if (ints.length > 0) {
      value = ints.length === 1 ? ints[0] : ints;
    } else if (floats.length > 0) {
      value = floats.length === 1 ? floats[0] : floats;
    } else if (str) {
      value = str;
    } else {
      value = null;
    }

    properties[id] = { id, name, value, status };
  }

  return properties;
}

function propValueOnly(prop) {
  if (!prop || typeof prop !== "object") return prop;
  return prop.value;
}
function propsToValueMap(properties) {
  const out = {};
  for (const [id, prop] of Object.entries(properties || {})) out[id.toLowerCase()] = propValueOnly(prop);
  return out;
}
function makeFullHistoryEntry(properties, ts) {
  return { ts, type: "full", values: propsToValueMap(properties) };
}
function makeDeltaHistoryEntry(properties, changedIds, ts) {
  const changes = {};
  for (const id of changedIds) changes[id.toLowerCase()] = propValueOnly(properties[id]);
  return { ts, type: "delta", changes };
}
function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.type === "full" && entry.values) return entry;
  if (entry.type === "delta" && entry.changes) return entry;
  const ts = Number(entry.ts || entry.timestamp || entry.time || Date.now());
  const values = {};
  if (entry.properties && typeof entry.properties === "object") {
    for (const [id, prop] of Object.entries(entry.properties)) values[id.toLowerCase()] = propValueOnly(prop);
  }
  for (const [key, value] of Object.entries(entry)) {
    if (key === "ts" || key === "timestamp" || key === "time" || key === "properties") continue;
    if (key.startsWith("0x")) values[key.toLowerCase()] = value;
  }
  return { ts, type: "full", values };
}
function normalizeHistory(history) {
  return (Array.isArray(history) ? history : []).map(normalizeHistoryEntry).filter(Boolean);
}
function reconstructHistorySnapshots(history) {
  const state = {};
  const snapshots = [];
  for (const raw of normalizeHistory(history)) {
    const entry = normalizeHistoryEntry(raw);
    if (!entry) continue;
    if (entry.type === "full") Object.assign(state, entry.values || {});
    else if (entry.type === "delta") Object.assign(state, entry.changes || {});
    snapshots.push({ ts: entry.ts, ...state });
  }
  return snapshots;
}
function diffChangedIds(oldProps, newProps) {
  const changed = [];
  for (const [id, prop] of Object.entries(newProps)) {
    if (!oldProps[id] || !sameValue(oldProps[id].value, prop.value)) changed.push(id);
  }
  return changed;
}

async function pollCarProperties(serial = null, reason = "timer") {
  if (carPollRunning) return { skipped: true, reason: "poll already running" };
  carPollRunning = true;
  try {
    await ensureConnected();
    const result = await runAdb(["shell", "dumpsys", "car_service"], serial);
    carLastPollTs = Date.now();

    if (!result.success) {
      carLastPollError = result.output || "dumpsys car_service failed";
      console.warn("car_service poll failed:", carLastPollError);
      return { success: false, error: carLastPollError };
    }

    const newProps = parseCarServiceProperties(result.output || "");
    const changedIds = diffChangedIds(carPropsCache || {}, newProps);
    carLastChangedIds = changedIds;
    carLastPollError = null;

    if (Object.keys(newProps).length > 0) {
      carPropsCache = newProps;
      writeJsonFile(CACHE_FILE, carPropsCache);

      if (carPropsHistory.length === 0) {
        carPropsHistory.push(makeFullHistoryEntry(newProps, carLastPollTs));
        writeJsonFile(HISTORY_FILE, carPropsHistory);
      } else if (changedIds.length > 0) {
        carPropsHistory.push(makeDeltaHistoryEntry(newProps, changedIds, carLastPollTs));
        if (carPropsHistory.length > HISTORY_MAX_ROWS) {
          const reconstructed = reconstructHistorySnapshots(carPropsHistory);
          const trimmed = carPropsHistory.slice(-HISTORY_MAX_ROWS);
          const firstTs = trimmed[0] && trimmed[0].ts;
          const firstFull = reconstructed.find(row => row.ts === firstTs);
          carPropsHistory = trimmed;
          if (firstFull) {
            const { ts, ...values } = firstFull;
            carPropsHistory[0] = { ts, type: "full", values };
          }
        }
        writeJsonFile(HISTORY_FILE, carPropsHistory);
      }
    }

    console.log(`car_service poll (${reason}): ${Object.keys(newProps).length} props, ${changedIds.length} changed`);
    return { success: true, count: Object.keys(newProps).length, changedIds };
  } catch (e) {
    carLastPollTs = Date.now();
    carLastPollError = e.message;
    console.warn("car_service poll error:", e.message);
    return { success: false, error: e.message };
  } finally {
    carPollRunning = false;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Serial, X-Filename",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
};

// ── Connect ADB to localhost:5555 (Termux mode only) ──
function adbConnect() {
  return new Promise((resolve) => {
    execFile("adb", ["connect", ADB_HOST], { timeout: 8000 }, (err, stdout, stderr) => {
      const out = (stdout || stderr || "").trim();
      console.log("adb connect:", out);
      resolve(out);
    });
  });
}

// ── Run ADB command ──
// In Termux mode always targets localhost:5555
function runAdb(args, serial) {
  return new Promise((resolve) => {
    const target = IS_TERMUX ? ADB_HOST : serial;
    const finalArgs = target ? ["-s", target, ...args] : args;
    execFile("adb", finalArgs, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve({ success: false, output: stderr || err.message });
      else     resolve({ success: true,  output: stdout });
    });
  });
}

// ── Run adb shell command ──
function runShell(command, serial) {
  return runAdb(["shell", command], serial);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// ── Save uploaded APK ──
function saveUpload(req, filename) {
  return new Promise((resolve, reject) => {
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    // Save to Termux home — always writable, and ADB can push from here
    const saveDir = IS_TERMUX
      ? (process.env.HOME || "/data/data/com.termux/files/home")
      : os.tmpdir();
    const dest = path.join(saveDir, `adbweb_${Date.now()}_${safeName}`);
    const out  = fs.createWriteStream(dest);
    req.pipe(out);
    out.on("finish", () => resolve(dest));
    out.on("error",  reject);
  });
}

// ── Ensure ADB is connected before handling requests ──
async function ensureConnected() {
  if (!IS_TERMUX) return true;
  // Check if already connected
  const check = await new Promise((resolve) => {
    execFile("adb", ["devices"], { timeout: 5000 }, (err, stdout) => {
      resolve(stdout || "");
    });
  });
  if (check.includes(ADB_HOST)) return true;
  // Connect
  const result = await adbConnect();
  return result.includes("connected");
}

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  // ── GET /devices ──
  if (req.method === "GET" && pathname === "/devices") {
    await ensureConnected();
    const result = await runAdb(["devices", "-l"]);
    const lines  = (result.output || "").split("\n").slice(1)
      .filter((l) => l.trim() && !l.startsWith("*") && !l.startsWith("List"));
    const devices = lines.map((line) => {
      const parts        = line.trim().split(/\s+/);
      const modelMatch   = line.match(/model:(\S+)/);
      const productMatch = line.match(/product:(\S+)/);
      return {
        serial:  parts[0],
        state:   parts[1],
        model:   modelMatch   ? modelMatch[1]   : (IS_TERMUX ? "BYD Sealion 7" : "Unknown"),
        product: productMatch ? productMatch[1] : "",
      };
    }).filter((d) => d.serial && d.state);
    res.writeHead(200);
    res.end(JSON.stringify({ devices, mode: IS_TERMUX ? "termux" : "adb" }));
    return;
  }

  // ── POST /shell ──
  if (req.method === "POST" && pathname === "/shell") {
    const body = await parseBody(req);
    const { command, serial } = body;
    if (!command || typeof command !== "string") {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, output: "Missing command" }));
      return;
    }
    const blocked = ["rm -rf /", "mkfs", "dd if="];
    if (blocked.some((b) => command.includes(b))) {
      res.writeHead(403);
      res.end(JSON.stringify({ success: false, output: "Command blocked for safety." }));
      return;
    }
    await ensureConnected();
    const result = await runShell(command, serial);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // ── POST /adb ──
  if (req.method === "POST" && pathname === "/adb") {
    const body = await parseBody(req);
    const { args, serial } = body;
    if (!args || !Array.isArray(args)) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, output: "Missing args array" }));
      return;
    }
    await ensureConnected();
    const result = await runAdb(args, serial);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // ── POST /install ──
  if (req.method === "POST" && pathname === "/install") {
    const serial   = req.headers["x-device-serial"] || null;
    const filename = req.headers["x-filename"] || "upload.apk";

    if (!filename.toLowerCase().endsWith(".apk")) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, output: "Only .apk files are supported." }));
      return;
    }

    // Save APK locally first
    let localPath;
    try {
      localPath = await saveUpload(req, filename);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, output: `Failed to save file: ${e.message}` }));
      return;
    }

    await ensureConnected();

    let result;
    if (IS_TERMUX) {
      // Push APK to /data/local/tmp on device via ADB (bypasses SELinux on BYD)
      // then install from there
      const remotePath = `/data/local/tmp/adbweb_install.apk`;
      console.log(`Pushing ${localPath} → ${remotePath}`);

      const pushResult = await runAdb(["push", localPath, remotePath]);
      console.log("Push result:", pushResult.output);

      if (!pushResult.success && !pushResult.output.includes("pushed")) {
        try { fs.unlinkSync(localPath); } catch {}
        res.writeHead(200);
        res.end(JSON.stringify({ success: false, output: `Push failed: ${pushResult.output}` }));
        return;
      }

      // Install from /data/local/tmp via ADB — this is the proper path ADB uses
      result = await runAdb(["install", "-r", remotePath]);
      console.log("Install result:", result.output);

      // Cleanup remote file
      await runShell(`rm -f ${remotePath}`);
    } else {
      // PC mode: install directly
      result = await runAdb(["install", "-r", localPath], serial);
    }

    // Clean up local APK file
    try { fs.unlinkSync(localPath); } catch(e) { console.warn("Cleanup failed:", e.message); }

    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // ── GET /mode ──
  if (req.method === "GET" && pathname === "/mode") {
    res.writeHead(200);
    res.end(JSON.stringify({ mode: IS_TERMUX ? "termux" : "adb", adbHost: IS_TERMUX ? ADB_HOST : null }));
    return;
  }

  // ── GET /connect — manually trigger ADB connect ──
  if (req.method === "GET" && pathname === "/connect") {
    const out = await adbConnect();
    res.writeHead(200);
    res.end(JSON.stringify({ success: out.includes("connected"), output: out }));
    return;
  }

  // ── GET /store — fetch APK list from Google Drive public folder ──
  if (req.method === "GET" && pathname === "/store") {
    const GDRIVE_FOLDER_ID = "11RoAclYjnDBdOxHfeUL5mAOUD5lEm3pq";
    const GDRIVE_API_KEY   = "AIzaSyCv_ytxk3JHN_-ROab5CKWY_RGqGveCFGA";
    try {
      const https = require("https");
      const q = encodeURIComponent(`'${GDRIVE_FOLDER_ID}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`);
      const path = `/drive/v3/files?q=${q}&key=${GDRIVE_API_KEY}&fields=files(id,name,size)&orderBy=name`;
      const data = await new Promise((resolve, reject) => {
        https.get({ hostname: "www.googleapis.com", path, headers: { "User-Agent": "Sealion7-ADB-Shell" } }, (r) => {
          let body = "";
          r.on("data", c => body += c);
          r.on("end", () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        }).on("error", reject);
      });
      const apks = (data.files || [])
        .filter(f => f.name.toLowerCase().endsWith(".apk"))
        .map(f => ({ name: f.name, size: f.size || 0, driveId: f.id }));
      res.writeHead(200);
      res.end(JSON.stringify({ apks }));
    } catch(e) {
      res.writeHead(200);
      res.end(JSON.stringify({ apks: [], error: e.message }));
    }
    return;
  }

  // ── POST /pull — pull a file from the device and stream it to browser ──
  if (req.method === "POST" && pathname === "/pull") {
    const body = await parseBody(req);
    const { path: remotePath, serial } = body;
    if (!remotePath) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, output: "Missing path" }));
      return;
    }
    const tmpPath = require("path").join(
      IS_TERMUX ? (process.env.HOME || "/data/data/com.termux/files/home") : require("os").tmpdir(),
      `pull_${Date.now()}.apk`
    );
    // runAdb already handles Termux/serial targeting internally
    const pullResult = await runAdb(["pull", remotePath, tmpPath], serial);
    if (!pullResult.success && !pullResult.output.includes("pulled")) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, output: pullResult.output }));
      return;
    }
    try {
      const fileData = require("fs").readFileSync(tmpPath);
      const filename = remotePath.split("/").pop();
      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileData.length,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(fileData);
    } catch(e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, output: e.message }));
    } finally {
      try { require("fs").unlinkSync(tmpPath); } catch {}
    }
    return;
  }

  // ── GET /carservice — run dumpsys car_service and return parsed JSON ──
  if (req.method === "GET" && pathname === "/carservice") {
    const serial = (parsed.query && parsed.query.serial) || null;
    // Load persistent cache (built by background poller every 60s)
    const fs   = require("fs");
    const path = require("path");
    const cacheFile = path.join(__dirname, "car_props_cache.json");
    let cachedProps = {};
    try {
      if (fs.existsSync(cacheFile)) {
        cachedProps = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      }
    } catch(e) {}

    // Also run a fresh dump to get latest values
    const result = await runAdb(["shell", "dumpsys", "car_service"], serial);
    if (!result.success) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, raw: result.output, sections: {} }));
      return;
    }

    const text = result.output;

    // Split into sections by *SectionName*
    const sectionRegex = new RegExp("[*]([^*\r\n]+)[*]", "g");
    const sectionMatches = [...text.matchAll(sectionRegex)];
    const sections = {};

    sectionMatches.forEach((match, idx) => {
      const name = match[1].trim();
      const start = match.index + match[0].length;
      const end = idx + 1 < sectionMatches.length ? sectionMatches[idx + 1].index : text.length;
      const body = text.slice(start, end).trim();

      const props = {};
      const lines = body.split("\n");
      lines.forEach(line => {
        line = line.replace(/\r/g, "").trim();
        if (!line) return;
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0 && colonIdx < line.length - 1) {
          const k = line.slice(0, colonIdx).trim();
          const v = line.slice(colonIdx + 1).trim();
          if (k && !k.includes(" ")) {
            props[k] = v;
          } else {
            if (!props["_lines"]) props["_lines"] = [];
            props["_lines"].push(line);
          }
        } else {
          if (!props["_lines"]) props["_lines"] = [];
          props["_lines"].push(line);
        }
      });

      // Special: All properties section
      if (name === "All properties") {
        const propRe = new RegExp("Property:(0x[0-9a-fA-F]+),\\s*Property name:([^,]+),\\s*access:(0x\\w+),\\s*changeMode:(0x\\w+)", "g");
        const propMatches = [...body.matchAll(propRe)];
        if (propMatches.length > 0) {
          props["_properties"] = propMatches.map(m => ({
            id: m[1], name: m[2].trim(), access: m[3], changeMode: m[4]
          }));
        }
      }

      // Special: All Events section
      if (name.startsWith("All Events")) {
        const evRe = new RegExp("lastEvent:Property:(0x[0-9a-fA-F]+),status:\\s*(\\d+).*?int32Values:\\s*\\[([^\\]]*)\\]", "g");
        const evMatches = [...body.matchAll(evRe)];
        if (evMatches.length > 0) {
          props["_events"] = evMatches.map(m => ({
            id: m[1], status: m[2], int32: m[3].trim()
          }));
        }
      }

      sections[name] = props;
    });

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, sections, sectionNames: Object.keys(sections) }));
    return;
  }

  // ── GET /properties — return cached car property values ──
  // Background poller updates this cache every 10 seconds.
  // Add ?refresh=1 to force a one-off fresh dumpsys before returning.
  if (req.method === "GET" && pathname === "/properties") {
    const serial = (parsed.query && parsed.query.serial) || null;
    const refresh = parsed.query && (parsed.query.refresh === "1" || parsed.query.refresh === "true");

    if (refresh || Object.keys(carPropsCache || {}).length === 0) {
      await pollCarProperties(serial, refresh ? "manual refresh" : "empty cache");
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      success: !carLastPollError,
      properties: carPropsCache || {},
      count: Object.keys(carPropsCache || {}).length,
      cached: true,
      lastPollTs: carLastPollTs,
      lastPollError: carLastPollError,
      lastChangedIds: carLastChangedIds,
      pollIntervalMs: POLL_INTERVAL_MS
    }));
    return;
  }

  // ── ABRP status / OAuth callback ──
  if (req.method === "GET" && pathname === "/abrp/status") {
    if (!ABRP_TOKEN) loadAbrpToken();
    if (ABRP_TOKEN && !ABRP_USER) await fetchAbrpUserInfo(ABRP_TOKEN);
    const redirectUri = ABRP_REDIRECT_URI;
    res.writeHead(200);
    res.end(JSON.stringify({
      connected: !!ABRP_TOKEN,
      client_id: ABRP_CLIENT_ID,
      redirect_uri: redirectUri,
      auth_start_url: "/oauth/start",
      user: ABRP_USER || null,
      vehicle_name: ABRP_USER?.vehicle_name || "",
      vehicle_typecode: ABRP_USER?.vehicle_typecode || ""
    }));
    return;
  }

  if (req.method === "GET" && pathname === "/oauth/start") {
    res.writeHead(302, { Location: buildAbrpAuthUrl(req) });
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/oauth/callback") {
    const code = parsed.query.code;
    const oauthError = parsed.query.error || parsed.query.error_description;
    if (!code) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      const configured = ABRP_REDIRECT_URI;
      const msg = oauthError
        ? "ABRP returned an OAuth error: " + String(oauthError)
        : "No code was present in the callback URL. Start login from Settings or use the button below.";
      const esc = (x) => String(x).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEALION 7 PILOT</title><style>body{background:#080c10;color:#e8f0f8;font-family:system-ui;padding:32px;line-height:1.5}a,.btn{color:#001;background:#00e5ff;padding:12px 18px;border-radius:12px;text-decoration:none;display:inline-block;margin-top:12px}code{color:#00e5ff}</style></head><body><h2>SEALION 7 PILOT</h2><p>${esc(msg)}</p><p>Configured redirect URI:</p><code>${esc(configured)}</code><br><a class="btn" href="/oauth/start">Login with ABRP again</a></body></html>`);
      return;
    }
    try {
      const returnedState = parsed.query.state || "";
      const redirectUri = ABRP_REDIRECT_URI;
      if (ABRP_OAUTH_STATE && returnedState && returnedState !== ABRP_OAUTH_STATE) {
        throw new Error("OAuth state mismatch. Please start login again from Settings.");
      }
      const tokenUrl = "https://api.iternio.com/1/oauth/token" +
        "?client_id=" + encodeURIComponent(ABRP_CLIENT_ID) +
        "&code=" + encodeURIComponent(code) +
        "&redirect_uri=" + encodeURIComponent(redirectUri);
      console.log("ABRP OAuth callback", { has_code: !!code, state: returnedState, redirect_uri: redirectUri });
      const data = await httpsJsonGet(tokenUrl);
      if (!data.access_token) throw new Error(JSON.stringify(data));
      saveAbrpToken(data.access_token);
      await fetchAbrpUserInfo(data.access_token);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ABRP Connected</title><style>body{background:#080c10;color:#e8f0f8;font-family:system-ui;padding:32px}a{color:#00e5ff}</style></head><body><h2>✅ Connected to ABRP</h2><p>SEALION 7 PILOT is connected${ABRP_USER?.vehicle_name ? " to <b>" + ABRP_USER.vehicle_name + "</b>" : ""}.</p><p>Returning to the app...</p><script>setTimeout(()=>{location.href='/'},1500)</script></body></html>`);
    } catch(e) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h2>ABRP OAuth failed</h2><pre>${String(e.message).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre><p><a href="/oauth/start">Try again</a></p>`);
    }
    return;
  }

  if (req.method === "GET" && pathname === "/abrp-oauth-token") {
    const code = parsed.query.code;
    const clientId = parsed.query.client_id || ABRP_CLIENT_ID;
    if (!code) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Missing code" }));
      return;
    }
    try {
      const tokenUrl = "https://api.iternio.com/1/oauth/token" +
        "?client_id=" + encodeURIComponent(clientId) +
        "&code=" + encodeURIComponent(code) +
        "&redirect_uri=" + encodeURIComponent(ABRP_REDIRECT_URI);
      console.log("ABRP OAuth exchange via GitHub callback", { client_id: clientId, redirect_uri: ABRP_REDIRECT_URI, has_code: !!code });
      const data = await httpsJsonGet(tokenUrl);
      if (data.access_token) {
        saveAbrpToken(data.access_token);
        await fetchAbrpUserInfo(data.access_token);
        data.connected = true;
        data.user = ABRP_USER;
      }
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(200);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "GET" && pathname === "/abrp-oauth-me") {
    const token = parsed.query.token || ABRP_TOKEN;
    if (!token) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Missing token" }));
      return;
    }
    const data = await fetchAbrpUserInfo(token);
    res.writeHead(200);
    res.end(JSON.stringify(data || { error: "Could not retrieve ABRP user information" }));
    return;
  }

  if (req.method === "POST" && pathname === "/abrp-token") {
    const body = await parseBody(req);
    const token = (body.token || "").trim();
    if (!token) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: "Missing token" }));
      return;
    }
    saveAbrpToken(token);
    await fetchAbrpUserInfo(token);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, connected: true, user: ABRP_USER }));
    return;
  }

  if (req.method === "POST" && pathname === "/abrp/logout") {
    saveAbrpToken("");
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, connected: false }));
    return;
  }

  // ── POST /abrp — push live data to ABRP ──
  if (req.method === "POST" && pathname === "/abrp") {
    const body = await parseBody(req);
    const { serial } = body;
    // Use token sent by UI when available, otherwise use the token persisted on the car server.
    // Reload from disk as a fallback in case the variable was not initialized after restart.
    if (!ABRP_TOKEN) loadAbrpToken();
    const token = body.token || ABRP_TOKEN;
    if (!token) {
      res.writeHead(400);
      res.end(JSON.stringify({
        success: false,
        output: "Missing ABRP token. Open Settings → Login with ABRP Account first.",
        connected: false
      }));
      return;
    }

    // Fetch live properties from car_service
    const result = await runAdb(["shell", "dumpsys", "car_service"], serial);
    if (!result.success) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, output: "Failed to read car_service" }));
      return;
    }
    const text = result.output;

    // Extract All Events section
    const evStart = text.indexOf("*All Events");
    const evEnd   = text.indexOf("*Property handlers*", evStart);
    const evBody  = evStart > -1 ? text.slice(evStart, evEnd > -1 ? evEnd : undefined) : "";

    // Helper: extract a property value by ID from All Events
    function getPropValue(hexId, preferFloat = false) {
      const re = new RegExp(
        "lastEvent:Property:" + hexId + ",status:\\s*\\d+,timestamp:\\d+," +
        "zone:[^,]+,floatValues:\\s*\\[([^\\]]*)\\],int32Values:\\s*\\[([^\\]]*)\\]",
        "ig"
      );
      // Use last match (most recent event)
      let m = null, tmp;
      while ((tmp = re.exec(evBody)) !== null) m = tmp;
      if (!m) return null;
      const floats = m[1].trim().split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      const ints   = m[2].trim().split(",").map(v => parseInt(v.trim())).filter(v => !isNaN(v));
      if (preferFloat && floats.length > 0) return floats[0];
      if (ints.length > 0 && !preferFloat) return ints[0];
      if (floats.length > 0) return floats[0];
      return null;
    }

    // ── Property fetch — verified IDs from actual dumpsys ──
    const soc            = getPropValue("0x21604402", true);  // ELEC_PERCENTAGE_VALUER float %
    const speed          = getPropValue("0x21604601", true);  // VEHICLE_SPEED float km/h
    const extTemp        = getPropValue("0x21404604");        // ENVIRONMENT_TEMP int °C
    const chargePower    = getPropValue("0x21603408", true);  // CHARGING_POWERR float W
    const dischargeState = getPropValue("0x2140460e");        // DISCHARGE_STATE (3=discharging)
    const gear           = getPropValue("0x21403a0a");        // GEAR_R (1=P,2=R,3=N,4=D)
    const soh            = getPropValue("0x21402037");        // BATTERY_HEALTH_STATUS_R int %
    const soe            = getPropValue("0x21604421", true);  // EV_REMAINING_BATTERY_POWER_R kWh
    const hvVoltRaw      = getPropValue("0x21407407");        // MOTOR_MCU_GENERATRIX_VOLT_REAR
    const odometer       = getPropValue("0x21604409", true);  // TOTAL_MILEAGE_VALUER km
    const evRange        = getPropValue("0x21404401");        // ELEC_DRIVING_RANGE_BY_STANDARD km
    const hvacSetpoint   = getPropValue("0x21401023");        // AC_CONTROLLER_DRIVER_TEMP_SET °C
    const tyreFl         = getPropValue("0x2160801d", true);  // LEFTFRONTTIREPRESSURE psi
    const tyreFr         = getPropValue("0x2160801e", true);  // RIGHTFRONTTIREPRESSURE psi
    const tyreRl         = getPropValue("0x2160801f", true);  // LEFTREARTIREPRESSURE psi
    const tyreRr         = getPropValue("0x21608020", true);  // RIGHTREARTIREPRESSURE psi

    // ── Derived values ──
    const isDischarging  = Number(dischargeState) === 3;
    const powerKw        = chargePower !== null ? chargePower / 1000 : null;
    const isChargingVal  = (!isDischarging && powerKw !== null && powerKw > 0) ? 1 : 0;
    const isParked       = Number(gear) === 1 ? 1 : 0;

    // power: ABRP convention — output (driving) = positive, input (charging) = negative
    let powerAbrp = null;
    if (powerKw !== null) {
      powerAbrp = isChargingVal ? -Math.abs(powerKw) : Math.abs(powerKw);
    }

    // voltage: only send when valid (non-zero, not 65535 = no data)
    const voltage = (hvVoltRaw !== null && hvVoltRaw > 0 && hvVoltRaw !== 65535) ? hvVoltRaw : null;

    // tyre pressure: convert psi → kPa (1 psi = 6.89476 kPa)
    const psiToKpa = v => v !== null ? parseFloat((v * 6.89476).toFixed(1)) : null;

    // ── Build ABRP telemetry payload ──
    // Ref: https://documenter.getpostman.com/view/7396339/SWTK5a8w
    const tlm = {
      utc:       Math.floor(Date.now() / 1000),
      car_model: "byd:sealion:25:82:rwd",
    };

    // High priority
    if (soc !== null)          tlm.soc         = parseFloat(soc.toFixed(1));
    if (powerAbrp !== null)    tlm.power       = parseFloat(powerAbrp.toFixed(3));
    if (speed !== null)        tlm.speed       = parseFloat(speed.toFixed(1));
                               tlm.is_charging = isChargingVal;
                               tlm.is_dcfc     = 0;
                               tlm.is_parked   = isParked;

    // Lower priority
    if (soe !== null)          tlm.soe              = parseFloat(soe.toFixed(2));
    if (soh !== null)          tlm.soh              = soh;
    if (extTemp !== null)      tlm.ext_temp         = extTemp;
    if (voltage !== null)      tlm.voltage          = voltage;
    if (odometer !== null)     tlm.odometer         = parseFloat(odometer.toFixed(1));
    if (evRange !== null)      tlm.est_battery_range = evRange;
    if (hvacSetpoint !== null) tlm.hvac_setpoint    = hvacSetpoint;
    if (tyreFl !== null)       tlm.tire_pressure_fl = psiToKpa(tyreFl);
    if (tyreFr !== null)       tlm.tire_pressure_fr = psiToKpa(tyreFr);
    if (tyreRl !== null)       tlm.tire_pressure_rl = psiToKpa(tyreRl);
    if (tyreRr !== null)       tlm.tire_pressure_rr = psiToKpa(tyreRr);

    // Push to ABRP API
    const https = require("https");
    const apiUrl = `https://api.iternio.com/1/tlm/send?token=${encodeURIComponent(token)}&tlm=${encodeURIComponent(JSON.stringify(tlm))}`;

    const abrpResult = await new Promise((resolve) => {
      https.get(apiUrl, { headers: { "User-Agent": "Sealion7-ADB-Shell" } }, (r) => {
        let data = "";
        r.on("data", c => data += c);
        r.on("end", () => {
          try { resolve({ success: true, output: JSON.parse(data), tlm }); }
          catch { resolve({ success: true, output: data, tlm }); }
        });
      }).on("error", e => resolve({ success: false, output: e.message, tlm }));
    });

    res.writeHead(200);
    res.end(JSON.stringify(abrpResult));
    return;
  }

  // ── POST /abrp-plan — send plan to ABRP account (syncs to mobile app) ──
  if (req.method === "POST" && pathname === "/abrp-plan") {
    const body = await parseBody(req);
    const { destinations } = body;
    const token = body.token || ABRP_TOKEN;
    if (!token || !destinations) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: "Missing token or destinations" }));
      return;
    }
    try {
      const https = require("https");

      // Build plan in correct ABRP API format
      const plan = {
        destinations: destinations.map(d => ({
          location: {
            type: "COORDINATES",
            latitude:  d.lat,
            longitude: d.lon,
            name:      d.address || d.name || ""
          }
        })),
        vehicle: {
          identifier: {
            type:  "TYPECODE",
            value: "byd:sealion:25:82:rwd"
          }
        }
      };

      const planJson = JSON.stringify(plan);
      const options = {
        hostname: "api.iternio.com",
        path:     "/1/plan/set",
        method:   "POST",
        headers:  {
          "Content-Type":   "application/json",
          "Authorization":  `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(planJson),
          "User-Agent":     "Sealion7-ADB-Shell"
        }
      };

      const data = await new Promise((resolve, reject) => {
        const req2 = https.request(options, (r) => {
          let body2 = "";
          r.on("data", c => body2 += c);
          r.on("end", () => { try { resolve(JSON.parse(body2)); } catch(e) { reject(e); } });
        });
        req2.on("error", reject);
        req2.write(planJson);
        req2.end();
      });

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, result: data }));
    } catch(e) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // ── POST /stop — gracefully stop the server from the UI ──
  if (req.method === "POST" && pathname === "/stop") {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, output: "Server stopping..." }));
    console.log("\n🛑 Stop requested from UI. Bye!\n");
    setTimeout(() => process.exit(0), 300);
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

// On startup in Termux: connect ADB immediately
if (IS_TERMUX) {
  console.log(`\nConnecting ADB to ${ADB_HOST}...`);
  adbConnect().then((out) => {
    console.log("ADB:", out);
  });
}

// Start car_service background polling.
// First poll runs shortly after startup; then every 10 seconds.
setTimeout(() => pollCarProperties(null, "startup"), 1500);
setInterval(() => pollCarProperties(null, "timer"), POLL_INTERVAL_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server on http://localhost:${PORT}`);
  console.log(`   Mode: ${IS_TERMUX ? `Termux → ADB ${ADB_HOST}` : "PC → ADB USB"}`);
});

// ── Stop via UI only (POST /stop) ──
// Use the ⏹ Stop button in the web UI to stop the server.
console.log(`   Stop: use the ⏹ Stop button in the UI, or: kill ${process.pid}\n`);
