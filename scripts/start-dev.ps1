$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not (Test-Path "$Root\.venv\Scripts\python.exe") -or -not (Test-Path "$Root\apps\desktop\node_modules")) {
  throw "Run scripts/setup-dev.ps1 first."
}
$env:QUIZPILOT_PYTHON = "$Root\.venv\Scripts\python.exe"
Set-Location "$Root\apps\desktop"
npm run dev
