import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DeterministicAnalysisProvider } from '../../src/core/ai/deterministic-ai';
import { PracticeAutomationEngine } from '../../src/core/automation/engine';
import { AnswerSourceManager } from '../../src/core/sources/answer-sources';
import { DEFAULT_SETTINGS, QuizPilotRepository } from '../../src/core/storage/repository';
import { handleContentScriptMessage } from '../../src/extension/content-script';
import { handleServiceWorkerMessage } from '../../src/extension/service-worker';
import { renderSyntheticQuizDom } from '../../src/quiz-sandbox/quiz-app';
import { DEFAULT_ANSWER_KEY_ENTRIES } from '../../src/quiz-sandbox/synthetic-bank';

describe('Browser / DOM Automation Lifecycle Integration Tests (Stages 4, 5, 6 & 9)', () => {
  it('completes a full authorized practice session on the standard synthetic quiz and distinguishes verified, AI-suggested, and uncertain answers', async () => {
    const doc = document.implementation.createHTMLDocument('Standard Practice');
    renderSyntheticQuizDom(doc, { scenario: 'standard' });

    const repo = new QuizPilotRepository();
    await repo.clearAllData();

    const ai = new DeterministicAnalysisProvider();
    const sourceManager = new AnswerSourceManager(ai, DEFAULT_ANSWER_KEY_ENTRIES, 0.65);
    const engine = new PracticeAutomationEngine();

    const result = await engine.runPracticeSession({
      doc,
      url: 'http://localhost:5173/quiz-lab.html',
      settings: { ...DEFAULT_SETTINGS, stepDelayMs: 1 },
      answerSourceManager: sourceManager,
      aiProvider: ai,
      repository: repo
    });

    expect(result.session.status).toBe('completed');
    expect(result.questions).toHaveLength(11);

    // 9 questions have official keys/feedback -> verified_correct
    // 1 question (q_std_10) has an instructor_note -> ai_suggested (not verified by official key)
    // 1 question (q_std_11) has an ambiguous/conflicting key -> uncertain
    const statusMap = new Map(result.questions.map((q) => [q.questionId, q.verificationStatus]));
    expect(statusMap.get('q_std_1')).toBe('verified_correct');
    expect(statusMap.get('q_std_4')).toBe('verified_correct');
    expect(statusMap.get('q_std_6')).toBe('verified_correct');
    expect(statusMap.get('q_std_8')).toBe('verified_correct');
    expect(statusMap.get('q_std_10')).toBe('ai_suggested');
    expect(statusMap.get('q_std_11')).toBe('uncertain');

    // Score denominator uses ONLY the 9 verified questions, excluding q_std_10 and q_std_11
    expect(result.report.performanceAnalysis.verifiedDenominator).toBe(9);
    expect(result.report.performanceAnalysis.excludedFromScoreCount).toBe(2);
    expect(result.report.executiveSummary.verifiedScorePercent).toBe(100);
  });

  it('handles edge-case faults: dynamic loading, disabled buttons, missing options, duplicate questions, and broken navigation', async () => {
    const doc = document.implementation.createHTMLDocument('Edge Case Suite');
    renderSyntheticQuizDom(doc, {
      scenario: 'edge_cases',
      simulateLoadingState: true,
      simulateBrokenNextButton: true
    });

    // Enable the next button without data-nav-exhausted so the engine tests broken navigation detection
    const nextBtn = doc.getElementById('quiz-next-btn');
    nextBtn?.removeAttribute('data-nav-exhausted');

    const repo = new QuizPilotRepository();
    await repo.clearAllData();

    const ai = new DeterministicAnalysisProvider();
    const sourceManager = new AnswerSourceManager(ai, DEFAULT_ANSWER_KEY_ENTRIES, 0.65);
    const engine = new PracticeAutomationEngine();

    const result = await engine.runPracticeSession({
      doc,
      url: 'http://localhost:5173/quiz-lab.html?scenario=edge_cases',
      settings: { ...DEFAULT_SETTINGS, stepDelayMs: 1, maxRetries: 2 },
      answerSourceManager: sourceManager,
      aiProvider: ai,
      repository: repo
    });

    expect(result.session.status).toBe('completed');
    // EDGE_CASE_FAULT_QUESTIONS has 8 DOM cards, 1 of which (q_edge_dup_1) is an exact duplicate of q_std_1
    // Therefore deduplication must yield 7 unique questions!
    expect(result.questions).toHaveLength(7);

    // Verify duplicate question was logged and skipped
    const dupEvents = result.session.events.filter((e) => e.code === 'DUPLICATE_SKIPPED');
    expect(dupEvents.length).toBeGreaterThanOrEqual(1);

    // Verify transient disabled control on q_edge_disabled_btn was recovered on retry
    const recoveredQ = result.questions.find((q) => q.questionId === 'q_edge_disabled_btn');
    expect(recoveredQ?.verificationStatus).toBe('verified_correct');
    expect(recoveredQ?.selectedResponse).toEqual(['opt_idb_a']);

    // Verify missing-options and canvas questions were classified as unsupported
    const missingOptsQ = result.questions.find((q) => q.questionId === 'q_edge_missing_opts');
    expect(missingOptsQ?.verificationStatus).toBe('unsupported');
    const canvasQ = result.questions.find((q) => q.questionId === 'q_edge_unsupported_canvas');
    expect(canvasQ?.verificationStatus).toBe('unsupported');
  });

  it('recovers an interrupted session without duplicating already-processed questions', async () => {
    const doc = document.implementation.createHTMLDocument('Interrupted Quiz');
    renderSyntheticQuizDom(doc, { scenario: 'standard' });

    const repo = new QuizPilotRepository();
    await repo.clearAllData();

    const ai = new DeterministicAnalysisProvider();
    const sourceManager = new AnswerSourceManager(ai, DEFAULT_ANSWER_KEY_ENTRIES, 0.65);
    const engine = new PracticeAutomationEngine();

    // First run: interrupt after 3 questions using emergencyStop inside onProgress
    let count = 0;
    const partialRun = await engine.runPracticeSession({
      doc,
      url: 'http://localhost:5173/quiz-lab.html',
      sessionId: 'sess_recover_test',
      settings: { ...DEFAULT_SETTINGS, stepDelayMs: 1 },
      answerSourceManager: sourceManager,
      aiProvider: ai,
      repository: repo,
      onProgress: (_sess, latest) => {
        if (latest) {
          count += 1;
          if (count === 3) {
            engine.emergencyStop('Simulated interruption after 3 questions.');
          }
        }
      }
    });

    expect(partialRun.session.status).toBe('stopped_by_user');
    expect(partialRun.questions).toHaveLength(3);

    // Second run: recover the same sessionId and complete all 11 questions with zero duplicates
    const recoveredRun = await engine.runPracticeSession({
      doc,
      url: 'http://localhost:5173/quiz-lab.html',
      sessionId: 'sess_recover_test',
      settings: { ...DEFAULT_SETTINGS, stepDelayMs: 1 },
      answerSourceManager: sourceManager,
      aiProvider: ai,
      repository: repo
    });

    expect(recoveredRun.session.status).toBe('completed');
    expect(recoveredRun.questions).toHaveLength(11);
    const uniqueIds = new Set(recoveredRun.questions.map((q) => q.questionId));
    expect(uniqueIds.size).toBe(11);
  });

  it('refuses to automate unauthorized live graded exams or pages with CAPTCHA challenges', async () => {
    const repo = new QuizPilotRepository();
    await repo.clearAllData();
    const ai = new DeterministicAnalysisProvider();
    const sourceManager = new AnswerSourceManager(ai, DEFAULT_ANSWER_KEY_ENTRIES, 0.65);
    const engine = new PracticeAutomationEngine();

    // 1. Live graded assessment
    const gradedDoc = document.implementation.createHTMLDocument('Graded Exam');
    renderSyntheticQuizDom(gradedDoc, { scenario: 'unauthorized_graded' });
    const gradedRes = await engine.runPracticeSession({
      doc: gradedDoc,
      url: 'https://university.edu/graded-midterm',
      settings: DEFAULT_SETTINGS,
      answerSourceManager: sourceManager,
      aiProvider: ai,
      repository: repo
    });
    expect(gradedRes.session.status).toBe('stopped_safety_restriction');
    expect(gradedRes.questions).toHaveLength(0);

    // 2. CAPTCHA challenge
    const captchaDoc = document.implementation.createHTMLDocument('CAPTCHA Page');
    renderSyntheticQuizDom(captchaDoc, { scenario: 'captcha_challenge' });
    const captchaRes = await engine.runPracticeSession({
      doc: captchaDoc,
      url: 'http://localhost:5173/quiz-lab.html',
      settings: DEFAULT_SETTINGS,
      answerSourceManager: sourceManager,
      aiProvider: ai,
      repository: repo
    });
    expect(captchaRes.session.status).toBe('stopped_safety_restriction');
    expect(captchaRes.questions).toHaveLength(0);
    expect(captchaRes.session.stopReason).toContain('CAPTCHA');
  });

  it('processes a large 60-question practice bank and coordinates extension messages', async () => {
    const doc = document.implementation.createHTMLDocument('Large 60Q Quiz');
    renderSyntheticQuizDom(doc, { scenario: 'large_bank' });

    const scanRes = await handleContentScriptMessage(
      {
        action: 'SCAN_PAGE',
        requestId: 'req_scan_60',
        timestamp: new Date().toISOString()
      },
      doc,
      'http://localhost:5173/quiz-lab.html'
    );
    expect(scanRes.ok).toBe(true);
    expect((scanRes.scan as { detectedQuestionCount: number }).detectedQuestionCount).toBe(60);

    const swRes = await handleServiceWorkerMessage({
      action: 'GET_STATUS',
      requestId: 'req_sw_status',
      timestamp: new Date().toISOString()
    });
    expect(swRes.ok).toBe(true);
  });
});
