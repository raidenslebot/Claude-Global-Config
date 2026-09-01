<#
.SYNOPSIS
  Bootstrap the Claude global config on Windows.

.DESCRIPTION
  Everything real happens in tools/install.mjs — this wrapper exists only to guarantee a
  Node runtime is present first, because a fresh Claude Desktop install does not ship one
  (Claude Code now uses a native binary, not npm).

.EXAMPLE
  .\install.ps1
  .\install.ps1 -DryRun
  .\install.ps1 -Yes -SkipLibrary
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Yes,          # do not prompt before installing Node
  [switch]$SkipLibrary,  # skip cloning the Tier-3 skill library
  [switch]$SkipNpm
)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($m) { Write-Host "  $m" }
function Write-Ok($m)   { Write-Host "  ok    $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  warn  $m" -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "  FAIL  $m" -ForegroundColor Red }

Write-Host "`nClaude Global Config - Windows bootstrap" -ForegroundColor Cyan
Write-Host "  repo $Repo`n"

# ── Node ────────────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeOk = $false
if ($node) {
  $v = (& node --version) -replace '^v', ''
  $major = [int]($v -split '\.')[0]
  if ($major -ge 20) { Write-Ok "node $v"; $nodeOk = $true }
  else { Write-Warn "node $v is too old - need 20 or newer" }
}

if (-not $nodeOk) {
  Write-Warn 'Node 20+ is required and was not found.'
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    $go = $Yes
    if (-not $go) {
      $ans = Read-Host '  Install Node LTS now via winget? [y/N]'
      $go = $ans -match '^[Yy]'
    }
    if ($go) {
      Write-Step 'Installing OpenJS.NodeJS.LTS via winget...'
      winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
      # winget updates the machine PATH but not this already-running shell.
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                  [Environment]::GetEnvironmentVariable('Path', 'User')
      $node = Get-Command node -ErrorAction SilentlyContinue
      if ($node) { Write-Ok "node $((& node --version))" }
      else {
        Write-Err 'Node still not on PATH. Close this window, open a new terminal, and re-run.'
        exit 1
      }
    } else {
      Write-Err 'Cannot continue without Node. Install it from https://nodejs.org and re-run.'
      exit 1
    }
  } else {
    Write-Err 'winget is unavailable. Install Node 20+ from https://nodejs.org and re-run.'
    exit 1
  }
}

# ── Git (optional: only the Tier-3 library needs it) ────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Warn 'git not found - the Tier-3 skill library cannot be cloned. Everything else still installs.'
  Write-Warn 'Get it from https://git-scm.com/download/win, then re-run with -Only library.'
}

# ── Hand off ────────────────────────────────────────────────────────────────
$argv = @()
if ($DryRun)      { $argv += '--dry-run' }
if ($SkipLibrary) { $argv += '--skip-library' }
if ($SkipNpm)     { $argv += '--skip-npm' }

& node (Join-Path $Repo 'tools\install.mjs') @argv
$code = $LASTEXITCODE
if ($code -ne 0) { Write-Err "install.mjs exited $code"; exit $code }

Write-Host "`nVerify with:" -ForegroundColor Cyan
Write-Host "  node `"$(Join-Path $Repo 'tools\doctor.mjs')`"`n"
