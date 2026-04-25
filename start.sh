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

echo ""
echo -e "${GREEN}╔═══════════════════════════════════╗${NC}"
echo -e "${GREEN}║      Sealion 7 ADB Web Shell      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════╝${NC}"
echo ""

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
  ADB_VER=$(adb version | head -1)
  echo -e "${BLUE}[4/5]${NC} ADB already installed ${GREEN}✓${NC}"
fi

# ── Step 5: Pull latest from GitHub ──
echo -e "${BLUE}[5/5]${NC} Pulling latest from GitHub..."
REPO_DIR="$HOME/Sealion7Store"

if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR"
  git pull --rebase origin main 2>&1 | tail -1
  echo -e "      ${GREEN}✓ Repo updated${NC}"
else
  echo "      Cloning repo..."
  git clone https://github.com/aliboumrah/Sealion7Store.git "$REPO_DIR" 2>&1 | tail -1
  cd "$REPO_DIR"
  echo -e "      ${GREEN}✓ Repo cloned${NC}"
fi

# ── Connect ADB to localhost:5555 ──
echo ""
echo -e "${YELLOW}Connecting ADB to localhost:5555...${NC}"
adb connect localhost:5555 2>&1
ADB_DEVICES=$(adb devices)
echo -e "$ADB_DEVICES"

if echo "$ADB_DEVICES" | grep -q "localhost:5555"; then
  echo -e "${GREEN}✓ ADB connected to localhost:5555${NC}"
else
  echo -e "${RED}⚠ ADB not connected. Make sure wireless ADB is enabled on port 5555.${NC}"
  echo -e "  In the BYD hidden menu: Settings → System → Version → tap Restore 10x → Connect USB"
fi

# ── Start the server ──
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Server starting on port ${YELLOW}3000${NC}"
echo ""
echo -e "  Open in browser:"
echo -e "  ${BLUE}http://localhost:3000${NC}"
echo -e "  ${BLUE}https://aliboumrah.github.io/Sealion7Store/${NC}"
echo ""
echo -e "  Press ${RED}Ctrl+C${NC} to stop"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

node "$REPO_DIR/adb-server.js"
