$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
& ".venv\Scripts\pip.exe" install -r apps/backend/requirements-build.txt
Set-Location apps/backend
& "$Root\.venv\Scripts\pyinstaller.exe" --clean --noconfirm quizpilot-backend.spec
Write-Host "Bundled backend created at apps/backend/dist/quizpilot-backend"
