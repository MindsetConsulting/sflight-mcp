#!/bin/bash
# ─────────────────────────────────────────────────────────────
# OAuth2 / JWT Authentication Test — BTP XSUAA
# ─────────────────────────────────────────────────────────────
#
# Tests the OAuth2 client_credentials flow against the deployed
# BTP service. Reads credentials from default-env.json.
#
# Prerequisites:
#   - default-env.json with XSUAA credentials (from cf env)
#   - BTP apps running (cf start sflights-mcp-srv sflights-mcp-approuter)
#   - jq installed (brew install jq)
#
# Usage:
#   bash test/auth-test.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/default-env.json"

# ─── Check prerequisites ─────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
	echo "ERROR: default-env.json not found."
	echo "  Run: cf env sflights-mcp-srv > default-env.json"
	echo "  Or:  cds bind --to sflights-mcp-db:sflights-mcp-db"
	exit 1
fi

if ! command -v jq &>/dev/null; then
	echo "ERROR: jq is required. Install with: brew install jq"
	exit 1
fi

# ─── Extract XSUAA credentials ───────────────────────────────
TOKEN_URL=$(jq -r '.VCAP_SERVICES.xsuaa[0].credentials.url' "$ENV_FILE")
CLIENT_ID=$(jq -r '.VCAP_SERVICES.xsuaa[0].credentials.clientid' "$ENV_FILE")
CLIENT_SECRET=$(jq -r '.VCAP_SERVICES.xsuaa[0].credentials.clientsecret' "$ENV_FILE")

APPROUTER_URL="https://0ef2ec95trial-dev-sflights-mcp-approuter.cfapps.us10-001.hana.ondemand.com"
SRV_URL="https://0ef2ec95trial-dev-sflights-mcp-srv.cfapps.us10-001.hana.ondemand.com"

echo "═══════════════════════════════════════════════════════════"
echo " OAuth2 Authentication Test"
echo " Token URL: $TOKEN_URL"
echo " Client ID: $CLIENT_ID"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Get JWT token ────────────────────────────────────
echo "── Step 1: Requesting JWT token (client_credentials) ────"

TOKEN_RESPONSE=$(curl -s -X POST "$TOKEN_URL/oauth/token" \
	-H "Content-Type: application/x-www-form-urlencoded" \
	-d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')

if [ -z "$TOKEN" ]; then
	echo "  ✗ FAIL — could not get token"
	echo "  Response: $(echo "$TOKEN_RESPONSE" | jq -r '.error_description // .error // "unknown error"')"
	echo ""
	echo "  Troubleshooting:"
	echo "    - Are the XSUAA credentials current? Re-run: cf env sflights-mcp-srv"
	echo "    - Is the BTP trial account active?"
	exit 1
fi

EXPIRES_IN=$(echo "$TOKEN_RESPONSE" | jq -r '.expires_in')
echo "  ✓ Token received (expires in ${EXPIRES_IN}s)"
echo "  Token (first 50 chars): ${TOKEN:0:50}..."
echo ""

# ─── Step 2: Call OData via approuter ─────────────────────────
echo "── Step 2: Calling OData via approuter ──────────────────"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
	-H "Authorization: Bearer $TOKEN" \
	"$APPROUTER_URL/odata/v4/flights/Carriers?\$top=3")

if [ "$HTTP_CODE" = "200" ]; then
	echo "  ✓ Approuter: HTTP $HTTP_CODE"
	CARRIERS=$(curl -s -H "Authorization: Bearer $TOKEN" "$APPROUTER_URL/odata/v4/flights/Carriers?\$top=3")
	echo "  Sample: $(echo "$CARRIERS" | jq -r '.value[0] | "\(.CARRID) - \(.CARRNAME)"' 2>/dev/null || echo "could not parse")"
else
	echo "  ✗ Approuter: HTTP $HTTP_CODE"
	echo "    Is the approuter running? Check: cf app sflights-mcp-approuter"
fi
echo ""

# ─── Step 3: Call OData directly on srv ───────────────────────
echo "── Step 3: Calling OData directly on srv ────────────────"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
	-H "Authorization: Bearer $TOKEN" \
	"$SRV_URL/odata/v4/flights/\$metadata")

if [ "$HTTP_CODE" = "200" ]; then
	echo "  ✓ Srv direct: HTTP $HTTP_CODE (metadata accessible)"
elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
	echo "  ⚠ Srv direct: HTTP $HTTP_CODE (auth required — expected if auth enforced)"
else
	echo "  ✗ Srv direct: HTTP $HTTP_CODE"
	echo "    Is the srv running? Check: cf app sflights-mcp-srv"
fi
echo ""

# ─── Summary ─────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo " Test complete. Token valid for ${EXPIRES_IN}s."
echo ""
echo " Useful commands:"
echo "   # Start apps:"
echo "   cf start sflights-mcp-srv"
echo "   cf start sflights-mcp-approuter"
echo ""
echo "   # Call with token:"
echo "   curl -H \"Authorization: Bearer \$TOKEN\" \\"
echo "     \"$APPROUTER_URL/odata/v4/flights/Carriers\""
echo "═══════════════════════════════════════════════════════════"
