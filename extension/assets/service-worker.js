// src/core/security/message-validator.ts
var MAX_MESSAGE_BYTES = 256 * 1024;
var ALLOWED_ACTIONS = /* @__PURE__ */ new Set([
  "SCAN_PAGE",
  "START_SESSION",
  "PAUSE_SESSION",
  "RESUME_SESSION",
  "EMERGENCY_STOP",
  "GET_STATUS",
  "SYNC_SESSION_STATE",
  "OPEN_DASHBOARD",
  "PING_COMPANION"
]);
function validateExtensionMessage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "Message must be a non-null JSON object." };
  }
  let serializedSize = 0;
  try {
    serializedSize = JSON.stringify(raw).length;
  } catch {
    return { valid: false, error: "Message contains non-serializable or circular data." };
  }
  if (serializedSize > MAX_MESSAGE_BYTES) {
    return {
      valid: false,
      error: `Message size (${serializedSize} bytes) exceeds limit (${MAX_MESSAGE_BYTES} bytes).`
    };
  }
  const candidate = raw;
  if (typeof candidate.action !== "string" || !ALLOWED_ACTIONS.has(candidate.action)) {
    return { valid: false, error: `Unsupported or unauthorized action: ${String(candidate.action)}` };
  }
  if (typeof candidate.requestId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(candidate.requestId)) {
    return { valid: false, error: "Invalid or missing requestId." };
  }
  if (typeof candidate.timestamp !== "string" || Number.isNaN(Date.parse(candidate.timestamp))) {
    return { valid: false, error: "Invalid ISO timestamp." };
  }
  return { valid: true };
}

// src/core/storage/repository.ts
var DEFAULT_SETTINGS = {
  profileName: "Authorized Practice Default",
  stepDelayMs: 60,
  maxRetries: 2,
  maxDurationMs: 12e4,
  minConfidenceThreshold: 0.65,
  autoSubmitAuthorizedPractice: true,
  requireConfirmationForSubmit: true,
  authorizedDomains: ["localhost", "127.0.0.1"],
  aiProviderMode: "deterministic",
  aiCustomEndpointUrl: "",
  aiModelName: "gpt-4o-mini",
  learnerDailyStudyMinutes: 60,
  learnerTargetExamDate: "2026-11-09",
  dataRetentionDays: 90,
  companionServiceUrl: "/companion-api"
};
var DB_NAME = "QuizPilotKnowledgeBaseDB";
var DB_VERSION = 1;
var STORE_SESSIONS = "sessions";
var STORE_QUESTIONS = "questions";
var STORE_REPORTS = "reports";
var STORE_ANSWER_KEYS = "answer_keys";
var QuizPilotRepository = class {
  dbPromise = null;
  memorySessions = /* @__PURE__ */ new Map();
  memoryQuestions = /* @__PURE__ */ new Map();
  memoryReports = /* @__PURE__ */ new Map();
  memoryAnswerKeys = [];
  memorySettings = { ...DEFAULT_SETTINGS };
  constructor() {
    this.initIndexedDB();
  }
  initIndexedDB() {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === "undefined") {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }
    this.dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
            db.createObjectStore(STORE_SESSIONS, { keyPath: "sessionId" });
          }
          if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
            const qStore = db.createObjectStore(STORE_QUESTIONS, { keyPath: "storageKey" });
            qStore.createIndex("by_session", "sessionId", { unique: false });
            qStore.createIndex("by_fingerprint", "sessionFingerprint", { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_REPORTS)) {
            db.createObjectStore(STORE_REPORTS, { keyPath: "sessionId" });
          }
          if (!db.objectStoreNames.contains(STORE_ANSWER_KEYS)) {
            db.createObjectStore(STORE_ANSWER_KEYS, { keyPath: "keyId" });
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
  async getSettings() {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        const data = await chrome.storage.local.get("quizpilot_settings");
        if (data?.quizpilot_settings) {
          return { ...DEFAULT_SETTINGS, ...data.quizpilot_settings };
        }
      } catch {
      }
    }
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem("quizpilot_settings");
        if (raw) {
          return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        }
      } catch {
      }
    }
    return { ...this.memorySettings };
  }
  async saveSettings(partial) {
    const current = await this.getSettings();
    const updated = { ...current, ...partial };
    this.memorySettings = updated;
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        await chrome.storage.local.set({ quizpilot_settings: updated });
      } catch {
      }
    }
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("quizpilot_settings", JSON.stringify(updated));
      } catch {
      }
    }
    return updated;
  }
  // ==================== Sessions ====================
  async saveSession(session) {
    const copy = JSON.parse(JSON.stringify(session));
    this.memorySessions.set(copy.sessionId, copy);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        await chrome.storage.local.set({ quizpilot_active_session: copy });
      } catch {
      }
    }
    const db = await this.initIndexedDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, "readwrite");
      tx.objectStore(STORE_SESSIONS).put(copy);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  async getSession(sessionId) {
    const mem = this.memorySessions.get(sessionId);
    if (mem) return JSON.parse(JSON.stringify(mem));
    const db = await this.initIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_SESSIONS, "readonly");
      const req = tx.objectStore(STORE_SESSIONS).get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  async listSessions() {
    const db = await this.initIndexedDB();
    if (db) {
      const fromDb = await new Promise((resolve) => {
        const tx = db.transaction(STORE_SESSIONS, "readonly");
        const req = tx.objectStore(STORE_SESSIONS).getAll();
        req.onsuccess = () => resolve(req.result || []);
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
  async saveCapturedQuestion(question) {
    const copy = JSON.parse(JSON.stringify(question));
    let existingStorageKey = null;
    for (const [key, existing] of this.memoryQuestions.entries()) {
      if (existing.sessionId === copy.sessionId && (existing.questionId === copy.questionId || existing.fingerprint === copy.fingerprint)) {
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
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_QUESTIONS, "readwrite");
      tx.objectStore(STORE_QUESTIONS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  async getQuestionsBySession(sessionId) {
    const all = await this.listAllQuestions();
    return all.filter((q) => q.sessionId === sessionId);
  }
  async listAllQuestions() {
    const db = await this.initIndexedDB();
    if (db) {
      const fromDb = await new Promise((resolve) => {
        const tx = db.transaction(STORE_QUESTIONS, "readonly");
        const req = tx.objectStore(STORE_QUESTIONS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      for (const item of fromDb) {
        const key = item.storageKey || `${item.sessionId}::${item.questionId}`;
        if (!this.memoryQuestions.has(key)) {
          const clean = { ...item };
          delete clean.storageKey;
          delete clean.sessionFingerprint;
          this.memoryQuestions.set(key, clean);
        }
      }
    }
    const seenFingerprints = /* @__PURE__ */ new Map();
    for (const q of this.memoryQuestions.values()) {
      const dedupeKey = `${q.sessionId}::${q.fingerprint}`;
      seenFingerprints.set(dedupeKey, q);
    }
    return Array.from(seenFingerprints.values()).sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    );
  }
  // ==================== Reports ====================
  async saveReport(report) {
    const copy = JSON.parse(JSON.stringify(report));
    this.memoryReports.set(copy.sessionId, copy);
    const db = await this.initIndexedDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_REPORTS, "readwrite");
      tx.objectStore(STORE_REPORTS).put(copy);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  async getReport(sessionId) {
    const mem = this.memoryReports.get(sessionId);
    if (mem) return JSON.parse(JSON.stringify(mem));
    const db = await this.initIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_REPORTS, "readonly");
      const req = tx.objectStore(STORE_REPORTS).get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  async listReports() {
    const db = await this.initIndexedDB();
    if (db) {
      const fromDb = await new Promise((resolve) => {
        const tx = db.transaction(STORE_REPORTS, "readonly");
        const req = tx.objectStore(STORE_REPORTS).getAll();
        req.onsuccess = () => resolve(req.result || []);
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
  async saveAnswerKeys(entries) {
    this.memoryAnswerKeys = JSON.parse(JSON.stringify(entries));
    const db = await this.initIndexedDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_ANSWER_KEYS, "readwrite");
      const store = tx.objectStore(STORE_ANSWER_KEYS);
      store.clear();
      entries.forEach((entry, idx) => {
        store.put({ ...entry, keyId: `key_${idx + 1}` });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  async getAnswerKeys() {
    if (this.memoryAnswerKeys.length > 0) {
      return [...this.memoryAnswerKeys];
    }
    const db = await this.initIndexedDB();
    if (!db) return [];
    const records = await new Promise((resolve) => {
      const tx = db.transaction(STORE_ANSWER_KEYS, "readonly");
      const req = tx.objectStore(STORE_ANSWER_KEYS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    this.memoryAnswerKeys = records;
    return [...records];
  }
  // ==================== Privacy & Data Deletion Controls (Section 8) ====================
  async deleteSessionData(sessionId) {
    this.memorySessions.delete(sessionId);
    this.memoryReports.delete(sessionId);
    for (const [key, q] of this.memoryQuestions.entries()) {
      if (q.sessionId === sessionId) {
        this.memoryQuestions.delete(key);
      }
    }
    const db = await this.initIndexedDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction([STORE_SESSIONS, STORE_QUESTIONS, STORE_REPORTS], "readwrite");
      tx.objectStore(STORE_SESSIONS).delete(sessionId);
      tx.objectStore(STORE_REPORTS).delete(sessionId);
      const qStore = tx.objectStore(STORE_QUESTIONS);
      const getAllReq = qStore.getAll();
      getAllReq.onsuccess = () => {
        const items = getAllReq.result || [];
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
  async clearAllData() {
    this.memorySessions.clear();
    this.memoryQuestions.clear();
    this.memoryReports.clear();
    this.memoryAnswerKeys = [];
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      try {
        await chrome.storage.local.clear();
      } catch {
      }
    }
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem("quizpilot_settings");
      } catch {
      }
    }
    const db = await this.initIndexedDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(
        [STORE_SESSIONS, STORE_QUESTIONS, STORE_REPORTS, STORE_ANSWER_KEYS],
        "readwrite"
      );
      tx.objectStore(STORE_SESSIONS).clear();
      tx.objectStore(STORE_QUESTIONS).clear();
      tx.objectStore(STORE_REPORTS).clear();
      tx.objectStore(STORE_ANSWER_KEYS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
};

// src/quiz-sandbox/synthetic-bank.ts
var STANDARD_PRACTICE_QUESTIONS = [
  {
    questionId: "q_std_1",
    questionText: "According to the CAP theorem, when a distributed data store experiences a network partition (P), which trade-off is unavoidable?",
    questionType: "single_choice",
    subject: "Distributed Systems",
    topic: "Consensus & Replication",
    options: [
      {
        id: "opt_cap_a",
        label: "A",
        text: "Choosing between linearizable Consistency (C) and 100% Availability (A)"
      },
      {
        id: "opt_cap_b",
        label: "B",
        text: "Choosing between Durability and Horizontal Sharding"
      },
      {
        id: "opt_cap_c",
        label: "C",
        text: "Guaranteeing both strict linearizability and zero-latency writes on all nodes"
      },
      {
        id: "opt_cap_d",
        label: "D",
        text: "Disabling TLS encryption to preserve TCP throughput"
      }
    ],
    officialAnswer: ["opt_cap_a"],
    officialExplanation: "During a network partition (P), nodes that cannot communicate must either reject/delay requests to preserve linearizable Consistency (CP) or serve potentially stale data to remain Available (AP)."
  },
  {
    questionId: "q_std_2",
    questionText: "In Chrome Extension Manifest V3, which component replaces persistent background pages for event-driven lifecycle coordination?",
    questionType: "single_choice",
    subject: "Cybersecurity",
    topic: "Web & Browser Security",
    options: [
      { id: "opt_mv3_a", label: "A", text: "DOM Frameset Controller" },
      { id: "opt_mv3_b", label: "B", text: "Background Service Worker" },
      { id: "opt_mv3_c", label: "C", text: "ActiveX NPAPI Plugin" },
      { id: "opt_mv3_d", label: "D", text: "Unrestricted Synchronous XMLHttpRequest Worker" }
    ],
    officialAnswer: ["opt_mv3_b"],
    officialExplanation: "Manifest V3 replaces persistent background pages with event-driven Service Workers to improve security and memory efficiency."
  },
  {
    questionId: "q_std_3",
    questionText: "Which database recovery mechanism guarantees Atomicity and Durability by flushing redo/undo log records to disk before dirty pages are written?",
    questionType: "single_choice",
    subject: "Database Systems",
    topic: "Transactions & Indexing",
    options: [
      { id: "opt_wal_a", label: "A", text: "Write-Ahead Logging (WAL)" },
      { id: "opt_wal_b", label: "B", text: "Read Uncommitted Dirty Cache" },
      { id: "opt_wal_c", label: "C", text: "UDP Broadcast Gossip" },
      { id: "opt_wal_d", label: "D", text: "Client-Side LocalStorage Polling" }
    ],
    officialAnswer: ["opt_wal_a"],
    officialExplanation: "Write-Ahead Logging (WAL) ensures that all modifications are recorded in stable log storage before data pages are updated in-place."
  },
  {
    questionId: "q_std_4",
    questionText: "Which of the following HTTP methods are defined as idempotent by RFC 9110? (Select all that apply)",
    questionType: "multiple_choice",
    subject: "Networking & Systems",
    topic: "HTTP & Transport Protocols",
    options: [
      { id: "opt_http_get", label: "A", text: "GET" },
      { id: "opt_http_put", label: "B", text: "PUT" },
      { id: "opt_http_post", label: "C", text: "POST" },
      { id: "opt_http_delete", label: "D", text: "DELETE" }
    ],
    officialAnswer: ["opt_http_get", "opt_http_put", "opt_http_delete"],
    officialExplanation: "Per RFC 9110 Section 9.2.2, GET, HEAD, OPTIONS, TRACE, PUT, and DELETE are idempotent; POST is not idempotent."
  },
  {
    questionId: "q_std_5",
    questionText: "Which defense-in-depth controls directly mitigate Cross-Site Scripting (XSS) when rendering untrusted page text in a browser dashboard? (Select all that apply)",
    questionType: "multiple_choice",
    subject: "Cybersecurity",
    topic: "Web & Browser Security",
    options: [
      {
        id: "opt_xss_a",
        label: "A",
        text: "Context-aware HTML output encoding and safe DOM APIs (textContent)"
      },
      {
        id: "opt_xss_b",
        label: "B",
        text: "Strict Content Security Policy (CSP) disallowing unsafe-inline scripts"
      },
      {
        id: "opt_xss_c",
        label: "C",
        text: "Passing raw extracted HTML directly into innerHTML and eval()"
      },
      {
        id: "opt_xss_d",
        label: "D",
        text: "Sanitizing and stripping executable script/iframe tags prior to storage"
      }
    ],
    officialAnswer: ["opt_xss_a", "opt_xss_b", "opt_xss_d"],
    officialExplanation: "Safe DOM sinks (textContent), strict CSP headers, and input sanitization prevent untrusted data from executing as code."
  },
  {
    questionId: "q_std_6",
    questionText: "True or False: Binary search over a sorted array of n elements has a worst-case time complexity of O(log n).",
    questionType: "true_false",
    subject: "Algorithms & Data Structures",
    topic: "Complexity & Graph Algorithms",
    options: [
      { id: "opt_tf_true", label: "A", text: "True" },
      { id: "opt_tf_false", label: "B", text: "False" }
    ],
    officialAnswer: ["opt_tf_true"],
    officialExplanation: "Binary search halves the remaining search space on each comparison, completing in at most floor(log2(n)) + 1 comparisons."
  },
  {
    questionId: "q_std_7",
    questionText: "True or False: In Raft consensus, a follower node can unilaterally commit log entries without a majority quorum if its local clock is synchronized via NTP.",
    questionType: "true_false",
    subject: "Distributed Systems",
    topic: "Consensus & Replication",
    options: [
      { id: "opt_raft_true", label: "A", text: "True" },
      { id: "opt_raft_false", label: "B", text: "False" }
    ],
    officialAnswer: ["opt_raft_false"],
    officialExplanation: "Raft safety requires a leader elected by a majority quorum and replication across a majority of cluster nodes before committing any log entry."
  },
  {
    questionId: "q_std_8",
    questionText: "Enter the numeric HTTP status code returned when a client exceeds the permitted request rate limit (Too Many Requests):",
    questionType: "text_input",
    subject: "Networking & Systems",
    topic: "HTTP & Transport Protocols",
    options: [],
    officialAnswer: ["429"],
    officialExplanation: "RFC 6585 defines HTTP status code 429 as Too Many Requests."
  },
  {
    questionId: "q_std_9",
    questionText: 'In Raft leader election, what minimum fraction of cluster votes must a candidate receive to become leader? (Type "majority")',
    questionType: "text_input",
    subject: "Distributed Systems",
    topic: "Consensus & Replication",
    options: [],
    officialAnswer: ["majority"],
    officialExplanation: "A Raft candidate must receive votes from a strict majority ((N/2) + 1) of nodes in the cluster."
  },
  {
    questionId: "q_std_10",
    questionText: "When designing retry logic for transient RPC timeouts in distributed microservices, which strategy prevents synchronized retry storms across clients?",
    questionType: "single_choice",
    subject: "Distributed Systems",
    topic: "Fault Tolerance & Idempotency",
    options: [
      {
        id: "opt_retry_a",
        label: "A",
        text: "Exponential backoff combined with randomized jitter and bounded retry limits"
      },
      {
        id: "opt_retry_b",
        label: "B",
        text: "Unbounded zero-delay tight-loop retries on every client thread"
      },
      {
        id: "opt_retry_c",
        label: "C",
        text: "Fixed 100ms synchronized cron retries across all worker nodes"
      }
    ]
    // Intentionally omitted from officialAnswer to demonstrate Approved Bank / Instructor Note tier
  },
  {
    questionId: "q_std_11",
    questionText: "Which experimental quantum-resistant lattice parameter set is optimal for custom sub-millisecond IoT mesh handshakes without hardware acceleration?",
    questionType: "single_choice",
    subject: "Cybersecurity",
    topic: "Authentication & Cryptography",
    options: [
      { id: "opt_q_a", label: "A", text: "Parameter Set Alpha-512" },
      { id: "opt_q_b", label: "B", text: "Parameter Set Beta-768" },
      { id: "opt_q_c", label: "C", text: "Parameter Set Gamma-1024" }
    ]
    // Ambiguous/unverified question to demonstrate transparent Uncertain status
  }
];
var EDGE_CASE_FAULT_QUESTIONS = [
  ...STANDARD_PRACTICE_QUESTIONS.slice(0, 4),
  {
    questionId: "q_edge_dup_1",
    questionText: "According to the CAP theorem, when a distributed data store experiences a network partition (P), which trade-off is unavoidable?",
    questionType: "single_choice",
    subject: "Distributed Systems",
    topic: "Consensus & Replication",
    options: STANDARD_PRACTICE_QUESTIONS[0].options,
    officialAnswer: ["opt_cap_a"],
    officialExplanation: "Duplicate question fixture to verify fingerprint deduplication."
  },
  {
    questionId: "q_edge_missing_opts",
    questionText: "Malformed Question Fixture: Which distributed lock lease duration is selected when option elements fail to render?",
    questionType: "single_choice",
    subject: "Distributed Systems",
    topic: "Fault Tolerance & Idempotency",
    options: []
    // Missing options!
  },
  {
    questionId: "q_edge_disabled_btn",
    questionText: "Transient Disabled Control Fixture: Which browser storage API supports structured indexing for large offline question banks?",
    questionType: "single_choice",
    subject: "Database Systems",
    topic: "Transactions & Indexing",
    initiallyDisabled: true,
    options: [
      { id: "opt_idb_a", label: "A", text: "IndexedDB", disabled: true },
      { id: "opt_idb_b", label: "B", text: "Session Cookie Header", disabled: true }
    ],
    officialAnswer: ["opt_idb_a"],
    officialExplanation: "IndexedDB provides asynchronous object stores and secondary indexes for large client-side datasets."
  },
  {
    questionId: "q_edge_unsupported_canvas",
    questionText: "Draw a topological sort state diagram on the interactive WebGL canvas below:",
    questionType: "unsupported",
    subject: "Algorithms & Data Structures",
    topic: "Complexity & Graph Algorithms",
    options: [],
    unsupportedLayoutReason: "interactive-webgl-canvas-drawing"
  }
];
var DEFAULT_ANSWER_KEY_ENTRIES = [
  {
    questionId: "q_std_1",
    questionPattern: "CAP theorem, when a distributed data store experiences a network partition",
    acceptedAnswers: ["opt_cap_a"],
    sourceType: "official_key",
    explanation: "Official Key: Under a network partition (P), a distributed system must choose between linearizable Consistency (C) and 100% Availability (A).",
    subject: "Distributed Systems",
    topic: "Consensus & Replication",
    subtopic: "Raft, Paxos & Quorum Consistency",
    difficulty: "medium",
    sourceCitation: "Official Distributed Systems Practice Key v2.4 (Item #1)"
  },
  {
    questionId: "q_std_2",
    questionPattern: "Chrome Extension Manifest V3, which component replaces persistent background pages",
    acceptedAnswers: ["opt_mv3_b"],
    sourceType: "official_key",
    explanation: "Official Key: Manifest V3 uses an event-driven Background Service Worker instead of persistent background pages.",
    subject: "Cybersecurity",
    topic: "Web & Browser Security",
    subtopic: "CSP, XSS, CSRF & Same-Origin Policy",
    difficulty: "easy",
    sourceCitation: "Official Browser Security Practice Key v2.4 (Item #2)"
  },
  {
    questionId: "q_std_3",
    questionPattern: "database recovery mechanism guarantees Atomicity and Durability by flushing redo/undo",
    acceptedAnswers: ["opt_wal_a"],
    sourceType: "official_key",
    explanation: "Official Key: Write-Ahead Logging (WAL) flushes log records to stable storage before data pages are overwritten.",
    subject: "Database Systems",
    topic: "Transactions & Indexing",
    subtopic: "ACID, Isolation Levels & B-Tree/WAL",
    difficulty: "medium",
    sourceCitation: "Official Database Internals Answer Key v2.4 (Item #3)"
  },
  {
    questionId: "q_std_4",
    questionPattern: "HTTP methods are defined as idempotent by RFC 9110",
    // Deliberately omit opt_http_delete here in one test profile or include all 3 in full key:
    // Let's include only ['opt_http_get', 'opt_http_put'] in the learner's pre-selected choice or let the official feedback grade it so we also demonstrate a realistic partial multi-select mistake in sample reports!
    acceptedAnswers: ["opt_http_get", "opt_http_put", "opt_http_delete"],
    sourceType: "official_key",
    explanation: "Official Key (RFC 9110): GET, PUT, and DELETE are idempotent; POST is not idempotent.",
    subject: "Networking & Systems",
    topic: "HTTP & Transport Protocols",
    subtopic: "TCP/UDP, HTTP/2, HTTP/3 & DNS",
    difficulty: "hard",
    sourceCitation: "Official Networking Practice Key v2.4 (Item #4)"
  },
  {
    questionId: "q_std_5",
    questionPattern: "defense-in-depth controls directly mitigate Cross-Site Scripting (XSS)",
    acceptedAnswers: ["opt_xss_a", "opt_xss_b", "opt_xss_d"],
    sourceType: "official_key",
    explanation: "Official Key: Safe DOM APIs (textContent), strict CSP, and HTML sanitization mitigate XSS.",
    subject: "Cybersecurity",
    topic: "Web & Browser Security",
    subtopic: "CSP, XSS, CSRF & Same-Origin Policy",
    difficulty: "medium",
    sourceCitation: "Official Web Security Practice Key v2.4 (Item #5)"
  },
  {
    questionId: "q_std_6",
    questionPattern: "Binary search over a sorted array of n elements has a worst-case time complexity",
    acceptedAnswers: ["opt_tf_true"],
    sourceType: "official_key",
    explanation: "Official Key: True. Binary search runs in O(log n) worst-case time.",
    subject: "Algorithms & Data Structures",
    topic: "Complexity & Graph Algorithms",
    subtopic: "Asymptotic Analysis, Trees & Shortest Paths",
    difficulty: "easy",
    sourceCitation: "Official Algorithms Practice Key v2.4 (Item #6)"
  },
  {
    questionId: "q_std_7",
    questionPattern: "In Raft consensus, a follower node can unilaterally commit log entries",
    acceptedAnswers: ["opt_raft_false"],
    sourceType: "official_key",
    explanation: "Official Key: False. Raft requires a majority quorum led by the cluster leader to commit entries.",
    subject: "Distributed Systems",
    topic: "Consensus & Replication",
    subtopic: "Raft, Paxos & Quorum Consistency",
    difficulty: "medium",
    sourceCitation: "Official Distributed Systems Practice Key v2.4 (Item #7)"
  },
  {
    questionId: "q_std_8",
    questionPattern: "numeric HTTP status code returned when a client exceeds the permitted request rate limit",
    acceptedAnswers: ["429"],
    sourceType: "official_key",
    explanation: "Official Key: HTTP 429 Too Many Requests (RFC 6585).",
    subject: "Networking & Systems",
    topic: "HTTP & Transport Protocols",
    subtopic: "TCP/UDP, HTTP/2, HTTP/3 & DNS",
    difficulty: "easy",
    sourceCitation: "Official Networking Practice Key v2.4 (Item #8)"
  },
  {
    questionId: "q_std_9",
    questionPattern: "In Raft leader election, what minimum fraction of cluster votes",
    acceptedAnswers: ["majority"],
    sourceType: "official_key",
    explanation: "Official Key: A Raft candidate requires a strict majority of cluster votes.",
    subject: "Distributed Systems",
    topic: "Consensus & Replication",
    subtopic: "Raft, Paxos & Quorum Consistency",
    difficulty: "medium",
    sourceCitation: "Official Distributed Systems Practice Key v2.4 (Item #9)"
  },
  {
    questionId: "q_std_10",
    questionPattern: "retry logic for transient RPC timeouts in distributed microservices",
    acceptedAnswers: ["opt_retry_a"],
    sourceType: "instructor_note",
    explanation: "Instructor Explanation: Exponential backoff with randomized jitter spreads out client retries and prevents cascading thundering-herd overload. (Note: Sourced from instructor lecture notes; not yet verified by an official grading key.)",
    subject: "Distributed Systems",
    topic: "Fault Tolerance & Idempotency",
    subtopic: "Retries, Backoff & Circuit Breakers",
    difficulty: "medium",
    sourceCitation: "CS-402 Instructor Lecture Notes \u2014 Fault Tolerance Week 4"
  },
  {
    questionId: "q_std_11",
    questionPattern: "experimental quantum-resistant lattice parameter set is optimal",
    acceptedAnswers: ["opt_q_a", "opt_q_b"],
    sourceType: "approved_bank",
    explanation: "Conflicting entries in study bank: Draft A lists Alpha-512 while Addendum B lists Beta-768. Flagged as uncertain until instructor clarifies.",
    subject: "Cybersecurity",
    topic: "Authentication & Cryptography",
    subtopic: "OAuth2, JWT, TLS & Key Management",
    difficulty: "hard",
    isAmbiguousOrConflicting: true,
    conflictReason: "Conflicting reference key: Study Guide v1 specifies Alpha-512 whereas Errata Sheet v2 specifies Beta-768.",
    sourceCitation: "Community Study Bank (Conflicting Errata #11)"
  },
  {
    questionId: "q_edge_disabled_btn",
    questionPattern: "Transient Disabled Control Fixture: Which browser storage API",
    acceptedAnswers: ["opt_idb_a"],
    sourceType: "official_key",
    explanation: "Official Key: IndexedDB supports indexed structured storage for large question banks.",
    subject: "Database Systems",
    topic: "Transactions & Indexing",
    subtopic: "ACID, Isolation Levels & B-Tree/WAL",
    difficulty: "easy",
    sourceCitation: "Official Edge-Case Fixture Key (#7)"
  }
];

// src/extension/service-worker.ts
var repo = new QuizPilotRepository();
async function handleServiceWorkerMessage(rawMessage, senderTabId) {
  const validation = validateExtensionMessage(rawMessage);
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.error || "Invalid message payload."
    };
  }
  const msg = rawMessage;
  switch (msg.action) {
    case "GET_STATUS": {
      const sessions = await repo.listSessions();
      const latestSession = sessions[0] || null;
      return {
        ok: true,
        latestSession,
        totalSessions: sessions.length
      };
    }
    case "SYNC_SESSION_STATE": {
      const status = String(msg.payload?.status || "idle");
      updateActionBadge(status, senderTabId);
      return { ok: true, status };
    }
    case "OPEN_DASHBOARD": {
      if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
      } else if (typeof chrome !== "undefined" && chrome.tabs?.create) {
        await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
      }
      return { ok: true };
    }
    case "PING_COMPANION": {
      const settings = await repo.getSettings();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2e3);
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
          note: "Optional local companion service is offline; core extension operates standalone."
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
function updateActionBadge(status, tabId) {
  if (typeof chrome === "undefined" || !chrome.action) return;
  const badgeMap = {
    running: { text: "RUN", color: "#8b5cf6" },
    paused: { text: "PAUS", color: "#f59e0b" },
    completed: { text: "DONE", color: "#10b981" },
    stopped_by_user: { text: "STOP", color: "#ef4444" },
    stopped_safety_restriction: { text: "HALT", color: "#ef4444" }
  };
  const cfg = badgeMap[status] || { text: "", color: "#64748b" };
  try {
    chrome.action.setBadgeText({ text: cfg.text, ...tabId ? { tabId } : {} });
    chrome.action.setBadgeBackgroundColor({ color: cfg.color, ...tabId ? { tabId } : {} });
  } catch {
  }
}
if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
    const existingKeys = await repo.getAnswerKeys();
    if (existingKeys.length === 0) {
      await repo.saveAnswerKeys(DEFAULT_ANSWER_KEY_ENTRIES);
    }
    await repo.saveSettings(DEFAULT_SETTINGS);
  });
}
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleServiceWorkerMessage(message, sender?.tab?.id).then((res) => sendResponse(res)).catch(
      (err) => sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : "Service worker error"
      })
    );
    return true;
  });
}
export {
  handleServiceWorkerMessage
};
