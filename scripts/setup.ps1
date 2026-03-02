# ─────────────────────────────────────────────────────────────
# sflight-mcp — One-Shot Setup (Windows PowerShell)
# ─────────────────────────────────────────────────────────────
# Run this after cloning. It installs everything, builds the
# MCP server, creates the .mcp.json config, and tells you
# what to do next.
#
# Usage (from project root):
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  sflight-mcp - One-Shot Setup (Windows)" -ForegroundColor White
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectDir

# -- Step 0: Check prerequisites ──────────────────────────────

Write-Host "Checking prerequisites..." -ForegroundColor Yellow

try {
    $nodeVersion = (node -v) -replace 'v', ''
    $major = [int]($nodeVersion.Split('.')[0])
    if ($major -lt 18) {
        Write-Host "  Node.js v18+ required. Current: v$nodeVersion" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK Node.js v$nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  Node.js not found. Install it: https://nodejs.org/ (v18+)" -ForegroundColor Red
    exit 1
}

try {
    $null = cds version 2>$null
    Write-Host "  OK @sap/cds-dk installed" -ForegroundColor Green
} catch {
    Write-Host "  @sap/cds-dk not found. Installing globally..." -ForegroundColor Yellow
    npm install -g @sap/cds-dk
    Write-Host "  OK @sap/cds-dk installed" -ForegroundColor Green
}

# -- Step 1: Install root dependencies ────────────────────────

Write-Host ""
Write-Host "Step 1/3: Installing project dependencies..." -ForegroundColor Yellow
npm install
Write-Host "  OK Root dependencies installed" -ForegroundColor Green

# -- Step 2: Build MCP server ─────────────────────────────────

Write-Host ""
Write-Host "Step 2/3: Building MCP server..." -ForegroundColor Yellow
Push-Location mcp-server
npm install
npm run build
Pop-Location

$mcpBuild = Join-Path $ProjectDir "mcp-server\build\index.js"
if (Test-Path $mcpBuild) {
    Write-Host "  OK MCP server built (19 tools ready)" -ForegroundColor Green
} else {
    Write-Host "  FAIL MCP server build failed" -ForegroundColor Red
    exit 1
}

# -- Step 3: Create .mcp.json ─────────────────────────────────

Write-Host ""
Write-Host "Step 3/3: Creating .mcp.json (MCP configuration)..." -ForegroundColor Yellow

# Use forward slashes for Node.js compatibility
$mcpPath = $mcpBuild -replace '\\', '/'

$mcpConfig = @"
{
  "mcpServers": {
    "cap-tools": {
      "command": "node",
      "args": ["$mcpPath"]
    }
  }
}
"@

$mcpConfig | Out-File -FilePath (Join-Path $ProjectDir ".mcp.json") -Encoding utf8
Write-Host "  OK .mcp.json created" -ForegroundColor Green

# -- Done ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  What to do next:" -ForegroundColor White
Write-Host ""
Write-Host "  Demo 1: OData Service" -ForegroundColor Cyan
Write-Host "    cds watch"
Write-Host "    # Open http://localhost:4004"
Write-Host ""
Write-Host "  Demo 2: Claude Code (AI Queries)" -ForegroundColor Cyan
Write-Host "    npm install -g @anthropic-ai/claude-code  # one-time" -ForegroundColor White
Write-Host "    NOTE: Claude Code requires WSL2 on Windows." -ForegroundColor Yellow
Write-Host "    In WSL2 terminal:" -ForegroundColor Yellow
Write-Host "    claude"
Write-Host "    # Ask: 'Which airlines fly to London?'"
Write-Host ""
Write-Host "  Demo 3: Claude for Excel" -ForegroundColor Cyan
Write-Host "    Once deployed to BTP, register the /mcp endpoint"
Write-Host "    in Claude org settings -> Connectors"
Write-Host ""
