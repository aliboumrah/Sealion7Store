/**
 * ADB Web Shell - Backend Server
 * Works in two modes:
 *   1. PC mode   — runs adb shell commands (device connected via USB/WiFi)
 *   2. Termux mode — runs shell commands directly on the Android device
 *
 * Auto-detects which mode to use based on environment.
 * Run: node adb-server.js
 */

const http     = require("http");
const { execFile, exec } = require("child_process");
const url      = require("url");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");

const PORT = 3000;

// ── Detect if running inside Termux ──
const IS_TERMUX = fs.existsSync("/data/data/com.termux") ||
                  (process.env.PREFIX || "").includes("com.termux");

console.log(`Mode: ${IS_TERMUX ? "🤖 Termux (native shell)" : "💻 PC (adb shell)"}`);

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Serial, X-Filename",
};

// ── Run a shell command ──
// In Termux: runs directly via sh
// On PC: runs via adb shell
function runShell(command, serial) {
  return new Promise((resolve) => {
    if (IS_TERMUX) {
      // Run directly on the device
      exec(command, { timeout: 15000, shell: "/system/bin/sh" }, (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ success: false, output: stderr || err.message });
        } else {
          resolve({ success: true, output: stdout || stderr });
        }
      });
    } else {
      // Run via ADB from PC
      const args = serial
        ? ["-s", serial, "shell", command]
        : ["shell", command];
      execFile("adb", args, { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) resolve({ success: false, output: stderr || err.message });
        else     resolve({ success: true,  output: stdout });
      });
    }
  });
}

// ── Run a raw ADB command (PC only) ──
function runAdb(args) {
  return new Promise((resolve) => {
    execFile("adb", args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) resolve({ success: false, output: stderr || err.message });
      else     resolve({ success: true,  output: stdout });
    });
  });
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

function saveUpload(req, filename) {
  return new Promise((resolve, reject) => {
    const tmpDir  = os.tmpdir();
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const dest    = path.join(tmpDir, `adbweb_${Date.now()}_${safeName}`);
    const out     = fs.createWriteStream(dest);
    req.pipe(out);
    out.on("finish", () => resolve(dest));
    out.on("error",  reject);
  });
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
    if (IS_TERMUX) {
      // In Termux, "this device" is the device — return a fake entry
      const model = await runShell("getprop ro.product.model");
      const ver   = await runShell("getprop ro.build.version.release");
      res.writeHead(200);
      res.end(JSON.stringify({
        devices: [{
          serial:  "localhost",
          state:   "device",
          model:   model.output.trim() || "BYD Sealion 7",
          product: `Android ${ver.output.trim()}`,
        }],
        mode: "termux",
      }));
    } else {
      const result = await runAdb(["devices", "-l"]);
      const lines  = result.output.split("\n").slice(1)
        .filter((l) => l.trim() && !l.startsWith("*"));
      const devices = lines.map((line) => {
        const parts       = line.trim().split(/\s+/);
        const modelMatch  = line.match(/model:(\S+)/);
        const productMatch= line.match(/product:(\S+)/);
        return {
          serial:  parts[0],
          state:   parts[1],
          model:   modelMatch  ? modelMatch[1]  : "Unknown",
          product: productMatch? productMatch[1] : "",
        };
      }).filter((d) => d.serial);
      res.writeHead(200);
      res.end(JSON.stringify({ devices, mode: "adb" }));
    }
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
    const result = await runShell(command, serial);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // ── POST /adb (PC mode only) ──
  if (req.method === "POST" && pathname === "/adb") {
    if (IS_TERMUX) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, output: "Not available in Termux mode. Use /shell instead." }));
      return;
    }
    const body = await parseBody(req);
    const { args, serial } = body;
    if (!args || !Array.isArray(args)) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, output: "Missing args array" }));
      return;
    }
    const finalArgs = serial ? ["-s", serial, ...args] : args;
    const result    = await runAdb(finalArgs);
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

    let tmpPath;
    try {
      tmpPath = await saveUpload(req, filename);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, output: `Failed to save file: ${e.message}` }));
      return;
    }

    let result;
    if (IS_TERMUX) {
      // Install directly using Android's pm command
      result = await runShell(`pm install -r "${tmpPath}"`);
    } else {
      const args = serial
        ? ["-s", serial, "install", "-r", tmpPath]
        : ["install", "-r", tmpPath];
      result = await runAdb(args);
    }

    try { fs.unlinkSync(tmpPath); } catch {}

    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // ── GET /mode — tells the UI which mode is active ──
  if (req.method === "GET" && pathname === "/mode") {
    res.writeHead(200);
    res.end(JSON.stringify({ mode: IS_TERMUX ? "termux" : "adb" }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server listening on http://localhost:${PORT}`);
  console.log(`   Mode: ${IS_TERMUX ? "Termux (direct shell)" : "PC (adb shell)"}`);
  if (IS_TERMUX) {
    console.log(`\n   Open the browser and go to:`);
    console.log(`   http://localhost:3000`);
    console.log(`   https://aliboumrah.github.io/Sealion7Store/\n`);
  }
});
