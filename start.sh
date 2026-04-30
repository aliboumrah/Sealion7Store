#!/data/data/com.termux/files/usr/bin/bash

# ─────────────────────────────────────────
#  Sealion7Store — Termux Start Script
#  Usage: bash start.sh
# ─────────────────────────────────────────

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

REPO_DIR="$HOME/Sealion7Store"
BASHRC="$HOME/.bashrc"
AUTOSTART_MARKER="# >>> Sealion7Store autostart <<<"

echo -e "\033[36m"
cat << 'ASCIIART'
================================++++++++++++++++++++++++++++++++++++
===========================================+++++++++++++++++++++++++
----------=================================================+++++++++
------------------==================================================
--------------------------------====================================
-------------------------------------------=========================
::::----------------------------------------------------============
::::::::::::-+**#*#%#**####++*###%%%%%%%###*=----------------------=
:::::::::::--+######%%%%%%%%%%%%%%%%%%%%%%%%%%#+--------------------
:::::::==-==+++++++++===+++++++***+**###%%#######**+----------------
::::::=++++++=====+++*####**+++++++++=====+++++++*%%*---------------
::::::====++++++++++++++++++++**+++++++++++++++****+++==------------
:::::-==---------=====+++++*%%%@@%%#+==============+++**##*+--------
:::::-==++*************##**#@@@@%@@@#***********++++++%@@@@@*-------
:::::=%%@%###%%@@%%#***#%#*%@%##%%%@%**++++++*********%%##%@#-------
:::::*##%##%%%%%%%%%%%%####%@%#%%%%@%********++++=+++#%#%%@%#-------
::::::-*%%%%@@@@@@@@@@@@@@@@@%%%%%%@@%%%%%%%%%%%%%%%%%%%%%%%*=------
::::::::-+@@@@@@@#--------*@@%**#%%**@@@@@*==========%@%#%%+========
----------=#@@@%*+++++++***%@@@%%%%##%@@@@%##########%@@@%%#********
-----------================++++++++++++++++++++++++++******+++++++++
---------===========================+==+++++++++++++++++++++++++++++
-------================+++++++++++++++++++++++++++++++++++++++++++++
============++++++++++++++++++++++++++++++++++++++++++++++++++++++++
ASCIIART
echo -e "\033[0m"
echo ""
echo -e "${GREEN}╔═══════════════════════════════════╗${NC}"
echo -e "${GREEN}║      Sealion 7 ADB Web Shell      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════╝${NC}"
echo ""

# ── Auto-register in .bashrc (first run only) ──
echo -e "${BLUE}[0/5]${NC} Checking autostart registration..."
if grep -qF "$AUTOSTART_MARKER" "$BASHRC" 2>/dev/null; then
  echo -e "      ${GREEN}✓ Already registered in ~/.bashrc${NC}"
else
  echo "" >> "$BASHRC"
  echo "$AUTOSTART_MARKER" >> "$BASHRC"
  echo 'bash ~/start.sh' >> "$BASHRC"
  echo "$AUTOSTART_MARKER" >> "$BASHRC"
  echo -e "      ${GREEN}✓ Successfully registered in ~/.bashrc${NC}"
  echo -e "      ${YELLOW}→ Script will auto-start on next Termux launch${NC}"
fi

# ── Step 1: Update & upgrade ──
echo -e "${BLUE}[1/5]${NC} Updating Termux packages..."
pkg update -y -o Dpkg::Options::="--force-confold" > /dev/null 2>&1
pkg upgrade -y -o Dpkg::Options::="--force-confold" > /dev/null 2>&1
echo -e "      ${GREEN}✓ Done${NC}"

# ── Step 2: Install git ──
if ! command -v git &> /dev/null; then
  echo -e "${BLUE}[2/5]${NC} Installing git..."
  pkg install git -y > /dev/null 2>&1
  echo -e "      ${GREEN}✓ git installed${NC}"
else
  echo -e "${BLUE}[2/5]${NC} git already installed ${GREEN}✓${NC}"
fi

# ── Step 3: Install Node.js ──
if ! command -v node &> /dev/null; then
  echo -e "${BLUE}[3/5]${NC} Installing Node.js..."
  pkg install nodejs -y > /dev/null 2>&1
  echo -e "      ${GREEN}✓ Node.js installed${NC}"
else
  echo -e "${BLUE}[3/5]${NC} Node.js $(node --version) ${GREEN}✓${NC}"
fi

# ── Step 4: Install ADB ──
if ! command -v adb &> /dev/null; then
  echo -e "${BLUE}[4/5]${NC} Installing ADB..."
  pkg install android-tools -y > /dev/null 2>&1
  echo -e "      ${GREEN}✓ ADB installed${NC}"
else
  echo -e "${BLUE}[4/5]${NC} ADB already installed ${GREEN}✓${NC}"
fi

# ── Step 5: Pull latest from GitHub ──
echo -e "${BLUE}[5/5]${NC} Pulling latest from GitHub..."
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  git pull --rebase origin main 2>&1 | tail -1
  echo -e "      ${GREEN}✓ Repo updated${NC}"
else
  git clone https://github.com/aliboumrah/Sealion7Store.git "$REPO_DIR" 2>&1 | tail -1
  cd "$REPO_DIR"
  echo -e "      ${GREEN}✓ Repo cloned${NC}"
fi

cd "$REPO_DIR"

# ── Get WiFi IP ──
CAR_IP=$(ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1 | head -1)
if [ -z "$CAR_IP" ]; then
  CAR_IP=$(ip addr show 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d/ -f1 | head -1)
fi

# ── Re-enable ADB on port 5555 ──
echo ""
echo -e "${YELLOW}Re-enabling ADB on port 5555...${NC}"
setprop service.adb.tcp.port 5555 2>/dev/null
stop adbd 2>/dev/null
start adbd 2>/dev/null
sleep 1
adb connect localhost:5555 2>&1
if adb devices | grep -q "localhost:5555"; then
  echo -e "${GREEN}✓ ADB connected${NC}"
else
  echo -e "${RED}⚠ ADB not connected — enable from car screen if first time${NC}"
fi

# ── Start server ──
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Server: ${YELLOW}http://localhost:3000${NC}"
if [ -n "$CAR_IP" ]; then
  echo -e "  WiFi:   ${YELLOW}http://$CAR_IP:3000${NC}"
fi
echo -e "  Stop:   use the ${RED}⏹ Stop${NC} button in the UI"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

node "$REPO_DIR/adb-server.js"
