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
echo -e "${BLUE}[1/4]${NC} Updating Termux packages..."
pkg update -y -o Dpkg::Options::="--force-confold" > /dev/null 2>&1
echo -e "      ${GREEN}✓ Done${NC}"

# ── Step 2: Install git if missing ──
if ! command -v git &> /dev/null; then
  echo -e "${BLUE}[2/4]${NC} Installing git..."
  pkg install git -y > /dev/null 2>&1
  echo -e "      ${GREEN}✓ git installed${NC}"
else
  echo -e "${BLUE}[2/4]${NC} git already installed ${GREEN}✓${NC}"
fi

# ── Step 3: Install Node.js if missing ──
if ! command -v node &> /dev/null; then
  echo -e "${BLUE}[3/4]${NC} Installing Node.js..."
  pkg install nodejs -y > /dev/null 2>&1
  echo -e "      ${GREEN}✓ Node.js installed${NC}"
else
  NODE_VER=$(node --version)
  echo -e "${BLUE}[3/4]${NC} Node.js $NODE_VER already installed ${GREEN}✓${NC}"
fi

# ── Step 4: Pull latest from GitHub ──
echo -e "${BLUE}[4/4]${NC} Pulling latest from GitHub..."
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
