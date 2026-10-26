# QuizPilot AI — Technical Architecture, Data Model & Implementation Log

## 1. System Architecture

QuizPilot AI is architected around a **standalone Chrome Extension Manifest V3 core** with an integrated **8-section Study & Analytics Dashboard**, a **Local Synthetic Quiz Test Environment**, and an **Optional Local Companion Service** (`FastAPI` + `Playwright` / `Electron`).

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                   Authorized Practice Quiz Web Page                        │
│        (data-quizpilot-authorized="true" / data-quiz-mode="practice")       │
└───────────────┬───────────────────────────────────────────▲────────────────┘
                │ DOM Inspection & Sanitization             │ Bounded DOM Actions
                ▼                                           │ + In-Page Stop HUD
┌────────────────────────────────────────────────────────────────────────────┐
│            MV3 Content Script (src/extension/content-script.ts)            │
│  • Authorization & Safety Verifier (refuses graded exams, CAPTCHA, auth)   │
│  • DOM Question Scanner (Single, Multi, True/False, Text, Unsupported)     │
│  • PracticeAutomationEngine (Bounded retries, pacing, pause/resume/stop)   │
└───────────────┬───────────────────────────────────────────▲────────────────┘
                │ Validated JSON Messages (<= 256 KB)       │
                ▼                                           │
┌────────────────────────────────────────────────────────────────────────────┐
│       MV3 Background Service Worker (src/extension/service-worker.ts)      │
│  • Lifecycle & Action Badge Coordinator (RUN / PAUS / DONE / STOP)         │
│  • Dual-Layer Persistence Sync (chrome.storage.local + IndexedDB)          │
│  • Optional Local Companion Bridge (127.0.0.1:8765 with token + origin)    │
└───────────────┬───────────────────────────────────────────┬────────────────┘
                │                                           │
                ▼                                           ▼
┌───────────────────────────────────────┐   ┌────────────────────────────────┐
│   Extension Popup (popup.html)        │   │ 8-Section Dashboard & Planner  │
│  • Page Compatibility & Question Cnt  │   │  1. Overview                   │
│  • Start / Pause / Resume / Stop      │   │  2. Practice Sessions & Logs   │
│  • Recent Session Summary             │   │  3. Question Bank (Search/Sort)│
│  • Open Full Dashboard                │   │  4. Important Questions        │
└───────────────────────────────────────┘   │  5. Performance Analytics      │
                                            │  6. Personalized Study Planner │
                                            │  7. Reports & Exports (4 fmts) │
                                            │  8. Settings & Privacy         │
                                            └────────────────────────────────┘
```

## 2. Knowledge Base Data Model (`CapturedQuestion`)

Every captured question in `src/core/models/types.ts` stores all 19 required fields:

| Field | Type | Description |
| :--- | :--- | :--- |
| `sessionId` | `string` | Unique identifier of the practice session |
| `questionId` | `string` | Sanitized DOM question identifier |
| `fingerprint` | `string` | Deterministic FNV-1a hash (`qf_...`) of normalized prompt + options for deduplication |
| `questionText` | `string` | Sanitized question prompt (scripts, directives, and secrets stripped) |
| `questionType` | `QuestionType` | `'single_choice' \| 'multiple_choice' \| 'true_false' \| 'text_input' \| 'unsupported'` |
| `options` | `QuestionOption[]` | Normalized selectable options (`id`, `label`, `text`, `disabled`) |
| `selectedResponse` | `string[]` | Selected option ID(s) or entered text |
| `officialCorrectAnswer` | `string[] \| null` | Populated **only** when established by an official key or official feedback; otherwise `null` |
| `aiProposedAnswer` | `string[] \| null` | Candidate response proposed by the AI/deterministic analyzer |
| `explanation` | `string` | Official explanation or evidence summary |
| `verificationStatus` | `VerificationStatus` | `'verified_correct' \| 'verified_incorrect' \| 'ai_suggested' \| 'uncertain' \| 'unanswered' \| 'unsupported'` |
| `answerSource` | `AnswerSourceType` | `'official_key' \| 'official_feedback' \| 'approved_bank' \| 'instructor_note' \| 'ai_inference' \| 'none'` |
| `confidenceScore` | `number` | Numeric confidence (`0.0` to `1.0`) |
| `subject` | `string` | Academic subject classification |
| `topic` / `subtopic` | `string` | Granular topic and subtopic classification |
| `difficulty` / `difficultyScore` | `DifficultyLevel` / `number` | `'easy' \| 'medium' \| 'hard'` and numeric complexity (`1.0`–`10.0`) |
| `timeSpentMs` | `number` | Processing & interaction time in milliseconds |
| `errorCategory` | `ErrorCategory` | Diagnostic category (`'none' \| 'conceptual_gap' \| 'partial_multi_select' \| 'ambiguous_source' \| ...`) |
| `sourceMetadata` | `SourceMetadata` | Sanitized reference URL, domain, quiz title, authorization mode, and source provenance |
| `timestamp` | `string` | ISO-8601 capture timestamp |

## 3. Stage-by-Stage Implementation Log & Remaining Limitations

- **Stage 1 (Environment & Project Structure):** Emptied legacy repository files per user request; established strict TypeScript, Vite, Vitest, esbuild, and Python FastAPI workspace.
- **Stage 2 (Manifest V3 Extension & Synthetic Quiz Fixture):** Implemented `extension/manifest.json` with least-privilege permissions (`activeTab`, `scripting`, `storage`), background service worker, content script, popup, and the multi-scenario Synthetic Quiz Website (`quiz-lab.html`).
- **Stage 3 (Question Scanner & Validation Engine):** Built `scanQuizDocument` and `inspectQuestionContainer` in `src/core/scanner/dom-scanner.ts` supporting single-choice, multiple-choice, true/false, text input, missing-option detection, disabled control detection, and proctoring/CAPTCHA halts.
- **Stage 4 (Authorized Practice-Test Runner):** Implemented `PracticeAutomationEngine` in `src/core/automation/engine.ts` with 4-tier answer resolution (`AnswerSourceManager`), bounded retries, configurable step pacing, maximum duration enforcement, and immediate Pause/Resume/Emergency Stop controls.
- **Stage 5 (Question-Bank Persistence & Session Recovery):** Implemented `QuizPilotRepository` (`src/core/storage/repository.ts`) using Chrome Storage API + IndexedDB with idempotent `(sessionId, fingerprint)` upserts so interrupted session recovery never duplicates questions.
- **Stage 6 (Dashboard & Analytics):** Built the dark-first, purple-accented 8-section dashboard (`src/dashboard/dashboard-app.ts` & `src/dashboard/styles.css`) with search, topic/difficulty/status filters, sortable columns, and real-time session execution.
- **Stage 7 (Report Generation & Exports):** Built `generateStudyReport` (`src/core/reporting/report-generator.ts`) and `src/core/reporting/exporters.ts` generating real PDF (`%PDF-1.4` binary), RFC-4180 CSV, JSON archive, and Markdown revision notes.
- **Stage 8 (AI Provider Integration & Study Planner):** Implemented `AIAnalysisProvider`, `DeterministicAnalysisProvider`, `MockAIProvider`, and `ConfigurableHttpAIProvider` with untrusted-input XML fencing and adaptive study scheduling.
- **Stage 9 (Security Review & Automated Tests):** Verified 22/22 Vitest unit & integration tests (`npm test`) and 6/6 FastAPI companion security tests (`pytest`).
- **Stage 10 (Documentation & Publishing Checklists):** Completed installation guide, security/privacy review, Firefox compatibility assessment, Chrome Web Store checklist, and AI roadmap.

### Known Engineering Limitations
1. **Canvas / Drag-and-Drop / Audio Questions:** Questions rendered exclusively inside `<canvas>` or complex drag-and-drop matrices are detected and logged as `unsupported` rather than automated via fragile pixel coordinate guessing.
2. **PDF Typography:** The built-in zero-dependency binary PDF generator uses standard PDF Type1 Helvetica (`%PDF-1.4`) for universal offline portability; complex non-ASCII mathematical glyphs are normalized to ASCII in PDF output while preserved verbatim in Markdown, JSON, and CSV exports.
