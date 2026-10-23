$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
& ".venv\Scripts\pytest.exe" apps/backend/tests -q
if ($env:QUIZPILOT_RUN_BROWSER -eq "1") {
  & ".venv\Scripts\pytest.exe" apps/backend/tests/test_browser_integration.py --run-browser -q
}
Set-Location apps/desktop
npm run typecheck
npm test
