import { AIAnalysisProvider } from '../ai/provider';
import {
  CapturedQuestion,
  ConfidenceCalibrationSummary,
  ImportantQuestionItem,
  PracticeSession,
  PriorityLevel,
  QuestionType,
  QuestionTypeErrorMetric,
  StudyReport,
  TopicPerformanceMetric
} from '../models/types';

export function generateStudyReport(params: {
  session: PracticeSession;
  questions: CapturedQuestion[];
  aiProvider: AIAnalysisProvider;
  learnerDailyStudyMinutes?: number;
  learnerTargetExamDate?: string;
}): StudyReport {
  const {
    session,
    questions,
    aiProvider,
    learnerDailyStudyMinutes = 60,
    learnerTargetExamDate = '2026-11-09'
  } = params;

  // Deduplicate questions by fingerprint within the session just in case
  const dedupedMap = new Map<string, CapturedQuestion>();
  for (const q of questions) {
    dedupedMap.set(q.fingerprint || q.questionId, { ...q });
  }
  const uniqueQuestions = Array.from(dedupedMap.values());

  // Compute topic error counts and concept repetition counts for transparent priority classification
  const topicErrorCounts = new Map<string, number>();
  const topicTotalCounts = new Map<string, number>();
  for (const q of uniqueQuestions) {
    topicTotalCounts.set(q.topic, (topicTotalCounts.get(q.topic) || 0) + 1);
    if (q.verificationStatus === 'verified_incorrect') {
      topicErrorCounts.set(q.topic, (topicErrorCounts.get(q.topic) || 0) + 1);
    }
  }

  const clusters = aiProvider.groupSimilarQuestions(uniqueQuestions);
  const questionToCluster = new Map<string, { clusterId: string; relatedIds: string[] }>();
  for (const c of clusters) {
    for (const qId of c.questionIds) {
      questionToCluster.set(qId, {
        clusterId: c.clusterId,
        relatedIds: c.questionIds.filter((id) => id !== qId)
      });
    }
  }

  // Classify each question into High, Medium, or Low priority with transparent rationale (Section 6.C)
  const importantItems: ImportantQuestionItem[] = [];
  const enrichedQuestionBank: CapturedQuestion[] = uniqueQuestions.map((q) => {
    const topicErrors = topicErrorCounts.get(q.topic) || 0;
    const topicOccurrences = topicTotalCounts.get(q.topic) || 1;
    const clusterInfo = questionToCluster.get(q.questionId) || {
      clusterId: 'cluster_singleton',
      relatedIds: []
    };

    let priorityLevel: PriorityLevel = 'low';
    let priorityRationale = '';
    let recommendedRevisionAction = '';

    if (q.verificationStatus === 'verified_incorrect') {
      priorityLevel = 'high';
      priorityRationale =
        topicErrors > 1
          ? `High Priority: Verified error in a concept ("${q.topic}") associated with multiple errors (${topicErrors} mistakes across ${topicOccurrences} items).`
          : `High Priority: Verified error on a ${q.difficulty}-difficulty foundational concept in "${q.topic}".`;
      recommendedRevisionAction = `Compare your selected response (${q.selectedResponse.join(', ') || 'none'}) against the verified key (${(q.officialCorrectAnswer || []).join(', ')}) and restudy "${q.subtopic}".`;
    } else if (topicErrors >= 2 || (topicOccurrences >= 2 && q.verificationStatus !== 'verified_correct')) {
      priorityLevel = 'high';
      priorityRationale = `High Priority: Repeated concept in practice materials ("${q.topic}" appears ${topicOccurrences} times) with unresolved knowledge gaps.`;
      recommendedRevisionAction = `Cross-verify "${q.topic}" against primary reference documentation and complete targeted practice drills.`;
    } else if (
      q.verificationStatus === 'uncertain' ||
      q.verificationStatus === 'ai_suggested' ||
      q.verificationStatus === 'unanswered' ||
      q.verificationStatus === 'unsupported'
    ) {
      priorityLevel = 'medium';
      priorityRationale = `Medium Priority: Supporting concept in "${q.topic}" with ${q.verificationStatus.replace('_', ' ')} status requiring authoritative verification.`;
      recommendedRevisionAction =
        q.verificationStatus === 'ai_suggested'
          ? 'Validate the AI-proposed candidate answer against an official answer key before relying on it for exam preparation.'
          : 'Obtain an authoritative explanation or answer key to resolve this ambiguous/unanswered item.';
    } else if (q.difficulty === 'hard' && topicOccurrences >= 2) {
      priorityLevel = 'medium';
      priorityRationale = `Medium Priority: Verified correct, but tests a recurring high-difficulty concept ("${q.topic}").`;
      recommendedRevisionAction = 'Include in 7-day spaced-repetition review to maintain mastery.';
    } else {
      priorityLevel = 'low';
      priorityRationale = `Low Priority: Verified correct response on an isolated or already mastered detail in "${q.topic}" with no recurring errors.`;
      recommendedRevisionAction = 'Schedule lightweight 14-day maintenance review only.';
    }

    importantItems.push({
      questionId: q.questionId,
      questionText: q.questionText,
      topic: q.topic,
      subtopic: q.subtopic,
      difficulty: q.difficulty,
      priorityLevel,
      priorityRationale,
      verificationStatus: q.verificationStatus,
      recommendedAction: recommendedRevisionAction,
      similarityClusterId: clusterInfo.clusterId,
      relatedQuestionIds: clusterInfo.relatedIds
    });

    return {
      ...q,
      priorityLevel,
      priorityRationale,
      recommendedRevisionAction,
      similarityClusterId: clusterInfo.clusterId
    };
  });

  // Sort importantItems: high -> medium -> low
  const priorityRank: Record<PriorityLevel, number> = { high: 1, medium: 2, low: 3 };
  importantItems.sort((a, b) => priorityRank[a.priorityLevel] - priorityRank[b.priorityLevel]);

  // Section 6.A & 6.D: Counts and Verified-Only Scoring
  const totalQuestionsProcessed = enrichedQuestionBank.length;
  const answeredCount = enrichedQuestionBank.filter((q) => q.selectedResponse.length > 0).length;
  const unansweredCount = totalQuestionsProcessed - answeredCount;

  const verifiedCorrectCount = enrichedQuestionBank.filter(
    (q) => q.verificationStatus === 'verified_correct'
  ).length;
  const verifiedIncorrectCount = enrichedQuestionBank.filter(
    (q) => q.verificationStatus === 'verified_incorrect'
  ).length;
  const aiSuggestedCount = enrichedQuestionBank.filter(
    (q) => q.verificationStatus === 'ai_suggested'
  ).length;
  const uncertainCount = enrichedQuestionBank.filter(
    (q) => q.verificationStatus === 'uncertain'
  ).length;
  const unsupportedCount = enrichedQuestionBank.filter(
    (q) => q.verificationStatus === 'unsupported'
  ).length;

  // Verified denominator includes questions where an authoritative official key exists
  const verifiedQuestions = enrichedQuestionBank.filter(
    (q) =>
      q.verificationStatus === 'verified_correct' ||
      q.verificationStatus === 'verified_incorrect' ||
      (q.officialCorrectAnswer && q.officialCorrectAnswer.length > 0)
  );
  const verifiedDenominator = verifiedQuestions.length;
  const excludedFromScoreCount = totalQuestionsProcessed - verifiedDenominator;

  // NEVER invent a score when official correctness data is unavailable!
  const verifiedScorePercent =
    verifiedDenominator > 0
      ? Number(((verifiedCorrectCount / verifiedDenominator) * 100).toFixed(1))
      : null;

  const scoreDenominatorNote =
    verifiedDenominator > 0
      ? `Calculated strictly over ${verifiedDenominator} officially verified question(s) (${verifiedCorrectCount}/${verifiedDenominator}). Excluded ${excludedFromScoreCount} unverified/AI-suggested/uncertain question(s) from the score denominator.`
      : 'No official answer key or authoritative correctness data was available for this session. Score is intentionally omitted (null) rather than fabricated from unverified AI estimates.';

  // Topic performance metrics
  const topicMap = new Map<string, CapturedQuestion[]>();
  for (const q of enrichedQuestionBank) {
    const list = topicMap.get(q.topic) || [];
    list.push(q);
    topicMap.set(q.topic, list);
  }

  const accuracyByTopic: TopicPerformanceMetric[] = Array.from(topicMap.entries()).map(
    ([topic, list]) => {
      const vCorrect = list.filter((q) => q.verificationStatus === 'verified_correct').length;
      const vIncorrect = list.filter((q) => q.verificationStatus === 'verified_incorrect').length;
      const vTotal = list.filter(
        (q) =>
          q.verificationStatus === 'verified_correct' ||
          q.verificationStatus === 'verified_incorrect' ||
          (q.officialCorrectAnswer && q.officialCorrectAnswer.length > 0)
      ).length;
      const uncOrAi = list.filter(
        (q) => q.verificationStatus === 'uncertain' || q.verificationStatus === 'ai_suggested'
      ).length;
      const unans = list.filter(
        (q) => q.verificationStatus === 'unanswered' || q.verificationStatus === 'unsupported'
      ).length;
      const avgTime =
        list.length > 0
          ? Math.round(list.reduce((acc, q) => acc + q.timeSpentMs, 0) / list.length)
          : 0;
      const avgConf =
        list.length > 0
          ? Number(
              (list.reduce((acc, q) => acc + q.confidenceScore, 0) / list.length).toFixed(2)
            )
          : 0;

      return {
        subject: list[0]?.subject || 'General',
        topic,
        totalQuestions: list.length,
        verifiedTotal: vTotal,
        verifiedCorrect: vCorrect,
        verifiedIncorrect: vIncorrect,
        uncertainOrAiCount: uncOrAi,
        unansweredCount: unans,
        verifiedAccuracyPercent:
          vTotal > 0 ? Number(((vCorrect / vTotal) * 100).toFixed(1)) : null,
        averageTimeMs: avgTime,
        averageConfidence: avgConf
      };
    }
  );

  // Question type error metrics
  const qTypes: QuestionType[] = [
    'single_choice',
    'multiple_choice',
    'true_false',
    'text_input',
    'unsupported'
  ];
  const errorRateByQuestionType: QuestionTypeErrorMetric[] = qTypes
    .map((qt) => {
      const list = enrichedQuestionBank.filter((q) => q.questionType === qt);
      const vIncorrect = list.filter((q) => q.verificationStatus === 'verified_incorrect').length;
      const vTotal = list.filter(
        (q) =>
          q.verificationStatus === 'verified_correct' ||
          q.verificationStatus === 'verified_incorrect' ||
          (q.officialCorrectAnswer && q.officialCorrectAnswer.length > 0)
      ).length;
      const unc = list.filter(
        (q) => q.verificationStatus === 'uncertain' || q.verificationStatus === 'ai_suggested'
      ).length;

      return {
        questionType: qt,
        totalQuestions: list.length,
        verifiedTotal: vTotal,
        verifiedIncorrect: vIncorrect,
        errorRatePercent:
          vTotal > 0 ? Number(((vIncorrect / vTotal) * 100).toFixed(1)) : null,
        uncertainCount: unc
      };
    })
    .filter((m) => m.totalQuestions > 0);

  // Confidence vs correctness calibration
  const highConfCorrect = verifiedQuestions.filter(
    (q) => q.verificationStatus === 'verified_correct' && q.confidenceScore >= 0.75
  );
  const highConfIncorrect = verifiedQuestions.filter(
    (q) => q.verificationStatus === 'verified_incorrect' && q.confidenceScore >= 0.75
  );
  const lowConfCorrect = verifiedQuestions.filter(
    (q) => q.verificationStatus === 'verified_correct' && q.confidenceScore < 0.75
  );
  const lowConfIncorrect = verifiedQuestions.filter(
    (q) => q.verificationStatus === 'verified_incorrect' && q.confidenceScore < 0.75
  );

  const correctItems = verifiedQuestions.filter((q) => q.verificationStatus === 'verified_correct');
  const incorrectItems = verifiedQuestions.filter(
    (q) => q.verificationStatus === 'verified_incorrect'
  );

  const avgConfCorrect =
    correctItems.length > 0
      ? Number(
          (
            correctItems.reduce((sum, q) => sum + q.confidenceScore, 0) / correctItems.length
          ).toFixed(2)
        )
      : null;

  const avgConfIncorrect =
    incorrectItems.length > 0
      ? Number(
          (
            incorrectItems.reduce((sum, q) => sum + q.confidenceScore, 0) / incorrectItems.length
          ).toFixed(2)
        )
      : null;

  const confidenceCalibration: ConfidenceCalibrationSummary = {
    highConfidenceVerifiedCorrect: highConfCorrect.length,
    highConfidenceVerifiedIncorrect: highConfIncorrect.length,
    lowConfidenceVerifiedCorrect: lowConfCorrect.length,
    lowConfidenceVerifiedIncorrect: lowConfIncorrect.length,
    averageConfidenceOnCorrect: avgConfCorrect,
    averageConfidenceOnIncorrect: avgConfIncorrect,
    calibrationNote:
      highConfIncorrect.length > 0
        ? `Detected ${highConfIncorrect.length} high-confidence incorrect response(s) (overconfidence alert). Prioritize reviewing those misconceptions.`
        : verifiedDenominator > 0
          ? 'Confidence scores are well-calibrated with verified accuracy; zero high-confidence errors detected.'
          : 'No verified questions available to calibrate confidence against correctness.'
  };

  // Strengths & weaknesses
  const principalStrengths = accuracyByTopic
    .filter((t) => t.verifiedAccuracyPercent !== null && t.verifiedAccuracyPercent >= 80)
    .map((t) => `${t.topic} (${t.verifiedAccuracyPercent}% verified accuracy)`);
  if (principalStrengths.length === 0) {
    principalStrengths.push(
      verifiedCorrectCount > 0
        ? `${verifiedCorrectCount} verified question(s) answered accurately.`
        : 'Completed initial diagnostic scan; load an official answer key to benchmark topic strengths.'
    );
  }

  const principalWeaknesses = accuracyByTopic
    .filter(
      (t) =>
        (t.verifiedAccuracyPercent !== null && t.verifiedAccuracyPercent < 80) ||
        t.uncertainOrAiCount > 0 ||
        t.unansweredCount > 0
    )
    .map((t) => {
      if (t.verifiedIncorrect > 0) {
        return `${t.topic} (${t.verifiedIncorrect} verified error(s), ${t.verifiedAccuracyPercent}% accuracy)`;
      }
      return `${t.topic} (${t.uncertainOrAiCount} unverified/uncertain, ${t.unansweredCount} unanswered)`;
    });

  // Repeated conceptual mistakes
  const repeatedConceptualMistakes = Array.from(topicMap.entries())
    .map(([topic, list]) => {
      const affected = list.filter(
        (q) =>
          q.verificationStatus === 'verified_incorrect' ||
          q.verificationStatus === 'uncertain' ||
          q.errorCategory !== 'none'
      );
      return {
        concept: topic,
        occurrences: affected.length,
        affectedQuestionIds: affected.map((q) => q.questionId),
        diagnosticSummary:
          affected.length > 0
            ? `${affected.length} question(s) in "${topic}" exhibited verified errors or ambiguous evidence (${affected
                .map((q) => q.errorCategory)
                .join(', ')}).`
            : ''
      };
    })
    .filter((m) => m.occurrences > 0)
    .sort((a, b) => b.occurrences - a.occurrences);

  // Unresolved or ambiguous questions
  const unresolvedOrAmbiguousQuestions = enrichedQuestionBank
    .filter(
      (q) =>
        q.verificationStatus === 'uncertain' ||
        q.verificationStatus === 'ai_suggested' ||
        q.verificationStatus === 'unanswered' ||
        q.verificationStatus === 'unsupported'
    )
    .map((q) => ({
      questionId: q.questionId,
      questionText: q.questionText,
      status: q.verificationStatus,
      reason: q.explanation || 'Lacks authoritative official answer key verification.'
    }));

  const totalTimeSpentMs = enrichedQuestionBank.reduce((sum, q) => sum + q.timeSpentMs, 0);
  const averageTimePerQuestionMs =
    totalQuestionsProcessed > 0 ? Math.round(totalTimeSpentMs / totalQuestionsProcessed) : 0;

  const studyPlan = aiProvider.generateStudyPlan(
    enrichedQuestionBank,
    learnerDailyStudyMinutes,
    learnerTargetExamDate
  );

  return {
    reportId: `rep_${session.sessionId}`,
    sessionId: session.sessionId,
    generatedAt: new Date().toISOString(),
    sessionTitle: session.title,
    executiveSummary: {
      totalQuestionsProcessed,
      answeredCount,
      unansweredCount,
      verifiedCorrectCount,
      verifiedIncorrectCount,
      aiSuggestedCount,
      uncertainCount,
      unsupportedCount,
      verifiedScorePercent,
      scoreDenominatorNote,
      topicCoverage: Array.from(topicMap.keys()),
      principalStrengths,
      principalWeaknesses
    },
    questionBank: enrichedQuestionBank,
    importantQuestions: {
      methodologyNote:
        'Questions are classified into High, Medium, and Low priority using transparent criteria: (1) Verified errors or repeated concepts across supplied materials = High; (2) Unverified AI suggestions, uncertain keys, or unanswered items = Medium; (3) Isolated details already verified correct = Low.',
      historicalDisclaimer:
        'Disclaimer: Priority ratings reflect conceptual centrality and observed session gaps. QuizPilot AI does not claim that any specific question will appear on a future examination without validated historical frequency evidence.',
      highPriorityCount: importantItems.filter((i) => i.priorityLevel === 'high').length,
      mediumPriorityCount: importantItems.filter((i) => i.priorityLevel === 'medium').length,
      lowPriorityCount: importantItems.filter((i) => i.priorityLevel === 'low').length,
      items: importantItems
    },
    performanceAnalysis: {
      verifiedAccuracyPercent: verifiedScorePercent,
      verifiedNumerator: verifiedCorrectCount,
      verifiedDenominator,
      excludedFromScoreCount,
      exclusionExplanation:
        'Questions with verificationStatus in {ai_suggested, uncertain, unanswered, unsupported} without an authoritative answer key are excluded from the verified accuracy denominator to prevent unverified guesses from skewing the score.',
      accuracyByTopic,
      errorRateByQuestionType,
      averageTimePerQuestionMs,
      totalTimeSpentMs,
      confidenceCalibration,
      repeatedConceptualMistakes,
      unresolvedOrAmbiguousQuestions
    },
    studyPlan
  };
}
