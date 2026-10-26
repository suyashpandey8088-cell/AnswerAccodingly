# QuizPilot AI — Optional Local Companion Architecture

Per **Section 3 (Technical Architecture)** and **Section 8 (Security and Privacy)** of the specification:

- **Standalone Core:** The Chrome Extension Manifest V3 (`extension/`) and Web Dashboard (`src/dashboard/`) operate **100% standalone** without requiring Electron or Python for quiz-page scanning, practice session automation, question-bank persistence, analytics, or PDF/CSV/JSON/Markdown report exports.
- **Least-Privilege Boundary:** The browser extension is never granted unrestricted computer access.
- **Optional Companion Service (`companion/service/`):** A FastAPI + Playwright service bound strictly to `127.0.0.1:8765` with:
  - Origin allowlist enforcement (`chrome-extension://`, `moz-extension://`, `localhost`, `127.0.0.1`)
  - Per-session token verification (`X-QuizPilot-Token`)
  - Request payload cap (`64 KB` -> HTTP `413`)
  - Authorized practice environment validation prior to any Playwright interaction.
- **Optional Desktop Shell (`companion/electron/`):** A hardened Electron wrapper (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) that hosts the dashboard and communicates with the local FastAPI service.
