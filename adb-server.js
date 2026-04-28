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

  // ── GET /store — fetch APK list from GitHub (server-side, no CORS) ──
  if (req.method === "GET" && pathname === "/store") {
    try {
      const https = require("https");
      const data = await new Promise((resolve, reject) => {
        const opts = {
          hostname: "api.github.com",
          path: "/repos/aliboumrah/Sealion7Store/contents",
          headers: {
            "User-Agent": "Sealion7-ADB-Shell",
            "Accept": "application/vnd.github.v3+json"
          }
        };
        https.get(opts, (r) => {
          let body = "";
          r.on("data", c => body += c);
          r.on("end", () => {
            try { resolve(JSON.parse(body)); }
            catch(e) { reject(e); }
          });
        }).on("error", reject);
      });
      const apks = Array.isArray(data)
        ? data.filter(f => f.name.toLowerCase().endsWith(".apk"))
              .map(f => ({ name: f.name, size: f.size }))
        : [];
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

  // ── GET /properties — fetch live property values mapped to names ──
  if (req.method === "GET" && pathname === "/properties") {
    const serial = (parsed.query && parsed.query.serial) || null;
    // Run dumpsys car_service and extract All Events section only
    const result = await runAdb(["shell", "dumpsys car_service"], serial);
    if (!result.success) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: false, properties: {} }));
      return;
    }
    const text = result.output;

    // Extract All Events section
    const evStart = text.indexOf("*All Events");
    const evEnd   = text.indexOf("*Property handlers*", evStart);
    const evBody  = evStart > -1 ? text.slice(evStart, evEnd > -1 ? evEnd : undefined) : "";

    // Extract All Properties section for name mapping
    const prStart = text.indexOf("*All properties*");
    const prEnd   = text.indexOf("*All Events", prStart);
    const prBody  = prStart > -1 ? text.slice(prStart, prEnd > -1 ? prEnd : undefined) : "";

    // Build id→name map from All Properties
    const idToName = {};
    const propNameRe = new RegExp("Property:(0x[0-9a-fA-F]+),\s*Property name:([^,]+),", "g");
    for (const m of prBody.matchAll(propNameRe)) {
      idToName[m[1].toLowerCase()] = m[2].trim();
    }

    // Parse events with values
    const evRe = new RegExp(
      "lastEvent:Property:(0x[0-9a-fA-F]+),status:\s*(\d+),timestamp:(\d+)," +
      "zone:[^,]+,floatValues:\s*\[([^\]]*)\],int32Values:\s*\[([^\]]*)\]," +
      "int64Values:\s*\[([^\]]*)\],bytes:\s*\[[^\]]*\],string:\s*([^\r\n]*)",
      "g"
    );

    const properties = {};
    for (const m of evBody.matchAll(evRe)) {
      const id        = m[1].toLowerCase();
      const status    = parseInt(m[2]);
      const timestamp = m[3];
      const floats    = m[4].trim().split(",").map(v => v.trim()).filter(Boolean).map(Number);
      const ints      = m[5].trim().split(",").map(v => v.trim()).filter(Boolean).map(Number);
      const int64s    = m[6].trim().split(",").map(v => v.trim()).filter(Boolean);
      const str       = m[7].trim();
      const name      = idToName[id] || id;

      // Pick best value to display
      let value;
      if (floats.length === 1)      value = floats[0];
      else if (floats.length > 1)   value = floats;
      else if (ints.length === 1)   value = ints[0];
      else if (ints.length > 1)     value = ints;
      else if (str)                 value = str;
      else                          value = null;

      properties[id] = { id, name, value, status, timestamp };
    }

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, properties, count: Object.keys(properties).length }));
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
