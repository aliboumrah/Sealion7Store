/**
 * ADB Web Shell - Backend Server
 * Run: node adb-server.js
 * Requires: adb installed and in PATH, device connected via USB or TCP/IP
 */

const http = require("http");
const { execFile } = require("child_process");
const url = require("url");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 3000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Serial, X-Filename",
};

function runAdb(args) {
  return new Promise((resolve) => {
    execFile("adb", args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, output: stderr || err.message });
      } else {
        resolve({ success: true, output: stdout });
      }
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

// Save raw binary body to a temp file
function saveUpload(req, filename) {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const dest = path.join(tmpDir, `adbweb_${Date.now()}_${safeName}`);
    const out = fs.createWriteStream(dest);
    req.pipe(out);
    out.on("finish", () => resolve(dest));
    out.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  // GET /devices
  if (req.method === "GET" && pathname === "/devices") {
    const result = await runAdb(["devices", "-l"]);
    const lines = result.output.split("\n").slice(1)
      .filter((l) => l.trim() && !l.startsWith("*"));
    const devices = lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const modelMatch = line.match(/model:(\S+)/);
      const productMatch = line.match(/product:(\S+)/);
      return {
        serial: parts[0],
        state: parts[1],
        model: modelMatch ? modelMatch[1] : "Unknown",
        product: productMatch ? productMatch[1] : "",
      };
    }).filter((d) => d.serial);
    res.writeHead(200);
    res.end(JSON.stringify({ devices }));
    return;
  }

  // POST /shell
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
    const args = serial ? ["-s", serial, "shell", command] : ["shell", command];
    const result = await runAdb(args);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // POST /adb
  if (req.method === "POST" && pathname === "/adb") {
    const body = await parseBody(req);
    const { args, serial } = body;
    if (!args || !Array.isArray(args)) {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, output: "Missing args array" }));
      return;
    }
    const finalArgs = serial ? ["-s", serial, ...args] : args;
    const result = await runAdb(finalArgs);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // POST /install — receive raw APK bytes and install via adb install
  // Headers: X-Device-Serial (optional), X-Filename (original filename)
  if (req.method === "POST" && pathname === "/install") {
    const serial = req.headers["x-device-serial"] || null;
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

    const args = serial
      ? ["-s", serial, "install", "-r", tmpPath]
      : ["install", "-r", tmpPath];

    const result = await runAdb(args);

    try { fs.unlinkSync(tmpPath); } catch {}

    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`ADB Web Shell server running at http://localhost:${PORT}`);
  console.log("Endpoints: GET /devices  POST /shell  POST /adb  POST /install");
});
