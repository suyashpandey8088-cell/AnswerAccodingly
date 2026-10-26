/**
 * Security & Privacy Sanitizer (Section 8)
 * - Treats all web-extracted content as untrusted data, never executable markup or AI instructions.
 * - Strips HTML/script payloads, prompt-injection delimiters, credentials, tokens, and session query params.
 */

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bsk-[A-Za-z0-9]{16,}\b/g, // API secret keys
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|session[_-]?id|auth[_-]?token)\s*[:=]\s*['"]?[^\s'",;]+['"]?/gi,
  /\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+/gi
];

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
  /system\s*prompt\s*override/gi,
  /<\/?(?:script|iframe|object|embed|style|meta|link)\b[^>]*>/gi
];

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'auth',
  'session',
  'sessionid',
  'sid',
  'jwt',
  'key',
  'api_key',
  'apikey',
  'password',
  'pwd',
  'signature',
  'sig'
]);

export function redactSensitiveTokens(input: string): string {
  if (!input) return '';
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED_CREDENTIAL]');
  }
  return result;
}

export function sanitizeUntrustedText(raw: string, maxLength = 4000): string {
  if (typeof raw !== 'string') return '';
  let cleaned = raw
    // Strip zero-width & control chars except newline/tab
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
    // Strip dangerous HTML tags completely
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ');

  for (const injectionPattern of PROMPT_INJECTION_PATTERNS) {
    cleaned = cleaned.replace(injectionPattern, '[UNTRUSTED_DIRECTIVE_FILTERED]');
  }

  cleaned = redactSensitiveTokens(cleaned)
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > maxLength) {
    cleaned = `${cleaned.slice(0, maxLength)}...`;
  }
  return cleaned;
}

export function escapeHtml(unsafe: string): string {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeReferenceUrl(rawUrl: string): { referenceUrl: string; originDomain: string } {
  if (!rawUrl) {
    return { referenceUrl: 'about:blank', originDomain: 'local' };
  }
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_value, key) => {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      parsed.searchParams.set(key, 'REDACTED');
    }
    parsed.username = '';
    parsed.password = '';
    return {
      referenceUrl: parsed.toString(),
      originDomain: parsed.hostname || 'local'
    };
  } catch {
    return {
      referenceUrl: redactSensitiveTokens(rawUrl).slice(0, 256),
      originDomain: 'local'
    };
  }
}

/**
 * Deterministic question fingerprint for deduplication across interrupted sessions
 * and duplicate-question detection.
 */
export function computeQuestionFingerprint(questionText: string, optionTexts: string[]): string {
  const normalizedQuestion = sanitizeUntrustedText(questionText)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const normalizedOptions = optionTexts
    .map((o) =>
      sanitizeUntrustedText(o)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    )
    .sort()
    .join('|');
  const payload = `${normalizedQuestion}::${normalizedOptions}`;

  // FNV-1a 32-bit hash for fast deterministic fingerprinting in browser & Node
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `qf_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
