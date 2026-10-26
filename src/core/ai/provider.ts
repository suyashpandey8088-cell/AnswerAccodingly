import {
  CapturedQuestion,
  DifficultyLevel,
  PersonalizedStudyPlan,
  QuestionOption,
  QuestionType
} from '../models/types';

export interface QuestionClassificationResult {
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: DifficultyLevel;
  difficultyScore: number; // 1.0 - 10.0
}

export interface AICandidateProposal {
  proposedAnswers: string[];
  confidenceScore: number; // 0.0 - 1.0
  explanation: string;
  evidenceSummary: string;
  isUncertain: boolean;
}

export interface SimilarityCluster {
  clusterId: string;
  conceptLabel: string;
  questionIds: string[];
}

/**
 * Provider-independent interface for language-model & deterministic analysis services (Section 3).
 */
export interface AIAnalysisProvider {
  readonly providerId: 'deterministic' | 'mock_ai' | 'custom_http';

  classifyQuestion(
    questionText: string,
    options: QuestionOption[],
    subjectHint?: string,
    topicHint?: string
  ): Promise<QuestionClassificationResult>;

  estimateDifficulty(
    questionText: string,
    questionType: QuestionType,
    options: QuestionOption[]
  ): { difficulty: DifficultyLevel; difficultyScore: number };

  proposeCandidateAnswer(
    questionText: string,
    questionType: QuestionType,
    options: QuestionOption[]
  ): Promise<AICandidateProposal>;

  generateExplanation(
    questionText: string,
    selectedAnswers: string[],
    officialCorrectAnswers: string[] | null,
    topic: string
  ): Promise<string>;

  groupSimilarQuestions(questions: CapturedQuestion[]): SimilarityCluster[];

  generateStudyPlan(
    questions: CapturedQuestion[],
    dailyStudyMinutes: number,
    targetExamDate: string
  ): PersonalizedStudyPlan;
}
