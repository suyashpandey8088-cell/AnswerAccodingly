# QuizPilot AI — Security Review, Threat Model & Privacy Policy

## 1. Least-Privilege Browser Extension Architecture

- **Minimal Manifest V3 Permissions:** `extension/manifest.json` requests only `["activeTab", "scripting", "storage"]` and restricts default `host_permissions` to `http://localhost/*` and `http://127.0.0.1/*`. It does **not** request `<all_urls>`, `cookies`, `webRequest`, `history`, or `tabs` blanket access.
- **Strict Content Security Policy (CSP):** Extension pages enforce `"script-src 'self'; object-src 'self'; base-uri 'self';"`. Remote code execution, inline script injection, and `eval()` are blocked.

## 2. Authorization & Anti-Abuse Safeguards

QuizPilot AI is strictly designed for **authorized practice quizzes, synthetic assessments, and self-study mock examinations**:

1. **Explicit Practice Verification (`src/core/security/authorization.ts`):**
   - Automation requires explicit practice markers (`data-quizpilot-authorized="true"`, `data-quiz-mode="practice"`, or `<meta name="quizpilot-practice" content="true">`) or an explicitly allowlisted domain with verified practice headings.
2. **Immediate Halt on Proctoring, CAPTCHA, or Authentication Walls:**
   - If the scanner detects CAPTCHA widgets (`.g-recaptcha`, `.h-captcha`, `.cf-turnstile`, `[data-captcha="true"]`), proctoring indicators (`[data-proctoring="active"]`, `[data-exam-mode="graded-live"]`), or active password/login walls (`input[type="password"]`), automation halts immediately with status `stopped_safety_restriction`.
   - QuizPilot AI never attempts to bypass CAPTCHA, proctoring, or access controls.
3. **Visible Automation Status & Emergency Stop:**
   - Every active session displays a prominent status indicator and a 1-click **Emergency Stop** button in the in-page floating HUD, the extension popup, and the dashboard top bar.

## 3. Untrusted Input Sanitization & Prompt-Injection Defense

All content extracted from web pages is treated as **untrusted data**:

- **HTML & Script Stripping (`src/core/security/sanitizer.ts`):** `sanitizeUntrustedText()` strips `<script>`, `<style>`, `<iframe>`, `<object>`, and control characters prior to storage, and `escapeHtml()` encodes all dynamic strings before rendering in the dashboard.
- **Prompt-Injection Filtering:** Known instruction-override phrases (`ignore previous instructions`, `system prompt override`) are neutralized in extracted DOM text, and `ConfigurableHttpAIProvider` wraps extracted quiz data inside `<untrusted_quiz_data>...</untrusted_quiz_data>` XML delimiters with a system prompt instructing the model never to execute instructions inside the data block.
- **Credential & Token Redaction:** `redactSensitiveTokens()` and `sanitizeReferenceUrl()` automatically redact Bearer tokens, JWTs (`eyJ...`), API secret keys (`sk-...`), password assignments, cookies, and URL query parameters (`access_token`, `sessionid`, `jwt`, `key`).

## 4. Inter-Component Message & Local Companion Security

- **Message Validation (`src/core/security/message-validator.ts`):** Every message exchanged between popup, content script, and service worker is validated against an explicit action allowlist and a `256 KB` payload size ceiling.
- **Local Companion Hardening (`companion/service/app/main.py`):**
  - Binds exclusively to `127.0.0.1:8765`.
  - Validates the HTTP `Origin` header (`403 Forbidden` for any external website attempting cross-origin calls to localhost).
  - Requires the `X-QuizPilot-Token` header (`401 Unauthorized` if missing or invalid).
  - Enforces a `64 KB` request body limit (`413 Payload Too Large`).

## 5. Privacy Policy & Data Retention

- **Local-First Storage:** All sessions, captured questions, answer keys, and study reports are stored locally in the user's browser via `chrome.storage.local` and `IndexedDB` (`QuizPilotKnowledgeBaseDB`).
- **Zero Silent Uploads:** QuizPilot AI never transmits page content, quiz questions, or telemetry to external servers unless the user explicitly configures an optional custom AI endpoint.
- **User Data Controls:** In **Section 8 (Settings & Privacy)** of the dashboard, users can:
  1. Export all personal data as a portable `.json` archive.
  2. Delete any individual practice session and its associated questions.
  3. Permanently wipe all stored data across `IndexedDB` and `chrome.storage.local`.
