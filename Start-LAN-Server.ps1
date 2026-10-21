[CmdletBinding()]
param(
    [int]$Port = 8787,
    [string]$BindAddress = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "RoadRush LAN Server"

if (-not (Test-Path -LiteralPath ".\server.bundle.mjs")) {
    Write-Host ""
    Write-Host "  server.bundle.mjs was not found next to this script." -ForegroundColor Red
    Write-Host "  Extract the complete LANServer folder and try again."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host ""
    Write-Host "  Node.js was not found." -ForegroundColor Red
    Write-Host "  Install Node.js 24 LTS or newer from https://nodejs.org/ and try again."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

$version = (& node -p "process.versions.node").Trim()
$major = [int]($version.Split(".")[0])
if ($major -lt 24) {
    Write-Host ""
    Write-Host "  Node.js $version is too old. RoadRush LAN needs Node.js 24 or newer." -ForegroundColor Red
    Write-Host "  Install the current Node.js LTS from https://nodejs.org/ and try again."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host ""
Write-Host "  Starting RoadRush LAN server with Node.js $version ..." -ForegroundColor Cyan
Write-Host "  Keep this window open while your friends are racing."
Write-Host "  Press Ctrl+C to stop the server."
Write-Host ""

& node ".\server.bundle.mjs" --port $Port --host $BindAddress
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "  The server stopped with exit code $exitCode." -ForegroundColor Red
    Write-Host "  Check the messages above, then try again."
    Write-Host ""
    Read-Host "Press Enter to close"
}

exit $exitCode
