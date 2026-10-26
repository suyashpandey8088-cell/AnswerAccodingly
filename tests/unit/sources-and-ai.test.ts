import { describe, expect, it } from 'vitest';
import { DeterministicAnalysisProvider } from '../../src/core/ai/deterministic-ai';
import { MockAIProvider } from '../../src/core/ai/mock-ai';
import { ScannedQuestionNode } from '../../src/core/models/types';
import {
  AnswerSourceManager,
  evaluateVerificationStatus
} from '../../src/core/sources/answer-sources';
import { DEFAULT_ANSWER_KEY_ENTRIES } from '../../src/quiz-sandbox/synthetic-bank';

const sampleQuestionNode: ScannedQuestionNode = {
  questionId: 'q_std_1',
  fingerprint: 'qf_12345678',
  questionNumber: 1,
  questionText:
    'According to the CAP theorem, when a distributed data store experiences a network partition (P), which trade-off is unavoidable?',
  questionType: 'single_choice',
  options: [
    {
      id: 'opt_cap_a',
      label: 'A',
      text: 'Choosing between linearizable Consistency (C) and 100% Availability (A)'
    },
    {
      id: 'opt_cap_b',
      label: 'B',
      text: 'Choosing between Durability and Horizontal Sharding'
    }
  ],
  currentSelection: [],
  officialFeedbackAnswer: null,
  officialFeedbackExplanation: null,
  hasDisabledControls: false
};

describe('Answer Sources & AI Analysis Engine (Stages 3, 4 & 8)', () => {
  it('resolves official answer keys with verified provenance', async () => {
    const ai = new DeterministicAnalysisProvider();
    const manager = new AnswerSourceManager(ai, DEFAULT_ANSWER_KEY_ENTRIES, 0.65);

    const res = await manager.resolveQuestion(sampleQuestionNode);
    expect(res.answerSource).toBe('official_key');
    expect(res.isVerifiedSource).toBe(true);
    expect(res.isUncertain).toBe(false);
    expect(res.officialCorrectAnswers).toEqual(['opt_cap_a']);
    expect(res.proposedAnswers).toEqual(['opt_cap_a']);
    expect(res.confidenceScore).toBeGreaterThanOrEqual(0.95);
  });

  it('never mislabels AI-suggested or instructor-note answers as officially verified when no official key exists', async () => {
    const ai = new DeterministicAnalysisProvider();
    const manager = new AnswerSourceManager(ai, [], 0.65); // No official keys loaded

    const res = await manager.resolveQuestion(sampleQuestionNode);
    expect(res.answerSource).toBe('ai_inference');
    expect(res.isVerifiedSource).toBe(false);
    expect(res.officialCorrectAnswers).toBeNull();
    expect(res.aiProposedAnswers).toEqual(['opt_cap_a']);

    const status = evaluateVerificationStatus({
      questionType: 'single_choice',
      selectedResponse: res.proposedAnswers,
      officialCorrectAnswer: res.officialCorrectAnswers,
      aiProposedAnswer: res.aiProposedAnswers,
      isUncertain: res.isUncertain,
      confidenceScore: res.confidenceScore,
      minConfidenceThreshold: 0.65
    });

    expect(status).toBe('ai_suggested');
    expect(status).not.toBe('verified_correct');
  });

  it('flags ambiguous or conflicting answer keys as uncertain instead of verified', async () => {
    const ai = new DeterministicAnalysisProvider();
    const conflictingKeys = [
      {
        questionId: 'q_conflict',
        questionPattern: 'conflicting distributed lock question',
        acceptedAnswers: ['opt_1'],
        sourceType: 'official_key' as const,
        explanation: 'Key A says opt_1',
        sourceCitation: 'Source A'
      },
      {
        questionId: 'q_conflict',
        questionPattern: 'conflicting distributed lock question',
        acceptedAnswers: ['opt_2'],
        sourceType: 'official_key' as const,
        explanation: 'Key B says opt_2',
        sourceCitation: 'Source B'
      }
    ];

    const manager = new AnswerSourceManager(ai, conflictingKeys, 0.65);
    const conflictNode: ScannedQuestionNode = {
      ...sampleQuestionNode,
      questionId: 'q_conflict',
      questionText: 'What is the answer to this conflicting distributed lock question?',
      options: [
        { id: 'opt_1', label: 'A', text: 'Option 1' },
        { id: 'opt_2', label: 'B', text: 'Option 2' }
      ]
    };

    const res = await manager.resolveQuestion(conflictNode);
    expect(res.isUncertain).toBe(true);
    expect(res.isVerifiedSource).toBe(false);
    expect(res.officialCorrectAnswers).toBeNull();
    expect(res.uncertaintyReason).toContain('Conflicting answer keys');

    const status = evaluateVerificationStatus({
      questionType: 'single_choice',
      selectedResponse: res.proposedAnswers,
      officialCorrectAnswer: res.officialCorrectAnswers,
      aiProposedAnswer: res.aiProposedAnswers,
      isUncertain: res.isUncertain,
      confidenceScore: res.confidenceScore,
      minConfidenceThreshold: 0.65
    });
    expect(status).toBe('uncertain');
  });

  it('classifies questions, estimates difficulty, and generates a personalized study plan', async () => {
    const mockAi = new MockAIProvider();
    const classification = await mockAi.classifyQuestion(
      'How does Content Security Policy (CSP) prevent Cross-Site Scripting (XSS)?',
      sampleQuestionNode.options
    );
    expect(classification.subject).toBe('Cybersecurity');
    expect(classification.topic).toBe('Web & Browser Security');

    const unknownProposal = await mockAi.proposeCandidateAnswer(
      'Unfamiliar obscure question about proprietary hardware register XYZ-999?',
      'single_choice',
      [
        { id: 'o1', label: 'A', text: 'Register A' },
        { id: 'o2', label: 'B', text: 'Register B' }
      ]
    );
    expect(unknownProposal.isUncertain).toBe(true);
    expect(unknownProposal.confidenceScore).toBeLessThan(0.65);
  });
});
