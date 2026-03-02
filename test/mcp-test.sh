#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MCP Server Test Suite — Tests all 17 cap_ tools
# ─────────────────────────────────────────────────────────────
#
# Sends JSON-RPC messages directly to the MCP server over stdio.
# This is the actual MCP protocol — no Inspector CLI needed.
#
# Prerequisites:
#   cd mcp-server && npm run build && cd ..
#
# Usage:
#   bash test/mcp-test.sh
#
# Exit code 0 = all passed, non-zero = failures detected.
# ─────────────────────────────────────────────────────────────

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MCP_SERVER="$PROJECT_DIR/mcp-server/build/index.js"
TMP_DIR=$(mktemp -d)

PASS=0
FAIL=0
ERRORS=""

# Cleanup on exit
trap "rm -rf $TMP_DIR" EXIT

# Helper: call a tool via JSON-RPC over stdio
test_tool() {
	local tool_name="$1"
	local args="$2"
	local description="$3"

	printf "  %-22s %-45s " "$tool_name" "$description"

	local out_file="$TMP_DIR/${tool_name}.json"

	# Build JSON-RPC messages: initialize → initialized notification → call tool
	local init_req='{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
	local init_notify='{"jsonrpc":"2.0","method":"notifications/initialized"}'
	local call_req="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool_name\",\"arguments\":$args}}"

	# Send messages with a sleep to keep stdin open, run in background
	# Must run from project root so CDS commands find the model files
	(
		printf '%s\n%s\n%s\n' "$init_req" "$init_notify" "$call_req"
		sleep 20
	) |
		(cd "$PROJECT_DIR" && node "$MCP_SERVER") >"$out_file" 2>/dev/null &
	local pid=$!

	# Wait for response (poll every 0.5s, max 25s)
	local waited=0
	while [ $waited -lt 50 ]; do
		sleep 0.5
		waited=$((waited + 1))
		# Check if output file has the tool response (id:1)
		if [ -f "$out_file" ] && grep -q '"id":1' "$out_file" 2>/dev/null; then
			break
		fi
		# If process died, stop waiting
		if ! kill -0 $pid 2>/dev/null; then
			break
		fi
	done

	# Kill the background process
	kill $pid 2>/dev/null
	wait $pid 2>/dev/null

	# Parse the tool response (second line = id:1 response)
	if [ ! -f "$out_file" ] || [ ! -s "$out_file" ]; then
		echo "✗ FAIL (no response)"
		FAIL=$((FAIL + 1))
		ERRORS="$ERRORS\n  $tool_name: empty response"
		return
	fi

	# Extract the tool call response line (contains "id":1)
	local response_line
	response_line=$(grep '"id":1' "$out_file" | head -1)

	if [ -z "$response_line" ]; then
		echo "✗ FAIL (no tool response)"
		FAIL=$((FAIL + 1))
		ERRORS="$ERRORS\n  $tool_name: no id:1 response in output"
		return
	fi

	# Validate the response has content (not an error)
	if echo "$response_line" | python3 -c "
import json, sys
resp = json.loads(sys.stdin.read().strip())
result = resp.get('result', {})
content = result.get('content', [])
if content and len(content) > 0:
    text = content[0].get('text', '')
    # Reject error responses
    if text and text.startswith('Error executing'):
        print(text[:80], file=sys.stderr)
        sys.exit(1)
    if text and len(text) > 5:
        sys.exit(0)
if 'error' in resp:
    print(resp['error'].get('message', 'unknown'), file=sys.stderr)
sys.exit(1)
" 2>/tmp/mcp-test-err; then
		echo "✓ PASS"
		PASS=$((PASS + 1))
	else
		local err_msg
		err_msg=$(cat /tmp/mcp-test-err 2>/dev/null)
		echo "✗ FAIL${err_msg:+ ($err_msg)}"
		FAIL=$((FAIL + 1))
		ERRORS="$ERRORS\n  $tool_name: ${err_msg:-no content}"
	fi
}

echo "═══════════════════════════════════════════════════════════"
echo " MCP Server Test Suite — 17 Tools (JSON-RPC over stdio)"
echo " Server: $MCP_SERVER"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── Model Introspection (5 tools) ────────────────────────────
echo "── Model Introspection ──────────────────────────────────"
test_tool "cap_entities" '{}' "List all entities"
test_tool "cap_entity_detail" '{"entity": "Carriers"}' "Carrier entity detail"
test_tool "cap_associations" '{}' "All associations"
test_tool "cap_nav_map" '{}' "Full navigation map"
test_tool "cap_services" '{}' "Service definitions"
echo ""

# ─── Schema & Compilation (2 tools) ──────────────────────────
echo "── Schema & Compilation ─────────────────────────────────"
test_tool "cap_compile" '{"format": "json"}' "Compile to JSON (CSN)"
test_tool "cap_edm" '{}' "Generate OData EDMX"
echo ""

# ─── Data Queries (4 tools) ──────────────────────────────────
echo "── Data Queries ─────────────────────────────────────────"
test_tool "cap_cql_query" '{"sql": "SELECT CARRID, CARRNAME FROM flights_Carriers LIMIT 5"}' "SQL query"
test_tool "cap_data_stats" '{}' "Entity row counts"
test_tool "cap_sample_data" '{"entity": "Carriers", "maxRows": 3}' "Sample rows"
test_tool "cap_db_schema" '{}' "Database schema"
echo ""

# ─── Data Inspection (1 tool) ────────────────────────────────
echo "── Data Inspection ──────────────────────────────────────"
test_tool "cap_csv_inspect" '{}' "List CSV files"
echo ""

# ─── Project Management (4 tools) ────────────────────────────
echo "── Project Management ───────────────────────────────────"
test_tool "cap_project_info" '{}' "Project info"
test_tool "cap_mta_info" '{}' "MTA descriptor"
test_tool "cap_build" '{}' "CDS build (dev)"
test_tool "cap_hana_mapping" '{}' "CDS→HANA mapping"
echo ""

# ─── OData Live Query (1 tool — may fail without cds watch) ──
echo "── OData Live Query ─────────────────────────────────────"
test_tool "cap_query" '{"entity": "Carriers", "top": 3}' "Live OData query (needs cds watch)"
echo ""

# ─── Summary ─────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo " Results: $PASS passed, $FAIL failed (of $((PASS + FAIL)) tools)"
echo "═══════════════════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
	echo ""
	echo "Failures:"
	echo -e "$ERRORS"
	exit 1
fi
