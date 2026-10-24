$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$VersionCheck = "import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] < (3, 14) else 1)"
$Python = $env:QUIZPILOT_PYTHON
$PythonArgs = @()

if (-not $Python -and (Get-Command py -ErrorAction SilentlyContinue)) {
  foreach ($Version in @("3.12", "3.13", "3.11")) {
    & py "-$Version" -c $VersionCheck 2>$null
    if ($LASTEXITCODE -eq 0) {
      $Python = "py"
      $PythonArgs = @("-$Version")
      break
    }
  }
}
if (-not $Python -and (Get-Command python -ErrorAction SilentlyContinue)) { $Python = "python" }
if (-not $Python) { throw "Python 3.11, 3.12, or 3.13 is required. Install 64-bit Python 3.12 from python.org." }

& $Python @PythonArgs -c $VersionCheck
if ($LASTEXITCODE -ne 0) {
  throw "Unsupported Python. QuizPilot requires Python >=3.11 and <3.14; install 64-bit Python 3.12. Python 3.14 cannot use the pinned NumPy/Pillow wheels."
}

if (Test-Path ".venv\Scripts\python.exe") {
  & ".venv\Scripts\python.exe" -c $VersionCheck 2>$null
  if ($LASTEXITCODE -ne 0) {
    $Backup = ".venv-unsupported-$(Get-Date -Format yyyyMMddHHmmss)"
    Write-Host "Preserving the unsupported virtual environment as $Backup"
    Rename-Item -Path ".venv" -NewName $Backup
  }
}
if (-not (Test-Path ".venv\Scripts\python.exe")) { & $Python @PythonArgs -m venv .venv }
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }
& ".venv\Scripts\python.exe" -m pip install -r apps/backend/requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed" }
Set-Location apps/desktop
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed" }
Set-Location $Root
& ".venv\Scripts\python.exe" -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium installation failed" }
if (-not (Get-Command tesseract -ErrorAction SilentlyContinue)) {
  Write-Host "Tesseract not found: browser QA works, Windows Desktop Autopilot requires Tesseract OCR."
}
Write-Host "Setup complete. Run: powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1"
