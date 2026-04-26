#!/data/data/com.termux/files/usr/bin/bash

# ─────────────────────────────────────────
#  Sealion7Store — Termux Start Script
# ─────────────────────────────────────────

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

REPO_DIR="$HOME/Sealion7Store"

echo ""
echo -e "${GREEN}╔═══════════════════════════════════╗${NC}"
echo -e "${GREEN}║      Sealion 7 ADB Web Shell      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════╝${NC}"
echo ""

# ── If piped from curl, re-download and exec directly ──
# When run as "curl | bash", stdin is the pipe so read/node readline breaks.
# We detect this and re-run the script from a real file instead.
if [ ! -t 0 ]; then
  echo -e "${YELLOW}Detected pipe mode. Downloading script and re-running...${NC}"
  pkg install curl -y > /dev/null 2>&1
  SCRIPT_PATH="$HOME/start_sealion.sh"
  curl -s https://raw.githubusercontent.com/aliboumrah/Sealion7Store/main/start.sh -o "$SCRIPT_PATH"
  chmod +x "$SCRIPT_PATH"
  echo -e "${GREEN}✓ Downloaded. Launching...${NC}"
  echo ""
  exec bash "$SCRIPT_PATH"
  exit 0
fi

# ── Step 1: Update packages ──
echo -e "${BLUE}[1/5]${NC} Updating Termux packages..."
pkg update -y -o Dpkg::Options::="--force-confold" > /dev/null 2>&1
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
  NODE_VER=$(node --version)
  echo -e "${BLUE}[3/5]${NC} Node.js $NODE_VER already installed ${GREEN}✓${NC}"
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

# ── Connect ADB ──
echo ""
echo -e "${YELLOW}Connecting ADB to localhost:5555...${NC}"
adb connect localhost:5555 2>&1
if adb devices | grep -q "localhost:5555"; then
  echo -e "${GREEN}✓ ADB connected${NC}"
else
  echo -e "${RED}⚠ ADB not connected. Enable from Settings → System → Version → tap Restore 10x${NC}"
fi

# ── Ask run mode ──
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  How do you want to run the server?"
echo ""
echo -e "  ${YELLOW}1${NC}) Foreground  — see logs, stop with Enter/Q"
echo -e "  ${YELLOW}2${NC}) Background  — runs silently, stop via UI"
echo -e "  ${YELLOW}3${NC}) Screen      — detachable session (recommended)"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -ne "  Choice [1/2/3]: "
read -r CHOICE

case "$CHOICE" in
  2)
    pkill -f "node.*adb-server.js" 2>/dev/null
    sleep 0.5
    nohup node "$REPO_DIR/adb-server.js" > "$REPO_DIR/server.log" 2>&1 &
    SERVER_PID=$!
    sleep 1
    if kill -0 $SERVER_PID 2>/dev/null; then
      echo ""
      echo -e "${GREEN}✓ Server running in background (PID $SERVER_PID)${NC}"
      echo -e "  Logs: ${BLUE}$REPO_DIR/server.log${NC}"
      echo -e "  Open: ${BLUE}http://localhost:3000${NC}"
      echo -e "  Stop: ${YELLOW}pkill -f 'node.*adb-server.js'${NC} or use ⏹ in UI"
      echo ""
    else
      echo -e "${RED}✗ Server failed. Check: $REPO_DIR/server.log${NC}"
    fi
    ;;
  3)
    if ! command -v screen &> /dev/null; then
      pkg install screen -y > /dev/null 2>&1
    fi
    screen -S adbserver -X quit 2>/dev/null
    sleep 0.5
    echo ""
    echo -e "${GREEN}✓ Starting screen session 'adbserver'${NC}"
    echo -e "  Open:      ${BLUE}http://localhost:3000${NC}"
    echo -e "  Detach:    ${YELLOW}Ctrl+A then D${NC}"
    echo -e "  Re-attach: ${YELLOW}screen -r adbserver${NC}"
    echo ""
    sleep 1
    screen -S adbserver node "$REPO_DIR/adb-server.js"
    ;;
  *)
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  Server on ${YELLOW}http://localhost:3000${NC}"
    echo -e "  Stop: press ${RED}Enter${NC} or type ${RED}Q${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    node "$REPO_DIR/adb-server.js"
    echo ""
    echo -e "${YELLOW}Server stopped. Run 'bash ~/start_sealion.sh' to restart.${NC}"
    ;;
esac
