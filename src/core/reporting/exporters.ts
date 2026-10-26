import { PracticeSession, StudyReport } from '../models/types';

/**
 * Exports the Complete Question Bank to RFC 4180 CSV format (Section 6.F).
 */
export function exportQuestionBankToCsv(report: StudyReport): string {
  const headers = [
    'Session ID',
    'Question ID',
    'Question Type',
    'Subject',
    'Topic',
    'Subtopic',
    'Difficulty',
    'Priority Level',
    'Verification Status',
    'Answer Source',
    'Confidence Score',
    'Question Text',
    'Available Options',
    'Selected Response',
    'Official Correct Answer',
    'AI Proposed Answer',
    'Explanation',
    'Priority Rationale',
    'Recommended Revision Action',
    'Time Spent (ms)',
    'Error Category',
    'Reference URL',
    'Timestamp'
  ];

  const escapeCsvCell = (val: unknown): string => {
    const str = val === null || val === undefined ? '' : String(val);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = report.questionBank.map((q) => [
    q.sessionId,
    q.questionId,
    q.questionType,
    q.subject,
    q.topic,
    q.subtopic,
    q.difficulty,
    q.priorityLevel || 'medium',
    q.verificationStatus,
    q.answerSource,
    q.confidenceScore.toFixed(2),
    q.questionText,
    q.options.map((o) => `${o.label}: ${o.text} (${o.id})`).join(' | '),
    q.selectedResponse.join(' | '),
    q.officialCorrectAnswer ? q.officialCorrectAnswer.join(' | ') : 'UNVERIFIED',
    q.aiProposedAnswer ? q.aiProposedAnswer.join(' | ') : '',
    q.explanation,
    q.priorityRationale || '',
    q.recommendedRevisionAction || '',
    q.timeSpentMs,
    q.errorCategory,
    q.sourceMetadata.referenceUrl,
    q.timestamp
  ]);

  return [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
}

/**
 * Exports the complete session archive to JSON (Section 6.F).
 */
export function exportSessionArchiveToJson(
  session: PracticeSession,
  report: StudyReport
): string {
  const archive = {
    schemaVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    application: 'QuizPilot AI',
    session,
    report
  };
  return JSON.stringify(archive, null, 2);
}

/**
 * Exports structured Markdown revision notes & full study report (Section 6.F).
 */
export function exportReportToMarkdown(report: StudyReport): string {
  const { executiveSummary: exec, importantQuestions: imp, performanceAnalysis: perf, studyPlan: plan } = report;
  const scoreDisplay =
    exec.verifiedScorePercent !== null
      ? `${exec.verifiedScorePercent}% (${perf.verifiedNumerator}/${perf.verifiedDenominator} verified)`
      : 'Not Scored (No Official Answer Key Available)';

  const lines: string[] = [
    `# QuizPilot AI — Study & Performance Report`,
    ``,
    `- **Session Title:** ${report.sessionTitle}`,
    `- **Session ID:** \`${report.sessionId}\``,
    `- **Report ID:** \`${report.reportId}\``,
    `- **Generated At:** ${report.generatedAt}`,
    ``,
    `---`,
    ``,
    `## A. Executive Summary`,
    ``,
    `| Metric | Value |`,
    `| :--- | :--- |`,
    `| Total Questions Processed | ${exec.totalQuestionsProcessed} |`,
    `| Answered / Unanswered | ${exec.answeredCount} answered / ${exec.unansweredCount} unanswered |`,
    `| Verified Correct | ${exec.verifiedCorrectCount} |`,
    `| Verified Incorrect | ${exec.verifiedIncorrectCount} |`,
    `| AI-Suggested (Unverified) | ${exec.aiSuggestedCount} |`,
    `| Uncertain / Ambiguous | ${exec.uncertainCount} |`,
    `| Unsupported Layout | ${exec.unsupportedCount} |`,
    `| **Verified Performance Score** | **${scoreDisplay}** |`,
    ``,
    `> **Scoring Integrity Note:** ${exec.scoreDenominatorNote}`,
    ``,
    `### Topic Coverage`,
    exec.topicCoverage.map((t) => `- ${t}`).join('\n') || '- None',
    ``,
    `### Principal Strengths`,
    exec.principalStrengths.map((s) => `- ${s}`).join('\n') || '- None identified yet',
    ``,
    `### Principal Weaknesses & Knowledge Gaps`,
    exec.principalWeaknesses.map((w) => `- ${w}`).join('\n') || '- No verified weaknesses detected',
    ``,
    `---`,
    ``,
    `## B. Complete Question Bank`,
    ``
  ];

  report.questionBank.forEach((q, idx) => {
    lines.push(`### Q${idx + 1}. [${q.questionId}] ${q.questionText}`);
    lines.push(`- **Type:** \`${q.questionType}\` | **Subject:** ${q.subject} | **Topic:** ${q.topic} (${q.subtopic})`);
    lines.push(`- **Difficulty:** \`${q.difficulty.toUpperCase()}\` (${q.difficultyScore}/10) | **Importance Priority:** \`${(q.priorityLevel || 'medium').toUpperCase()}\``);
    lines.push(`- **Verification Status:** \`${q.verificationStatus}\` | **Source:** \`${q.answerSource}\` (${q.sourceMetadata.sourceProvenance}) | **Confidence:** ${(q.confidenceScore * 100).toFixed(0)}%`);
    if (q.options.length > 0) {
      lines.push(`- **Options:**`);
      q.options.forEach((opt) => {
        lines.push(`  - \`${opt.label}\` (\`${opt.id}\`): ${opt.text}`);
      });
    }
    lines.push(`- **Selected Response:** ${q.selectedResponse.length > 0 ? q.selectedResponse.join(', ') : '_None (Unanswered)_'}`);
    lines.push(
      `- **Official Correct Answer:** ${
        q.officialCorrectAnswer && q.officialCorrectAnswer.length > 0
          ? q.officialCorrectAnswer.join(', ')
          : '_Not verified by an official key_'
      }`
    );
    if (q.aiProposedAnswer && q.aiProposedAnswer.length > 0) {
      lines.push(`- **AI-Proposed Candidate:** ${q.aiProposedAnswer.join(', ')}`);
    }
    lines.push(`- **Explanation:** ${q.explanation}`);
    lines.push(`- **Priority Rationale:** ${q.priorityRationale || 'Standard review'}`);
    lines.push(`- **Recommended Revision Action:** ${q.recommendedRevisionAction || 'Review concept'}`);
    lines.push(``);
  });

  lines.push(
    `---`,
    ``,
    `## C. Important-Question Classification`,
    ``,
    `> **Methodology:** ${imp.methodologyNote}`,
    `>`,
    `> **${imp.historicalDisclaimer}**`,
    ``,
    `- **High Priority:** ${imp.highPriorityCount} | **Medium Priority:** ${imp.mediumPriorityCount} | **Low Priority:** ${imp.lowPriorityCount}`,
    ``
  );

  imp.items.forEach((item) => {
    lines.push(
      `- **[${item.priorityLevel.toUpperCase()}] \`${item.questionId}\` (${item.topic} — ${item.difficulty}):** ${item.priorityRationale} -> *Action:* ${item.recommendedAction}`
    );
  });

  lines.push(
    ``,
    `---`,
    ``,
    `## D. Performance Analysis`,
    ``,
    `- **Verified Accuracy:** ${
      perf.verifiedAccuracyPercent !== null
        ? `${perf.verifiedAccuracyPercent}% (${perf.verifiedNumerator}/${perf.verifiedDenominator})`
        : 'N/A (0 verified questions)'
    }`,
    `- **Excluded from Score:** ${perf.excludedFromScoreCount} question(s) (${perf.exclusionExplanation})`,
    `- **Average Time per Question:** ${perf.averageTimePerQuestionMs} ms (Total: ${perf.totalTimeSpentMs} ms)`,
    `- **Confidence Calibration:** ${perf.confidenceCalibration.calibrationNote}`,
    ``,
    `### Accuracy by Topic`,
    `| Subject | Topic | Total | Verified | Correct | Incorrect | Uncertain/AI | Verified Accuracy | Avg Time (ms) |`,
    `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`
  );

  perf.accuracyByTopic.forEach((t) => {
    lines.push(
      `| ${t.subject} | ${t.topic} | ${t.totalQuestions} | ${t.verifiedTotal} | ${t.verifiedCorrect} | ${t.verifiedIncorrect} | ${t.uncertainOrAiCount} | ${
        t.verifiedAccuracyPercent !== null ? `${t.verifiedAccuracyPercent}%` : 'Unverified'
      } | ${t.averageTimeMs} |`
    );
  });

  lines.push(
    ``,
    `### Error Rate by Question Type`,
    `| Question Type | Total | Verified Total | Verified Incorrect | Verified Error Rate | Uncertain/AI |`,
    `| :--- | :---: | :---: | :---: | :---: | :---: |`
  );

  perf.errorRateByQuestionType.forEach((qt) => {
    lines.push(
      `| \`${qt.questionType}\` | ${qt.totalQuestions} | ${qt.verifiedTotal} | ${qt.verifiedIncorrect} | ${
        qt.errorRatePercent !== null ? `${qt.errorRatePercent}%` : 'N/A'
      } | ${qt.uncertainCount} |`
    );
  });

  lines.push(
    ``,
    `---`,
    ``,
    `## E. Personalized Preparation Plan`,
    ``,
    `- **Learner Daily Study Budget:** ${plan.learnerDailyMinutes} minutes/day`,
    `- **Target Assessment Date:** ${plan.targetExamDate} (${plan.daysUntilTarget} days remaining)`,
    `- **Recommended Revision Order:** ${plan.recommendedRevisionOrder.join(' → ') || 'Core Review'}`,
    ``,
    `### Priority Topics for Revision`,
    ...plan.priorityTopics.map(
      (pt) => `${pt.rank}. **${pt.topic}** (${pt.recommendedMinutes} min/day) — ${pt.reason}`
    ),
    ``,
    `### Suggested Daily Study Schedule`,
    ...plan.dailySchedule.map(
      (day) =>
        `- **Day ${day.dayIndex} (${day.dateLabel}) [${day.allocatedMinutes} min] — Focus: ${day.focusTopics.join(', ')}**\n  ${day.activities
          .map((a) => `  - ${a}`)
          .join('\n')}`
    ),
    ``,
    `### Spaced-Repetition Recommendations`,
    ...plan.spacedRepetitionQueue.map(
      (sr) =>
        `- **${sr.topic}** (\`${sr.urgency}\`, intervals: Day ${sr.scheduleIntervalsDays.join(', Day ')}): ${sr.rationale} (Questions: ${sr.questionIds.join(', ')})`
    ),
    ``,
    `### Follow-Up Mock-Test Plan`,
    `- **Timing:** ${plan.followUpMockPlan.recommendedTiming}`,
    `- **Focus Areas:** ${plan.followUpMockPlan.focusAreas.join(', ')}`,
    `- **Target Conditions:** ${plan.followUpMockPlan.targetConditions}`,
    ``,
    `### Criteria for Measuring Improvement`,
    ...plan.improvementCriteria.map((c) => `- [ ] ${c}`),
    ``
  );

  return lines.join('\n');
}

/**
 * Generates a valid, self-contained binary PDF 1.4 document from actual session report data (Section 6.F).
 * Works in both browser and Node environments without external native binaries.
 */
export function exportReportToPdfBytes(report: StudyReport): Uint8Array {
  const mdText = exportReportToMarkdown(report);
  const plainLines = wrapTextLines(
    mdText
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .split('\n'),
    88
  );

  const linesPerPage = 46;
  const pages: string[][] = [];
  for (let i = 0; i < plainLines.length; i += linesPerPage) {
    pages.push(plainLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) {
    pages.push(['QuizPilot AI Study Report']);
  }

  const escapePdfText = (s: string): string =>
    s
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

  // Build PDF objects:
  // 1: Catalog, 2: Pages, 3: Font (Helvetica), then (Page, ContentStream) pairs
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageObjectIds: number[] = [];
  let nextObjId = 4;
  for (let p = 0; p < pages.length; p++) {
    pageObjectIds.push(nextObjId);
    nextObjId += 2;
  }

  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  );

  for (let p = 0; p < pages.length; p++) {
    const pageObjId = pageObjectIds[p];
    const streamObjId = pageObjId + 1;
    const pageLines = pages[p];

    const streamOps: string[] = ['BT', '/F1 9.5 Tf', '42 752 Td', '14 TL'];
    streamOps.push(
      `(${escapePdfText(`QuizPilot AI Study Report — ${report.sessionTitle} (Page ${p + 1}/${pages.length})`)}) Tj`,
      'T*',
      'T*'
    );

    for (const line of pageLines) {
      streamOps.push(`(${escapePdfText(line)}) Tj`, 'T*');
    }
    streamOps.push('ET');
    const streamBody = streamOps.join('\n');

    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObjId} 0 R >>\nendobj\n`
    );
    objects.push(
      `${streamObjId} 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream\nendobj\n`
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

function wrapTextLines(lines: string[], maxCols: number): string[] {
  const result: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length <= maxCols) {
      result.push(line);
      continue;
    }
    let remaining = line;
    while (remaining.length > maxCols) {
      let splitAt = remaining.lastIndexOf(' ', maxCols);
      if (splitAt <= 20) splitAt = maxCols;
      result.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining.length > 0) {
      result.push(remaining);
    }
  }
  return result;
}
