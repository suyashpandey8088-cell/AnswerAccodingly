import {
  CapturedQuestion,
  DifficultyLevel,
  PersonalizedStudyPlan,
  QuestionOption,
  QuestionType
} from '../models/types';
import { DeterministicAnalysisProvider } from './deterministic-ai';
import {
  AICandidateProposal,
  AIAnalysisProvider,
  QuestionClassificationResult,
  SimilarityCluster
} from './provider';

/**
 * Mock AI Provider for local development and deterministic test suites (Section 3).
 * Simulates a language model that returns candidate answers with explicit provenance
 * and never claims official correctness.
 */
export class MockAIProvider implements AIAnalysisProvider {
  public readonly providerId = 'mock_ai' as const;
  private readonly fallback = new DeterministicAnalysisProvider();

  public async classifyQuestion(
    questionText: string,
    options: QuestionOption[],
    subjectHint?: string,
    topicHint?: string
  ): Promise<QuestionClassificationResult> {
    return this.fallback.classifyQuestion(questionText, options, subjectHint, topicHint);
  }

  public estimateDifficulty(
    questionText: string,
    questionType: QuestionType,
    options: QuestionOption[]
  ): { difficulty: DifficultyLevel; difficultyScore: number } {
    return this.fallback.estimateDifficulty(questionText, questionType, options);
  }

  public async proposeCandidateAnswer(
    questionText: string,
    questionType: QuestionType,
    options: QuestionOption[]
  ): Promise<AICandidateProposal> {
    const det = await this.fallback.proposeCandidateAnswer(questionText, questionType, options);
    if (!det.isUncertain && det.proposedAnswers.length > 0) {
      return {
        ...det,
        explanation: `[Mock AI Provider] ${det.explanation}`,
        evidenceSummary: `Mock AI candidate inference (${det.evidenceSummary})`
      };
    }

    // If options exist, Mock AI proposes a low-confidence candidate marked as uncertain
    if (options.length > 0) {
      return {
        proposedAnswers: [options[0].id],
        confidenceScore: 0.45,
        explanation:
          '[Mock AI Provider] Candidate option proposed with low confidence (0.45). No authoritative verification evidence available; marked as uncertain.',
        evidenceSummary: 'Mock AI low-confidence candidate (unverified).',
        isUncertain: true
      };
    }

    return det;
  }

  public async generateExplanation(
    questionText: string,
    selectedAnswers: string[],
    officialCorrectAnswers: string[] | null,
    topic: string
  ): Promise<string> {
    return this.fallback.generateExplanation(
      questionText,
      selectedAnswers,
      officialCorrectAnswers,
      topic
    );
  }

  public groupSimilarQuestions(questions: CapturedQuestion[]): SimilarityCluster[] {
    return this.fallback.groupSimilarQuestions(questions);
  }

  public generateStudyPlan(
    questions: CapturedQuestion[],
    dailyStudyMinutes: number,
    targetExamDate: string
  ): PersonalizedStudyPlan {
    return this.fallback.generateStudyPlan(questions, dailyStudyMinutes, targetExamDate);
  }
}
