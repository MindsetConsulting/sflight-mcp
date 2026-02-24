# ─────────────────────────────────────────────────────────────
# Start MCP Server as HTTP/SSE — for Claude for Excel (Windows)
# ─────────────────────────────────────────────────────────────
#
# Wraps the stdio MCP server as an HTTP/SSE endpoint so Claude
# for Excel can connect to it locally — no BTP, no org admin.
#
# Prerequisites:
#   Node.js 18+  https://nodejs.org/
#   Repo cloned and set up:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#
# Usage (from project root):
#   powershell -ExecutionPolicy Bypass -File scripts\start-mcp-sse.ps1
#
#   Optional — custom port:
#   $env:MCP_SSE_PORT=9090; powershell -ExecutionPolicy Bypass -File scripts\start-mcp-sse.ps1
#
# Test (in another PowerShell window):
#   Invoke-WebRequest http://localhost:8080/sse -TimeoutSec 3
#
# Then in claude.ai → Settings → Integrations → Add MCP Server:
#   URL:  http://localhost:8080
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$ProjectDir  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Port        = if ($env:MCP_SSE_PORT) { $env:MCP_SSE_PORT } else { "8080" }
$McpBuild    = Join-Path $ProjectDir "mcp-server\build\index.js"

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  sflight-mcp  MCP Server -> HTTP/SSE  (supergateway)" -ForegroundColor White
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# ── Check Node.js ─────────────────────────────────────────────
try {
    $nodeVer = node -v
    Write-Host "  OK Node.js $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  Node.js not found. Install it: https://nodejs.org/ (v18+)" -ForegroundColor Red
    exit 1
}

# ── Build MCP server if needed ────────────────────────────────
if (-not (Test-Path $McpBuild)) {
    Write-Host "  MCP server not built. Building now..." -ForegroundColor Yellow
    Push-Location (Join-Path $ProjectDir "mcp-server")
    npm install
    npm run build
    Pop-Location
    if (-not (Test-Path $McpBuild)) {
        Write-Host "  FAIL Build failed. Run: cd mcp-server && npm run build" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK MCP server built" -ForegroundColor Green
} else {
    Write-Host "  OK MCP server already built" -ForegroundColor Green
}

# ── Print endpoints and connector instructions ────────────────
Write-Host ""
Write-Host "  Listening on:" -ForegroundColor White
Write-Host "    SSE:    http://localhost:$Port/sse" -ForegroundColor Yellow
Write-Host "    Health: http://localhost:$Port/" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ─── How to register (no org admin needed) ──────────────" -ForegroundColor Cyan
Write-Host "  1. Go to: https://claude.ai" -ForegroundColor White
Write-Host "     Settings -> Integrations -> Add MCP Server" -ForegroundColor White
Write-Host "     URL: http://localhost:$Port" -ForegroundColor Yellow
Write-Host "     (This adds it to YOUR account only - no admin required)" -ForegroundColor Green
Write-Host ""
Write-Host "  2. Open Excel -> Claude add-in -> ask a question:" -ForegroundColor White
Write-Host "     'Which airlines fly to New York?'" -ForegroundColor Yellow
Write-Host "     'Show me the top 5 flights by seat occupancy'" -ForegroundColor Yellow
Write-Host ""
Write-Host "  NOTE: Keep this window open while using Claude for Excel." -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# ── Start supergateway ────────────────────────────────────────
# npx will download supergateway on first run if not installed
$McpCmd = "node `"$McpBuild`""
npx --yes supergateway --stdio $McpCmd --port $Port
