#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# End-to-end tests for Code Mode MCP server (2 tools: cap_search, cap_execute)
# ─────────────────────────────────────────────────────────────
#
# Tests the MCP JSON-RPC protocol over stdio, including:
#   - Tool listing (tools/list)
#   - cap_search: model introspection, sandbox security
#   - cap_execute: SQL queries, multi-query, sandbox security
#   - Error handling for unknown tools
#
# Prerequisites:
#   cd mcp-server && npm run build && cd ..
#
# Usage:
#   bash test/mcp-code-mode-test.sh
#
# Exit code 0 = all passed, non-zero = failures detected.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MCP_SERVER="$PROJECT_DIR/mcp-server/build/index.js"
TMP_DIR=$(mktemp -d) || { echo "ERROR: Failed to create temp dir"; exit 1; }

# Validate MCP server is built
if [ ! -f "$MCP_SERVER" ]; then
  echo "ERROR: MCP server not built. Run: cd mcp-server && npm run build && cd .."
  exit 1
fi

PASS=0
FAIL=0

# Cleanup on exit (single quotes defer $TMP_DIR expansion)
trap 'rm -rf "$TMP_DIR"' EXIT

# MCP protocol handshake messages
INIT_REQ='{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
INIT_NOTIFY='{"jsonrpc":"2.0","method":"notifications/initialized"}'

# Helper: send MCP messages and get response for id:1
# Writes JSON-RPC messages to a temp file (avoids shell escaping issues),
# then pipes to server in background and polls for the tool response.
call_mcp() {
  local test_id="$1"
  local input_file="$TMP_DIR/in-${test_id}.json"
  local out_file="$TMP_DIR/out-${test_id}.json"

  # Input file was written by the caller
  mv "$TMP_DIR/req-${test_id}.json" "$input_file"

  # Send messages; sleep keeps stdin open so server stays alive.
  # Capture stderr for debugging test failures.
  (cat "$input_file"; sleep 20) \
    | (cd "$PROJECT_DIR" && node "$MCP_SERVER") >"$out_file" 2>"$TMP_DIR/err-${test_id}.log" &
  local pid=$!

  # Poll for the tool response (id:1) every 0.5s, max 25s
  local poll_count=0
  while [ $poll_count -lt 50 ]; do
    sleep 0.5
    poll_count=$((poll_count + 1))
    if [ -f "$out_file" ] && grep -q '"id":1' "$out_file" 2>/dev/null; then
      break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      sleep 0.1  # Allow final output flush
      break
    fi
  done

  # Kill the background server process
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true

  # Return the response line with id:1, or diagnostic info on failure
  if [ -f "$out_file" ] && [ -s "$out_file" ]; then
    grep '"id":1' "$out_file" | head -1
  elif [ -f "$TMP_DIR/err-${test_id}.log" ] && [ -s "$TMP_DIR/err-${test_id}.log" ]; then
    echo "Error (stderr): $(head -c 200 "$TMP_DIR/err-${test_id}.log")"
  fi
}

check() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected '$expected')"
    echo "    got: $(echo "$actual" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Code Mode MCP Tests ==="
echo ""

# ─── Test 1: tools/list returns exactly 2 tools ─────────────
echo "1. tools/list"
cat > "$TMP_DIR/req-1.json" << 'EOF'
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF
RESULT=$(call_mcp 1)
check "returns cap_search" "cap_search" "$RESULT"
check "returns cap_execute" "cap_execute" "$RESULT"

# ─── Test 2: cap_search — list tables ────────────────────────
echo "2. cap_search — list tables"
cat > "$TMP_DIR/req-2.json" << 'EOF'
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"cap_search","arguments":{"code":"log(tables.length + ' tables')"}}}
EOF
RESULT=$(call_mcp 2)
check "returns table count" "tables" "$RESULT"

# ─── Test 3: cap_execute — simple query ──────────────────────
echo "3. cap_execute — carrier count"
cat > "$TMP_DIR/req-3.json" << 'EOF'
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"cap_execute","arguments":{"code":"const r = await query('SELECT COUNT(*) as cnt FROM flights_Carriers'); log('Carriers: ' + r[0].cnt);"}}}
EOF
RESULT=$(call_mcp 3)
check "returns carrier count" "Carriers:" "$RESULT"

# ─── Test 4: cap_search — sandbox security (no require) ─────
echo "4. cap_search — sandbox blocks require()"
cat > "$TMP_DIR/req-4.json" << 'EOF'
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"cap_search","arguments":{"code":"require('fs')"}}}
EOF
RESULT=$(call_mcp 4)
check "blocks require" "not defined" "$RESULT"

# ─── Test 5: cap_execute — sandbox security (no process) ────
echo "5. cap_execute — sandbox blocks process"
cat > "$TMP_DIR/req-5.json" << 'EOF'
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"cap_execute","arguments":{"code":"process.exit(1)"}}}
EOF
RESULT=$(call_mcp 5)
check "blocks process" "not defined" "$RESULT"

# ─── Test 6: cap_execute — multi-query composition ──────────
echo "6. cap_execute — multi-query composition"
cat > "$TMP_DIR/req-6.json" << 'EOF'
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"cap_execute","arguments":{"code":"const c = await query('SELECT COUNT(*) as n FROM flights_Carriers'); const f = await query('SELECT COUNT(*) as n FROM flights_Flights'); log('carriers=' + c[0].n + ' flights=' + f[0].n);"}}}
EOF
RESULT=$(call_mcp 6)
check "multi-query returns data" "carriers=" "$RESULT"
check "multi-query has flights" "flights=" "$RESULT"

# ─── Test 7: Unknown tool returns error ──────────────────────
echo "7. Unknown tool"
cat > "$TMP_DIR/req-7.json" << 'EOF'
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"cap_nonexistent","arguments":{}}}
EOF
RESULT=$(call_mcp 7)
check "unknown tool error" "Unknown tool" "$RESULT"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
