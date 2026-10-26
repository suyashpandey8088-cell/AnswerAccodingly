import { JSDOM } from 'jsdom';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DeterministicAnalysisProvider } from '../src/core/ai/deterministic-ai';
import { PracticeAutomationEngine } from '../src/core/automation/engine';
import {
  exportQuestionBankToCsv,
  exportReportToMarkdown,
  exportReportToPdfBytes,
  exportSessionArchiveToJson
} from '../src/core/reporting/exporters';
import { AnswerSourceManager } from '../src/core/sources/answer-sources';
import { DEFAULT_SETTINGS, QuizPilotRepository } from '../src/core/storage/repository';
import { renderSyntheticQuizDom } from '../src/quiz-sandbox/quiz-app';
import { DEFAULT_ANSWER_KEY_ENTRIES } from '../src/quiz-sandbox/synthetic-bank';

async function main() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost:5173/quiz-lab.html?scenario=standard'
  });

  renderSyntheticQuizDom(dom.window.document, { scenario: 'standard' });

  const repo = new QuizPilotRepository();
  const aiProvider = new DeterministicAnalysisProvider();

  // Simulate one realistic partial multi-select choice on q_std_4 so the sample report
  // demonstrates verified_correct (8 items), verified_incorrect (1 item), ai_suggested (1 item), and uncertain (1 item)
  const sampleKeys = DEFAULT_ANSWER_KEY_ENTRIES.map((k) =>
    k.questionId === 'q_std_4'
      ? { ...k, acceptedAnswers: ['opt_http_get', 'opt_http_put'] }
      : k
  );

  const sourceManager = new AnswerSourceManager(
    aiProvider,
    sampleKeys,
    DEFAULT_SETTINGS.minConfidenceThreshold
  );

  const engine = new PracticeAutomationEngine();
  const result = await engine.runPracticeSession({
    doc: dom.window.document,
    url: 'http://localhost:5173/quiz-lab.html?scenario=standard',
    sessionId: 'sess_sample_synthetic_2026',
    sessionTitle: 'CS-402 Distributed Systems & Security — Synthetic Practice Run',
    settings: {
      ...DEFAULT_SETTINGS,
      stepDelayMs: 5,
      learnerDailyStudyMinutes: 75,
      learnerTargetExamDate: '2026-11-09'
    },
    answerSourceManager: sourceManager,
    aiProvider,
    repository: repo
  });

  const reportsDir = resolve(process.cwd(), 'reports');
  mkdirSync(reportsDir, { recursive: true });

  const md = exportReportToMarkdown(result.report);
  const csv = exportQuestionBankToCsv(result.report);
  const json = exportSessionArchiveToJson(result.session, result.report);
  const pdf = exportReportToPdfBytes(result.report);

  writeFileSync(resolve(reportsDir, 'sample-session-report.md'), md, 'utf8');
  writeFileSync(resolve(reportsDir, 'sample-question-bank.csv'), csv, 'utf8');
  writeFileSync(resolve(reportsDir, 'sample-session-archive.json'), json, 'utf8');
  writeFileSync(resolve(reportsDir, 'sample-session-report.pdf'), pdf);

  console.log(
    `Generated sample report artifacts in ./reports/ (${result.questions.length} questions, verified score: ${result.report.executiveSummary.verifiedScorePercent}%)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
