# QuizPilot AI — Chrome Web Store Publishing Checklist

## 1. Technical & Manifest V3 Compliance

- [x] **Manifest Version 3 (`manifest_version: 3`):** Verified in `extension/manifest.json`.
- [x] **Self-Contained Code Bundle:** All JavaScript and CSS assets (`extension/assets/*.js`, `extension/assets/styles.css`) are bundled locally via `npm run build:extension`. Zero remotely hosted scripts, CDNs, or dynamic `eval()` calls.
- [x] **Single Purpose Policy:** Single, clearly defined purpose: *"Personal practice quiz inspection, question-bank capture, performance analytics, and personalized study report generation for authorized practice assessments."*

## 2. Permission Justifications (Chrome Developer Dashboard)

- **`activeTab`:** Required so the extension inspects the currently open practice quiz tab only when the user explicitly interacts with the extension popup or starts a practice session.
- **`scripting`:** Required to communicate with the authorized practice quiz DOM to highlight status and inspect question containers.
- **`storage`:** Required to store user settings, pacing configuration, and active session status locally on the user's device.
- **`host_permissions` (`http://localhost/*`, `http://127.0.0.1/*`):** Used for local synthetic practice quiz environments and developer self-assessment servers.

## 3. Privacy & Data Usage Disclosures

- [x] **No Sale of User Data:** Declared compliant with Chrome Web Store Limited Use policy.
- [x] **Local-First Persistence:** Disclose that captured practice questions and study reports remain in local `IndexedDB` and `chrome.storage.local`.
- [x] **Credential & Token Exclusion:** Automated sanitization (`src/core/security/sanitizer.ts`) strips authentication tokens, passwords, and session query parameters before storage.
- [x] **Academic Integrity Safeguards:** Document in the store listing that QuizPilot AI refuses proctored or live graded assessments and immediately halts upon detecting CAPTCHA or authentication walls.

## 4. Store Listing Assets & Packaging Steps

1. Run `npm test && npm run build:extension`.
2. Verify `extension/manifest.json`, `extension/popup.html`, `extension/dashboard.html`, and `extension/assets/`.
3. Create the submission archive:
   ```bash
   cd extension && zip -r ../quizpilot-ai-chrome-mv3.zip .
   ```
4. Upload `quizpilot-ai-chrome-mv3.zip` to the Chrome Web Store Developer Console alongside screenshots of the Extension Popup, the 8-section Full Dashboard, and the Synthetic Quiz Test Environment.
