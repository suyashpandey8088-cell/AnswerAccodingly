# QuizPilot AI

**Intelligent Browser Extension (Chrome Manifest V3), Authorized Practice Quiz Automation Engine, Knowledge Base & Personalized Study Report Platform**

QuizPilot AI is a personal practice-quiz automation and exam-preparation assistant designed exclusively for **authorized practice quizzes, synthetic assessments, and self-study mock examinations**. It inspects supported quiz interfaces, resolves answers across a 4-tier provenance chain (Official Answer Keys, Approved Reference Banks, Instructor Explanations, and AI/Deterministic Candidate Inference), strictly distinguishes verified answers from unverified suggestions or ambiguous items, and generates comprehensive study reports and adaptive preparation schedules.

---

## 1. Architecture & Repository Structure

```text
/home/user/AnswerAccodingly
├── extension/                         # Unpacked Chrome Extension Manifest V3 package
│   ├── manifest.json                  # Least-privilege MV3 manifest (activeTab, scripting, storage)
│   ├── popup.html                     # Extension Popup entry
│   ├── dashboard.html                 # Extension Full Dashboard entry
│   └── assets/                        # Compiled MV3 bundles (service-worker.js, content-script.js, popup.js, dashboard.js)
├── src/
│   ├── core/
│   │   ├── models/types.ts            # 19-field CapturedQuestion schema, PracticeSession, StudyReport, QuizPilotSettings
│   │   ├── security/
│   │   │   ├── sanitizer.ts           # Untrusted DOM sanitizer, script/directive stripper, token/URL scrubber, FNV-1a fingerprinting
│   │   │   ├── authorization.ts       # Practice authorization verifier & CAPTCHA/proctoring/auth-wall halt guard
│   │   │   └── message-validator.ts   # Runtime schema & payload-size validator (<= 256 KB)
│   │   ├── scanner/dom-scanner.ts     # Quiz DOM inspector (single-choice, multi-choice, true/false, text, unsupported, disabled)
│   │   ├── sources/answer-sources.ts  # 4-tier AnswerSourceManager + conflict/ambiguity detection + strict VerificationStatus evaluator
│   │   ├── ai/
│   │   │   ├── provider.ts            # Provider-independent AIAnalysisProvider interface
│   │   │   ├── deterministic-ai.ts    # Standalone Deterministic Analysis Engine (classification, difficulty, clusters, study plan)
│   │   │   ├── mock-ai.ts             # Mock AI Provider for offline development & testing
│   │   │   └── http-ai.ts             # Optional OpenAI-compatible HTTP provider with <untrusted_quiz_data> prompt fencing
│   │   ├── automation/engine.ts       # Authorized practice runner: retries, pacing, max duration, pause/resume/emergency stop, recovery
│   │   ├── storage/repository.ts      # Dual-layer persistence: Chrome Storage API + IndexedDB with idempotent fingerprint deduplication
│   │   └── reporting/
│   │       ├── report-generator.ts    # Verified-only scoring, transparent priority classifier, calibration analytics, study planner
│   │       └── exporters.ts           # Real session exporters: PDF (%PDF-1.4 binary), RFC-4180 CSV, JSON archive, Markdown notes
│   ├── quiz-sandbox/
│   │   ├── synthetic-bank.ts          # Standard 11-question exam, Edge-case fault suite, 60-question bank, Default answer keys
│   │   └── quiz-app.ts                # Interactive Local Synthetic Quiz Website controller
│   ├── extension/
│   │   ├── service-worker.ts          # MV3 background service worker
│   │   ├── content-script.ts          # MV3 content script + floating in-page Emergency Stop HUD
│   │   └── popup-app.ts               # Extension Popup UI controller
│   └── dashboard/
│       ├── dashboard-app.ts           # Full 8-section interactive Dashboard & Study Planner
│       └── styles.css                 # Dark-first theme with restrained purple accents (#8b5cf6) and WCAG AA/AAA contrast
├── companion/                         # Optional Local Companion Application (never required for core extension operation)
│   ├── service/                       # Python + FastAPI + Playwright local automation service (127.0.0.1:8765)
│   └── electron/                      # Hardened Electron desktop wrapper (contextIsolation: true, nodeIntegration: false, sandbox: true)
├── reports/                           # Sample report artifacts generated from actual synthetic test execution
│   ├── sample-session-report.md
│   ├── sample-question-bank.csv
│   ├── sample-session-archive.json
│   └── sample-session-report.pdf
├── docs/                              # Architecture, Installation, Security Review, Store Checklists & AI Roadmap
└── tests/                             # Automated Unit & Browser/DOM Integration Tests (Vitest + jsdom + fake-indexeddb)
```

---

## 2. Deliverables Index

| # | Deliverable | Location in Repository | Verification Status |
| :---: | :--- | :--- | :--- |
| 1 | Complete source-code repository | Root (`/home/user/AnswerAccodingly`) | Verified (`npm run typecheck && npm run build`) |
| 2 | Working Chrome extension for authorized practice testing | `extension/` (`manifest.json` + `extension/assets/`) | Built & verified via `npm run build:extension` |
| 3 | Local synthetic quiz test environment | `quiz-lab.html` & `src/quiz-sandbox/` | Verified across 5 scenarios (Standard, Edge-Cases, 60Q Bank, Graded Refusal, CAPTCHA Halt) |
| 4 | Question-bank and report-generation system | `src/core/storage/repository.ts` & `src/core/reporting/` | Verified in `tests/unit/reporting-and-exports.test.ts` |
| 5 | Functioning 8-section dashboard with persistent data | `dashboard.html` & `src/dashboard/dashboard-app.ts` | Live & interactive across all 8 required sections |
| 6 | Automated unit and integration tests | `tests/unit/*.test.ts`, `tests/integration/*.test.ts`, `companion/service/tests/` | **22/22 Vitest tests passing** + **6/6 FastAPI Pytest tests passing** |
| 7 | Sample report generated from actual synthetic test data | `reports/sample-session-report.{md,pdf}`, `sample-question-bank.csv`, `sample-session-archive.json` | Generated via `npm run generate:report` |
| 8 | Installation and setup instructions | `docs/INSTALLATION_AND_USAGE.md` | Complete |
| 9 | Security and privacy review | `docs/SECURITY_AND_PRIVACY.md` | Complete |
| 10 | Firefox compatibility assessment & AMO checklist | `docs/FIREFOX_COMPATIBILITY.md` | Complete |
| 11 | Chrome Web Store publishing checklist | `docs/CHROME_WEB_STORE_CHECKLIST.md` | Complete |
| 12 | Prioritized roadmap for future AI features | `docs/AI_ROADMAP.md` | Complete |

---

## 3. Core Engineering & Safety Guarantees

1. **Strict Separation of Verified vs. Unverified Answers:**
   - Questions are labeled `verified_correct` or `verified_incorrect` **only** when an authoritative `official_key` or verified in-quiz `official_feedback` establishes correctness.
   - Candidate answers from instructor notes, reference banks without an official grading key, or AI inference are labeled `ai_suggested` or `uncertain`.
   - Conflicting or ambiguous answer keys are automatically detected and flagged as `uncertain`.
2. **Honest Verified-Only Scoring:**
   - Performance scores (`verifiedScorePercent`) use **only** verified questions in the denominator, explicitly documenting how many unverified/uncertain items were excluded. When zero verified questions exist, the score is `null` rather than invented.
3. **Authorized Practice Enforcement & Immediate Safety Halts:**
   - Unattended automation is restricted to pages with explicit practice authorization (`data-quizpilot-authorized="true"` or `data-quiz-mode="practice"`).
   - Detection of CAPTCHA challenges, proctoring overlays, live graded exam markers (`data-exam-mode="graded-live"`), or login walls triggers an immediate `stopped_safety_restriction` halt.
4. **Idempotent Session Recovery:**
   - Every captured question is fingerprinted (`computeQuestionFingerprint`) and upserted by `(sessionId, fingerprint)`, guaranteeing that resuming an interrupted session never duplicates questions.

---

## 4. Quick Start & Commands

```bash
# Install dependencies
npm install

# Run TypeScript typecheck
npm run typecheck

# Run all 22 automated unit & integration tests
npm test

# Build Chrome Extension Manifest V3 (./extension) and Web Bundle (./dist)
npm run build

# Regenerate sample report artifacts in ./reports/ from a real synthetic run
npm run generate:report

# Start the live development server on port 5173
npm run dev
```
