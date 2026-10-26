import {
  PageCompatibilityScan,
  QuestionOption,
  QuestionType,
  ScannedQuestionNode
} from '../models/types';
import { verifyPracticeAuthorization } from '../security/authorization';
import {
  computeQuestionFingerprint,
  sanitizeReferenceUrl,
  sanitizeUntrustedText
} from '../security/sanitizer';

const QUESTION_CONTAINER_SELECTORS = [
  '[data-quiz-question]',
  '.quiz-question-card',
  'article[data-question-id]',
  'fieldset[data-question-id]'
].join(', ');

export function scanQuizDocument(
  doc: Document,
  rawUrl: string,
  allowedDomains: string[] = ['localhost', '127.0.0.1']
): PageCompatibilityScan {
  const auth = verifyPracticeAuthorization(doc, rawUrl, allowedDomains);
  const { referenceUrl } = sanitizeReferenceUrl(rawUrl);

  const rawTitle =
    doc.querySelector('[data-quiz-title]')?.textContent ||
    doc.querySelector('h1')?.textContent ||
    doc.title ||
    'Untitled Practice Assessment';
  const quizTitle = sanitizeUntrustedText(rawTitle, 160);

  if (auth.hasSafetyRestriction) {
    return {
      isCompatible: false,
      isAuthorizedPractice: false,
      authorizationReason: auth.authorizationReason,
      hasSafetyRestriction: true,
      safetyRestrictionReason: auth.safetyRestrictionReason,
      quizTitle,
      referenceUrl,
      detectedQuestionCount: 0,
      supportedQuestionCount: 0,
      unsupportedQuestionCount: 0,
      navigationControls: detectNavigationControls(doc),
      questions: []
    };
  }

  const containers = Array.from(doc.querySelectorAll<HTMLElement>(QUESTION_CONTAINER_SELECTORS)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
  );

  const questions: ScannedQuestionNode[] = containers.map((container, idx) =>
    inspectQuestionContainer(container, idx + 1)
  );

  const supportedQuestionCount = questions.filter((q) => q.questionType !== 'unsupported').length;
  const unsupportedQuestionCount = questions.filter((q) => q.questionType === 'unsupported').length;

  return {
    isCompatible: auth.isAuthorizedPractice && questions.length > 0 && supportedQuestionCount > 0,
    isAuthorizedPractice: auth.isAuthorizedPractice,
    authorizationReason: auth.authorizationReason,
    hasSafetyRestriction: false,
    quizTitle,
    referenceUrl,
    detectedQuestionCount: questions.length,
    supportedQuestionCount,
    unsupportedQuestionCount,
    navigationControls: detectNavigationControls(doc),
    questions
  };
}

export function inspectQuestionContainer(
  container: HTMLElement,
  fallbackNumber: number
): ScannedQuestionNode {
  const explicitId =
    container.getAttribute('data-question-id') ||
    container.id ||
    `q_${fallbackNumber}`;

  const promptEl =
    container.querySelector('[data-question-prompt], .question-prompt, legend, h3, h4') ||
    container;

  const rawPrompt = promptEl === container
    ? extractDirectPromptText(container)
    : promptEl.textContent || '';
  const questionText = sanitizeUntrustedText(rawPrompt, 2000);

  const subjectHint = sanitizeUntrustedText(
    container.getAttribute('data-subject') || '',
    100
  ) || undefined;
  const topicHint = sanitizeUntrustedText(
    container.getAttribute('data-topic') || '',
    100
  ) || undefined;

  // Check for explicit unsupported layout markers (e.g., canvas, drag-drop, audio-only)
  const unsupportedAttr = container.getAttribute('data-unsupported-layout');
  if (unsupportedAttr) {
    const fp = computeQuestionFingerprint(questionText || explicitId, []);
    return {
      questionId: sanitizeUntrustedText(explicitId, 80),
      fingerprint: fp,
      questionNumber: fallbackNumber,
      questionText: questionText || '[Malformed Question Prompt]',
      questionType: 'unsupported',
      options: [],
      currentSelection: [],
      officialFeedbackAnswer: null,
      officialFeedbackExplanation: null,
      isUnsupportedReason: `Unsupported question widget: ${sanitizeUntrustedText(unsupportedAttr, 120)}`,
      hasDisabledControls: false,
      subjectHint,
      topicHint
    };
  }

  if (!questionText) {
    return {
      questionId: sanitizeUntrustedText(explicitId, 80),
      fingerprint: computeQuestionFingerprint(explicitId, []),
      questionNumber: fallbackNumber,
      questionText: '[Missing Question Prompt]',
      questionType: 'unsupported',
      options: [],
      currentSelection: [],
      officialFeedbackAnswer: null,
      officialFeedbackExplanation: null,
      isUnsupportedReason: 'Question container has an empty or unreadable prompt.',
      hasDisabledControls: false,
      subjectHint,
      topicHint
    };
  }

  const declaredType = container.getAttribute('data-question-type')?.toLowerCase();
  const radioInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const checkboxInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const textInputs = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="search"], input[type="number"], textarea'
    )
  );

  let questionType: QuestionType = 'unsupported';
  let options: QuestionOption[] = [];
  let currentSelection: string[] = [];
  let isUnsupportedReason: string | undefined;
  let hasDisabledControls = false;

  if (declaredType === 'text_input' || (textInputs.length > 0 && radioInputs.length === 0 && checkboxInputs.length === 0)) {
    questionType = 'text_input';
    const primaryInput = textInputs[0];
    if (!primaryInput) {
      questionType = 'unsupported';
      isUnsupportedReason = 'Declared text_input question is missing an input field.';
    } else {
      hasDisabledControls = primaryInput.disabled || primaryInput.readOnly;
      const val = sanitizeUntrustedText(primaryInput.value || '', 500);
      if (val) {
        currentSelection = [val];
      }
    }
  } else if (checkboxInputs.length > 0 || declaredType === 'multiple_choice') {
    options = extractChoiceOptions(container, checkboxInputs);
    if (options.length < 2) {
      questionType = 'unsupported';
      isUnsupportedReason = `Multiple-choice question requires at least 2 options (found ${options.length}).`;
    } else {
      questionType = 'multiple_choice';
      hasDisabledControls = options.every((o) => o.disabled);
      currentSelection = checkboxInputs
        .filter((inp) => inp.checked)
        .map((inp, idx) => sanitizeUntrustedText(inp.value || options[idx]?.id || '', 200))
        .filter(Boolean);
    }
  } else if (radioInputs.length > 0 || declaredType === 'single_choice' || declaredType === 'true_false') {
    options = extractChoiceOptions(container, radioInputs);
    if (options.length < 2) {
      questionType = 'unsupported';
      isUnsupportedReason = `Choice question is missing selectable options (found ${options.length}).`;
    } else {
      const normalizedLabels = options.map((o) => o.text.trim().toLowerCase());
      const isBooleanPair =
        declaredType === 'true_false' ||
        (options.length === 2 &&
          ((normalizedLabels.includes('true') && normalizedLabels.includes('false')) ||
            (normalizedLabels.includes('yes') && normalizedLabels.includes('no'))));

      questionType = isBooleanPair ? 'true_false' : 'single_choice';
      hasDisabledControls = options.every((o) => o.disabled);
      currentSelection = radioInputs
        .filter((inp) => inp.checked)
        .map((inp, idx) => sanitizeUntrustedText(inp.value || options[idx]?.id || '', 200))
        .filter(Boolean);
    }
  } else {
    questionType = 'unsupported';
    isUnsupportedReason = 'No supported answer controls (radio, checkbox, or text input) found in container.';
  }

  // Extract official feedback ONLY if explicitly marked by an authoritative post-answer element
  let officialFeedbackAnswer: string[] | null = null;
  let officialFeedbackExplanation: string | null = null;

  const officialFeedbackEl = container.querySelector<HTMLElement>(
    '[data-official-feedback="true"], .official-answer-feedback[data-verified="true"]'
  );
  if (officialFeedbackEl && !officialFeedbackEl.hasAttribute('hidden')) {
    const rawCorrect = officialFeedbackEl.getAttribute('data-official-correct-answer');
    if (rawCorrect) {
      officialFeedbackAnswer = rawCorrect
        .split('|')
        .map((s) => sanitizeUntrustedText(s, 300))
        .filter(Boolean);
    }
    const rawExplanation =
      officialFeedbackEl.getAttribute('data-official-explanation') ||
      officialFeedbackEl.textContent ||
      '';
    if (rawExplanation) {
      officialFeedbackExplanation = sanitizeUntrustedText(rawExplanation, 1500);
    }
  }

  const fingerprint = computeQuestionFingerprint(
    questionText,
    options.map((o) => o.text)
  );

  return {
    questionId: sanitizeUntrustedText(explicitId, 80),
    fingerprint,
    questionNumber: fallbackNumber,
    questionText,
    questionType,
    options,
    currentSelection,
    officialFeedbackAnswer,
    officialFeedbackExplanation,
    isUnsupportedReason,
    hasDisabledControls,
    subjectHint,
    topicHint
  };
}

function extractChoiceOptions(
  container: HTMLElement,
  inputs: HTMLInputElement[]
): QuestionOption[] {
  if (inputs.length > 0) {
    return inputs
      .map((input, idx) => {
        const parentLabel = input.closest('label');
        const safeId =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(input.id)
            : input.id.replace(/["\\]/g, '\\$&');
        const explicitForLabel = input.id
          ? container.querySelector<HTMLLabelElement>(`label[for="${safeId}"]`)
          : null;
        const optionWrapper = input.closest('[data-option-id], .quiz-option');

        const rawText =
          input.getAttribute('data-option-text') ||
          explicitForLabel?.textContent ||
          parentLabel?.textContent ||
          optionWrapper?.textContent ||
          input.value ||
          '';

        const text = sanitizeUntrustedText(rawText, 600);
        const optionId = sanitizeUntrustedText(
          input.value || input.getAttribute('data-option-id') || `opt_${idx + 1}`,
          120
        );
        const label = String.fromCharCode(65 + (idx % 26));

        return {
          id: optionId,
          label,
          text,
          disabled: input.disabled
        };
      })
      .filter((o) => o.text.length > 0);
  }

  // Fallback for custom ARIA option buttons if no native inputs
  const ariaOptions = Array.from(
    container.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"], [data-quiz-option]')
  );
  return ariaOptions
    .map((el, idx) => {
      const text = sanitizeUntrustedText(el.textContent || '', 600);
      const id = sanitizeUntrustedText(
        el.getAttribute('data-option-id') || el.getAttribute('data-value') || `opt_${idx + 1}`,
        120
      );
      const disabled =
        el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
      return {
        id,
        label: String.fromCharCode(65 + (idx % 26)),
        text,
        disabled
      };
    })
    .filter((o) => o.text.length > 0);
}

function extractDirectPromptText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('label, input, textarea, button, [data-official-feedback]')
    .forEach((n) => n.remove());
  return clone.textContent || '';
}

export function detectNavigationControls(doc: Document): {
  hasNext: boolean;
  hasPrevious: boolean;
  hasReview: boolean;
  hasSubmit: boolean;
} {
  const buttons = Array.from(
    doc.querySelectorAll<HTMLElement>('button, input[type="button"], input[type="submit"], a[role="button"]')
  );

  const matchesNav = (navType: string, regex: RegExp): boolean =>
    buttons.some((btn) => {
      if (btn.hasAttribute('hidden')) return false;
      const attr = btn.getAttribute('data-quiz-nav')?.toLowerCase();
      if (attr === navType) return true;
      const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim();
      return regex.test(text);
    });

  return {
    hasNext: matchesNav('next', /^(next|continue|forward|next\s+question)/i),
    hasPrevious: matchesNav('prev', /^(prev|previous|back|prior\s+question)/i),
    hasReview: matchesNav('review', /^(review|flag|mark\s+for\s+review)/i),
    hasSubmit: matchesNav('submit', /^(submit|finish\s+quiz|complete\s+practice|grade\s+practice)/i)
  };
}
