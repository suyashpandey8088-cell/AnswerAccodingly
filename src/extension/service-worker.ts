import {
  ExtensionMessage,
  validateExtensionMessage
} from '../core/security/message-validator';
import { DEFAULT_SETTINGS, QuizPilotRepository } from '../core/storage/repository';
import { DEFAULT_ANSWER_KEY_ENTRIES } from '../quiz-sandbox/synthetic-bank';

const repo = new QuizPilotRepository();

export async function handleServiceWorkerMessage(
  rawMessage: unknown,
  senderTabId?: number
): Promise<Record<string, unknown>> {
  const validation = validateExtensionMessage(rawMessage);
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.error || 'Invalid message payload.'
    };
  }

  const msg = rawMessage as ExtensionMessage<Record<string, unknown>>;

  switch (msg.action) {
    case 'GET_STATUS': {
      const sessions = await repo.listSessions();
      const latestSession = sessions[0] || null;
      return {
        ok: true,
        latestSession,
        totalSessions: sessions.length
      };
    }

    case 'SYNC_SESSION_STATE': {
      const status = String(msg.payload?.status || 'idle');
      updateActionBadge(status, senderTabId);
      return { ok: true, status };
    }

    case 'OPEN_DASHBOARD': {
      if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
      } else if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      }
      return { ok: true };
    }

    case 'PING_COMPANION': {
      const settings = await repo.getSettings();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(`${settings.companionServiceUrl}/health`, {
          signal: controller.signal
        });
        return {
          ok: res.ok,
          companionAvailable: res.ok
        };
      } catch {
        return {
          ok: true,
          companionAvailable: false,
          note: 'Optional local companion service is offline; core extension operates standalone.'
        };
      } finally {
        clearTimeout(timer);
      }
    }

    default:
      return {
        ok: true,
        forwardedAction: msg.action
      };
  }
}

function updateActionBadge(status: string, tabId?: number): void {
  if (typeof chrome === 'undefined' || !chrome.action) return;

  const badgeMap: Record<string, { text: string; color: string }> = {
    running: { text: 'RUN', color: '#8b5cf6' },
    paused: { text: 'PAUS', color: '#f59e0b' },
    completed: { text: 'DONE', color: '#10b981' },
    stopped_by_user: { text: 'STOP', color: '#ef4444' },
    stopped_safety_restriction: { text: 'HALT', color: '#ef4444' }
  };

  const cfg = badgeMap[status] || { text: '', color: '#64748b' };
  try {
    chrome.action.setBadgeText({ text: cfg.text, ...(tabId ? { tabId } : {}) });
    chrome.action.setBadgeBackgroundColor({ color: cfg.color, ...(tabId ? { tabId } : {}) });
  } catch {
    // Ignore in headless/non-extension context
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
    const existingKeys = await repo.getAnswerKeys();
    if (existingKeys.length === 0) {
      await repo.saveAnswerKeys(DEFAULT_ANSWER_KEY_ENTRIES);
    }
    await repo.saveSettings(DEFAULT_SETTINGS);
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleServiceWorkerMessage(message, sender?.tab?.id)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Service worker error'
        })
      );
    return true;
  });
}
