import { createAIProvider } from '../core/ai/http-ai';
import { PracticeAutomationEngine } from '../core/automation/engine';
import {
  AnswerKeyEntry,
  CapturedQuestion,
  DifficultyLevel,
  PracticeSession,
  PriorityLevel,
  QuizPilotSettings,
  StudyReport,
  VerificationStatus
} from '../core/models/types';
import {
  exportQuestionBankToCsv,
  exportReportToMarkdown,
  exportReportToPdfBytes,
  exportSessionArchiveToJson
} from '../core/reporting/exporters';
import { generateStudyReport } from '../core/reporting/report-generator';
import { escapeHtml, sanitizeUntrustedText } from '../core/security/sanitizer';
import { AnswerSourceManager } from '../core/sources/answer-sources';
import { QuizPilotRepository } from '../core/storage/repository';
import { renderSyntheticQuizDom, SyntheticQuizScenario } from '../quiz-sandbox/quiz-app';
import { DEFAULT_ANSWER_KEY_ENTRIES } from '../quiz-sandbox/synthetic-bank';

export type DashboardSectionId =
  | 'overview'
  | 'sessions'
  | 'question-bank'
  | 'important-questions'
  | 'analytics'
  | 'study-planner'
  | 'reports-exports'
  | 'settings-privacy';

interface QuestionBankFilterState {
  search: string;
  topic: string;
  difficulty: 'all' | DifficultyLevel;
  verificationStatus: 'all' | VerificationStatus;
  sortBy: 'questionId' | 'topic' | 'difficultyScore' | 'verificationStatus' | 'confidenceScore' | 'timeSpentMs';
  sortDir: 'asc' | 'desc';
}

export async function bootDashboardApp(): Promise<void> {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('dashboard-root');
  if (!root) return;

  const repo = new QuizPilotRepository();
  const engine = new PracticeAutomationEngine();

  let activeSection: DashboardSectionId = 'overview';
  let settings: QuizPilotSettings = await repo.getSettings();
  let answerKeys: AnswerKeyEntry[] = await repo.getAnswerKeys();
  if (answerKeys.length === 0) {
    await repo.saveAnswerKeys(DEFAULT_ANSWER_KEY_ENTRIES);
    answerKeys = await repo.getAnswerKeys();
  }

  let sessions: PracticeSession[] = await repo.listSessions();
  let allQuestions: CapturedQuestion[] = await repo.listAllQuestions();
  let reports: StudyReport[] = await repo.listReports();
  let selectedSessionId: string = sessions[0]?.sessionId || '';
  let selectedScenario: SyntheticQuizScenario = 'standard';
  let importantPriorityFilter: 'all' | PriorityLevel = 'all';
  let statusBannerMessage = 'Ready — Authorized practice automation & analytics active.';

  const qbFilter: QuestionBankFilterState = {
    search: '',
    topic: 'all',
    difficulty: 'all',
    verificationStatus: 'all',
    sortBy: 'questionId',
    sortDir: 'asc'
  };

  // Seed initial synthetic practice session if repository is empty so the dashboard has real data immediately
  if (sessions.length === 0) {
    await runSyntheticScenario('standard', true);
  }

  async function reloadData(): Promise<void> {
    settings = await repo.getSettings();
    answerKeys = await repo.getAnswerKeys();
    sessions = await repo.listSessions();
    allQuestions = await repo.listAllQuestions();
    reports = await repo.listReports();
    if (!selectedSessionId && sessions.length > 0) {
      selectedSessionId = sessions[0].sessionId;
    }
  }

  async function runSyntheticScenario(
    scenario: SyntheticQuizScenario,
    includeRealisticErrorDemo = false
  ): Promise<void> {
    const virtualDoc = document.implementation.createHTMLDocument('Synthetic Practice Quiz');
    renderSyntheticQuizDom(virtualDoc, {
      scenario,
      simulateLoadingState: scenario === 'edge_cases',
      simulateBrokenNextButton: scenario === 'edge_cases'
    });

    const currentSettings = await repo.getSettings();
    const keys = await repo.getAnswerKeys();

    // For initial baseline demo, simulate one partial multi-select answer on q_std_4 so the report
    // showcases both verified_correct and verified_incorrect alongside ai_suggested and uncertain!
    const runtimeKeys = includeRealisticErrorDemo
      ? keys.map((k) =>
          k.questionId === 'q_std_4'
            ? { ...k, acceptedAnswers: ['opt_http_get', 'opt_http_put'] }
            : k
        )
      : keys;

    const aiProvider = createAIProvider(currentSettings.aiProviderMode, {
      endpointUrl: currentSettings.aiCustomEndpointUrl,
      modelName: currentSettings.aiModelName
    });
    const sourceManager = new AnswerSourceManager(
      aiProvider,
      runtimeKeys,
      currentSettings.minConfidenceThreshold
    );

    const scenarioTitles: Record<SyntheticQuizScenario, string> = {
      standard: 'CS-402 Distributed Systems & Security — Practice Session',
      edge_cases: 'Edge-Case & Fault Resilience Practice Session',
      large_bank: '60-Question Comprehensive Systems Mock Exam',
      unauthorized_graded: 'Unauthorized Graded Assessment (Safety Refusal Check)',
      captcha_challenge: 'CAPTCHA Challenge Page (Safety Halt Check)'
    };

    const result = await engine.runPracticeSession({
      doc: virtualDoc,
      url: `http://localhost:5173/quiz-lab.html?scenario=${scenario}`,
      sessionTitle: scenarioTitles[scenario],
      settings: currentSettings,
      answerSourceManager: sourceManager,
      aiProvider,
      repository: repo,
      onProgress: (sess) => {
        statusBannerMessage = `Running "${sess.title}" [${sess.status.toUpperCase()}]: ${sess.processedQuestionIds.length}/${sess.totalDetectedQuestions} processed...`;
      }
    });

    selectedSessionId = result.session.sessionId;
    statusBannerMessage = `Session "${result.session.title}" finished with status ${result.session.status.toUpperCase()} (${result.session.processedQuestionIds.length} questions processed).`;
    await reloadData();
  }

  function getSelectedReport(): StudyReport | null {
    return (
      reports.find((r) => r.sessionId === selectedSessionId) ||
      reports[0] ||
      null
    );
  }

  function getSelectedSession(): PracticeSession | null {
    return (
      sessions.find((s) => s.sessionId === selectedSessionId) ||
      sessions[0] ||
      null
    );
  }

  function render(): void {
    if (!root) return;
    const currentSession = getSelectedSession();
    const currentReport = getSelectedReport();

    const progressPct =
      currentSession && currentSession.totalDetectedQuestions > 0
        ? Math.min(
            100,
            Math.round(
              (currentSession.processedQuestionIds.length /
                currentSession.totalDetectedQuestions) *
                100
            )
          )
        : 0;

    root.innerHTML = `
      <div class="app-layout">
        <aside class="sidebar" aria-label="Dashboard Navigation">
          <div class="brand-header">
            <span class="brand-dot"></span>
            <div>
              <h1 class="brand-title">QuizPilot AI</h1>
              <p class="brand-subtitle">Practice Automation & Study Lab</p>
            </div>
          </div>

          <nav class="nav-list">
            ${renderNavButton('overview', '1. Overview', sessions.length)}
            ${renderNavButton('sessions', '2. Practice Sessions', sessions.length)}
            ${renderNavButton('question-bank', '3. Question Bank', allQuestions.length)}
            ${renderNavButton(
              'important-questions',
              '4. Important Questions',
              currentReport?.importantQuestions.highPriorityCount ?? 0
            )}
            ${renderNavButton('analytics', '5. Performance Analytics')}
            ${renderNavButton('study-planner', '6. Study Planner')}
            ${renderNavButton('reports-exports', '7. Reports & Exports', reports.length)}
            ${renderNavButton('settings-privacy', '8. Settings & Privacy')}
          </nav>

          <div class="sidebar-footer">
            <a href="/quiz-lab.html" class="qp-btn qp-btn-secondary full-width">
              Open Synthetic Quiz Website
            </a>
            <a href="/popup.html" class="qp-btn qp-btn-ghost full-width">
              Open Extension Popup View
            </a>
          </div>
        </aside>

        <main class="main-content">
          <!-- Active Session Experience Bar (Section 7) -->
          <section class="top-session-bar" aria-label="Active Session Status">
            <div>
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <strong>Active Session State:</strong>
                ${renderSessionStatusPill(currentSession?.status || 'idle')}
                <span class="muted">${escapeHtml(statusBannerMessage)}</span>
              </div>
              <div class="session-bar-metrics">
                <span><strong>Processed:</strong> ${
                  currentSession?.processedQuestionIds.length ?? 0
                } / ${currentSession?.totalDetectedQuestions ?? 0}</span>
                <span><strong>Uncertain / AI:</strong> ${
                  currentSession?.uncertainAnswerCount ?? 0
                }</span>
                <span><strong>Recoverable Errors:</strong> ${
                  currentSession?.recoverableErrorCount ?? 0
                }</span>
                <span><strong>Elapsed:</strong> ${currentSession?.elapsedMs ?? 0} ms</span>
              </div>
            </div>
            <div class="session-bar-actions">
              <button type="button" id="top-pause-btn" class="qp-btn qp-btn-secondary qp-btn-sm">Pause</button>
              <button type="button" id="top-resume-btn" class="qp-btn qp-btn-secondary qp-btn-sm">Resume</button>
              <button type="button" id="top-stop-btn" class="qp-btn qp-btn-danger qp-btn-sm">Emergency Stop</button>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${progressPct}%"></div>
            </div>
          </section>

          ${renderActiveSection(currentSession, currentReport)}
        </main>
      </div>
    `;

    bindDashboardEvents();
  }

  function renderNavButton(
    id: DashboardSectionId,
    label: string,
    badgeCount?: number
  ): string {
    const isActive = activeSection === id;
    const badgeHtml =
      typeof badgeCount === 'number'
        ? `<span class="status-pill pill-neutral">${badgeCount}</span>`
        : '';
    return `
      <button
        type="button"
        class="nav-btn ${isActive ? 'active' : ''}"
        data-nav-section="${id}"
      >
        <span>${escapeHtml(label)}</span>
        ${badgeHtml}
      </button>
    `;
  }

  function renderActiveSection(
    session: PracticeSession | null,
    report: StudyReport | null
  ): string {
    switch (activeSection) {
      case 'overview':
        return renderOverviewSection(session, report);
      case 'sessions':
        return renderSessionsSection(session);
      case 'question-bank':
        return renderQuestionBankSection();
      case 'important-questions':
        return renderImportantQuestionsSection(report);
      case 'analytics':
        return renderAnalyticsSection(report);
      case 'study-planner':
        return renderStudyPlannerSection(report);
      case 'reports-exports':
        return renderReportsExportsSection(session, report);
      case 'settings-privacy':
        return renderSettingsPrivacySection();
      default:
        return renderOverviewSection(session, report);
    }
  }

  // ==================== 1. Overview ====================
  function renderOverviewSection(
    _session: PracticeSession | null,
    report: StudyReport | null
  ): string {
    const exec = report?.executiveSummary;
    const scoreDisplay =
      exec && exec.verifiedScorePercent !== null
        ? `${exec.verifiedScorePercent}%`
        : 'Unverified (N/A)';

    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">1. Overview & Authorized Practice Launcher</h2>
          <p class="section-subtitle">
            Execute authorized practice sessions, inspect verified vs. AI-proposed answers, and track exam readiness.
          </p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <select id="quick-scenario-select" class="qp-select">
            <option value="standard" ${selectedScenario === 'standard' ? 'selected' : ''}>Standard Practice Quiz (11 Questions)</option>
            <option value="edge_cases" ${selectedScenario === 'edge_cases' ? 'selected' : ''}>Edge-Case Fault Suite (Duplicates, Disabled, Missing)</option>
            <option value="large_bank" ${selectedScenario === 'large_bank' ? 'selected' : ''}>Large Question Bank (60 Questions)</option>
            <option value="unauthorized_graded" ${selectedScenario === 'unauthorized_graded' ? 'selected' : ''}>Unauthorized Graded Exam (Safety Stop Test)</option>
            <option value="captcha_challenge" ${selectedScenario === 'captcha_challenge' ? 'selected' : ''}>CAPTCHA Challenge (Safety Stop Test)</option>
          </select>
          <button type="button" id="quick-run-scenario-btn" class="qp-btn qp-btn-primary">
            Run Selected Practice Session
          </button>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Verified Performance Score</div>
          <div class="kpi-value">${escapeHtml(scoreDisplay)}</div>
          <div class="kpi-footnote">
            ${
              report
                ? `${report.performanceAnalysis.verifiedNumerator}/${report.performanceAnalysis.verifiedDenominator} verified (${report.performanceAnalysis.excludedFromScoreCount} unverified excluded)`
                : 'No report generated yet'
            }
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Captured Questions</div>
          <div class="kpi-value">${allQuestions.length}</div>
          <div class="kpi-footnote">Across ${sessions.length} practice session(s)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Verified Correct / Incorrect</div>
          <div class="kpi-value">${exec?.verifiedCorrectCount ?? 0} / ${exec?.verifiedIncorrectCount ?? 0}</div>
          <div class="kpi-footnote">Strictly verified by official keys</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">AI-Suggested & Uncertain</div>
          <div class="kpi-value">${(exec?.aiSuggestedCount ?? 0) + (exec?.uncertainCount ?? 0)}</div>
          <div class="kpi-footnote">${exec?.aiSuggestedCount ?? 0} AI-suggested • ${exec?.uncertainCount ?? 0} uncertain</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Principal Strengths & Weaknesses (Latest Report)</h3>
          ${
            exec
              ? `
            <p><strong>Scoring Integrity:</strong> <span class="muted">${escapeHtml(exec.scoreDenominatorNote)}</span></p>
            <h4 style="margin:12px 0 6px;font-size:13px;color:#34d399;">Principal Strengths</h4>
            <ul>
              ${exec.principalStrengths.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
            </ul>
            <h4 style="margin:12px 0 6px;font-size:13px;color:#fbbf24;">Principal Weaknesses & Unverified Gaps</h4>
            <ul>
              ${
                exec.principalWeaknesses.length > 0
                  ? exec.principalWeaknesses.map((w) => `<li>${escapeHtml(w)}</li>`).join('')
                  : '<li>No verified topic weaknesses detected in this session.</li>'
              }
            </ul>
          `
              : `<p class="muted">Run a practice session to populate strengths and weaknesses.</p>`
          }
        </div>

        <div class="card">
          <h3 class="card-title">Recent Practice Sessions</h3>
          <div class="table-wrap">
            <table class="qp-table">
              <thead>
                <tr>
                  <th>Session Title</th>
                  <th>Status</th>
                  <th>Processed</th>
                  <th>Uncertain</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${sessions
                  .slice(0, 5)
                  .map(
                    (s) => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(s.title)}</strong>
                      <div class="muted" style="font-size:11.5px;"><code>${escapeHtml(s.sessionId)}</code></div>
                    </td>
                    <td>${renderSessionStatusPill(s.status)}</td>
                    <td>${s.processedQuestionIds.length} / ${s.totalDetectedQuestions}</td>
                    <td>${s.uncertainAnswerCount}</td>
                    <td>
                      <button type="button" class="qp-btn qp-btn-secondary qp-btn-sm select-session-btn" data-session-id="${escapeHtml(
                        s.sessionId
                      )}">
                        Inspect
                      </button>
                    </td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // ==================== 2. Practice Sessions ====================
  function renderSessionsSection(currentSession: PracticeSession | null): string {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">2. Practice Sessions & Automation Lifecycle</h2>
          <p class="section-subtitle">
            Start authorized practice runs, recover interrupted sessions without duplicating questions, and inspect the automation event log.
          </p>
        </div>
        <div style="display:flex;gap:10px;">
          <button type="button" id="sessions-run-standard-btn" class="qp-btn qp-btn-primary">
            Run Standard Quiz (11 Qs)
          </button>
          <button type="button" id="sessions-run-edge-btn" class="qp-btn qp-btn-secondary">
            Run Edge-Case Suite
          </button>
          <button type="button" id="sessions-run-large-btn" class="qp-btn qp-btn-secondary">
            Run 60-Question Bank
          </button>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Recorded Sessions</h3>
        <div class="table-wrap">
          <table class="qp-table">
            <thead>
              <tr>
                <th>Session ID</th>
                <th>Title & Target URL</th>
                <th>Status</th>
                <th>Questions</th>
                <th>Recoverable Errors</th>
                <th>Uncertain</th>
                <th>Elapsed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${sessions
                .map(
                  (s) => `
                <tr>
                  <td><code>${escapeHtml(s.sessionId)}</code></td>
                  <td>
                    <strong>${escapeHtml(s.title)}</strong>
                    <div class="muted" style="font-size:11.5px;">${escapeHtml(s.targetUrl)}</div>
                    ${
                      s.stopReason
                        ? `<div style="color:#fca5a5;font-size:11.5px;">Reason: ${escapeHtml(s.stopReason)}</div>`
                        : ''
                    }
                  </td>
                  <td>${renderSessionStatusPill(s.status)}</td>
                  <td>${s.processedQuestionIds.length} / ${s.totalDetectedQuestions}</td>
                  <td>${s.recoverableErrorCount}</td>
                  <td>${s.uncertainAnswerCount}</td>
                  <td>${s.elapsedMs} ms</td>
                  <td style="display:flex;gap:6px;">
                    <button type="button" class="qp-btn qp-btn-secondary qp-btn-sm select-session-btn" data-session-id="${escapeHtml(
                      s.sessionId
                    )}">
                      ${s.sessionId === selectedSessionId ? 'Selected' : 'Select'}
                    </button>
                    <button type="button" class="qp-btn qp-btn-ghost qp-btn-sm recover-session-btn" data-session-id="${escapeHtml(
                      s.sessionId
                    )}">
                      Resume / Recover
                    </button>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Automation Event Log — ${escapeHtml(
          currentSession?.title || 'Selected Session'
        )} (<code>${escapeHtml(currentSession?.sessionId || '')}</code>)</h3>
        <div class="table-wrap">
          <table class="qp-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Level</th>
                <th>Event Code</th>
                <th>Question ID</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              ${
                currentSession && currentSession.events.length > 0
                  ? currentSession.events
                      .map(
                        (ev) => `
                    <tr>
                      <td><code>${escapeHtml(ev.timestamp.slice(11, 23))}</code></td>
                      <td>${renderEventLevelPill(ev.level)}</td>
                      <td><code>${escapeHtml(ev.code)}</code></td>
                      <td><code>${escapeHtml(ev.questionId || '—')}</code></td>
                      <td>${escapeHtml(ev.message)}</td>
                    </tr>
                  `
                      )
                      .join('')
                  : `<tr><td colspan="5" class="muted">No automation events logged yet.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== 3. Question Bank ====================
  function renderQuestionBankSection(): string {
    const distinctTopics = Array.from(new Set(allQuestions.map((q) => q.topic))).sort();

    const filtered = allQuestions
      .filter((q) => {
        if (qbFilter.topic !== 'all' && q.topic !== qbFilter.topic) return false;
        if (qbFilter.difficulty !== 'all' && q.difficulty !== qbFilter.difficulty) return false;
        if (
          qbFilter.verificationStatus !== 'all' &&
          q.verificationStatus !== qbFilter.verificationStatus
        ) {
          return false;
        }
        if (qbFilter.search.trim().length > 0) {
          const needle = qbFilter.search.trim().toLowerCase();
          const haystack = `${q.questionId} ${q.questionText} ${q.subject} ${q.topic} ${q.subtopic} ${q.explanation}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dir = qbFilter.sortDir === 'asc' ? 1 : -1;
        switch (qbFilter.sortBy) {
          case 'questionId':
            return a.questionId.localeCompare(b.questionId) * dir;
          case 'topic':
            return a.topic.localeCompare(b.topic) * dir;
          case 'difficultyScore':
            return (a.difficultyScore - b.difficultyScore) * dir;
          case 'verificationStatus':
            return a.verificationStatus.localeCompare(b.verificationStatus) * dir;
          case 'confidenceScore':
            return (a.confidenceScore - b.confidenceScore) * dir;
          case 'timeSpentMs':
            return (a.timeSpentMs - b.timeSpentMs) * dir;
          default:
            return 0;
        }
      });

    const sortIndicator = (col: QuestionBankFilterState['sortBy']): string =>
      qbFilter.sortBy === col ? (qbFilter.sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">3. Captured Question Bank & Knowledge Base</h2>
          <p class="section-subtitle">
            Search, filter, and sort captured questions. Verified answers are strictly separated from AI suggestions and uncertain items.
          </p>
        </div>
        <span class="status-pill pill-purple">Showing ${filtered.length} of ${allQuestions.length} questions</span>
      </div>

      <div class="filter-bar" role="search">
        <input
          type="search"
          id="qb-search-input"
          class="qp-input"
          placeholder="Search question text, topic, ID, or explanation..."
          value="${escapeHtml(qbFilter.search)}"
        />
        <select id="qb-topic-filter" class="qp-select" aria-label="Filter by Topic">
          <option value="all">All Topics (${distinctTopics.length})</option>
          ${distinctTopics
            .map(
              (t) =>
                `<option value="${escapeHtml(t)}" ${
                  qbFilter.topic === t ? 'selected' : ''
                }>${escapeHtml(t)}</option>`
            )
            .join('')}
        </select>
        <select id="qb-difficulty-filter" class="qp-select" aria-label="Filter by Difficulty">
          <option value="all" ${qbFilter.difficulty === 'all' ? 'selected' : ''}>All Difficulties</option>
          <option value="easy" ${qbFilter.difficulty === 'easy' ? 'selected' : ''}>Easy</option>
          <option value="medium" ${qbFilter.difficulty === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="hard" ${qbFilter.difficulty === 'hard' ? 'selected' : ''}>Hard</option>
        </select>
        <select id="qb-status-filter" class="qp-select" aria-label="Filter by Verification Status">
          <option value="all" ${qbFilter.verificationStatus === 'all' ? 'selected' : ''}>All Verification Statuses</option>
          <option value="verified_correct" ${qbFilter.verificationStatus === 'verified_correct' ? 'selected' : ''}>Verified Correct</option>
          <option value="verified_incorrect" ${qbFilter.verificationStatus === 'verified_incorrect' ? 'selected' : ''}>Verified Incorrect</option>
          <option value="ai_suggested" ${qbFilter.verificationStatus === 'ai_suggested' ? 'selected' : ''}>AI-Suggested (Unverified)</option>
          <option value="uncertain" ${qbFilter.verificationStatus === 'uncertain' ? 'selected' : ''}>Uncertain / Ambiguous</option>
          <option value="unanswered" ${qbFilter.verificationStatus === 'unanswered' ? 'selected' : ''}>Unanswered</option>
          <option value="unsupported" ${qbFilter.verificationStatus === 'unsupported' ? 'selected' : ''}>Unsupported Layout</option>
        </select>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="qp-table">
            <thead>
              <tr>
                <th class="sortable" data-sort-col="questionId">ID${sortIndicator('questionId')}</th>
                <th>Question Prompt & Provenance</th>
                <th class="sortable" data-sort-col="topic">Subject / Topic${sortIndicator('topic')}</th>
                <th class="sortable" data-sort-col="difficultyScore">Difficulty${sortIndicator('difficultyScore')}</th>
                <th>Selected vs. Official Key</th>
                <th class="sortable" data-sort-col="verificationStatus">Verification Status${sortIndicator('verificationStatus')}</th>
                <th class="sortable" data-sort-col="confidenceScore">Confidence & Source${sortIndicator('confidenceScore')}</th>
                <th class="sortable" data-sort-col="timeSpentMs">Time${sortIndicator('timeSpentMs')}</th>
              </tr>
            </thead>
            <tbody>
              ${
                filtered.length > 0
                  ? filtered
                      .map(
                        (q) => `
                    <tr>
                      <td>
                        <code>${escapeHtml(q.questionId)}</code>
                        <div class="muted" style="font-size:11px;">${escapeHtml(q.questionType)}</div>
                      </td>
                      <td style="max-width:380px;">
                        <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(q.questionText)}</div>
                        <div class="muted" style="font-size:12px;">${escapeHtml(q.explanation)}</div>
                      </td>
                      <td>
                        <div><strong>${escapeHtml(q.topic)}</strong></div>
                        <div class="muted" style="font-size:11.5px;">${escapeHtml(q.subject)} • ${escapeHtml(q.subtopic)}</div>
                      </td>
                      <td>
                        <span class="status-pill pill-neutral">${escapeHtml(q.difficulty.toUpperCase())} (${q.difficultyScore})</span>
                      </td>
                      <td>
                        <div><span class="muted">Selected:</span> <code>${escapeHtml(
                          q.selectedResponse.join(', ') || 'None'
                        )}</code></div>
                        <div><span class="muted">Official Key:</span> <code>${escapeHtml(
                          q.officialCorrectAnswer && q.officialCorrectAnswer.length > 0
                            ? q.officialCorrectAnswer.join(', ')
                            : 'UNVERIFIED'
                        )}</code></div>
                      </td>
                      <td>${renderVerificationPill(q.verificationStatus)}</td>
                      <td>
                        <div><strong>${Math.round(q.confidenceScore * 100)}%</strong> (<code>${escapeHtml(
                          q.answerSource
                        )}</code>)</div>
                        <div class="muted" style="font-size:11px;">${escapeHtml(
                          q.sourceMetadata.sourceProvenance
                        )}</div>
                      </td>
                      <td>${q.timeSpentMs} ms</td>
                    </tr>
                  `
                      )
                      .join('')
                  : `<tr><td colspan="8" class="muted">No questions match the current filter criteria.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== 4. Important Questions ====================
  function renderImportantQuestionsSection(report: StudyReport | null): string {
    if (!report) {
      return `<div class="card"><p class="muted">No study report available yet.</p></div>`;
    }
    const imp = report.importantQuestions;
    const filteredItems = imp.items.filter(
      (i) => importantPriorityFilter === 'all' || i.priorityLevel === importantPriorityFilter
    );

    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">4. Important-Question Classification & Concept Clusters</h2>
          <p class="section-subtitle">
            Transparent prioritization based on verified error patterns, repeated concepts, and unverified knowledge gaps.
          </p>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="qp-btn ${
            importantPriorityFilter === 'all' ? 'qp-btn-primary' : 'qp-btn-secondary'
          } qp-btn-sm prio-filter-btn" data-prio="all">
            All (${imp.items.length})
          </button>
          <button type="button" class="qp-btn ${
            importantPriorityFilter === 'high' ? 'qp-btn-primary' : 'qp-btn-secondary'
          } qp-btn-sm prio-filter-btn" data-prio="high">
            High Priority (${imp.highPriorityCount})
          </button>
          <button type="button" class="qp-btn ${
            importantPriorityFilter === 'medium' ? 'qp-btn-primary' : 'qp-btn-secondary'
          } qp-btn-sm prio-filter-btn" data-prio="medium">
            Medium Priority (${imp.mediumPriorityCount})
          </button>
          <button type="button" class="qp-btn ${
            importantPriorityFilter === 'low' ? 'qp-btn-primary' : 'qp-btn-secondary'
          } qp-btn-sm prio-filter-btn" data-prio="low">
            Low Priority (${imp.lowPriorityCount})
          </button>
        </div>
      </div>

      <div class="qp-alert qp-alert-info">
        <div><strong>Classification Criteria:</strong> ${escapeHtml(imp.methodologyNote)}</div>
        <div style="margin-top:4px;"><strong>${escapeHtml(imp.historicalDisclaimer)}</strong></div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="qp-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Question ID & Concept Cluster</th>
                <th>Question Text & Topic</th>
                <th>Transparent Priority Rationale</th>
                <th>Recommended Revision Action</th>
              </tr>
            </thead>
            <tbody>
              ${filteredItems
                .map(
                  (item) => `
                <tr>
                  <td>${renderPriorityPill(item.priorityLevel)}</td>
                  <td>
                    <code>${escapeHtml(item.questionId)}</code>
                    <div class="muted" style="font-size:11px;">Cluster: <code>${escapeHtml(
                      item.similarityClusterId
                    )}</code></div>
                  </td>
                  <td style="max-width:340px;">
                    <div style="font-weight:600;">${escapeHtml(item.questionText)}</div>
                    <div class="muted" style="font-size:11.5px;">${escapeHtml(item.topic)} • ${escapeHtml(
                      item.difficulty.toUpperCase()
                    )}</div>
                  </td>
                  <td style="max-width:300px;">${escapeHtml(item.priorityRationale)}</td>
                  <td style="max-width:300px;">${escapeHtml(item.recommendedAction)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== 5. Performance Analytics ====================
  function renderAnalyticsSection(report: StudyReport | null): string {
    if (!report) {
      return `<div class="card"><p class="muted">No analytics available yet.</p></div>`;
    }
    const perf = report.performanceAnalysis;
    const cal = perf.confidenceCalibration;

    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">5. Performance Analytics & Calibration</h2>
          <p class="section-subtitle">
            Verified accuracy breakdown, denominator disclosures, error rates by question type, and confidence calibration.
          </p>
        </div>
      </div>

      <div class="qp-alert qp-alert-authorized">
        <strong>Denominator & Exclusion Disclosure:</strong>
        Verified Accuracy is ${
          perf.verifiedAccuracyPercent !== null
            ? `<strong>${perf.verifiedAccuracyPercent}%</strong> (${perf.verifiedNumerator} correct out of ${perf.verifiedDenominator} officially verified questions)`
            : '<strong>Not Applicable (0 verified questions)</strong>'
        }.
        <strong>${perf.excludedFromScoreCount}</strong> question(s) without an official answer key were excluded from the score denominator (${escapeHtml(
          perf.exclusionExplanation
        )}).
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Accuracy by Topic</h3>
          <div class="table-wrap">
            <table class="qp-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Total</th>
                  <th>Verified</th>
                  <th>Correct / Incorrect</th>
                  <th>Uncertain/AI</th>
                  <th>Verified Accuracy</th>
                  <th>Avg Time</th>
                </tr>
              </thead>
              <tbody>
                ${perf.accuracyByTopic
                  .map(
                    (t) => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(t.topic)}</strong>
                      <div class="muted" style="font-size:11px;">${escapeHtml(t.subject)}</div>
                    </td>
                    <td>${t.totalQuestions}</td>
                    <td>${t.verifiedTotal}</td>
                    <td>${t.verifiedCorrect} / ${t.verifiedIncorrect}</td>
                    <td>${t.uncertainOrAiCount}</td>
                    <td>
                      ${
                        t.verifiedAccuracyPercent !== null
                          ? `<span class="status-pill ${
                              t.verifiedAccuracyPercent >= 80 ? 'pill-verified' : 'pill-warn'
                            }">${t.verifiedAccuracyPercent}%</span>`
                          : `<span class="status-pill pill-neutral">Unverified</span>`
                      }
                    </td>
                    <td>${t.averageTimeMs} ms</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">Error Rate by Question Type & Confidence Calibration</h3>
          <div class="table-wrap" style="margin-bottom:16px;">
            <table class="qp-table">
              <thead>
                <tr>
                  <th>Question Type</th>
                  <th>Total</th>
                  <th>Verified Total</th>
                  <th>Verified Incorrect</th>
                  <th>Verified Error Rate</th>
                </tr>
              </thead>
              <tbody>
                ${perf.errorRateByQuestionType
                  .map(
                    (qt) => `
                  <tr>
                    <td><code>${escapeHtml(qt.questionType)}</code></td>
                    <td>${qt.totalQuestions}</td>
                    <td>${qt.verifiedTotal}</td>
                    <td>${qt.verifiedIncorrect}</td>
                    <td>${
                      qt.errorRatePercent !== null ? `${qt.errorRatePercent}%` : 'Unverified'
                    }</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>

          <h4 style="margin:12px 0 8px;font-size:14px;">Confidence vs. Correctness Calibration</h4>
          <p class="muted" style="margin:0 0 10px;">${escapeHtml(cal.calibrationNote)}</p>
          <div class="summary-grid">
            <div>High-Confidence Correct: <strong>${cal.highConfidenceVerifiedCorrect}</strong></div>
            <div>High-Confidence Incorrect (Overconfidence): <strong>${cal.highConfidenceVerifiedIncorrect}</strong></div>
            <div>Low-Confidence Correct (Underconfidence): <strong>${cal.lowConfidenceVerifiedCorrect}</strong></div>
            <div>Low-Confidence Incorrect: <strong>${cal.lowConfidenceVerifiedIncorrect}</strong></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Unresolved, Ambiguous & AI-Suggested Questions Requiring Verification</h3>
        <div class="table-wrap">
          <table class="qp-table">
            <thead>
              <tr>
                <th>Question ID</th>
                <th>Status</th>
                <th>Question Prompt</th>
                <th>Diagnostic Reason</th>
              </tr>
            </thead>
            <tbody>
              ${
                perf.unresolvedOrAmbiguousQuestions.length > 0
                  ? perf.unresolvedOrAmbiguousQuestions
                      .map(
                        (u) => `
                    <tr>
                      <td><code>${escapeHtml(u.questionId)}</code></td>
                      <td>${renderVerificationPill(u.status)}</td>
                      <td>${escapeHtml(u.questionText)}</td>
                      <td>${escapeHtml(u.reason)}</td>
                    </tr>
                  `
                      )
                      .join('')
                  : `<tr><td colspan="4" class="muted">All questions in this session were verified by an authoritative answer key.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== 6. Study Planner ====================
  function renderStudyPlannerSection(report: StudyReport | null): string {
    const plan = report?.studyPlan;
    if (!plan) {
      return `<div class="card"><p class="muted">Run a session to generate a personalized study plan.</p></div>`;
    }

    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">6. Personalized Study Planner & Spaced Repetition</h2>
          <p class="section-subtitle">
            Adaptive preparation schedule calibrated to your daily study budget, target exam date, and verified topic gaps.
          </p>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Learner Schedule Parameters</h3>
        <div class="form-grid">
          <div class="form-field">
            <label for="planner-daily-minutes">Available Daily Study Time (Minutes)</label>
            <input
              type="number"
              id="planner-daily-minutes"
              class="qp-input"
              min="15"
              max="480"
              value="${settings.learnerDailyStudyMinutes}"
            />
          </div>
          <div class="form-field">
            <label for="planner-target-date">Target Examination Date</label>
            <input
              type="date"
              id="planner-target-date"
              class="qp-input"
              value="${escapeHtml(settings.learnerTargetExamDate)}"
            />
          </div>
          <div class="form-field" style="justify-content:flex-end;">
            <button type="button" id="regenerate-study-plan-btn" class="qp-btn qp-btn-primary">
              Update & Regenerate Study Plan
            </button>
          </div>
        </div>
        <p class="muted" style="margin:0;">
          <strong>Recommended Revision Order:</strong> ${escapeHtml(
            plan.recommendedRevisionOrder.join(' → ')
          )} (${plan.daysUntilTarget} days until target date ${escapeHtml(plan.targetExamDate)})
        </p>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Priority Topics for Revision</h3>
          <div class="table-wrap">
            <table class="qp-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Topic</th>
                  <th>Daily Allocation</th>
                  <th>Prioritization Rationale</th>
                </tr>
              </thead>
              <tbody>
                ${plan.priorityTopics
                  .map(
                    (pt) => `
                  <tr>
                    <td><span class="status-pill pill-purple">#${pt.rank}</span></td>
                    <td><strong>${escapeHtml(pt.topic)}</strong></td>
                    <td>${pt.recommendedMinutes} min/day</td>
                    <td>${escapeHtml(pt.reason)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">Spaced-Repetition Queue</h3>
          <div class="table-wrap">
            <table class="qp-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Urgency</th>
                  <th>Review Intervals (Days)</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                ${plan.spacedRepetitionQueue
                  .map(
                    (sr) => `
                  <tr>
                    <td><strong>${escapeHtml(sr.topic)}</strong></td>
                    <td><code>${escapeHtml(sr.urgency)}</code></td>
                    <td>Day ${escapeHtml(sr.scheduleIntervalsDays.join(', Day '))}</td>
                    <td>${escapeHtml(sr.rationale)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Suggested Daily Study Schedule</h3>
          ${plan.dailySchedule
            .map(
              (day) => `
            <div style="padding:10px 0;border-bottom:1px solid var(--border-subtle);">
              <div style="display:flex;justify-content:space-between;font-weight:600;">
                <span>Day ${day.dayIndex} (${escapeHtml(day.dateLabel)}) — ${escapeHtml(
                  day.focusTopics.join(', ')
                )}</span>
                <span class="status-pill pill-neutral">${day.allocatedMinutes} min</span>
              </div>
              <ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;color:var(--text-secondary);">
                ${day.activities.map((act) => `<li>${escapeHtml(act)}</li>`).join('')}
              </ul>
            </div>
          `
            )
            .join('')}
        </div>

        <div class="card">
          <h3 class="card-title">Follow-Up Mock Plan & Improvement Criteria</h3>
          <p><strong>Follow-Up Mock Timing:</strong> ${escapeHtml(
            plan.followUpMockPlan.recommendedTiming
          )}</p>
          <p><strong>Target Conditions:</strong> ${escapeHtml(
            plan.followUpMockPlan.targetConditions
          )}</p>
          <h4 style="margin:14px 0 8px;font-size:13.5px;">Criteria for Measuring Improvement</h4>
          <ul>
            ${plan.improvementCriteria.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }

  // ==================== 7. Reports and Exports ====================
  function renderReportsExportsSection(
    session: PracticeSession | null,
    report: StudyReport | null
  ): string {
    const mdPreview = report ? exportReportToMarkdown(report) : 'No report generated.';

    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">7. Intelligent Reports & Multi-Format Exports</h2>
          <p class="section-subtitle">
            Export actual session data as PDF Report, RFC-4180 CSV Question Bank, JSON Session Archive, or Markdown Revision Notes.
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label for="report-session-select" class="muted">Session:</label>
          <select id="report-session-select" class="qp-select">
            ${sessions
              .map(
                (s) =>
                  `<option value="${escapeHtml(s.sessionId)}" ${
                    s.sessionId === (session?.sessionId || '') ? 'selected' : ''
                  }>${escapeHtml(s.title)} (${escapeHtml(s.sessionId)})</option>`
              )
              .join('')}
          </select>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Download Session Artifacts (Generated from Real Session Data)</h3>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          <button type="button" id="export-pdf-btn" class="qp-btn qp-btn-primary">
            Export PDF Study Report (.pdf)
          </button>
          <button type="button" id="export-csv-btn" class="qp-btn qp-btn-secondary">
            Export Question Bank (.csv)
          </button>
          <button type="button" id="export-json-btn" class="qp-btn qp-btn-secondary">
            Export Session Archive (.json)
          </button>
          <button type="button" id="export-md-btn" class="qp-btn qp-btn-secondary">
            Export Revision Notes (.md)
          </button>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Structured Report Preview (Markdown / Executive Summary)</h3>
        <pre class="report-markdown-preview">${escapeHtml(mdPreview)}</pre>
      </div>
    `;
  }

  // ==================== 8. Settings and Privacy ====================
  function renderSettingsPrivacySection(): string {
    return `
      <div class="section-header">
        <div>
          <h2 class="section-title">8. Settings, Answer Sources & Privacy Controls</h2>
          <p class="section-subtitle">
            Configure automation pacing, manage official answer keys, select AI analysis providers, and control local data retention.
          </p>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 class="card-title">Automation Engine & AI Provider Configuration</h3>
          <div class="form-grid">
            <div class="form-field">
              <label for="cfg-profile-name">Test Profile Name</label>
              <input type="text" id="cfg-profile-name" class="qp-input" value="${escapeHtml(
                settings.profileName
              )}" />
            </div>
            <div class="form-field">
              <label for="cfg-step-delay">Step Pacing Delay (ms)</label>
              <input type="number" id="cfg-step-delay" class="qp-input" min="0" max="5000" value="${
                settings.stepDelayMs
              }" />
            </div>
            <div class="form-field">
              <label for="cfg-max-retries">Bounded Retry Limit</label>
              <input type="number" id="cfg-max-retries" class="qp-input" min="0" max="10" value="${
                settings.maxRetries
              }" />
            </div>
            <div class="form-field">
              <label for="cfg-confidence-threshold">Minimum Verification Confidence (0.1 - 0.99)</label>
              <input type="number" id="cfg-confidence-threshold" class="qp-input" step="0.05" min="0.1" max="0.99" value="${
                settings.minConfidenceThreshold
              }" />
            </div>
            <div class="form-field">
              <label for="cfg-ai-mode">AI Analysis Provider</label>
              <select id="cfg-ai-mode" class="qp-select">
                <option value="deterministic" ${
                  settings.aiProviderMode === 'deterministic' ? 'selected' : ''
                }>Deterministic Analysis Engine (Local Default)</option>
                <option value="mock_ai" ${
                  settings.aiProviderMode === 'mock_ai' ? 'selected' : ''
                }>Mock AI Provider (Development / Testing)</option>
                <option value="custom_http" ${
                  settings.aiProviderMode === 'custom_http' ? 'selected' : ''
                }>Custom OpenAI-Compatible Endpoint</option>
              </select>
            </div>
            <div class="form-field">
              <label for="cfg-allowed-domains">Authorized Practice Domains (comma-separated)</label>
              <input type="text" id="cfg-allowed-domains" class="qp-input" value="${escapeHtml(
                settings.authorizedDomains.join(', ')
              )}" />
            </div>
          </div>
          <button type="button" id="save-settings-btn" class="qp-btn qp-btn-primary">
            Save Configuration
          </button>
        </div>

        <div class="card">
          <h3 class="card-title">Privacy Policy & Data Retention Controls</h3>
          <p class="muted">
            <strong>Least-Privilege & Local-First Guarantee:</strong> All captured questions, session logs, and study reports are stored locally in IndexedDB and Chrome Local Storage. Page content is never uploaded without explicit user configuration, and all extracted DOM strings are sanitized to strip credentials, session tokens, cookies, and executable scripts.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;">
            <button type="button" id="privacy-export-all-btn" class="qp-btn qp-btn-secondary">
              Export All Personal Data (.json)
            </button>
            <button type="button" id="privacy-delete-session-btn" class="qp-btn qp-btn-ghost">
              Delete Selected Session
            </button>
            <button type="button" id="privacy-wipe-all-btn" class="qp-btn qp-btn-danger">
              Delete All Stored Sessions & Reset
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Add Official Answer Key or Reference Entry</h3>
        <div class="form-grid">
          <div class="form-field">
            <label for="new-key-pattern">Question Text Pattern or Question ID</label>
            <input type="text" id="new-key-pattern" class="qp-input" placeholder="e.g., CAP theorem" />
          </div>
          <div class="form-field">
            <label for="new-key-answers">Accepted Option ID(s) or Text (comma-separated)</label>
            <input type="text" id="new-key-answers" class="qp-input" placeholder="e.g., opt_cap_a" />
          </div>
          <div class="form-field">
            <label for="new-key-source">Source Tier</label>
            <select id="new-key-source" class="qp-select">
              <option value="official_key">Official Answer Key (Verified)</option>
              <option value="approved_bank">Approved Reference Bank</option>
              <option value="instructor_note">Instructor Explanation</option>
            </select>
          </div>
          <div class="form-field">
            <label for="new-key-citation">Source Citation</label>
            <input type="text" id="new-key-citation" class="qp-input" placeholder="e.g., Official Practice Key #12" />
          </div>
        </div>
        <button type="button" id="add-answer-key-btn" class="qp-btn qp-btn-secondary">
          Add Reference Entry (${answerKeys.length} currently loaded)
        </button>
      </div>
    `;
  }

  function bindDashboardEvents(): void {
    // Sidebar navigation
    document.querySelectorAll<HTMLElement>('[data-nav-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-nav-section') as DashboardSectionId;
        if (target) {
          activeSection = target;
          render();
        }
      });
    });

    // Top session bar controls
    document.getElementById('top-pause-btn')?.addEventListener('click', () => {
      engine.pause();
      statusBannerMessage = 'Active session PAUSED by user.';
      render();
    });
    document.getElementById('top-resume-btn')?.addEventListener('click', () => {
      engine.resume();
      statusBannerMessage = 'Active session RESUMED by user.';
      render();
    });
    document.getElementById('top-stop-btn')?.addEventListener('click', async () => {
      engine.emergencyStop('Emergency Stop triggered from Dashboard top bar.');
      const current = getSelectedSession();
      if (current && (current.status === 'running' || current.status === 'paused')) {
        current.status = 'stopped_by_user';
        current.stopReason = 'Emergency Stop triggered from Dashboard top bar.';
        await repo.saveSession(current);
      }
      statusBannerMessage = 'EMERGENCY STOP activated — Automation halted immediately.';
      await reloadData();
      render();
    });

    // Overview quick scenario runner
    const scenarioSelect = document.getElementById(
      'quick-scenario-select'
    ) as HTMLSelectElement | null;
    scenarioSelect?.addEventListener('change', () => {
      selectedScenario = scenarioSelect.value as SyntheticQuizScenario;
    });
    document.getElementById('quick-run-scenario-btn')?.addEventListener('click', async () => {
      await runSyntheticScenario(selectedScenario, false);
      render();
    });

    // Sessions tab runners
    document.getElementById('sessions-run-standard-btn')?.addEventListener('click', async () => {
      await runSyntheticScenario('standard', false);
      render();
    });
    document.getElementById('sessions-run-edge-btn')?.addEventListener('click', async () => {
      await runSyntheticScenario('edge_cases', false);
      render();
    });
    document.getElementById('sessions-run-large-btn')?.addEventListener('click', async () => {
      await runSyntheticScenario('large_bank', false);
      render();
    });

    // Select or recover session buttons
    document.querySelectorAll<HTMLElement>('.select-session-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.getAttribute('data-session-id');
        if (sid) {
          selectedSessionId = sid;
          statusBannerMessage = `Selected session ${sid}.`;
          render();
        }
      });
    });

    document.querySelectorAll<HTMLElement>('.recover-session-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sid = btn.getAttribute('data-session-id');
        if (!sid) return;
        const virtualDoc = document.implementation.createHTMLDocument('Synthetic Recovery');
        renderSyntheticQuizDom(virtualDoc, { scenario: 'standard' });
        const aiProvider = createAIProvider(settings.aiProviderMode);
        const sourceManager = new AnswerSourceManager(
          aiProvider,
          answerKeys,
          settings.minConfidenceThreshold
        );
        await engine.runPracticeSession({
          doc: virtualDoc,
          url: 'http://localhost:5173/quiz-lab.html',
          sessionId: sid,
          settings,
          answerSourceManager: sourceManager,
          aiProvider,
          repository: repo
        });
        selectedSessionId = sid;
        statusBannerMessage = `Recovered session ${sid} without duplicating already-captured questions.`;
        await reloadData();
        render();
      });
    });

    // Question Bank filters & sorting
    const searchInput = document.getElementById('qb-search-input') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      qbFilter.search = searchInput.value;
      render();
      const refocused = document.getElementById('qb-search-input') as HTMLInputElement | null;
      refocused?.focus();
      if (refocused) {
        refocused.setSelectionRange(refocused.value.length, refocused.value.length);
      }
    });

    const topicSelect = document.getElementById('qb-topic-filter') as HTMLSelectElement | null;
    topicSelect?.addEventListener('change', () => {
      qbFilter.topic = topicSelect.value;
      render();
    });

    const diffSelect = document.getElementById('qb-difficulty-filter') as HTMLSelectElement | null;
    diffSelect?.addEventListener('change', () => {
      qbFilter.difficulty = diffSelect.value as QuestionBankFilterState['difficulty'];
      render();
    });

    const statusSelect = document.getElementById('qb-status-filter') as HTMLSelectElement | null;
    statusSelect?.addEventListener('change', () => {
      qbFilter.verificationStatus =
        statusSelect.value as QuestionBankFilterState['verificationStatus'];
      render();
    });

    document.querySelectorAll<HTMLElement>('[data-sort-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-sort-col') as QuestionBankFilterState['sortBy'];
        if (!col) return;
        if (qbFilter.sortBy === col) {
          qbFilter.sortDir = qbFilter.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          qbFilter.sortBy = col;
          qbFilter.sortDir = 'asc';
        }
        render();
      });
    });

    // Important Questions priority filter
    document.querySelectorAll<HTMLElement>('.prio-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        importantPriorityFilter = (btn.getAttribute('data-prio') as 'all' | PriorityLevel) || 'all';
        render();
      });
    });

    // Study Planner regeneration
    document.getElementById('regenerate-study-plan-btn')?.addEventListener('click', async () => {
      const minInput = document.getElementById('planner-daily-minutes') as HTMLInputElement | null;
      const dateInput = document.getElementById('planner-target-date') as HTMLInputElement | null;
      const dailyMinutes = Number(minInput?.value || 60);
      const targetDate = dateInput?.value || '2026-11-09';

      await repo.saveSettings({
        learnerDailyStudyMinutes: dailyMinutes,
        learnerTargetExamDate: targetDate
      });

      const currentSession = getSelectedSession();
      if (currentSession) {
        const sessionQuestions = await repo.getQuestionsBySession(currentSession.sessionId);
        const aiProvider = createAIProvider(settings.aiProviderMode);
        const updatedReport = generateStudyReport({
          session: currentSession,
          questions: sessionQuestions,
          aiProvider,
          learnerDailyStudyMinutes: dailyMinutes,
          learnerTargetExamDate: targetDate
        });
        await repo.saveReport(updatedReport);
      }

      statusBannerMessage = `Updated study plan for ${dailyMinutes} min/day targeting ${targetDate}.`;
      await reloadData();
      render();
    });

    // Reports & Exports
    const repSessionSelect = document.getElementById(
      'report-session-select'
    ) as HTMLSelectElement | null;
    repSessionSelect?.addEventListener('change', () => {
      selectedSessionId = repSessionSelect.value;
      render();
    });

    document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
      const report = getSelectedReport();
      if (!report) return;
      const pdfBytes = exportReportToPdfBytes(report);
      triggerBrowserDownload(
        new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }),
        `quizpilot-report-${report.sessionId}.pdf`
      );
    });

    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
      const report = getSelectedReport();
      if (!report) return;
      const csv = exportQuestionBankToCsv(report);
      triggerBrowserDownload(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `quizpilot-question-bank-${report.sessionId}.csv`
      );
    });

    document.getElementById('export-json-btn')?.addEventListener('click', () => {
      const session = getSelectedSession();
      const report = getSelectedReport();
      if (!session || !report) return;
      const json = exportSessionArchiveToJson(session, report);
      triggerBrowserDownload(
        new Blob([json], { type: 'application/json' }),
        `quizpilot-session-archive-${session.sessionId}.json`
      );
    });

    document.getElementById('export-md-btn')?.addEventListener('click', () => {
      const report = getSelectedReport();
      if (!report) return;
      const md = exportReportToMarkdown(report);
      triggerBrowserDownload(
        new Blob([md], { type: 'text/markdown;charset=utf-8' }),
        `quizpilot-revision-notes-${report.sessionId}.md`
      );
    });

    // Settings & Privacy actions
    document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
      const profileName = sanitizeUntrustedText(
        (document.getElementById('cfg-profile-name') as HTMLInputElement)?.value ||
          settings.profileName,
        100
      );
      const stepDelayMs = Number(
        (document.getElementById('cfg-step-delay') as HTMLInputElement)?.value ?? 60
      );
      const maxRetries = Number(
        (document.getElementById('cfg-max-retries') as HTMLInputElement)?.value ?? 2
      );
      const minConfidenceThreshold = Number(
        (document.getElementById('cfg-confidence-threshold') as HTMLInputElement)?.value ?? 0.65
      );
      const aiProviderMode = ((document.getElementById('cfg-ai-mode') as HTMLSelectElement)
        ?.value || 'deterministic') as QuizPilotSettings['aiProviderMode'];
      const rawDomains =
        (document.getElementById('cfg-allowed-domains') as HTMLInputElement)?.value ||
        'localhost, 127.0.0.1';
      const authorizedDomains = rawDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      await repo.saveSettings({
        profileName,
        stepDelayMs,
        maxRetries,
        minConfidenceThreshold,
        aiProviderMode,
        authorizedDomains
      });
      statusBannerMessage = 'Configuration saved to local storage.';
      await reloadData();
      render();
    });

    document.getElementById('add-answer-key-btn')?.addEventListener('click', async () => {
      const pattern = sanitizeUntrustedText(
        (document.getElementById('new-key-pattern') as HTMLInputElement)?.value || '',
        200
      );
      const rawAns = sanitizeUntrustedText(
        (document.getElementById('new-key-answers') as HTMLInputElement)?.value || '',
        200
      );
      const sourceType = ((document.getElementById('new-key-source') as HTMLSelectElement)?.value ||
        'official_key') as AnswerKeyEntry['sourceType'];
      const citation = sanitizeUntrustedText(
        (document.getElementById('new-key-citation') as HTMLInputElement)?.value ||
          'User Supplied Key',
        160
      );

      if (!pattern || !rawAns) {
        statusBannerMessage = 'Please provide both a question pattern and accepted answer(s).';
        render();
        return;
      }

      const newEntry: AnswerKeyEntry = {
        questionPattern: pattern,
        acceptedAnswers: rawAns
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        sourceType,
        explanation: `User-configured ${sourceType.replace('_', ' ')} (${citation}).`,
        sourceCitation: citation
      };

      const updatedKeys = [...answerKeys, newEntry];
      await repo.saveAnswerKeys(updatedKeys);
      statusBannerMessage = `Added reference entry for "${pattern}".`;
      await reloadData();
      render();
    });

    document.getElementById('privacy-export-all-btn')?.addEventListener('click', () => {
      const dump = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          settings,
          sessions,
          questions: allQuestions,
          reports
        },
        null,
        2
      );
      triggerBrowserDownload(
        new Blob([dump], { type: 'application/json' }),
        'quizpilot-personal-data-export.json'
      );
    });

    document.getElementById('privacy-delete-session-btn')?.addEventListener('click', async () => {
      if (!selectedSessionId) return;
      const deletedId = selectedSessionId;
      await repo.deleteSessionData(deletedId);
      selectedSessionId = '';
      await reloadData();
      statusBannerMessage = `Deleted session ${deletedId} and its captured question records.`;
      render();
    });

    document.getElementById('privacy-wipe-all-btn')?.addEventListener('click', async () => {
      await repo.clearAllData();
      await repo.saveAnswerKeys(DEFAULT_ANSWER_KEY_ENTRIES);
      selectedSessionId = '';
      await reloadData();
      statusBannerMessage = 'All stored sessions, questions, and reports have been permanently deleted.';
      render();
    });
  }

  render();
}

function renderSessionStatusPill(status: string): string {
  switch (status) {
    case 'completed':
      return `<span class="status-pill pill-verified">COMPLETED</span>`;
    case 'running':
      return `<span class="status-pill pill-purple">RUNNING</span>`;
    case 'paused':
      return `<span class="status-pill pill-warn">PAUSED</span>`;
    case 'stopped_by_user':
    case 'stopped_safety_restriction':
      return `<span class="status-pill pill-danger">${escapeHtml(status.toUpperCase())}</span>`;
    default:
      return `<span class="status-pill pill-neutral">${escapeHtml(status.toUpperCase())}</span>`;
  }
}

function renderVerificationPill(status: VerificationStatus): string {
  switch (status) {
    case 'verified_correct':
      return `<span class="status-pill pill-verified">Verified Correct</span>`;
    case 'verified_incorrect':
      return `<span class="status-pill pill-danger">Verified Incorrect</span>`;
    case 'ai_suggested':
      return `<span class="status-pill pill-ai">AI-Suggested (Unverified)</span>`;
    case 'uncertain':
      return `<span class="status-pill pill-warn">Uncertain / Ambiguous</span>`;
    case 'unanswered':
      return `<span class="status-pill pill-neutral">Unanswered</span>`;
    case 'unsupported':
      return `<span class="status-pill pill-danger">Unsupported Layout</span>`;
  }
}

function renderPriorityPill(priority: PriorityLevel): string {
  switch (priority) {
    case 'high':
      return `<span class="status-pill pill-danger">HIGH PRIORITY</span>`;
    case 'medium':
      return `<span class="status-pill pill-warn">MEDIUM PRIORITY</span>`;
    case 'low':
      return `<span class="status-pill pill-verified">LOW PRIORITY</span>`;
  }
}

function renderEventLevelPill(level: string): string {
  switch (level) {
    case 'safety':
    case 'error':
      return `<span class="status-pill pill-danger">${escapeHtml(level.toUpperCase())}</span>`;
    case 'warn':
      return `<span class="status-pill pill-warn">WARN</span>`;
    default:
      return `<span class="status-pill pill-neutral">INFO</span>`;
  }
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
