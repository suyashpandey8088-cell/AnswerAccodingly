export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'text_input'
  | 'unsupported';

export type VerificationStatus =
  | 'verified_correct'
  | 'verified_incorrect'
  | 'ai_suggested'
  | 'uncertain'
  | 'unanswered'
  | 'unsupported';

export type AnswerSourceType =
  | 'official_key'
  | 'official_feedback'
  | 'approved_bank'
  | 'instructor_note'
  | 'ai_inference'
  | 'none';

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

export type PriorityLevel = 'high' | 'medium' | 'low';

export type ErrorCategory =
  | 'none'
  | 'conceptual_gap'
  | 'partial_multi_select'
  | 'ambiguous_source'
  | 'unanswered_timeout'
  | 'ui_interaction_error'
  | 'recall_or_application';

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped_by_user'
  | 'stopped_safety_restriction'
  | 'interrupted_recoverable'
  | 'failed';

export interface QuestionOption {
  id: string;
  label: string;
  text: string;
  disabled?: boolean;
}

export interface SourceMetadata {
  referenceUrl: string;
  originDomain: string;
  quizTitle: string;
  authorizationMode: 'synthetic_sandbox' | 'explicit_practice_attribute' | 'user_allowlisted_practice';
  sourceProvenance: string;
}

/**
 * Complete Question Record stored in the Knowledge Base (Section 5).
 * Never labels an answer as officially correct unless authoritative evidence establishes it.
 */
export interface CapturedQuestion {
  sessionId: string;
  questionId: string;
  fingerprint: string;
  questionText: string;
  questionType: QuestionType;
  options: QuestionOption[];
  selectedResponse: string[];
  officialCorrectAnswer: string[] | null;
  aiProposedAnswer: string[] | null;
  explanation: string;
  verificationStatus: VerificationStatus;
  answerSource: AnswerSourceType;
  confidenceScore: number; // 0.0 to 1.0
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: DifficultyLevel;
  difficultyScore: number; // 1.0 to 10.0
  timeSpentMs: number;
  errorCategory: ErrorCategory;
  sourceMetadata: SourceMetadata;
  timestamp: string;
  // Report enrichment fields
  priorityLevel?: PriorityLevel;
  priorityRationale?: string;
  recommendedRevisionAction?: string;
  similarityClusterId?: string;
}

export interface AnswerKeyEntry {
  questionId?: string;
  questionPattern: string;
  acceptedAnswers: string[];
  sourceType: 'official_key' | 'approved_bank' | 'instructor_note';
  explanation: string;
  subject?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: DifficultyLevel;
  isAmbiguousOrConflicting?: boolean;
  conflictReason?: string;
  sourceCitation: string;
}

export interface CandidateAnswerResolution {
  proposedAnswers: string[];
  officialCorrectAnswers: string[] | null;
  aiProposedAnswers: string[] | null;
  answerSource: AnswerSourceType;
  confidenceScore: number;
  explanation: string;
  isVerifiedSource: boolean;
  isUncertain: boolean;
  uncertaintyReason?: string;
  sourceProvenance: string;
  subject?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: DifficultyLevel;
}

export interface AutomationEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'safety';
  code: string;
  message: string;
  questionId?: string;
  retryAttempt?: number;
}

export interface PracticeSession {
  sessionId: string;
  title: string;
  profileName: string;
  targetUrl: string;
  status: SessionStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  elapsedMs: number;
  totalDetectedQuestions: number;
  processedQuestionIds: string[];
  recoverableErrorCount: number;
  uncertainAnswerCount: number;
  unsupportedQuestionCount: number;
  stopReason?: string;
  events: AutomationEvent[];
}

export interface ScannedQuestionNode {
  questionId: string;
  fingerprint: string;
  questionNumber: number;
  questionText: string;
  questionType: QuestionType;
  options: QuestionOption[];
  currentSelection: string[];
  officialFeedbackAnswer: string[] | null;
  officialFeedbackExplanation: string | null;
  isUnsupportedReason?: string;
  hasDisabledControls: boolean;
  subjectHint?: string;
  topicHint?: string;
}

export interface PageCompatibilityScan {
  isCompatible: boolean;
  isAuthorizedPractice: boolean;
  authorizationReason: string;
  hasSafetyRestriction: boolean;
  safetyRestrictionReason?: string;
  quizTitle: string;
  referenceUrl: string;
  detectedQuestionCount: number;
  supportedQuestionCount: number;
  unsupportedQuestionCount: number;
  navigationControls: {
    hasNext: boolean;
    hasPrevious: boolean;
    hasReview: boolean;
    hasSubmit: boolean;
  };
  questions: ScannedQuestionNode[];
}

export interface TopicPerformanceMetric {
  subject: string;
  topic: string;
  totalQuestions: number;
  verifiedTotal: number;
  verifiedCorrect: number;
  verifiedIncorrect: number;
  uncertainOrAiCount: number;
  unansweredCount: number;
  verifiedAccuracyPercent: number | null;
  averageTimeMs: number;
  averageConfidence: number;
}

export interface QuestionTypeErrorMetric {
  questionType: QuestionType;
  totalQuestions: number;
  verifiedTotal: number;
  verifiedIncorrect: number;
  errorRatePercent: number | null;
  uncertainCount: number;
}

export interface ConfidenceCalibrationSummary {
  highConfidenceVerifiedCorrect: number;
  highConfidenceVerifiedIncorrect: number; // Overconfidence indicator
  lowConfidenceVerifiedCorrect: number; // Underconfidence indicator
  lowConfidenceVerifiedIncorrect: number;
  averageConfidenceOnCorrect: number | null;
  averageConfidenceOnIncorrect: number | null;
  calibrationNote: string;
}

export interface ImportantQuestionItem {
  questionId: string;
  questionText: string;
  topic: string;
  subtopic: string;
  difficulty: DifficultyLevel;
  priorityLevel: PriorityLevel;
  priorityRationale: string;
  verificationStatus: VerificationStatus;
  recommendedAction: string;
  similarityClusterId: string;
  relatedQuestionIds: string[];
}

export interface SpacedRepetitionItem {
  topic: string;
  questionIds: string[];
  urgency: 'immediate_24h' | 'short_term_3d' | 'medium_term_7d' | 'consolidation_14d';
  scheduleIntervalsDays: number[];
  rationale: string;
}

export interface DailyStudyBlock {
  dayIndex: number;
  dateLabel: string;
  focusTopics: string[];
  allocatedMinutes: number;
  activities: string[];
}

export interface PersonalizedStudyPlan {
  learnerDailyMinutes: number;
  targetExamDate: string;
  daysUntilTarget: number;
  priorityTopics: {
    rank: number;
    topic: string;
    reason: string;
    recommendedMinutes: number;
  }[];
  recommendedRevisionOrder: string[];
  dailySchedule: DailyStudyBlock[];
  practiceExercises: {
    topic: string;
    exerciseTitle: string;
    objective: string;
    targetQuestionCount: number;
  }[];
  spacedRepetitionQueue: SpacedRepetitionItem[];
  followUpMockPlan: {
    recommendedTiming: string;
    focusAreas: string[];
    targetConditions: string;
  };
  improvementCriteria: string[];
}

export interface StudyReport {
  reportId: string;
  sessionId: string;
  generatedAt: string;
  sessionTitle: string;
  executiveSummary: {
    totalQuestionsProcessed: number;
    answeredCount: number;
    unansweredCount: number;
    verifiedCorrectCount: number;
    verifiedIncorrectCount: number;
    aiSuggestedCount: number;
    uncertainCount: number;
    unsupportedCount: number;
    verifiedScorePercent: number | null; // Null when verifiedTotal === 0
    scoreDenominatorNote: string;
    topicCoverage: string[];
    principalStrengths: string[];
    principalWeaknesses: string[];
  };
  questionBank: CapturedQuestion[];
  importantQuestions: {
    methodologyNote: string;
    historicalDisclaimer: string;
    highPriorityCount: number;
    mediumPriorityCount: number;
    lowPriorityCount: number;
    items: ImportantQuestionItem[];
  };
  performanceAnalysis: {
    verifiedAccuracyPercent: number | null;
    verifiedNumerator: number;
    verifiedDenominator: number;
    excludedFromScoreCount: number;
    exclusionExplanation: string;
    accuracyByTopic: TopicPerformanceMetric[];
    errorRateByQuestionType: QuestionTypeErrorMetric[];
    averageTimePerQuestionMs: number;
    totalTimeSpentMs: number;
    confidenceCalibration: ConfidenceCalibrationSummary;
    repeatedConceptualMistakes: {
      concept: string;
      occurrences: number;
      affectedQuestionIds: string[];
      diagnosticSummary: string;
    }[];
    unresolvedOrAmbiguousQuestions: {
      questionId: string;
      questionText: string;
      status: VerificationStatus;
      reason: string;
    }[];
  };
  studyPlan: PersonalizedStudyPlan;
}

export interface QuizPilotSettings {
  profileName: string;
  stepDelayMs: number;
  maxRetries: number;
  maxDurationMs: number;
  minConfidenceThreshold: number;
  autoSubmitAuthorizedPractice: boolean;
  requireConfirmationForSubmit: boolean;
  authorizedDomains: string[];
  aiProviderMode: 'deterministic' | 'mock_ai' | 'custom_http';
  aiCustomEndpointUrl: string;
  aiModelName: string;
  learnerDailyStudyMinutes: number;
  learnerTargetExamDate: string;
  dataRetentionDays: number;
  companionServiceUrl: string;
}
