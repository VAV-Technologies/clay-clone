# agent-x installer (PowerShell). Pipe-installable:
#   irm https://dataflow-pi.vercel.app/cli/install.ps1 | iex
#
# Env overrides:
#   $env:DATAFLOW_BASE_URL    default https://dataflow-pi.vercel.app
#   $env:AGENT_X_INSTALL_DIR  default $env:USERPROFILE\.local\bin

$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:DATAFLOW_BASE_URL) { $env:DATAFLOW_BASE_URL } else { 'https://dataflow-pi.vercel.app' }
$BinUrl  = "$BaseUrl/cli/agent-x"
$BinDir  = if ($env:AGENT_X_INSTALL_DIR) { $env:AGENT_X_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.local\bin' }
$JsPath  = Join-Path $BinDir 'agent-x.mjs'
$CmdPath = Join-Path $BinDir 'agent-x.cmd'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'error: agent-x needs Node.js (>=18). Install Node and re-run.' -ForegroundColor Red
    exit 1
}

$nodeVersion = (node -p 'process.versions.node').Trim()
$nodeMajor = [int]($nodeVersion -split '\.' | Select-Object -First 1)
if ($nodeMajor -lt 18) {
    Write-Host "error: agent-x needs Node.js >= 18 (found v$nodeVersion)" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

Write-Host "downloading $BinUrl"
Invoke-WebRequest -UseBasicParsing -Uri $BinUrl -OutFile $JsPath

# Windows shim — .cmd that invokes node on the .mjs
@"
@echo off
node "%~dp0agent-x.mjs" %*
"@ | Set-Content -Encoding ascii -Path $CmdPath

Write-Host "installed: $CmdPath" -ForegroundColor Green

# Configure the API key if it was provided inline (e.g. $env:DATAFLOW_API_KEY='...'; irm ... | iex).
# PATH may not be live in this session yet, so invoke the freshly downloaded script by path.
$KeyConfigured = $false
if ($env:DATAFLOW_API_KEY) {
    node $JsPath set-key $env:DATAFLOW_API_KEY | Out-Null
    Write-Host 'configured API key' -ForegroundColor Green
    $KeyConfigured = $true
}

# Install the global Claude Code skill so Claude becomes Agent X in any folder on this device.
try {
    $SkillDir = Join-Path $env:USERPROFILE '.claude\skills\dataflow'
    New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/cli/dataflow-skill.md" -OutFile (Join-Path $SkillDir 'SKILL.md')
    Write-Host 'installed Claude Code skill: dataflow' -ForegroundColor Green
} catch {
    Write-Host "note: could not install the dataflow Claude Code skill ($($_.Exception.Message))" -ForegroundColor Yellow
}

$pathParts = $env:Path -split ';'
if (-not ($pathParts -contains $BinDir)) {
    Write-Host ''
    Write-Host "note: $BinDir is not on `$env:Path." -ForegroundColor Yellow
    Write-Host 'add it permanently with:'
    Write-Host "  setx PATH `"%PATH%;$BinDir`""
    Write-Host 'or for this session only:'
    Write-Host "  `$env:Path += `";$BinDir`""
}

Write-Host ''
if ($KeyConfigured) {
    Write-Host 'ready - open Claude Code in any folder and describe your campaign.' -ForegroundColor Green
    Write-Host '  e.g. "find me 500 manufacturing CFOs in Vietnam and get their emails"'
    Write-Host '  or try a quick read:  agent-x api GET /api/projects'
} else {
    Write-Host 'next steps:'
    Write-Host '  agent-x set-key <DATAFLOW_API_KEY>'
    Write-Host '  agent-x docs                              # rules + API spec'
    Write-Host '  agent-x api GET /api/projects             # try a quick read'
}
