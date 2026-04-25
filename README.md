# 🚗 Sealion 7 ADB Web Shell

A browser-based ADB shell and app store for the **BYD Sealion 7** infotainment system (DiLink OS). Run shell commands, install APKs, and manage your car's Android system — all from a web UI.

---

## 📁 Files

| File | Description |
|------|-------------|
| `adb-shell-ui.html` | Web UI — open in any browser |
| `adb-server.js` | Node.js backend server |
| `start.sh` | One-command setup & launch script for Termux |
| `AppManager_v4.0.5.apk` | App Manager — unlocks APK installation |
| `GBox-1.5.6.0-150600-16538-telegram.apk` | GBox — Google Play services layer |

---

## 🚀 Quick Start (Termux on the car)

Open **Termux** on the Sealion 7 and run:

```bash
curl -s https://raw.githubusercontent.com/aliboumrah/Sealion7Store/main/start.sh | bash
```

This single command will:
1. Update Termux packages
2. Install `git`, `nodejs`, and `adb` if missing
3. Clone or pull the latest repo from GitHub
4. Connect ADB to `localhost:5555`
5. Start the server on port `3000`

Then open the car's browser and go to:

```
http://localhost:3000
```

Or from any device on the same network:

```
https://aliboumrah.github.io/Sealion7Store/
```

---

## 🔓 Step 1 — Enable ADB on the Sealion 7

Do this on the **car touchscreen** while parked:

1. Open **Settings**
2. Tap **System**
3. Tap **Version**
4. Tap **Restore Factory** **10 times rapidly** — a hidden developer menu appears
5. Tap **Rotate screen**
6. Tap **Connect USB** — ADB is now enabled on port `5555`

> ⚠️ Do NOT confirm any factory reset. Just tap the button 10 times fast to trigger the hidden menu.

---

## 📟 Step 2 — Set Up Termux

> Do not install Termux from Google Play — it is outdated. Use F-Droid.

**Download:** https://f-droid.org/en/packages/com.termux/

Install via ADB from your PC:

```bash
adb install -r com.termux.apk
```

Then inside Termux:

```bash
pkg update && pkg upgrade -y
pkg install nodejs git android-tools -y
```

---

## 🖥️ Step 3 — Run the Server

```bash
# Clone the repo
git clone https://github.com/aliboumrah/Sealion7Store.git
cd Sealion7Store

# Start
node adb-server.js
```

Or use `start.sh` for subsequent runs — it pulls latest changes automatically:

```bash
bash start.sh
```

Press **Enter** or type **`q`** to stop the server. You can also click the **⏹ Stop** button in the web UI.

### Run in background

```bash
# Option 1 — nohup
nohup node adb-server.js &

# Option 2 — screen session
pkg install screen -y
screen -S adbserver
node adb-server.js
# Ctrl+A then D to detach
# screen -r adbserver to re-attach
```

---

## 🌐 Architecture

```
BYD Sealion 7 (DiLink Android)
│
├── Termux
│   ├── node adb-server.js    ← runs on port 3000
│   └── adb connect localhost:5555
│
├── ADB (port 5555)           ← wireless ADB on the car itself
│
└── Browser
    └── adb-shell-ui.html     ← connects to localhost:3000
```

The server auto-detects it is running inside Termux and connects to ADB over TCP (`localhost:5555`) instead of USB. APKs are installed via `adb push` + `adb install` which bypasses BYD's SELinux restrictions.

---

## 🏪 App Store

The **App Store** tab shows all APKs in this GitHub repo. Click **Install** to download and sideload directly to the car — no file manager needed.

To add more apps: push any `.apk` file to this repo and add an entry to `STORE_APPS` in `adb-shell-ui.html`.

---

## ⚡ Status Indicators

The header shows two live status pills that refresh every 10 seconds:

| Pill | Green ✓ | Yellow ⚠ | Red |
|------|---------|----------|-----|
| **JS** | Server running | — | Server offline |
| **ADB** | Device connected | No device | Unknown |

> Install buttons are disabled until both pills are green.

---

## ⚠️ Notes

- Works best on firmware **≤ 2307**. Firmware 2310+ removed ADB — downgrade to 2307 first using `UpdateFull.zip` on a USB drive.
- Use the **USB-A data port** in the center console, not the USB-C charging port.
- If ADB doesn't connect, try a different USB cable or laptop port — the car's OTG port is picky.

---

## 🔗 Resources

- [XDA Forum — BYD Multimedia APK Install](https://xdaforums.com/t/byd-multimedia-install-apk.4541247/)
- [Defective Tech — BYD Firmware Images](https://wiki.defective.tech/BYD/Firmware)
- [F-Droid — Termux](https://f-droid.org/en/packages/com.termux/)
- [App Manager (GitHub)](https://github.com/MuntashirAkon/AppManager/releases)
