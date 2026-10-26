import { createAIProvider } from '../core/ai/http-ai';
import { PracticeAutomationEngine } from '../core/automation/engine';
import { PracticeSession } from '../core/models/types';
import { scanQuizDocument } from '../core/scanner/dom-scanner';
import {
  ExtensionMessage,
  validateExtensionMessage
} from '../core/security/message-validator';
import { AnswerSourceManager } from '../core/sources/answer-sources';
import { QuizPilotRepository } from '../core/storage/repository';
import { DEFAULT_ANSWER_KEY_ENTRIES } from '../quiz-sandbox/synthetic-bank';

const repo = new QuizPilotRepository();
const engine = new PracticeAutomationEngine();

function updateInPageStatusOverlay(session: PracticeSession | null): void {
  if (typeof document === 'undefined') return;
  let overlay = document.getElementById('quizpilot-inpage-status-hud');

  if (!session) {
    overlay?.remove();
    return;
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'quizpilot-inpage-status-hud';
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'QuizPilot AI Automation Status');
    overlay.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483647',
      'background:#121624',
      'color:#f8fafc',
      'border:1px solid #8b5cf6',
      'border-radius:10px',
      'padding:12px 16px',
      'box-shadow:0 10px 25px rgba(0,0,0,0.55)',
      'font-family:system-ui,-apple-system,sans-serif',
      'font-size:13px',
      'display:flex',
      'align-items:center',
      'gap:12px'
    ].join(';');

    const textSpan = document.createElement('span');
    textSpan.id = 'quizpilot-inpage-status-text';
    overlay.appendChild(textSpan);

    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.textContent = 'Emergency Stop';
    stopBtn.style.cssText = [
      'background:#ef4444',
      'color:#ffffff',
      'border:none',
      'border-radius:6px',
      'padding:6px 10px',
      'font-weight:600',
      'cursor:pointer'
    ].join(';');
    stopBtn.addEventListener('click', () => {
      engine.emergencyStop('Emergency Stop clicked in floating page overlay.');
      updateInPageStatusOverlay(engine.getActiveSession());
    });
    overlay.appendChild(stopBtn);

    document.body.appendChild(overlay);
  }

  const textEl = document.getElementById('quizpilot-inpage-status-text');
  if (textEl) {
    textEl.textContent = `QuizPilot AI [${session.status.toUpperCase()}] • Processed ${
      session.processedQuestionIds.length
    }/${session.totalDetectedQuestions} • Uncertain: ${session.uncertainAnswerCount}`;
  }
}

export async function handleContentScriptMessage(
  rawMessage: unknown,
  doc: Document = document,
  url: string = typeof window !== 'undefined' ? window.location.href : 'http://localhost/quiz'
): Promise<Record<string, unknown>> {
  const validation = validateExtensionMessage(rawMessage);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const msg = rawMessage as ExtensionMessage<Record<string, unknown>>;
  const settings = await repo.getSettings();

  switch (msg.action) {
    case 'SCAN_PAGE': {
      const scan = scanQuizDocument(doc, url, settings.authorizedDomains);
      return {
        ok: true,
        scan,
        activeSession: engine.getActiveSession()
      };
    }

    case 'START_SESSION': {
      let keys = await repo.getAnswerKeys();
      if (keys.length === 0) {
        await repo.saveAnswerKeys(DEFAULT_ANSWER_KEY_ENTRIES);
        keys = DEFAULT_ANSWER_KEY_ENTRIES;
      }

      const aiProvider = createAIProvider(settings.aiProviderMode, {
        endpointUrl: settings.aiCustomEndpointUrl,
        modelName: settings.aiModelName
      });
      const sourceManager = new AnswerSourceManager(
        aiProvider,
        keys,
        settings.minConfidenceThreshold
      );

      const resumeSessionId =
        typeof msg.payload?.sessionId === 'string' ? msg.payload.sessionId : undefined;

      const result = await engine.runPracticeSession({
        doc,
        url,
        sessionId: resumeSessionId,
        settings,
        answerSourceManager: sourceManager,
        aiProvider,
        repository: repo,
        onProgress: (sess) => {
          updateInPageStatusOverlay(sess);
        }
      });

      updateInPageStatusOverlay(result.session);
      return {
        ok: true,
        session: result.session,
        report: result.report
      };
    }

    case 'PAUSE_SESSION': {
      engine.pause();
      const active = engine.getActiveSession();
      updateInPageStatusOverlay(active);
      return { ok: true, session: active };
    }

    case 'RESUME_SESSION': {
      engine.resume();
      const active = engine.getActiveSession();
      updateInPageStatusOverlay(active);
      return { ok: true, session: active };
    }

    case 'EMERGENCY_STOP': {
      engine.emergencyStop('Emergency Stop triggered via extension popup/control.');
      const active = engine.getActiveSession();
      updateInPageStatusOverlay(active);
      return { ok: true, session: active };
    }

    case 'GET_STATUS': {
      const scan = scanQuizDocument(doc, url, settings.authorizedDomains);
      return {
        ok: true,
        scan,
        activeSession: engine.getActiveSession()
      };
    }

    default:
      return { ok: false, error: `Action ${msg.action} not handled by content script.` };
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleContentScriptMessage(message)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Content script error'
        })
      );
    return true;
  });
}
