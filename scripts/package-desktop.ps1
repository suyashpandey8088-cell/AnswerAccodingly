$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
& "$Root\scripts\build-backend.ps1"
Set-Location "$Root\apps\desktop"
npm run package
