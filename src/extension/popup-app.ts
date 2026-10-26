import { createAIProvider } from '../core/ai/http-ai';
import { PracticeAutomationEngine } from '../core/automation/engine';
import { PageCompatibilityScan, PracticeSession } from '../core/models/types';
import { escapeHtml } from '../core/security/sanitizer';
import { AnswerSourceManager } from '../core/sources/answer-sources';
import { QuizPilotRepository } from '../core/storage/repository';
import { renderSyntheticQuizDom } from '../quiz-sandbox/quiz-app';
import { DEFAULT_ANSWER_KEY_ENTRIES } from '../quiz-sandbox/synthetic-bank';

const repo = new QuizPilotRepository();
const standaloneEngine = new PracticeAutomationEngine();

export async function bootPopupApp(): Promise<void> {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('popup-root');
  if (!root) return;

  // Ensure default answer keys are seeded so initial run works out of the box
  const existingKeys = await repo.getAnswerKeys();
  if (existingKeys.length === 0) {
    await repo.saveAnswerKeys(DEFAULT_ANSWER_KEY_ENTRIES);
  }

  let currentScan: PageCompatibilityScan | null = null;
  let activeSession: PracticeSession | null = null;
  let statusNotice = 'Ready to inspect authorized practice quiz.';

  async function refreshState(): Promise<void> {
    const sessions = await repo.listSessions();
    if (!activeSession && sessions.length > 0) {
      activeSession = sessions[0];
    }

    // Try querying active Chrome tab content script first if running inside extension popup
    if (typeof chrome !== 'undefined' && chrome.tabs?.query && chrome.tabs?.sendMessage) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (tabId) {
          const response = (await chrome.tabs.sendMessage(tabId, {
            action: 'SCAN_PAGE',
            requestId: `req_${Date.now()}`,
            timestamp: new Date().toISOString()
          })) as { ok?: boolean; scan?: PageCompatibilityScan; activeSession?: PracticeSession };
          if (response?.ok && response.scan) {
            currentScan = response.scan;
            if (response.activeSession) activeSession = response.activeSession;
            renderPopup();
            return;
          }
        }
      } catch {
        // Fallback to local synthetic practice fixture scan when running in standalone web preview
      }
    }

    // Standalone preview fallback: inspect virtual synthetic practice DOM
    const virtualDoc = document.implementation.createHTMLDocument('Synthetic Practice Quiz');
    renderSyntheticQuizDom(virtualDoc, { scenario: 'standard' });
    const settings = await repo.getSettings();
    const { scanQuizDocument } = await import('../core/scanner/dom-scanner');
    currentScan = scanQuizDocument(
      virtualDoc,
      'http://localhost:5173/quiz-lab.html',
      settings.authorizedDomains
    );
    renderPopup();
  }

  function renderPopup(): void {
    if (!root) return;

    const compatBadge = currentScan?.hasSafetyRestriction
      ? `<span class="status-pill pill-danger">Restricted (Safety Halt)</span>`
      : currentScan?.isCompatible
        ? `<span class="status-pill pill-verified">Authorized & Compatible</span>`
        : `<span class="status-pill pill-warn">Incompatible / Unverified</span>`;

    const sessionBadge = activeSession
      ? `<span class="status-pill pill-purple">${escapeHtml(activeSession.status.toUpperCase())}</span>`
      : `<span class="status-pill pill-neutral">IDLE</span>`;

    root.innerHTML = `
      <div class="popup-card">
        <header class="popup-header">
          <div class="brand-row">
            <span class="brand-dot"></span>
            <div>
              <h1 class="popup-title">QuizPilot AI</h1>
              <p class="popup-subtitle">Authorized Practice Quiz Assistant</p>
            </div>
          </div>
          ${sessionBadge}
        </header>

        <section class="popup-section">
          <div class="metric-row">
            <span class="metric-label">Page Compatibility</span>
            ${compatBadge}
          </div>
          <div class="metric-row">
            <span class="metric-label">Target Quiz</span>
            <span class="metric-val">${escapeHtml(currentScan?.quizTitle || 'No Quiz Detected')}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Supported Questions</span>
            <span class="metric-val"><strong>${currentScan?.supportedQuestionCount ?? 0}</strong> supported (${
              currentScan?.unsupportedQuestionCount ?? 0
            } unsupported)</span>
          </div>
          <p class="popup-auth-note">${escapeHtml(currentScan?.authorizationReason || statusNotice)}</p>
        </section>

        <section class="popup-controls" aria-label="Session Controls">
          <button type="button" id="popup-start-btn" class="qp-btn qp-btn-primary">Start Practice Session</button>
          <div class="control-row-3">
            <button type="button" id="popup-pause-btn" class="qp-btn qp-btn-secondary">Pause</button>
            <button type="button" id="popup-resume-btn" class="qp-btn qp-btn-secondary">Resume</button>
            <button type="button" id="popup-stop-btn" class="qp-btn qp-btn-danger">Emergency Stop</button>
          </div>
        </section>

        <section class="popup-section recent-summary">
          <h2 class="section-heading-xs">Recent Session Summary</h2>
          ${
            activeSession
              ? `
            <div class="summary-grid">
              <div><span class="muted">Session:</span> <strong>${escapeHtml(activeSession.title)}</strong></div>
              <div><span class="muted">Processed:</span> <strong>${activeSession.processedQuestionIds.length} / ${activeSession.totalDetectedQuestions}</strong></div>
              <div><span class="muted">Uncertain / AI:</span> <strong>${activeSession.uncertainAnswerCount}</strong></div>
              <div><span class="muted">Recoverable Errors:</span> <strong>${activeSession.recoverableErrorCount}</strong></div>
              <div><span class="muted">Elapsed Time:</span> <strong>${activeSession.elapsedMs} ms</strong></div>
            </div>
          `
              : `<p class="muted">No practice sessions recorded yet. Click "Start Practice Session" to run an authorized session.</p>`
          }
          <p class="status-toast" role="status">${escapeHtml(statusNotice)}</p>
        </section>

        <footer class="popup-footer">
          <a href="/dashboard.html" target="_blank" id="popup-open-dashboard" class="qp-btn qp-btn-secondary full-width">
            Open Full Dashboard & Analytics
          </a>
          <a href="/quiz-lab.html" target="_blank" class="qp-btn qp-btn-ghost full-width">
            Open Synthetic Quiz Test Environment
          </a>
        </footer>
      </div>
    `;

    bindPopupEvents();
  }

  function bindPopupEvents(): void {
    const startBtn = document.getElementById('popup-start-btn');
    const pauseBtn = document.getElementById('popup-pause-btn');
    const resumeBtn = document.getElementById('popup-resume-btn');
    const stopBtn = document.getElementById('popup-stop-btn');

    startBtn?.addEventListener('click', async () => {
      statusNotice = 'Starting authorized practice session...';
      renderPopup();

      // Try active Chrome tab first if inside extension
      if (typeof chrome !== 'undefined' && chrome.tabs?.query && chrome.tabs?.sendMessage) {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tabId = tabs[0]?.id;
          if (tabId) {
            const res = (await chrome.tabs.sendMessage(tabId, {
              action: 'START_SESSION',
              requestId: `req_${Date.now()}`,
              timestamp: new Date().toISOString()
            })) as { ok?: boolean; session?: PracticeSession };
            if (res?.ok && res.session) {
              activeSession = res.session;
              statusNotice = `Session ${res.session.status}: ${res.session.processedQuestionIds.length} questions processed.`;
              renderPopup();
              return;
            }
          }
        } catch {
          // Fall through to standalone synthetic execution
        }
      }

      // Run against synthetic practice DOM and persist to repository
      const virtualDoc = document.implementation.createHTMLDocument('Synthetic Practice Quiz');
      renderSyntheticQuizDom(virtualDoc, { scenario: 'standard' });
      const settings = await repo.getSettings();
      const keys = await repo.getAnswerKeys();
      const aiProvider = createAIProvider(settings.aiProviderMode);
      const sourceManager = new AnswerSourceManager(
        aiProvider,
        keys,
        settings.minConfidenceThreshold
      );

      const result = await standaloneEngine.runPracticeSession({
        doc: virtualDoc,
        url: 'http://localhost:5173/quiz-lab.html',
        settings,
        answerSourceManager: sourceManager,
        aiProvider,
        repository: repo,
        onProgress: (sess) => {
          activeSession = sess;
        }
      });

      activeSession = result.session;
      statusNotice = `Completed "${result.session.title}" — ${result.session.processedQuestionIds.length} questions captured.`;
      renderPopup();
    });

    pauseBtn?.addEventListener('click', () => {
      standaloneEngine.pause();
      activeSession = standaloneEngine.getActiveSession() || activeSession;
      if (activeSession) activeSession.status = 'paused';
      statusNotice = 'Session paused.';
      renderPopup();
    });

    resumeBtn?.addEventListener('click', () => {
      standaloneEngine.resume();
      activeSession = standaloneEngine.getActiveSession() || activeSession;
      if (activeSession) activeSession.status = 'running';
      statusNotice = 'Session resumed.';
      renderPopup();
    });

    stopBtn?.addEventListener('click', () => {
      standaloneEngine.emergencyStop('Emergency Stop clicked in Extension Popup.');
      activeSession = standaloneEngine.getActiveSession() || activeSession;
      if (activeSession) activeSession.status = 'stopped_by_user';
      statusNotice = 'EMERGENCY STOP activated. Automation halted immediately.';
      renderPopup();
    });
  }

  await refreshState();
}
