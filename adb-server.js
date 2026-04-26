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

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Serial, X-Filename",
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
    execFile("adb", finalArgs, { timeout: 60000 }, (err, stdout, stderr) => {
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server on http://localhost:${PORT}`);
  console.log(`   Mode: ${IS_TERMUX ? `Termux → ADB ${ADB_HOST}` : "PC → ADB USB"}`);
});

// ── Stop via UI only (POST /stop) ──
// Use the ⏹ Stop button in the web UI to stop the server.
console.log(`   Stop: use the ⏹ Stop button in the UI, or: kill ${process.pid}\n`);
