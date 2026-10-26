import { createAIProvider } from '../core/ai/http-ai';
import { PracticeAutomationEngine } from '../core/automation/engine';
import { scanQuizDocument } from '../core/scanner/dom-scanner';
import { escapeHtml } from '../core/security/sanitizer';
import { AnswerSourceManager } from '../core/sources/answer-sources';
import { QuizPilotRepository } from '../core/storage/repository';
import {
  DEFAULT_ANSWER_KEY_ENTRIES,
  EDGE_CASE_FAULT_QUESTIONS,
  generateLargeSyntheticQuestionSet,
  STANDARD_PRACTICE_QUESTIONS,
  SyntheticQuizQuestion
} from './synthetic-bank';

export type SyntheticQuizScenario =
  | 'standard'
  | 'edge_cases'
  | 'large_bank'
  | 'unauthorized_graded'
  | 'captcha_challenge';

export interface RenderSyntheticQuizOptions {
  scenario: SyntheticQuizScenario;
  simulateLoadingState?: boolean;
  simulateBrokenNextButton?: boolean;
}

/**
 * Renders the synthetic quiz fixture into the provided Document (works in both browser and jsdom tests).
 */
export function renderSyntheticQuizDom(
  doc: Document,
  options: RenderSyntheticQuizOptions = { scenario: 'standard' }
): void {
  const { scenario, simulateLoadingState = false, simulateBrokenNextButton = false } = options;

  doc.documentElement.removeAttribute('data-quizpilot-authorized');
  doc.documentElement.removeAttribute('data-quiz-mode');
  doc.body.innerHTML = '';

  let questions: SyntheticQuizQuestion[] = STANDARD_PRACTICE_QUESTIONS;
  let quizTitle = 'CS-402 Distributed Systems & Security — Authorized Practice Exam';

  if (scenario === 'edge_cases') {
    questions = EDGE_CASE_FAULT_QUESTIONS;
    quizTitle = 'QuizPilot Edge-Case & Fault Resilience Regression Suite';
  } else if (scenario === 'large_bank') {
    questions = generateLargeSyntheticQuestionSet(60);
    quizTitle = 'Comprehensive 60-Question Systems Engineering Mock Assessment';
  } else if (scenario === 'unauthorized_graded') {
    questions = STANDARD_PRACTICE_QUESTIONS.slice(0, 4);
    quizTitle = 'CS-402 Live Graded Midterm Examination (Automation Prohibited)';
  } else if (scenario === 'captcha_challenge') {
    questions = STANDARD_PRACTICE_QUESTIONS.slice(0, 4);
    quizTitle = 'Practice Quiz with Active CAPTCHA / Proctoring Challenge';
  }

  if (scenario !== 'unauthorized_graded' && scenario !== 'captcha_challenge') {
    doc.documentElement.setAttribute('data-quizpilot-authorized', 'true');
    doc.documentElement.setAttribute('data-quiz-mode', 'practice');
  }

  const safetyBannerHtml =
    scenario === 'unauthorized_graded'
      ? `<div data-exam-mode="graded-live" data-automation-policy="prohibited" class="qp-alert qp-alert-danger">
           <strong>LIVE GRADED ASSESSMENT:</strong> Unattended automation is prohibited on this page.
         </div>`
      : scenario === 'captcha_challenge'
        ? `<div class="g-recaptcha" data-captcha="true">
             <strong>Security Challenge (CAPTCHA):</strong> Complete human verification to proceed.
           </div>`
        : `<div class="qp-alert qp-alert-authorized">
             <strong>Authorized Practice Mode Active:</strong> <code>data-quizpilot-authorized="true"</code> — Safe for QuizPilot AI inspection and automation.
           </div>`;

  const loadingBannerHtml = simulateLoadingState
    ? `<div id="quiz-loading-indicator" data-quiz-loading="true" class="qp-loading-banner">
         <span>Simulating transient network delay...</span>
         <button type="button" data-retry-network="true" id="resolve-loading-btn">Retry Connection</button>
       </div>`
    : '';

  const questionCardsHtml = questions
    .map((q, idx) => renderQuestionCardHtml(q, idx + 1))
    .join('\n');

  doc.body.innerHTML = `
    <div class="quiz-lab-shell">
      <header class="quiz-lab-header">
        <div class="quiz-lab-brand">
          <span class="brand-dot"></span>
          <h1 data-quiz-title="true">${escapeHtml(quizTitle)}</h1>
        </div>
        <div class="quiz-lab-nav-links">
          <a href="/dashboard.html" class="qp-btn qp-btn-secondary">Open Full Dashboard</a>
          <a href="/popup.html" class="qp-btn qp-btn-ghost">Open Extension Popup View</a>
        </div>
      </header>

      <section class="quiz-lab-controls" aria-label="QuizPilot Sandbox Controls">
        <div class="scenario-bar">
          <label for="scenario-selector"><strong>Synthetic Test Scenario:</strong></label>
          <select id="scenario-selector" class="qp-select">
            <option value="standard" ${scenario === 'standard' ? 'selected' : ''}>Standard Practice Quiz (11 Questions: All Types + Ambiguous Key)</option>
            <option value="edge_cases" ${scenario === 'edge_cases' ? 'selected' : ''}>Edge-Case Fault Suite (Missing Options, Disabled Controls, Duplicates, Canvas)</option>
            <option value="large_bank" ${scenario === 'large_bank' ? 'selected' : ''}>Large Question Bank Stress Test (60 Questions)</option>
            <option value="unauthorized_graded" ${scenario === 'unauthorized_graded' ? 'selected' : ''}>Unauthorized Live Graded Assessment (Safety Refusal Test)</option>
            <option value="captcha_challenge" ${scenario === 'captcha_challenge' ? 'selected' : ''}>CAPTCHA / Anti-Bot Challenge (Immediate Safety Halt Test)</option>
          </select>
          <button type="button" id="hud-scan-btn" class="qp-btn qp-btn-secondary">Inspect Page</button>
          <button type="button" id="hud-start-btn" class="qp-btn qp-btn-primary">Start Authorized Automation</button>
          <button type="button" id="hud-pause-btn" class="qp-btn qp-btn-ghost">Pause</button>
          <button type="button" id="hud-resume-btn" class="qp-btn qp-btn-ghost">Resume</button>
          <button type="button" id="hud-stop-btn" class="qp-btn qp-btn-danger">Emergency Stop</button>
        </div>
        <div id="hud-status-bar" class="hud-status-bar" role="status" aria-live="polite">
          Status: Ready — Select a scenario and click "Inspect Page" or "Start Authorized Automation".
        </div>
      </section>

      ${safetyBannerHtml}
      ${loadingBannerHtml}

      <main id="quiz-questions-container" class="quiz-questions-list">
        ${questionCardsHtml}
      </main>

      <footer class="quiz-navigation-footer">
        <button type="button" data-quiz-nav="prev" class="qp-btn qp-btn-ghost">Previous Question</button>
        <button type="button" data-quiz-nav="review" class="qp-btn qp-btn-ghost">Mark for Review</button>
        <button type="button" data-quiz-nav="next" id="quiz-next-btn" ${
          simulateBrokenNextButton ? 'data-broken-nav="true"' : 'data-nav-exhausted="true"'
        } class="qp-btn qp-btn-secondary">Next Section</button>
        <button type="button" data-quiz-nav="submit" id="quiz-submit-btn" class="qp-btn qp-btn-primary">Submit Practice Assessment</button>
      </footer>
    </div>
  `;

  attachQuizDomInteractions(doc, questions);
}

function renderQuestionCardHtml(q: SyntheticQuizQuestion, number: number): string {
  const unsupportedAttr = q.unsupportedLayoutReason
    ? `data-unsupported-layout="${escapeHtml(q.unsupportedLayoutReason)}"`
    : '';

  let controlsHtml = '';
  if (q.questionType === 'unsupported') {
    controlsHtml = `
      <div class="unsupported-widget-placeholder">
        <canvas width="360" height="80"></canvas>
        <p class="muted-note">Interactive WebGL / Canvas diagram widget (unsupported by standard DOM form automation).</p>
      </div>
    `;
  } else if (q.questionType === 'text_input') {
    controlsHtml = `
      <div class="quiz-text-input-wrap">
        <input
          type="text"
          name="${escapeHtml(q.questionId)}"
          placeholder="Type your answer..."
          class="qp-input"
          ${q.initiallyDisabled ? 'disabled' : ''}
        />
      </div>
    `;
  } else {
    const inputType = q.questionType === 'multiple_choice' ? 'checkbox' : 'radio';
    controlsHtml = `
      <div class="quiz-options-list">
        ${q.options
          .map(
            (opt) => `
          <label class="quiz-option" data-option-id="${escapeHtml(opt.id)}">
            <input
              type="${inputType}"
              name="${escapeHtml(q.questionId)}"
              value="${escapeHtml(opt.id)}"
              data-option-text="${escapeHtml(opt.text)}"
              ${opt.disabled || q.initiallyDisabled ? 'disabled' : ''}
            />
            <span class="opt-badge">${escapeHtml(opt.label)}</span>
            <span class="opt-text">${escapeHtml(opt.text)}</span>
          </label>
        `
          )
          .join('\n')}
      </div>
    `;
  }

  const unlockBtnHtml = q.initiallyDisabled
    ? `<button type="button" data-unlock-controls="true" class="qp-btn qp-btn-ghost qp-btn-sm">Unlock Transient Disabled Controls</button>`
    : '';

  const officialFeedbackHtml = q.officialAnswer
    ? `<div
         class="official-answer-feedback"
         data-official-feedback="true"
         data-verified="true"
         data-official-correct-answer="${escapeHtml(q.officialAnswer.join('|'))}"
         data-official-explanation="${escapeHtml(q.officialExplanation || '')}"
         hidden
       >
         <strong>Official Practice Feedback:</strong> Correct Answer: <code>${escapeHtml(
           q.officialAnswer.join(', ')
         )}</code> — ${escapeHtml(q.officialExplanation || '')}
       </div>`
    : '';

  return `
    <article
      class="quiz-question-card"
      id="${escapeHtml(q.questionId)}"
      data-quiz-question="true"
      data-question-id="${escapeHtml(q.questionId)}"
      data-question-type="${escapeHtml(q.questionType)}"
      data-subject="${escapeHtml(q.subject)}"
      data-topic="${escapeHtml(q.topic)}"
      ${unsupportedAttr}
    >
      <div class="question-header">
        <span class="question-badge">Q${number} • ${escapeHtml(q.questionType.replace('_', ' '))}</span>
        <span class="question-topic-tag">${escapeHtml(q.subject)} / ${escapeHtml(q.topic)}</span>
      </div>
      <h3 class="question-prompt" data-question-prompt="true">${escapeHtml(q.questionText)}</h3>
      ${controlsHtml}
      <div class="question-card-actions">
        ${unlockBtnHtml}
        <button type="button" data-check-answer="true" class="qp-btn qp-btn-ghost qp-btn-sm">Check Practice Answer</button>
      </div>
      ${officialFeedbackHtml}
    </article>
  `;
}

function attachQuizDomInteractions(doc: Document, questions: SyntheticQuizQuestion[]): void {
  // Resolve loading banner when retry button is clicked
  const resolveLoadingBtn = doc.getElementById('resolve-loading-btn');
  resolveLoadingBtn?.addEventListener('click', () => {
    const banner = doc.getElementById('quiz-loading-indicator');
    banner?.setAttribute('hidden', 'true');
    banner?.removeAttribute('data-quiz-loading');
  });

  // Unlock transient disabled controls when recovery hook is clicked
  doc.querySelectorAll<HTMLElement>('[data-unlock-controls]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest<HTMLElement>('[data-quiz-question]');
      card?.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
        inp.disabled = false;
      });
    });
  });

  // Reveal official feedback on individual Check Answer click
  doc.querySelectorAll<HTMLElement>('[data-check-answer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest<HTMLElement>('[data-quiz-question]');
      const feedback = card?.querySelector<HTMLElement>('[data-official-feedback="true"]');
      feedback?.removeAttribute('hidden');
    });
  });

  // Reveal all official feedback on Submit Practice Assessment click
  const submitBtn = doc.getElementById('quiz-submit-btn');
  submitBtn?.addEventListener('click', () => {
    doc.querySelectorAll<HTMLElement>('[data-official-feedback="true"]').forEach((fb) => {
      fb.removeAttribute('hidden');
    });
  });
}

/**
 * Boots the interactive Quiz Lab page when opened in a browser.
 */
export function bootQuizLabBrowserPage(): void {
  if (typeof document === 'undefined') return;

  const repo = new QuizPilotRepository();
  const engine = new PracticeAutomationEngine();

  const mountScenario = (scenario: SyntheticQuizScenario) => {
    renderSyntheticQuizDom(document, {
      scenario,
      simulateLoadingState: scenario === 'edge_cases',
      simulateBrokenNextButton: scenario === 'edge_cases'
    });
    bindHudControls(scenario);
  };

  const bindHudControls = (currentScenario: SyntheticQuizScenario) => {
    const selector = document.getElementById('scenario-selector') as HTMLSelectElement | null;
    const statusBar = document.getElementById('hud-status-bar');
    const scanBtn = document.getElementById('hud-scan-btn');
    const startBtn = document.getElementById('hud-start-btn');
    const pauseBtn = document.getElementById('hud-pause-btn');
    const resumeBtn = document.getElementById('hud-resume-btn');
    const stopBtn = document.getElementById('hud-stop-btn');

    selector?.addEventListener('change', () => {
      mountScenario(selector.value as SyntheticQuizScenario);
    });

    scanBtn?.addEventListener('click', async () => {
      const settings = await repo.getSettings();
      const scan = scanQuizDocument(document, window.location.href, settings.authorizedDomains);
      if (statusBar) {
        if (scan.hasSafetyRestriction) {
          statusBar.textContent = `SAFETY HALT: ${scan.safetyRestrictionReason}`;
        } else if (!scan.isAuthorizedPractice) {
          statusBar.textContent = `UNAUTHORIZED: ${scan.authorizationReason}`;
        } else {
          statusBar.textContent = `Page Compatible: ${scan.supportedQuestionCount} supported question(s), ${scan.unsupportedQuestionCount} unsupported layout(s). Authorization: ${scan.authorizationReason}`;
        }
      }
    });

    startBtn?.addEventListener('click', async () => {
      const settings = await repo.getSettings();
      let keys = await repo.getAnswerKeys();
      if (keys.length === 0) {
        await repo.saveAnswerKeys(DEFAULT_ANSWER_KEY_ENTRIES);
        keys = DEFAULT_ANSWER_KEY_ENTRIES;
      }

      const aiProvider = createAIProvider(settings.aiProviderMode);
      const sourceManager = new AnswerSourceManager(
        aiProvider,
        keys,
        settings.minConfidenceThreshold
      );

      if (statusBar) {
        statusBar.textContent = `Running authorized practice session on scenario "${currentScenario}"...`;
      }

      const result = await engine.runPracticeSession({
        doc: document,
        url: window.location.href,
        settings,
        answerSourceManager: sourceManager,
        aiProvider,
        repository: repo,
        onProgress: (sess, latest) => {
          if (statusBar) {
            statusBar.textContent = `[${sess.status.toUpperCase()}] Processed ${
              sess.processedQuestionIds.length
            }/${sess.totalDetectedQuestions} | Uncertain: ${
              sess.uncertainAnswerCount
            } | Recoverable Errors: ${sess.recoverableErrorCount}${
              latest ? ` | Latest: ${latest.questionId} (${latest.verificationStatus})` : ''
            }`;
          }
        }
      });

      if (statusBar) {
        const scoreStr =
          result.report.executiveSummary.verifiedScorePercent !== null
            ? `${result.report.executiveSummary.verifiedScorePercent}% verified accuracy`
            : 'Score N/A (unverified)';
        statusBar.textContent = `Session ${result.session.status.toUpperCase()}: ${
          result.session.processedQuestionIds.length
        } questions processed (${scoreStr}). ${
          result.session.stopReason ? `Reason: ${result.session.stopReason}. ` : ''
        }Open Dashboard to inspect full report & exports.`;
      }
    });

    pauseBtn?.addEventListener('click', () => {
      engine.pause();
      if (statusBar) statusBar.textContent = 'Session PAUSED by user.';
    });

    resumeBtn?.addEventListener('click', () => {
      engine.resume();
      if (statusBar) statusBar.textContent = 'Session RESUMED by user.';
    });

    stopBtn?.addEventListener('click', () => {
      engine.emergencyStop('Emergency Stop clicked in Quiz Lab HUD.');
      if (statusBar) statusBar.textContent = 'EMERGENCY STOP triggered — Automation halted immediately.';
    });
  };

  mountScenario('standard');
}
