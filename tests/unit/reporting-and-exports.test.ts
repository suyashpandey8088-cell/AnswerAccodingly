import { describe, expect, it } from 'vitest';
import { DeterministicAnalysisProvider } from '../../src/core/ai/deterministic-ai';
import { CapturedQuestion, PracticeSession } from '../../src/core/models/types';
import {
  exportQuestionBankToCsv,
  exportReportToMarkdown,
  exportReportToPdfBytes,
  exportSessionArchiveToJson
} from '../../src/core/reporting/exporters';
import { generateStudyReport } from '../../src/core/reporting/report-generator';

function buildFixtureSession(): PracticeSession {
  return {
    sessionId: 'sess_unit_rep_1',
    title: 'Distributed Systems & Security Practice Run',
    profileName: 'Default Profile',
    targetUrl: 'http://localhost:5173/quiz-lab.html',
    status: 'completed',
    startedAt: '2026-10-26T06:00:00.000Z',
    updatedAt: '2026-10-26T06:05:00.000Z',
    completedAt: '2026-10-26T06:05:00.000Z',
    elapsedMs: 1200,
    totalDetectedQuestions: 3,
    processedQuestionIds: ['q1', 'q2', 'q3'],
    recoverableErrorCount: 0,
    uncertainAnswerCount: 1,
    unsupportedQuestionCount: 0,
    events: []
  };
}

function buildFixtureQuestions(): CapturedQuestion[] {
  return [
    {
      sessionId: 'sess_unit_rep_1',
      questionId: 'q1',
      fingerprint: 'qf_0001',
      questionText: 'What trade-off does CAP theorem state during a partition?',
      questionType: 'single_choice',
      options: [
        { id: 'a', label: 'A', text: 'Consistency vs Availability' },
        { id: 'b', label: 'B', text: 'Latency vs Bandwidth' }
      ],
      selectedResponse: ['a'],
      officialCorrectAnswer: ['a'],
      aiProposedAnswer: null,
      explanation: 'Official key verified.',
      verificationStatus: 'verified_correct',
      answerSource: 'official_key',
      confidenceScore: 0.99,
      subject: 'Distributed Systems',
      topic: 'Consensus & Replication',
      subtopic: 'CAP Theorem',
      difficulty: 'medium',
      difficultyScore: 5.0,
      timeSpentMs: 320,
      errorCategory: 'none',
      sourceMetadata: {
        referenceUrl: 'http://localhost:5173/quiz-lab.html',
        originDomain: 'localhost',
        quizTitle: 'Practice Run',
        authorizationMode: 'synthetic_sandbox',
        sourceProvenance: 'Official Key #1'
      },
      timestamp: '2026-10-26T06:01:00.000Z'
    },
    {
      sessionId: 'sess_unit_rep_1',
      questionId: 'q2',
      fingerprint: 'qf_0002',
      questionText: 'Which HTTP methods are idempotent?',
      questionType: 'multiple_choice',
      options: [
        { id: 'get', label: 'A', text: 'GET' },
        { id: 'put', label: 'B', text: 'PUT' },
        { id: 'delete', label: 'C', text: 'DELETE' }
      ],
      selectedResponse: ['get', 'put'],
      officialCorrectAnswer: ['get', 'put', 'delete'],
      aiProposedAnswer: null,
      explanation: 'Missed DELETE in multi-select.',
      verificationStatus: 'verified_incorrect',
      answerSource: 'official_key',
      confidenceScore: 0.85,
      subject: 'Networking',
      topic: 'HTTP & Transport Protocols',
      subtopic: 'RFC 9110 Idempotency',
      difficulty: 'hard',
      difficultyScore: 7.5,
      timeSpentMs: 540,
      errorCategory: 'partial_multi_select',
      sourceMetadata: {
        referenceUrl: 'http://localhost:5173/quiz-lab.html',
        originDomain: 'localhost',
        quizTitle: 'Practice Run',
        authorizationMode: 'synthetic_sandbox',
        sourceProvenance: 'Official Key #2'
      },
      timestamp: '2026-10-26T06:02:00.000Z'
    },
    {
      sessionId: 'sess_unit_rep_1',
      questionId: 'q3',
      fingerprint: 'qf_0003',
      questionText: 'Unverified AI-suggested question on retry jitter?',
      questionType: 'single_choice',
      options: [
        { id: 'j1', label: 'A', text: 'Exponential backoff with jitter' },
        { id: 'j2', label: 'B', text: 'Immediate tight loop' }
      ],
      selectedResponse: ['j1'],
      officialCorrectAnswer: null,
      aiProposedAnswer: ['j1'],
      explanation: 'AI candidate inference without official key.',
      verificationStatus: 'ai_suggested',
      answerSource: 'ai_inference',
      confidenceScore: 0.8,
      subject: 'Distributed Systems',
      topic: 'Fault Tolerance & Idempotency',
      subtopic: 'Retry Jitter',
      difficulty: 'medium',
      difficultyScore: 5.5,
      timeSpentMs: 280,
      errorCategory: 'none',
      sourceMetadata: {
        referenceUrl: 'http://localhost:5173/quiz-lab.html',
        originDomain: 'localhost',
        quizTitle: 'Practice Run',
        authorizationMode: 'synthetic_sandbox',
        sourceProvenance: 'AI Candidate'
      },
      timestamp: '2026-10-26T06:03:00.000Z'
    }
  ];
}

describe('Intelligent Report Generation & Exports (Stage 7)', () => {
  it('calculates scores strictly over verified questions and excludes unverified AI suggestions', () => {
    const ai = new DeterministicAnalysisProvider();
    const session = buildFixtureSession();
    const questions = buildFixtureQuestions();

    const report = generateStudyReport({
      session,
      questions,
      aiProvider: ai,
      learnerDailyStudyMinutes: 60,
      learnerTargetExamDate: '2026-11-09'
    });

    // 1 verified_correct + 1 verified_incorrect = 2 verified questions; 1 ai_suggested excluded
    expect(report.performanceAnalysis.verifiedNumerator).toBe(1);
    expect(report.performanceAnalysis.verifiedDenominator).toBe(2);
    expect(report.performanceAnalysis.excludedFromScoreCount).toBe(1);
    expect(report.executiveSummary.verifiedScorePercent).toBe(50.0);

    // High-confidence incorrect on q2 (0.85 confidence) is flagged in calibration
    expect(
      report.performanceAnalysis.confidenceCalibration.highConfidenceVerifiedIncorrect
    ).toBe(1);

    // q2 (verified_incorrect) is classified as HIGH priority with rationale
    const q2Imp = report.importantQuestions.items.find((i) => i.questionId === 'q2');
    expect(q2Imp?.priorityLevel).toBe('high');
    expect(q2Imp?.priorityRationale).toContain('High Priority: Verified error');

    // q3 (ai_suggested) is classified as MEDIUM priority
    const q3Imp = report.importantQuestions.items.find((i) => i.questionId === 'q3');
    expect(q3Imp?.priorityLevel).toBe('medium');

    // q1 (verified_correct on isolated topic) is classified as LOW priority
    const q1Imp = report.importantQuestions.items.find((i) => i.questionId === 'q1');
    expect(q1Imp?.priorityLevel).toBe('low');
  });

  it('never invents a score (returns null) when no official correctness data is available', () => {
    const ai = new DeterministicAnalysisProvider();
    const session = buildFixtureSession();
    const unverifiedOnly = buildFixtureQuestions().filter((q) => q.questionId === 'q3');

    const report = generateStudyReport({
      session,
      questions: unverifiedOnly,
      aiProvider: ai
    });

    expect(report.performanceAnalysis.verifiedDenominator).toBe(0);
    expect(report.executiveSummary.verifiedScorePercent).toBeNull();
    expect(report.performanceAnalysis.verifiedAccuracyPercent).toBeNull();
    expect(report.executiveSummary.scoreDenominatorNote).toContain(
      'Score is intentionally omitted (null)'
    );
  });

  it('generates real PDF, CSV, JSON, and Markdown exports containing actual session data', () => {
    const ai = new DeterministicAnalysisProvider();
    const session = buildFixtureSession();
    const questions = buildFixtureQuestions();
    const report = generateStudyReport({ session, questions, aiProvider: ai });

    const csv = exportQuestionBankToCsv(report);
    expect(csv).toContain('Session ID,Question ID,Question Type');
    expect(csv).toContain('sess_unit_rep_1,q1,single_choice');
    expect(csv).toContain('verified_incorrect');
    expect(csv).toContain('UNVERIFIED');

    const jsonStr = exportSessionArchiveToJson(session, report);
    const parsedJson = JSON.parse(jsonStr);
    expect(parsedJson.session.sessionId).toBe('sess_unit_rep_1');
    expect(parsedJson.report.questionBank).toHaveLength(3);

    const md = exportReportToMarkdown(report);
    expect(md).toContain('# QuizPilot AI — Study & Performance Report');
    expect(md).toContain('## A. Executive Summary');
    expect(md).toContain('## B. Complete Question Bank');
    expect(md).toContain('## C. Important-Question Classification');
    expect(md).toContain('## D. Performance Analysis');
    expect(md).toContain('## E. Personalized Preparation Plan');

    const pdfBytes = exportReportToPdfBytes(report);
    const pdfText = new TextDecoder().decode(pdfBytes);
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfText).toContain('QuizPilot AI Study Report');
    expect(pdfText).toContain('Distributed Systems & Security Practice Run');
    expect(pdfText.trim().endsWith('%%EOF')).toBe(true);
  });
});
