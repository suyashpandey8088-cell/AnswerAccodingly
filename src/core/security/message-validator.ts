/**
 * Message Schema Validator (Section 8)
 * Validates messages between content scripts, popup, service worker, and companion service.
 * Enforces payload size bounds and strict action allowlists.
 */

export const MAX_MESSAGE_BYTES = 256 * 1024; // 256 KB limit

export type AllowedExtensionAction =
  | 'SCAN_PAGE'
  | 'START_SESSION'
  | 'PAUSE_SESSION'
  | 'RESUME_SESSION'
  | 'EMERGENCY_STOP'
  | 'GET_STATUS'
  | 'SYNC_SESSION_STATE'
  | 'OPEN_DASHBOARD'
  | 'PING_COMPANION';

const ALLOWED_ACTIONS = new Set<AllowedExtensionAction>([
  'SCAN_PAGE',
  'START_SESSION',
  'PAUSE_SESSION',
  'RESUME_SESSION',
  'EMERGENCY_STOP',
  'GET_STATUS',
  'SYNC_SESSION_STATE',
  'OPEN_DASHBOARD',
  'PING_COMPANION'
]);

export interface ExtensionMessage<T = unknown> {
  action: AllowedExtensionAction;
  requestId: string;
  timestamp: string;
  payload?: T;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateExtensionMessage(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Message must be a non-null JSON object.' };
  }

  let serializedSize = 0;
  try {
    serializedSize = JSON.stringify(raw).length;
  } catch {
    return { valid: false, error: 'Message contains non-serializable or circular data.' };
  }

  if (serializedSize > MAX_MESSAGE_BYTES) {
    return {
      valid: false,
      error: `Message size (${serializedSize} bytes) exceeds limit (${MAX_MESSAGE_BYTES} bytes).`
    };
  }

  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.action !== 'string' || !ALLOWED_ACTIONS.has(candidate.action as AllowedExtensionAction)) {
    return { valid: false, error: `Unsupported or unauthorized action: ${String(candidate.action)}` };
  }

  if (typeof candidate.requestId !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(candidate.requestId)) {
    return { valid: false, error: 'Invalid or missing requestId.' };
  }

  if (typeof candidate.timestamp !== 'string' || Number.isNaN(Date.parse(candidate.timestamp))) {
    return { valid: false, error: 'Invalid ISO timestamp.' };
  }

  return { valid: true };
}
