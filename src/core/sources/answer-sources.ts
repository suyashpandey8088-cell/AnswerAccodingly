import { AIAnalysisProvider } from '../ai/provider';
import {
  AnswerKeyEntry,
  CandidateAnswerResolution,
  ScannedQuestionNode,
  VerificationStatus
} from '../models/types';
import { sanitizeUntrustedText } from '../security/sanitizer';

export class AnswerSourceManager {
  private entries: AnswerKeyEntry[] = [];
  private aiProvider: AIAnalysisProvider;
  private minConfidenceThreshold: number;

  constructor(
    aiProvider: AIAnalysisProvider,
    initialEntries: AnswerKeyEntry[] = [],
    minConfidenceThreshold = 0.65
  ) {
    this.aiProvider = aiProvider;
    this.entries = [...initialEntries];
    this.minConfidenceThreshold = minConfidenceThreshold;
  }

  public setEntries(entries: AnswerKeyEntry[]): void {
    this.entries = [...entries];
  }

  public getEntries(): AnswerKeyEntry[] {
    return [...this.entries];
  }

  public addEntry(entry: AnswerKeyEntry): void {
    this.entries.push(entry);
  }

  public setAIProvider(provider: AIAnalysisProvider): void {
    this.aiProvider = provider;
  }

  public setMinConfidenceThreshold(threshold: number): void {
    this.minConfidenceThreshold = Math.max(0.1, Math.min(0.99, threshold));
  }

  /**
   * Resolves candidate answers across the 4 source tiers:
   * 1. Official answer keys supplied by the user
   * 2. Approved question banks and reference documents
   * 3. Instructor-provided explanations
   * 4. AI-generated candidate answers with supporting evidence
   */
  public async resolveQuestion(question: ScannedQuestionNode): Promise<CandidateAnswerResolution> {
    const matchingEntries = this.findMatchingEntries(question);

    // Check for conflicting or explicitly ambiguous entries across user-supplied keys/banks
    if (matchingEntries.length > 0) {
      const explicitAmbiguous = matchingEntries.find((e) => e.isAmbiguousOrConflicting);
      if (explicitAmbiguous) {
        return {
          proposedAnswers: [],
          officialCorrectAnswers: null,
          aiProposedAnswers: null,
          answerSource: explicitAmbiguous.sourceType,
          confidenceScore: 0.25,
          explanation:
            explicitAmbiguous.conflictReason ||
            'Supplied answer key entry is flagged as ambiguous or conflicting. Refusing to treat as verified fact.',
          isVerifiedSource: false,
          isUncertain: true,
          uncertaintyReason:
            explicitAmbiguous.conflictReason || 'Ambiguous answer key entry detected.',
          sourceProvenance: explicitAmbiguous.sourceCitation,
          subject: explicitAmbiguous.subject,
          topic: explicitAmbiguous.topic,
          subtopic: explicitAmbiguous.subtopic,
          difficulty: explicitAmbiguous.difficulty
        };
      }

      // Check if multiple entries disagree on the accepted answers
      const distinctAnswerSets = new Set(
        matchingEntries.map((e) =>
          [...e.acceptedAnswers]
            .map((a) => a.trim().toLowerCase())
            .sort()
            .join('||')
        )
      );

      if (distinctAnswerSets.size > 1) {
        return {
          proposedAnswers: [],
          officialCorrectAnswers: null,
          aiProposedAnswers: null,
          answerSource: matchingEntries[0].sourceType,
          confidenceScore: 0.2,
          explanation: `Conflicting answers found across ${matchingEntries.length} reference sources (${matchingEntries
            .map((m) => m.sourceCitation)
            .join(' vs. ')}). Marked as uncertain.`,
          isVerifiedSource: false,
          isUncertain: true,
          uncertaintyReason: 'Conflicting answer keys supplied for the same question.',
          sourceProvenance: matchingEntries.map((m) => m.sourceCitation).join('; ')
        };
      }

      // Priority order: official_key > approved_bank > instructor_note
      const priorityOrder: Record<AnswerKeyEntry['sourceType'], number> = {
        official_key: 1,
        approved_bank: 2,
        instructor_note: 3
      };
      matchingEntries.sort((a, b) => priorityOrder[a.sourceType] - priorityOrder[b.sourceType]);
      const bestEntry = matchingEntries[0];
      const mappedAnswers = this.mapAcceptedAnswersToOptions(bestEntry.acceptedAnswers, question);

      if (mappedAnswers.length === 0) {
        return {
          proposedAnswers: [],
          officialCorrectAnswers: null,
          aiProposedAnswers: null,
          answerSource: bestEntry.sourceType,
          confidenceScore: 0.3,
          explanation: `Reference source (${bestEntry.sourceCitation}) matched the question prompt, but its answer (${bestEntry.acceptedAnswers.join(
            ', '
          )}) did not match any available option on the page.`,
          isVerifiedSource: false,
          isUncertain: true,
          uncertaintyReason: 'Reference answer does not match any rendered option.',
          sourceProvenance: bestEntry.sourceCitation,
          subject: bestEntry.subject,
          topic: bestEntry.topic,
          subtopic: bestEntry.subtopic,
          difficulty: bestEntry.difficulty
        };
      }

      const isAuthoritativeOfficialKey = bestEntry.sourceType === 'official_key';
      const confidence =
        bestEntry.sourceType === 'official_key'
          ? 0.99
          : bestEntry.sourceType === 'approved_bank'
            ? 0.9
            : 0.85;

      return {
        proposedAnswers: mappedAnswers,
        officialCorrectAnswers: isAuthoritativeOfficialKey ? mappedAnswers : null,
        aiProposedAnswers: null,
        answerSource: bestEntry.sourceType,
        confidenceScore: confidence,
        explanation: bestEntry.explanation,
        isVerifiedSource: isAuthoritativeOfficialKey,
        isUncertain: false,
        sourceProvenance: bestEntry.sourceCitation,
        subject: bestEntry.subject,
        topic: bestEntry.topic,
        subtopic: bestEntry.subtopic,
        difficulty: bestEntry.difficulty
      };
    }

    // Tier 4: AI-generated candidate answers with supporting evidence
    const aiProposal = await this.aiProvider.proposeCandidateAnswer(
      question.questionText,
      question.questionType,
      question.options
    );

    const isBelowThreshold =
      aiProposal.isUncertain ||
      aiProposal.confidenceScore < this.minConfidenceThreshold ||
      aiProposal.proposedAnswers.length === 0;

    return {
      proposedAnswers: aiProposal.proposedAnswers,
      officialCorrectAnswers: null, // AI proposals are NEVER labeled as official correct answers
      aiProposedAnswers: aiProposal.proposedAnswers.length > 0 ? aiProposal.proposedAnswers : null,
      answerSource: aiProposal.proposedAnswers.length > 0 ? 'ai_inference' : 'none',
      confidenceScore: aiProposal.confidenceScore,
      explanation: aiProposal.explanation,
      isVerifiedSource: false,
      isUncertain: isBelowThreshold,
      uncertaintyReason: isBelowThreshold
        ? 'No authoritative key found and AI confidence is below verification threshold.'
        : undefined,
      sourceProvenance: `AI Analysis (${this.aiProvider.providerId}): ${aiProposal.evidenceSummary}`
    };
  }

  private findMatchingEntries(question: ScannedQuestionNode): AnswerKeyEntry[] {
    const cleanQText = sanitizeUntrustedText(question.questionText).toLowerCase();
    return this.entries.filter((entry) => {
      if (entry.questionId && entry.questionId === question.questionId) {
        return true;
      }
      if (!entry.questionPattern) return false;
      const pattern = entry.questionPattern.trim().toLowerCase();
      return pattern.length > 3 && cleanQText.includes(pattern);
    });
  }

  private mapAcceptedAnswersToOptions(
    acceptedAnswers: string[],
    question: ScannedQuestionNode
  ): string[] {
    if (question.questionType === 'text_input') {
      return acceptedAnswers.map((a) => sanitizeUntrustedText(a, 300)).filter(Boolean);
    }

    const matchedOptionIds: string[] = [];
    for (const rawAns of acceptedAnswers) {
      const normalizedAns = rawAns.trim().toLowerCase();
      const found = question.options.find(
        (opt) =>
          opt.id.trim().toLowerCase() === normalizedAns ||
          opt.text.trim().toLowerCase() === normalizedAns ||
          opt.text.trim().toLowerCase().includes(normalizedAns)
      );
      if (found && !matchedOptionIds.includes(found.id)) {
        matchedOptionIds.push(found.id);
      }
    }
    return matchedOptionIds;
  }
}

/**
 * Computes the strict VerificationStatus (Section 2 & Section 5).
 * Never labels an answer as verified_correct or verified_incorrect unless
 * officialCorrectAnswer is established by an official key or official page feedback.
 */
export function evaluateVerificationStatus(params: {
  questionType: ScannedQuestionNode['questionType'];
  selectedResponse: string[];
  officialCorrectAnswer: string[] | null;
  aiProposedAnswer: string[] | null;
  isUncertain: boolean;
  confidenceScore: number;
  minConfidenceThreshold: number;
}): VerificationStatus {
  const {
    questionType,
    selectedResponse,
    officialCorrectAnswer,
    aiProposedAnswer,
    isUncertain,
    confidenceScore,
    minConfidenceThreshold
  } = params;

  if (questionType === 'unsupported') {
    return 'unsupported';
  }

  // If an authoritative official key or official feedback exists, we can verify correctness!
  if (officialCorrectAnswer && officialCorrectAnswer.length > 0) {
    if (selectedResponse.length === 0) {
      return 'unanswered';
    }
    const normSelected = [...selectedResponse].map((s) => s.trim().toLowerCase()).sort();
    const normOfficial = [...officialCorrectAnswer].map((s) => s.trim().toLowerCase()).sort();
    const isExactMatch =
      normSelected.length === normOfficial.length &&
      normSelected.every((val, idx) => val === normOfficial[idx]);

    return isExactMatch ? 'verified_correct' : 'verified_incorrect';
  }

  if (selectedResponse.length === 0) {
    return isUncertain ? 'uncertain' : 'unanswered';
  }

  if (isUncertain || confidenceScore < minConfidenceThreshold) {
    return 'uncertain';
  }

  if (aiProposedAnswer && aiProposedAnswer.length > 0) {
    return 'ai_suggested';
  }

  // Approved bank or instructor note without an official key is still unverified by an official key,
  // so we classify it as ai_suggested or uncertain unless an official key confirms it.
  return 'ai_suggested';
}
