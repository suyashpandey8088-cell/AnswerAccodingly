import {
  AnswerKeyEntry,
  CapturedQuestion,
  PracticeSession,
  QuizPilotSettings,
  StudyReport
} from '../models/types';

export const DEFAULT_SETTINGS: QuizPilotSettings = {
  profileName: 'Authorized Practice Default',
  stepDelayMs: 60,
  maxRetries: 2,
  maxDurationMs: 120000,
  minConfidenceThreshold: 0.65,
  autoSubmitAuthorizedPractice: true,
  requireConfirmationForSubmit: true,
  authorizedDomains: ['localhost', '127.0.0.1'],
  aiProviderMode: 'deterministic',
  aiCustomEndpointUrl: '',
  aiModelName: 'gpt-4o-mini',
  learnerDailyStudyMinutes: 60,
  learnerTargetExamDate: '2026-11-09',
  dataRetentionDays: 90,
  companionServiceUrl: '/companion-api'
};

const DB_NAME = 'QuizPilotKnowledgeBaseDB';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_QUESTIONS = 'questions';
const STORE_REPORTS = 'reports';
const STORE_ANSWER_KEYS = 'answer_keys';

/**
 * Dual-layer Repository (Section 3, Section 5, Section 8):
 * - Uses Chrome Storage API (with localStorage/memory fallback) for settings & active session state.
 * - Uses IndexedDB (with in-memory Map fallback) for large question banks, sessions, answer keys & reports.
 * - Guarantees idempotent upsert by (sessionId, questionId) and (sessionId, fingerprint) so session recovery
 *   never duplicates questions.
 */
export class QuizPilotRepository {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private memorySessions = new Map<string, PracticeSession>();
  private memoryQuestions = new Map<string, CapturedQuestion>();
  private memoryReports = new Map<string, StudyReport>();
  private memoryAnswerKeys: AnswerKeyEntry[] = [];
  private memorySettings: QuizPilotSettings = { ...DEFAULT_SETTINGS };

  constructor() {
    this.initIndexedDB();
  }

  private initIndexedDB(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    if (typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
            db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
          }
          if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
            const qStore = db.createObjectStore(STORE_QUESTIONS, { keyPath: 'storageKey' });
            qStore.createIndex('by_session', 'sessionId', { unique: false });
            qStore.createIndex('by_fingerprint', 'sessionFingerprint', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_REPORTS)) {
            db.createObjectStore(STORE_REPORTS, { keyPath: 'sessionId' });
          }
          if (!db.objectStoreNames.contains(STORE_ANSWER_KEYS)) {
            db.createObjectStore(STORE_ANSWER_KEYS, { keyPath: 'keyId' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  // ==================== Settings (Chrome Storage API + Fallback) ====================

  public async getSettings(): Promise<QuizPilotSettings> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const data = await chrome.storage.local.get('quizpilot_settings');
        if (data?.quizpilot_settings) {
          return { ...DEFAULT_SETTINGS, ...data.quizpilot_settings };
        }
      } catch {
        // Fallback below
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('quizpilot_settings');
        if (raw) {
          return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<QuizPilotSettings>) };
        }
      } catch {
        // Fallback below
      }
    }

    return { ...this.memorySettings };
  }

  public async saveSettings(partial: Partial<QuizPilotSettings>): Promise<QuizPilotSettings> {
    const current = await this.getSettings();
    const updated: QuizPilotSettings = { ...current, ...partial };
    this.memorySettings = updated;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.set({ quizpilot_settings: updated });
      } catch {
        // Ignore if quota/context restricted
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('quizpilot_settings', JSON.stringify(updated));
      } catch {
        // Ignore
      }
    }

    return updated;
  }

  // ==================== Sessions ====================

  public async saveSession(session: PracticeSession): Promise<void> {
    const copy: PracticeSession = JSON.parse(JSON.stringify(session));
    this.memorySessions.set(copy.sessionId, copy);

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.set({ quizpilot_active_session: copy });
      } catch {
        // Ignore
      }
    }

    const db = await this.initIndexedDB();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      tx.objectStore(STORE_SESSIONS).put(copy);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  public async getSession(sessionId: string): Promise<PracticeSession | null> {
    const mem = this.memorySessions.get(sessionId);
    if (mem) return JSON.parse(JSON.stringify(mem));

    const db = await this.initIndexedDB();
    if (!db) return null;

    return new Promise<PracticeSession | null>((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).get(sessionId);
      req.onsuccess = () => resolve((req.result as PracticeSession) || null);
      req.onerror = () => resolve(null);
    });
  }

  public async listSessions(): Promise<PracticeSession[]> {
    const db = await this.initIndexedDB();
    if (db) {
      const fromDb = await new Promise<PracticeSession[]>((resolve) => {
        const tx = db.transaction(STORE_SESSIONS, 'readonly');
        const req = tx.objectStore(STORE_SESSIONS).getAll();
        req.onsuccess = () => resolve((req.result as PracticeSession[]) || []);
        req.onerror = () => resolve([]);
      });
      for (const s of fromDb) {
        this.memorySessions.set(s.sessionId, s);
      }
    }

    return Array.from(this.memorySessions.values()).sort(
      (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
    );
  }

  // ==================== Question Bank (Idempotent & Deduplicated) ====================

  public async saveCapturedQuestion(question: CapturedQuestion): Promise<void> {
    const copy: CapturedQuestion = JSON.parse(JSON.stringify(question));

    // Check if an entry with the same (sessionId, questionId) OR (sessionId, fingerprint) already exists
    let existingStorageKey: string | null = null;
    for (const [key, existing] of this.memoryQuestions.entries()) {
      if (
        existing.sessionId === copy.sessionId &&
        (existing.questionId === copy.questionId || existing.fingerprint === copy.fingerprint)
      ) {
        existingStorageKey = key;
        break;
      }
    }

    const storageKey = existingStorageKey || `${copy.sessionId}::${copy.questionId}`;
    this.memoryQuestions.set(storageKey, copy);

    const db = await this.initIndexedDB();
    if (!db) return;

    const record = {
      ...copy,
      storageKey,
      sessionFingerprint: `${copy.sessionId}::${copy.fingerprint}`
    };

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_QUESTIONS, 'readwrite');
      tx.objectStore(STORE_QUESTIONS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  public async getQuestionsBySession(sessionId: string): Promise<CapturedQuestion[]> {
    const all = await this.listAllQuestions();
    return all.filter((q) => q.sessionId === sessionId);
  }

  public async listAllQuestions(): Promise<CapturedQuestion[]> {
    const db = await this.initIndexedDB();
    if (db) {
      const fromDb = await new Promise<(CapturedQuestion & { storageKey?: string })[]>((resolve) => {
        const tx = db.transaction(STORE_QUESTIONS, 'readonly');
        const req = tx.objectStore(STORE_QUESTIONS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      for (const item of fromDb) {
        const key = item.storageKey || `${item.sessionId}::${item.questionId}`;
        if (!this.memoryQuestions.has(key)) {
          const clean = { ...item };
          delete clean.storageKey;
          delete (clean as Record<string, unknown>).sessionFingerprint;
          this.memoryQuestions.set(key, clean);
        }
      }
    }

    // Deduplicate by (sessionId, fingerprint) to guarantee zero duplicate questions
    const seenFingerprints = new Map<string, CapturedQuestion>();
    for (const q of this.memoryQuestions.values()) {
      const dedupeKey = `${q.sessionId}::${q.fingerprint}`;
      seenFingerprints.set(dedupeKey, q);
    }

    return Array.from(seenFingerprints.values()).sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    );
  }

  // ==================== Reports ====================

  public async saveReport(report: StudyReport): Promise<void> {
    const copy: StudyReport = JSON.parse(JSON.stringify(report));
    this.memoryReports.set(copy.sessionId, copy);

    const db = await this.initIndexedDB();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_REPORTS, 'readwrite');
      tx.objectStore(STORE_REPORTS).put(copy);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  public async getReport(sessionId: string): Promise<StudyReport | null> {
    const mem = this.memoryReports.get(sessionId);
    if (mem) return JSON.parse(JSON.stringify(mem));

    const db = await this.initIndexedDB();
    if (!db) return null;

    return new Promise<StudyReport | null>((resolve) => {
      const tx = db.transaction(STORE_REPORTS, 'readonly');
      const req = tx.objectStore(STORE_REPORTS).get(sessionId);
      req.onsuccess = () => resolve((req.result as StudyReport) || null);
      req.onerror = () => resolve(null);
    });
  }

  public async listReports(): Promise<StudyReport[]> {
    const db = await this.initIndexedDB();
    if (db) {
      const fromDb = await new Promise<StudyReport[]>((resolve) => {
        const tx = db.transaction(STORE_REPORTS, 'readonly');
        const req = tx.objectStore(STORE_REPORTS).getAll();
        req.onsuccess = () => resolve((req.result as StudyReport[]) || []);
        req.onerror = () => resolve([]);
      });
      for (const r of fromDb) {
        this.memoryReports.set(r.sessionId, r);
      }
    }

    return Array.from(this.memoryReports.values()).sort(
      (a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
    );
  }

  // ==================== Answer Keys ====================

  public async saveAnswerKeys(entries: AnswerKeyEntry[]): Promise<void> {
    this.memoryAnswerKeys = JSON.parse(JSON.stringify(entries));
    const db = await this.initIndexedDB();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_ANSWER_KEYS, 'readwrite');
      const store = tx.objectStore(STORE_ANSWER_KEYS);
      store.clear();
      entries.forEach((entry, idx) => {
        store.put({ ...entry, keyId: `key_${idx + 1}` });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  public async getAnswerKeys(): Promise<AnswerKeyEntry[]> {
    if (this.memoryAnswerKeys.length > 0) {
      return [...this.memoryAnswerKeys];
    }
    const db = await this.initIndexedDB();
    if (!db) return [];

    const records = await new Promise<AnswerKeyEntry[]>((resolve) => {
      const tx = db.transaction(STORE_ANSWER_KEYS, 'readonly');
      const req = tx.objectStore(STORE_ANSWER_KEYS).getAll();
      req.onsuccess = () => resolve((req.result as AnswerKeyEntry[]) || []);
      req.onerror = () => resolve([]);
    });

    this.memoryAnswerKeys = records;
    return [...records];
  }

  // ==================== Privacy & Data Deletion Controls (Section 8) ====================

  public async deleteSessionData(sessionId: string): Promise<void> {
    this.memorySessions.delete(sessionId);
    this.memoryReports.delete(sessionId);
    for (const [key, q] of this.memoryQuestions.entries()) {
      if (q.sessionId === sessionId) {
        this.memoryQuestions.delete(key);
      }
    }

    const db = await this.initIndexedDB();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE_SESSIONS, STORE_QUESTIONS, STORE_REPORTS], 'readwrite');
      tx.objectStore(STORE_SESSIONS).delete(sessionId);
      tx.objectStore(STORE_REPORTS).delete(sessionId);

      const qStore = tx.objectStore(STORE_QUESTIONS);
      const getAllReq = qStore.getAll();
      getAllReq.onsuccess = () => {
        const items = (getAllReq.result as { storageKey: string; sessionId: string }[]) || [];
        for (const item of items) {
          if (item.sessionId === sessionId) {
            qStore.delete(item.storageKey);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  public async clearAllData(): Promise<void> {
    this.memorySessions.clear();
    this.memoryQuestions.clear();
    this.memoryReports.clear();
    this.memoryAnswerKeys = [];

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.clear();
      } catch {
        // Ignore
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('quizpilot_settings');
      } catch {
        // Ignore
      }
    }

    const db = await this.initIndexedDB();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(
        [STORE_SESSIONS, STORE_QUESTIONS, STORE_REPORTS, STORE_ANSWER_KEYS],
        'readwrite'
      );
      tx.objectStore(STORE_SESSIONS).clear();
      tx.objectStore(STORE_QUESTIONS).clear();
      tx.objectStore(STORE_REPORTS).clear();
      tx.objectStore(STORE_ANSWER_KEYS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
