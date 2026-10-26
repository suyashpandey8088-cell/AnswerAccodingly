# QuizPilot AI — Firefox Compatibility Assessment & AMO Publishing Checklist

## 1. Compatibility Assessment (Firefox Manifest V3)

QuizPilot AI's extension code (`src/extension/*` and `extension/manifest.json`) is designed using standard WebExtensions APIs supported by **Firefox 128+ (ESR and Release)**:

| Component / API | Chrome MV3 | Firefox MV3 (128+) | Compatibility Status |
| :--- | :--- | :--- | :--- |
| `manifest_version: 3` | Supported | Supported | Compatible |
| `permissions: ["activeTab", "scripting", "storage"]` | Supported | Supported | 100% Compatible |
| `chrome.storage.local` (Promise API) | Supported | Supported (`browser.storage.local` & `chrome.storage.local`) | 100% Compatible |
| `IndexedDB` (`QuizPilotKnowledgeBaseDB`) | Supported | Supported | 100% Compatible |
| `background` script / service worker | `"service_worker": "assets/service-worker.js"` | Firefox MV3 prefers `"scripts": ["assets/service-worker.js"]` alongside `"service_worker"` | Add `browser_specific_settings.gecko` & `"scripts"` array for Firefox build |
| `options_ui` (`dashboard.html`) | Supported | Supported | 100% Compatible |
| Content Security Policy (`extension_pages`) | Supported | Supported | 100% Compatible |

### Required Manifest Addition for Firefox Packaging

When packaging for Firefox Add-ons (AMO), add the following block to `extension/manifest.json`:

```json
{
  "background": {
    "service_worker": "assets/service-worker.js",
    "scripts": ["assets/service-worker.js"],
    "type": "module"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "quizpilot-ai@authorized-practice.local",
      "strict_min_version": "128.0"
    }
  }
}
```

---

## 2. Mozilla Add-ons (AMO) Publishing Checklist

- [x] **No Obfuscated or Minified-Only Source:** Provide the full repository (`package.json`, `src/`, `scripts/build-extension.mjs`) as the AMO source code submission package alongside the built `.zip`.
- [x] **Exact Reproducible Build Instructions:** Document `npm install && npm run build:extension` on Node.js 22 LTS for AMO human reviewers.
- [x] **Least-Privilege Permissions Justification:** Document why `activeTab`, `scripting`, and `storage` are needed (user-initiated practice quiz inspection and local study bank persistence).
- [x] **No Remote Script Execution:** Confirm all scripts (`service-worker.js`, `content-script.js`, `popup.js`, `dashboard.js`) are bundled locally inside `extension/assets/`.
- [x] **Data Collection Disclosure:** Declare that all data is stored locally in `IndexedDB` / `storage.local` by default, with user-controlled deletion in Settings & Privacy.
