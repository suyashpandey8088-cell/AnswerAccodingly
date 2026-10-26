# QuizPilot AI — Installation, Setup & Testing Guide

## 1. Prerequisites

- **Node.js:** v20.x or v22.x+ and `npm` v10+
- **Browser:** Google Chrome, Chromium, Microsoft Edge, or Brave (for loading the Manifest V3 unpacked extension)
- **Python (Optional):** Python 3.11+ (only required if running the optional local FastAPI companion service)

---

## 2. Quick Start (Core Extension, Dashboard & Synthetic Quiz Website)

```bash
# 1. Install dependencies
npm install

# 2. Run TypeScript typechecking and build both the Chrome Extension (./extension) and Web App (./dist)
npm run typecheck
npm run build

# 3. Generate sample report artifacts (.md, .csv, .json, .pdf) from a synthetic test run
npm run generate:report

# 4. Start the local development server (serves Dashboard, Popup view, and Synthetic Quiz Website)
npm run dev
```

Once `npm run dev` is running on `http://localhost:5173`:

- **Full 8-Section Dashboard:** `http://localhost:5173/dashboard.html` (or `http://localhost:5173/`)
- **Local Synthetic Quiz Test Environment:** `http://localhost:5173/quiz-lab.html`
- **Standalone Extension Popup View:** `http://localhost:5173/popup.html`

---

## 3. Loading the Chrome Extension (Manifest V3)

1. Run `npm run build:extension` to ensure `./extension/assets/` is up to date.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `/home/user/AnswerAccodingly/extension` directory.
5. Open `http://localhost:5173/quiz-lab.html` in a tab and click the **QuizPilot AI** extension icon in the toolbar to inspect the page, start an authorized practice session, pause/resume/emergency-stop, or open the full dashboard.

---

## 4. Running Automated Tests

### TypeScript Unit & Browser/DOM Integration Tests (Vitest + jsdom + fake-indexeddb)

```bash
npm test
```

This runs 5 test suites (22 tests) covering:
- DOM question scanning & authorization checks (`tests/unit/scanner.test.ts`)
- 4-tier answer sources, ambiguous key detection & AI classification (`tests/unit/sources-and-ai.test.ts`)
- Verified-only scoring, priority classification & PDF/CSV/JSON/Markdown exports (`tests/unit/reporting-and-exports.test.ts`)
- Untrusted input sanitization, token redaction, message validation & IndexedDB deduplication (`tests/unit/security-and-storage.test.ts`)
- Full practice automation lifecycle, fault recovery, emergency stop, and unauthorized exam refusal (`tests/integration/automation-lifecycle.test.ts`)

### Optional Python Companion Service Tests (FastAPI + Pytest)

```bash
python3 -m venv .venv
.venv/bin/pip install -r companion/service/requirements.txt
PYTHONPATH=companion/service .venv/bin/pytest companion/service/tests/test_companion_api.py
```
