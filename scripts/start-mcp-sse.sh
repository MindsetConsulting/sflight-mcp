#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Start MCP Server as HTTP/SSE — for Claude for Excel
# ─────────────────────────────────────────────────────────────
#
# Uses supergateway to wrap the stdio-based MCP server as an
# HTTP/SSE endpoint that Claude for Excel can connect to.
#
# Prerequisites:
#   cd mcp-server && npm run build && cd ..
#
# Usage:
#   bash scripts/start-mcp-sse.sh
#   # Then register http://localhost:8080 in Claude org settings
#
# Test:
#   curl http://localhost:8080/sse
# ─────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${MCP_SSE_PORT:-8080}"
MCP_SERVER="node $PROJECT_DIR/mcp-server/build/index.js"

# Check MCP server build exists
if [ ! -f "$PROJECT_DIR/mcp-server/build/index.js" ]; then
	echo "MCP server not built. Building..."
	cd "$PROJECT_DIR/mcp-server" && npm run build && cd "$PROJECT_DIR"
fi

echo "═══════════════════════════════════════════════════════════"
echo " MCP Server → HTTP/SSE (supergateway)"
echo " Port: $PORT"
echo " Server: $MCP_SERVER"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Endpoints:"
echo "  SSE:    http://localhost:$PORT/sse"
echo "  Health: http://localhost:$PORT/"
echo ""
echo "Register http://localhost:$PORT in Claude org settings"
echo "  → Organization Settings → Connectors → Add Custom Connector"
echo ""
echo "Press Ctrl+C to stop"
echo ""

npx -y supergateway --stdio "$MCP_SERVER" --port "$PORT"
