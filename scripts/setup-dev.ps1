$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$Python = if ($env:QUIZPILOT_PYTHON) { $env:QUIZPILOT_PYTHON } else { "python" }
& $Python -c "import sys; assert sys.version_info >= (3, 11), 'Python 3.11 or newer is required'"
if (-not (Test-Path ".venv\Scripts\python.exe")) { & $Python -m venv .venv }
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\pip.exe" install -r apps/backend/requirements.txt
Set-Location apps/desktop
npm ci
Set-Location $Root
& ".venv\Scripts\playwright.exe" install chromium
if (-not (Get-Command tesseract -ErrorAction SilentlyContinue)) {
  Write-Host "Tesseract not found: browser QA works, desktop OCR remains unavailable."
}
Write-Host "Setup complete. Run: powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1"
