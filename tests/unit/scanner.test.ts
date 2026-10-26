import { describe, expect, it } from 'vitest';
import { inspectQuestionContainer, scanQuizDocument } from '../../src/core/scanner/dom-scanner';
import { renderSyntheticQuizDom } from '../../src/quiz-sandbox/quiz-app';

describe('Question Scanner & Authorization Engine (Stage 3)', () => {
  it('detects single-choice, multiple-choice, true/false, and text-input questions in standard practice quiz', () => {
    const doc = document.implementation.createHTMLDocument('Standard Quiz');
    renderSyntheticQuizDom(doc, { scenario: 'standard' });

    const scan = scanQuizDocument(doc, 'http://localhost:5173/quiz-lab.html');
    expect(scan.isAuthorizedPractice).toBe(true);
    expect(scan.isCompatible).toBe(true);
    expect(scan.hasSafetyRestriction).toBe(false);
    expect(scan.detectedQuestionCount).toBe(11);
    expect(scan.supportedQuestionCount).toBe(11);
    expect(scan.unsupportedQuestionCount).toBe(0);

    const types = new Set(scan.questions.map((q) => q.questionType));
    expect(types.has('single_choice')).toBe(true);
    expect(types.has('multiple_choice')).toBe(true);
    expect(types.has('true_false')).toBe(true);
    expect(types.has('text_input')).toBe(true);

    expect(scan.navigationControls).toEqual({
      hasNext: true,
      hasPrevious: true,
      hasReview: true,
      hasSubmit: true
    });
  });

  it('accurately identifies missing options, disabled controls, and unsupported canvas layouts', () => {
    const doc = document.implementation.createHTMLDocument('Edge Case Quiz');
    renderSyntheticQuizDom(doc, { scenario: 'edge_cases' });

    const scan = scanQuizDocument(doc, 'http://localhost:5173/quiz-lab.html');
    expect(scan.isAuthorizedPractice).toBe(true);

    const missingOptsQ = scan.questions.find((q) => q.questionId === 'q_edge_missing_opts');
    expect(missingOptsQ).toBeDefined();
    expect(missingOptsQ?.questionType).toBe('unsupported');
    expect(missingOptsQ?.isUnsupportedReason).toContain('missing selectable options');

    const disabledQ = scan.questions.find((q) => q.questionId === 'q_edge_disabled_btn');
    expect(disabledQ).toBeDefined();
    expect(disabledQ?.hasDisabledControls).toBe(true);

    const canvasQ = scan.questions.find((q) => q.questionId === 'q_edge_unsupported_canvas');
    expect(canvasQ).toBeDefined();
    expect(canvasQ?.questionType).toBe('unsupported');
    expect(canvasQ?.isUnsupportedReason).toContain('interactive-webgl-canvas-drawing');
  });

  it('detects CAPTCHA challenges and halts compatibility immediately', () => {
    const doc = document.implementation.createHTMLDocument('CAPTCHA Quiz');
    renderSyntheticQuizDom(doc, { scenario: 'captcha_challenge' });

    const scan = scanQuizDocument(doc, 'http://localhost:5173/quiz-lab.html');
    expect(scan.hasSafetyRestriction).toBe(true);
    expect(scan.isAuthorizedPractice).toBe(false);
    expect(scan.isCompatible).toBe(false);
    expect(scan.safetyRestrictionReason).toContain('CAPTCHA');
  });

  it('rejects live graded or proctored assessments', () => {
    const doc = document.implementation.createHTMLDocument('Graded Exam');
    renderSyntheticQuizDom(doc, { scenario: 'unauthorized_graded' });

    const scan = scanQuizDocument(doc, 'http://localhost:5173/quiz-lab.html');
    expect(scan.hasSafetyRestriction).toBe(true);
    expect(scan.isAuthorizedPractice).toBe(false);
    expect(scan.safetyRestrictionReason).toContain('Proctored or graded examination');
  });

  it('handles empty question prompts as unsupported', () => {
    const doc = document.implementation.createHTMLDocument('Malformed');
    doc.body.innerHTML = `<article data-quiz-question="true" data-question-id="q_empty"></article>`;
    const container = doc.querySelector('article') as HTMLElement;
    const node = inspectQuestionContainer(container, 1);
    expect(node.questionType).toBe('unsupported');
    expect(node.isUnsupportedReason).toContain('empty or unreadable prompt');
  });
});
