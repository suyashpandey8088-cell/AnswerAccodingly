# QuizPilot AI

Local desktop QA automation for **developer-owned or explicitly authorized quiz environments**. QuizPilot inspects a visible quiz, normalizes each question, solves without reading the verification oracle, interacts with the UI, observes the result, and stores assertion and latency evidence.

> **MVP honesty:** the browser workflow and React dashboard are verified in this workspace. Electron main/preload compile and their security tests pass, but the Electron binary could not be downloaded in this sandbox, so the native shell and installer were not launched here. Live Windows UIA/OCR has mocked/headless coverage only; a physical Windows target has not been verified. Real Docker and live LLM calls are opt-in and were not executed.

## What works

- FastAPI + Pydantic + SQLAlchemy + SQLite backend with incremental per-question persistence.
- Electron main-process backend lifecycle, random local session token, health wait, graceful shutdown, fixed IPC bridge, context isolation, disabled Node integration, and sandboxed renderer.
- React + TypeScript + Vite + Tailwind + Radix dialog primitives + Lucide + Recharts + React Query.
- Visible Playwright Chromium by default; stable `data-qa` selectors; operation and feedback deadlines; navigation/request target revalidation; cleanup.
- MCQ, multi-select, arithmetic, logic, text, and deterministic demo programming solutions. Optional structured OpenAI-compatible LLM responses with bounded retries.
- Timer states `present`, `absent`, `failed`, and `uncertain`; unreadable input never becomes zero seconds.
- Separate extraction, solving, selection, submission, feedback, independent correctness, and navigation assertions.
- Managed background runs, bounded concurrency, hard deadlines, failure thresholds, real cancellation, SSE updates, and interrupted-run recovery.
- Overview, project CRUD/configuration, live runs, result search/filter/sort, report charts, JSON/CSV export, and capability settings.
- Local demo with normal, delayed, incorrect-feedback, missing-element, and timeout scenarios.
- Dedicated **zero-calibration Windows Desktop Autopilot** for authorized native apps: visible-window picker, Windows UI Automation with OCR fallback, dynamic question/option/input/Submit/Next/completion detection, and hands-free navigation after one run confirmation.
- Automatic safety stops for uncertain extraction, duplicate answers, unsupported UI, stale questions, focus/target loss, out-of-window controls, repeated desktop questions, unverified navigation, timeouts, failure thresholds, question limits, and deadlines. No guessed coordinates or OS-permission bypass.
- Opt-in Docker Python sandbox with network disabled, CPU/memory/PID limits, read-only filesystem, dropped capabilities, wall timeout, and named-container cleanup.

## Verification status — 2026-10-24

| Check | Actual result |
|---|---|
| Current backend headless-safe tests | **69 passed, 6 skipped**; includes mocked live UIA/OCR analysis, stale-question/control refusal, duplicate-answer and timeout stops, legacy Windows focus/bounds, and autonomous lifecycle coverage |
| Current Electron lifecycle/preload/IPC tests | **4 passed**, including single-flight backend startup |
| Current TypeScript + production build | Renderer and Electron main/preload builds passed; npm audit reported **0 vulnerabilities** |
| Current real Chromium integration | **Not rerun in this fresh sandbox** because Chromium download hosts are blocked. The merged baseline previously passed all 4 real-browser tests and the six-question demo |
| Windows graphical Autopilot | **Not verified on a physical Windows desktop**; live UIA/OCR analysis, window safety and loop behavior have mocked/headless tests only |
| Docker sandbox | Mocked command/timeout/isolation tests passed; no real Docker execution claimed |
| LLM provider | Mocked transport/validation tests passed; no live provider call claimed |
| Native Electron launch / installer | **Not verified here**; Electron binary asset host inaccessible, and this Python lacks shared `libpython` for PyInstaller |

## Quick start

### Requirements

- Python **3.11, 3.12, or 3.13** (3.12 recommended), with `venv` and pip. **Python 3.14 is not supported by the pinned NumPy/Pillow wheels.** Setup selects a supported interpreter and preserves an unsupported old `.venv` under a timestamped backup name.
- Node.js **22.12+** and npm 10+.
- A graphical desktop for normal visible Chromium and desktop input.
- For Windows live Autopilot, the pinned `pywinauto` and `PyGetWindow` dependencies (installed by the requirements on Windows). Tesseract is needed for OCR fallback and legacy calibrated projects, not for UIA-only capture.
- Docker only for generated-code execution. No hosted account or LLM key is required for the demo.

Native packaging additionally requires a Python shared development library (for example `libpython3.11-dev`/`libpython3.12-dev` on Debian/Ubuntu) and network access to Electron release assets on the first npm install.

### Linux / macOS

```bash
git clone https://github.com/suyashpandey8088-cell/AnswerAccodingly.git
cd AnswerAccodingly
./scripts/setup-dev
./scripts/start-dev
```

`setup-dev` creates `.venv`, installs pinned Python/npm dependencies, and runs `playwright install chromium`. `start-dev` starts Vite and Electron; Electron starts and health-checks Python itself.

For a browser-only development preview instead of Electron:

```bash
./scripts/start-web
# Open http://127.0.0.1:5173
```

The script generates a random API token for that session and shuts Python down with the renderer.

### Windows PowerShell

```powershell
git clone https://github.com/suyashpandey8088-cell/AnswerAccodingly.git
cd AnswerAccodingly
powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1
```

Use `scripts/run-tests.ps1`, `scripts/build-backend.ps1`, and `scripts/package-desktop.ps1` for the other workflows. Only build a Windows installer on Windows, a macOS bundle on macOS, and a Linux AppImage on Linux.

### OCR installation

- **Ubuntu/Debian:** `sudo apt-get install tesseract-ocr`
- **macOS:** `brew install tesseract`
- **Windows:** install a maintained Tesseract distribution and add its executable to `PATH`.

Desktop automation may also require OS screen-recording/accessibility permission. QuizPilot never bypasses those prompts.

## Windows Desktop Autopilot

Use this workflow only with a native Windows quiz application you own or are explicitly authorized to automate. It provides unattended execution **after one validated run confirmation**, not unrestricted control of other applications.

For arbitrary questions, configure an OpenAI-compatible provider locally before launching Electron:

```powershell
$env:QUIZPILOT_LLM_API_KEY = "your-local-secret"
$env:QUIZPILOT_LLM_BASE_URL = "https://api.openai.com/v1"
$env:QUIZPILOT_LLM_MODEL = "your-model-identifier"
powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1
```

Never commit the key or paste it into project JSON. The deterministic solver remains useful for supported local fixtures but cannot solve arbitrary questions.

1. Open the authorized native quiz app and keep its question window visible and restored.
2. Open **Desktop Autopilot**. There is no calibration form and no X/Y/width/height entry.
3. Select the window in **Select the authorized window**. Duplicate titles are rejected; use **Refresh windows** after opening or restoring the app.
4. Confirm that you own the application or have explicit automation permission, then choose **Start live Autopilot** once.
5. Watch the persisted live run. Cancel remains available; no further approval prompts occur during that run.

The zero-form workflow uses bounded defaults: at most 25 questions, a 15-minute hard deadline, and a three-failure stop. The advanced project editor can change legacy/project settings, but screen regions are not used in `live` capture mode.

On every screen, the adapter uses Windows UI Automation first and OCR fallback inside the same authorized window. It detects question text, radio/checkbox/list or button options, a single text/code input, enabled Submit/Next controls, timers, feedback, and completion markers. OCR fallback requires clearly readable option labels prefixed `A`–`F` or `1`–`6`; unlabelled custom-drawn/canvas answers and ambiguous multi-editor screens stop as unsupported. UIA/OCR support is not universal and must be tested with your own application.

Before input, the adapter re-reads the question, uniquely rematches the intended control, verifies the current foreground window and bounds, and maps answer text to the actual control rather than a position. Text/code answers replace the detected editor contents with Ctrl+A and clipboard paste; the existing clipboard is not read. The adapter stops on low-confidence extraction, duplicate answer labels, missing controls, stale questions, focus/target loss, out-of-window controls, repeated questions, failed navigation, timeouts, failure thresholds, or the question limit. Applications that advance without answer feedback remain correctness-`unknown`, not automatically passed or failed.

AI answers are not guaranteed correct. Without an independent oracle, successful clicking/submission remains distinct from verified correctness. This workflow does not bypass proctoring, monitoring, OS permissions, or assessment rules.

## Run the local demo

1. Open **Projects → New project**. The local demo configuration is pre-filled.
2. Keep **Run browser headlessly unchecked** to watch Chromium. It is checked only in display-less CI.
3. Keep the **Local demo independent oracle** selected. It is used only after solving, never supplied as a solver answer sheet.
4. Save, then choose **Validate & start run**.
5. Review target/dependency checks and explicitly confirm visible actions.
6. Watch **Live run**, then inspect **Results** and **Reports**.

The fixture is served by the same loopback backend at `/demo/` and includes six question types. Programming correctness remains `unknown` while the sandbox is disabled; successful code entry/submission does not count as correctness.

To test failure handling, change **Demo behavior** in project configuration:

- `normal`: standard workflow, including a delayed arithmetic response.
- `delayed`: longer feedback delay.
- `incorrect_feedback`: application feedback disagrees with independent evidence; the disagreement is recorded for investigation.
- `missing_element`: the second question loses its options and produces an extraction error.
- `timeout`: feedback never arrives before the configured deadline.

## Tests

```bash
# Headless-safe backend + Electron type/preload tests
./scripts/run-tests

# Real Chromium integration (after playwright install chromium)
QUIZPILOT_RUN_BROWSER=1 ./scripts/run-tests

# Direct commands
.venv/bin/pytest apps/backend/tests -q
.venv/bin/pytest apps/backend/tests/test_browser_integration.py --run-browser -q
cd apps/desktop && npm run typecheck && npm test && npm run build
```

Graphical desktop and real Docker tests are explicit opt-ins and are not silently run in CI:

```bash
.venv/bin/pytest apps/backend/tests --run-desktop
.venv/bin/pytest apps/backend/tests --run-sandbox
```

The legacy graphical smoke test still requires an operator-provided calibrated fixture. Live Windows Autopilot additionally needs a manual smoke test against your visible UIA/OCR-compatible application; mocked tests do not prove native control compatibility. The Docker test requires `QUIZPILOT_SANDBOX_ENABLED=true`, Docker, and a locally available `python:3.12-alpine` image; QuizPilot does not pull an image automatically.

## Configuration

Copy `.env.example` to `.env` only for manual backend development. **Do not commit `.env`.** Electron generates its own random token and does not use a hardcoded credential.

Common variables:

- `QUIZPILOT_API_TOKEN`: required local API session token for separately launched backend/web development.
- `QUIZPILOT_TARGET_ALLOWLIST`: default `localhost,127.0.0.1,::1`.
- `QUIZPILOT_ALLOW_NON_LOCAL_TARGETS`: default `false`; even when enabled, only allowlisted public global IPs are accepted, not private/metadata addresses.
- `QUIZPILOT_BROWSER_EXECUTABLE_PATH`: optional custom Chromium binary.
- `QUIZPILOT_LLM_API_KEY`, `QUIZPILOT_LLM_BASE_URL`, `QUIZPILOT_LLM_MODEL`: optional provider settings.
- `QUIZPILOT_SANDBOX_ENABLED`, `QUIZPILOT_SANDBOX_IMAGE`, `QUIZPILOT_SANDBOX_TIMEOUT_SECONDS`: opt-in isolation settings.

To initialize SQLite manually, starting the backend is sufficient; reliable MVP schema creation runs at startup. There are no destructive migrations in this initial schema. Alembic should be introduced before destructive schema changes.

```bash
cd apps/backend
../../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

The API binds to loopback by default. Do not expose it directly to a public interface.

## Repository structure

```text
apps/
  backend/
    app/
      api/                 # projects, runs, system, errors
      adapters/            # shared interface, browser, live UIA/OCR, legacy calibrated desktop
      metrics/             # medians, p95, stage aggregates
      models/              # Project, TestRun, QuestionResult, AssertionResult
      reports/             # reports, CSV/JSON, overview
      sandbox/             # execution interface + Docker implementation
      schemas/             # domain, project, run contracts
      services/            # runner, repository, policy, normalization, verification
      solvers/             # deterministic, structured LLM, orchestration
    tests/                 # unit + separately marked integration tests
    run.py                 # packaged backend entry point
    quizpilot-backend.spec # PyInstaller one-folder strategy
  desktop/
    src/main/              # window, backend lifecycle, validated IPC
    src/preload/           # minimal typed contextBridge API
    renderer/src/
      api/                 # authenticated API/SSE clients and formatting
      components/          # accessible UI, forms, tables, detail dialogs
      hooks/               # live events and elapsed time
      pages/               # overview through settings
fixtures/
  browser-quiz/            # local demo + independent verification oracles
  coding-tests/
  desktop-fixtures/
scripts/                   # POSIX and PowerShell setup/test/build workflows
reports/                   # generated artifacts are ignored
```

## API

`GET /health` is public and contains no secrets. Every `/api` endpoint requires `X-QuizPilot-Token` (or bearer authentication). State-changing requests also enforce allowed origins; CORS is not authentication.

Implemented routes: project CRUD and `POST /api/projects/{id}/validate`; run create/list/detail/cancel; `GET /api/runs/{id}/events` (SSE); report and `?format=json|csv` export; overview, system capability status, and authenticated `GET /api/system/windows` visible-window enumeration. Request validation errors use a consistent `{"error":{"code","message","details"}}` shape and list endpoints paginate.

### Status meanings

- `pending`: persisted but execution has not begun.
- `running`: managed execution is active.
- `passed`: every required assertion passed, including independent correctness when required.
- `failed`: at least one required assertion failed.
- `timeout`: a configured stage/run deadline expired.
- `error`: extraction, solver, interaction, submission, verification, or infrastructure error.
- `unknown`: evidence is insufficient—for example no correctness oracle, uncertain OCR, or unsupported sandbox.
- `skipped`: deliberately not executed.
- `cancelled`: run-level only; the operator cancelled a managed task.

A generated or submitted answer alone is never a verified pass.

## Metrics

Timings use `time.perf_counter()` around independent stages. Browser startup is recorded separately from question interaction. Unmeasured values remain `null`, not zero. Median uses `statistics.median`; p95 uses linear interpolation at rank `(n - 1) × 0.95`, equivalent to the common NumPy linear method. Reports are recomputed from stored question/assertion records.

## Security assumptions

- Default targets are loopback only. Initial URLs, requests, final URLs, and navigation are checked against hostname allowlist, DNS results, protocol, and IP policy. Keep non-local targets disabled unless you also enforce network-level egress controls.
- No stealth, fingerprint manipulation, monitoring evasion, arbitrary shell actions, credential storage, or OS-permission bypass is implemented.
- Renderer navigation/new windows are restricted. The preload has no generic IPC or filesystem methods.
- API keys and sensitive prompts are not logged. Question text needed for QA reports is persisted; cookies/passwords/arbitrary page content are not captured.
- Desktop actions require a configured target, project authorization, and immediate run confirmation. Live Windows mode requires a unique visible window, dynamic control rematching, verified foreground focus, and current-window bounds before every click; only legacy `calibrated` projects use operator regions.
- Generated code never runs in the FastAPI process. Without explicit Docker isolation it receives `unsupported`, not a pretend pass.

## Build a native package

First satisfy the shared-Python prerequisite, then run:

```bash
# Linux/macOS
./scripts/package-desktop

# Or separately
./scripts/build-backend
cd apps/desktop && npm run package
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-desktop.ps1
```

Outputs are written to `apps/desktop/release/`. electron-builder includes the compiled renderer/main/preload, one-folder Python backend, Playwright runtime, and demo resources. SQLite is stored in Electron's OS user-data directory. Chromium, Tesseract, Docker, and runtime images remain separate prerequisites; they are not silently bundled or downloaded at runtime.

**Current packaging limitation:** this sandbox could not download Electron and has no `libpython3.11.so`, so no installer is claimed as built or production-ready. A normal connected development machine with Python development libraries can run the commands above. Test the resulting installer on each target OS before distribution.

## Troubleshooting

- **Backend unavailable:** run setup, confirm Python 3.11–3.13, and inspect the Electron error dialog. Early Python exits now include sanitized backend output. Port 8765 is preferred; Electron selects a free loopback port if occupied.
- **NumPy tries to compile / Python 3.14:** install 64-bit Python 3.12 and rerun `scripts/setup-dev.ps1`. The script selects a supported interpreter and renames an incompatible `.venv` to a timestamped backup instead of compiling incompatible pinned packages.
- **Chromium unavailable:** run `.venv/bin/python -m playwright install chromium` (or the Windows equivalent). A custom binary can be configured through the environment.
- **401 responses in web development:** use `scripts/start-web`; it shares a freshly generated token between Vite and Python. Do not put tokens in URLs.
- **Linux PyInstaller `PythonLibraryNotFoundError`:** install the development/shared Python package appropriate to your Python version, then rebuild.
- **Live Windows runtime unavailable / no windows listed:** run the backend on Windows, rerun the pinned setup to install `pywinauto`/`PyGetWindow`, restore the authorized app, and choose **Refresh windows**. Install Tesseract only if OCR fallback is needed.
- **Live question or answer controls are unsupported:** use a UIA-accessible native control or readable OCR options prefixed `A`–`F`/`1`–`6`. The run stops rather than guessing coordinates; no calibration fallback is silently selected.
- **Programming result is unknown:** this is expected until Docker isolation and independent tests are available.
- **Unexpected target rejection:** check the exact hostname allowlist and resolved IP. QuizPilot does not fall back to another URL or application.
