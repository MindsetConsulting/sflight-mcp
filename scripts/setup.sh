#!/bin/bash
# ─────────────────────────────────────────────────────────────
# sflight-mcp — One-Shot Setup
# ─────────────────────────────────────────────────────────────
# Run this after cloning. It installs everything, builds the
# MCP server, creates the .mcp.json config, and tells you
# what to do next.
#
# Usage:
#   bash scripts/setup.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  sflight-mcp — One-Shot Setup${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ── Step 0: Check prerequisites ──────────────────────────────

echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js not found. Install it: https://nodejs.org/ (v18+)${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Node.js v18+ required. Current: $(node -v)${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

if ! command -v cds &> /dev/null; then
    echo -e "  ${YELLOW}⚠ @sap/cds-dk not found. Installing globally...${NC}"
    npm install -g @sap/cds-dk
fi
echo -e "  ${GREEN}✓${NC} CDS DK $(cds --version 2>/dev/null | head -1 || echo 'installed')"

# ── Step 1: Install root dependencies ────────────────────────

echo ""
echo -e "${YELLOW}Step 1/3: Installing project dependencies...${NC}"
npm install
echo -e "  ${GREEN}✓${NC} Root dependencies installed"

# ── Step 2: Build MCP server ─────────────────────────────────

echo ""
echo -e "${YELLOW}Step 2/3: Building MCP server...${NC}"
cd mcp-server
npm install
npm run build
cd "$PROJECT_DIR"

if [ -f "mcp-server/build/index.js" ]; then
    echo -e "  ${GREEN}✓${NC} MCP server built (19 tools ready)"
else
    echo -e "  ${RED}✗ MCP server build failed${NC}"
    exit 1
fi

# ── Step 3: Create .mcp.json ─────────────────────────────────

echo ""
echo -e "${YELLOW}Step 3/3: Creating .mcp.json (MCP configuration)...${NC}"

MCP_SERVER_PATH="$PROJECT_DIR/mcp-server/build/index.js"

cat > "$PROJECT_DIR/.mcp.json" <<EOF
{
  "mcpServers": {
    "cap-tools": {
      "command": "node",
      "args": ["$MCP_SERVER_PATH"]
    }
  }
}
EOF
echo -e "  ${GREEN}✓${NC} .mcp.json created"

# ── Done ─────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}What to do next:${NC}"
echo ""
echo -e "  ${CYAN}Demo 1: OData Service${NC}"
echo -e "    cds watch"
echo -e "    # Open http://localhost:4004"
echo ""
echo -e "  ${CYAN}Demo 2: Claude Code (AI Queries)${NC}"
echo -e "    npm install -g @anthropic-ai/claude-code  ${YELLOW}# one-time${NC}"
echo -e "    claude"
echo -e "    # Ask: \"Which airlines fly to London?\""
echo ""
echo -e "  ${CYAN}Demo 3: Claude for Excel (HTTP/SSE)${NC}"
echo -e "    bash scripts/start-mcp-sse.sh"
echo -e "    # Register http://localhost:8080 in Claude org settings"
echo ""
