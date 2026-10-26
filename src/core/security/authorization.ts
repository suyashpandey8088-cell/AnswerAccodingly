/**
 * Safety & Authorization Guard (Section 4 & Section 8)
 * - Restricts unattended execution to designated practice environments, synthetic test sites,
 *   or explicitly authorized assessment workflows.
 * - Detects CAPTCHA, proctoring, authentication challenges, and access restrictions;
 *   forces an immediate stop rather than bypassing them.
 */

export interface AuthorizationCheckResult {
  isAuthorizedPractice: boolean;
  authorizationMode: 'synthetic_sandbox' | 'explicit_practice_attribute' | 'user_allowlisted_practice' | 'unauthorized';
  authorizationReason: string;
  hasSafetyRestriction: boolean;
  safetyRestrictionReason?: string;
}

const CAPTCHA_SELECTORS = [
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '[data-captcha="true"]',
  '[data-captcha-challenge]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]'
];

const PROCTORING_SELECTORS = [
  '[data-proctoring="active"]',
  '[data-proctored="true"]',
  '[data-exam-mode="graded-live"]',
  '[data-automation-policy="prohibited"]',
  '#proctorio-overlay',
  '.respondus-lockdown',
  '.honorlock-active'
];

const AUTH_WALL_SELECTORS = [
  '[data-auth-challenge="true"]',
  '[data-access-restricted="true"]',
  'form[data-login-wall="true"]',
  'input[type="password"]:not([data-ignore-auth-check])'
];

export function verifyPracticeAuthorization(
  doc: Document,
  rawUrl: string,
  allowedDomains: string[] = ['localhost', '127.0.0.1']
): AuthorizationCheckResult {
  // 1. Check for CAPTCHA challenges first
  for (const selector of CAPTCHA_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el && !el.hasAttribute('hidden')) {
      return {
        isAuthorizedPractice: false,
        authorizationMode: 'unauthorized',
        authorizationReason: 'Blocked by CAPTCHA challenge detection.',
        hasSafetyRestriction: true,
        safetyRestrictionReason: `CAPTCHA / anti-bot challenge detected (${selector}). Automation halted immediately.`
      };
    }
  }

  // 2. Check for proctoring or live graded assessment markers
  for (const selector of PROCTORING_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el && !el.hasAttribute('hidden')) {
      return {
        isAuthorizedPractice: false,
        authorizationMode: 'unauthorized',
        authorizationReason: 'Blocked by proctoring or live graded exam policy.',
        hasSafetyRestriction: true,
        safetyRestrictionReason: `Proctored or graded examination marker detected (${selector}). Automation is strictly prohibited.`
      };
    }
  }

  // 3. Check for authentication or access restriction walls
  for (const selector of AUTH_WALL_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el && !el.hasAttribute('hidden')) {
      return {
        isAuthorizedPractice: false,
        authorizationMode: 'unauthorized',
        authorizationReason: 'Blocked by authentication challenge or access restriction.',
        hasSafetyRestriction: true,
        safetyRestrictionReason: `Authentication challenge or access wall detected (${selector}). Do not bypass login controls.`
      };
    }
  }

  // 4. Check explicit synthetic sandbox or DOM practice authorization attributes
  const rootPracticeAttr =
    doc.documentElement.getAttribute('data-quizpilot-authorized') === 'true' ||
    doc.body?.getAttribute('data-quizpilot-authorized') === 'true' ||
    Boolean(doc.querySelector('[data-quizpilot-authorized="true"]'));

  const explicitPracticeQuiz =
    doc.documentElement.getAttribute('data-quiz-mode') === 'practice' ||
    doc.body?.getAttribute('data-quiz-mode') === 'practice' ||
    Boolean(doc.querySelector('[data-quiz-mode="practice"]')) ||
    Boolean(doc.querySelector('meta[name="quizpilot-practice"][content="true"]'));

  if (rootPracticeAttr) {
    return {
      isAuthorizedPractice: true,
      authorizationMode: 'synthetic_sandbox',
      authorizationReason: 'Verified synthetic practice sandbox (data-quizpilot-authorized="true").',
      hasSafetyRestriction: false
    };
  }

  if (explicitPracticeQuiz) {
    return {
      isAuthorizedPractice: true,
      authorizationMode: 'explicit_practice_attribute',
      authorizationReason: 'Page explicitly declares practice mode (data-quiz-mode="practice").',
      hasSafetyRestriction: false
    };
  }

  // 5. Check user-configured authorized practice domains ONLY when page also contains practice quiz markers
  try {
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const host = parsedUrl.hostname.toLowerCase();
    const isDomainAllowlisted = allowedDomains.some((d) => {
      const clean = d.trim().toLowerCase();
      return clean === host || (clean.endsWith('.e2b.app') && host.endsWith('.e2b.app'));
    });

    const hasPracticeTitleOrBanner = /practice|mock\s+exam|sample\s+quiz|self-assessment|study\s+drill/i.test(
      `${doc.title} ${doc.querySelector('h1, h2, [data-quiz-title]')?.textContent || ''}`
    );

    if (isDomainAllowlisted && hasPracticeTitleOrBanner) {
      return {
        isAuthorizedPractice: true,
        authorizationMode: 'user_allowlisted_practice',
        authorizationReason: `Authorized allowlisted host (${host}) with verified practice-quiz heading.`,
        hasSafetyRestriction: false
      };
    }
  } catch {
    // Fall through to unauthorized
  }

  return {
    isAuthorizedPractice: false,
    authorizationMode: 'unauthorized',
    authorizationReason:
      'Page lacks explicit practice authorization markers (data-quizpilot-authorized="true" or data-quiz-mode="practice") and is not verified as an authorized practice quiz.',
    hasSafetyRestriction: false
  };
}
