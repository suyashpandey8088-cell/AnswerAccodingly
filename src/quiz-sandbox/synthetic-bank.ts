import { AnswerKeyEntry, QuestionOption, QuestionType } from '../core/models/types';

export interface SyntheticQuizQuestion {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  subject: string;
  topic: string;
  options: QuestionOption[];
  officialAnswer?: string[];
  officialExplanation?: string;
  unsupportedLayoutReason?: string;
  initiallyDisabled?: boolean;
}

export const STANDARD_PRACTICE_QUESTIONS: SyntheticQuizQuestion[] = [
  {
    questionId: 'q_std_1',
    questionText:
      'According to the CAP theorem, when a distributed data store experiences a network partition (P), which trade-off is unavoidable?',
    questionType: 'single_choice',
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
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
      },
      {
        id: 'opt_cap_c',
        label: 'C',
        text: 'Guaranteeing both strict linearizability and zero-latency writes on all nodes'
      },
      {
        id: 'opt_cap_d',
        label: 'D',
        text: 'Disabling TLS encryption to preserve TCP throughput'
      }
    ],
    officialAnswer: ['opt_cap_a'],
    officialExplanation:
      'During a network partition (P), nodes that cannot communicate must either reject/delay requests to preserve linearizable Consistency (CP) or serve potentially stale data to remain Available (AP).'
  },
  {
    questionId: 'q_std_2',
    questionText:
      'In Chrome Extension Manifest V3, which component replaces persistent background pages for event-driven lifecycle coordination?',
    questionType: 'single_choice',
    subject: 'Cybersecurity',
    topic: 'Web & Browser Security',
    options: [
      { id: 'opt_mv3_a', label: 'A', text: 'DOM Frameset Controller' },
      { id: 'opt_mv3_b', label: 'B', text: 'Background Service Worker' },
      { id: 'opt_mv3_c', label: 'C', text: 'ActiveX NPAPI Plugin' },
      { id: 'opt_mv3_d', label: 'D', text: 'Unrestricted Synchronous XMLHttpRequest Worker' }
    ],
    officialAnswer: ['opt_mv3_b'],
    officialExplanation:
      'Manifest V3 replaces persistent background pages with event-driven Service Workers to improve security and memory efficiency.'
  },
  {
    questionId: 'q_std_3',
    questionText:
      'Which database recovery mechanism guarantees Atomicity and Durability by flushing redo/undo log records to disk before dirty pages are written?',
    questionType: 'single_choice',
    subject: 'Database Systems',
    topic: 'Transactions & Indexing',
    options: [
      { id: 'opt_wal_a', label: 'A', text: 'Write-Ahead Logging (WAL)' },
      { id: 'opt_wal_b', label: 'B', text: 'Read Uncommitted Dirty Cache' },
      { id: 'opt_wal_c', label: 'C', text: 'UDP Broadcast Gossip' },
      { id: 'opt_wal_d', label: 'D', text: 'Client-Side LocalStorage Polling' }
    ],
    officialAnswer: ['opt_wal_a'],
    officialExplanation:
      'Write-Ahead Logging (WAL) ensures that all modifications are recorded in stable log storage before data pages are updated in-place.'
  },
  {
    questionId: 'q_std_4',
    questionText:
      'Which of the following HTTP methods are defined as idempotent by RFC 9110? (Select all that apply)',
    questionType: 'multiple_choice',
    subject: 'Networking & Systems',
    topic: 'HTTP & Transport Protocols',
    options: [
      { id: 'opt_http_get', label: 'A', text: 'GET' },
      { id: 'opt_http_put', label: 'B', text: 'PUT' },
      { id: 'opt_http_post', label: 'C', text: 'POST' },
      { id: 'opt_http_delete', label: 'D', text: 'DELETE' }
    ],
    officialAnswer: ['opt_http_get', 'opt_http_put', 'opt_http_delete'],
    officialExplanation:
      'Per RFC 9110 Section 9.2.2, GET, HEAD, OPTIONS, TRACE, PUT, and DELETE are idempotent; POST is not idempotent.'
  },
  {
    questionId: 'q_std_5',
    questionText:
      'Which defense-in-depth controls directly mitigate Cross-Site Scripting (XSS) when rendering untrusted page text in a browser dashboard? (Select all that apply)',
    questionType: 'multiple_choice',
    subject: 'Cybersecurity',
    topic: 'Web & Browser Security',
    options: [
      {
        id: 'opt_xss_a',
        label: 'A',
        text: 'Context-aware HTML output encoding and safe DOM APIs (textContent)'
      },
      {
        id: 'opt_xss_b',
        label: 'B',
        text: 'Strict Content Security Policy (CSP) disallowing unsafe-inline scripts'
      },
      {
        id: 'opt_xss_c',
        label: 'C',
        text: 'Passing raw extracted HTML directly into innerHTML and eval()'
      },
      {
        id: 'opt_xss_d',
        label: 'D',
        text: 'Sanitizing and stripping executable script/iframe tags prior to storage'
      }
    ],
    officialAnswer: ['opt_xss_a', 'opt_xss_b', 'opt_xss_d'],
    officialExplanation:
      'Safe DOM sinks (textContent), strict CSP headers, and input sanitization prevent untrusted data from executing as code.'
  },
  {
    questionId: 'q_std_6',
    questionText:
      'True or False: Binary search over a sorted array of n elements has a worst-case time complexity of O(log n).',
    questionType: 'true_false',
    subject: 'Algorithms & Data Structures',
    topic: 'Complexity & Graph Algorithms',
    options: [
      { id: 'opt_tf_true', label: 'A', text: 'True' },
      { id: 'opt_tf_false', label: 'B', text: 'False' }
    ],
    officialAnswer: ['opt_tf_true'],
    officialExplanation:
      'Binary search halves the remaining search space on each comparison, completing in at most floor(log2(n)) + 1 comparisons.'
  },
  {
    questionId: 'q_std_7',
    questionText:
      'True or False: In Raft consensus, a follower node can unilaterally commit log entries without a majority quorum if its local clock is synchronized via NTP.',
    questionType: 'true_false',
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
    options: [
      { id: 'opt_raft_true', label: 'A', text: 'True' },
      { id: 'opt_raft_false', label: 'B', text: 'False' }
    ],
    officialAnswer: ['opt_raft_false'],
    officialExplanation:
      'Raft safety requires a leader elected by a majority quorum and replication across a majority of cluster nodes before committing any log entry.'
  },
  {
    questionId: 'q_std_8',
    questionText:
      'Enter the numeric HTTP status code returned when a client exceeds the permitted request rate limit (Too Many Requests):',
    questionType: 'text_input',
    subject: 'Networking & Systems',
    topic: 'HTTP & Transport Protocols',
    options: [],
    officialAnswer: ['429'],
    officialExplanation: 'RFC 6585 defines HTTP status code 429 as Too Many Requests.'
  },
  {
    questionId: 'q_std_9',
    questionText:
      'In Raft leader election, what minimum fraction of cluster votes must a candidate receive to become leader? (Type "majority")',
    questionType: 'text_input',
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
    options: [],
    officialAnswer: ['majority'],
    officialExplanation:
      'A Raft candidate must receive votes from a strict majority ((N/2) + 1) of nodes in the cluster.'
  },
  {
    questionId: 'q_std_10',
    questionText:
      'When designing retry logic for transient RPC timeouts in distributed microservices, which strategy prevents synchronized retry storms across clients?',
    questionType: 'single_choice',
    subject: 'Distributed Systems',
    topic: 'Fault Tolerance & Idempotency',
    options: [
      {
        id: 'opt_retry_a',
        label: 'A',
        text: 'Exponential backoff combined with randomized jitter and bounded retry limits'
      },
      {
        id: 'opt_retry_b',
        label: 'B',
        text: 'Unbounded zero-delay tight-loop retries on every client thread'
      },
      {
        id: 'opt_retry_c',
        label: 'C',
        text: 'Fixed 100ms synchronized cron retries across all worker nodes'
      }
    ]
    // Intentionally omitted from officialAnswer to demonstrate Approved Bank / Instructor Note tier
  },
  {
    questionId: 'q_std_11',
    questionText:
      'Which experimental quantum-resistant lattice parameter set is optimal for custom sub-millisecond IoT mesh handshakes without hardware acceleration?',
    questionType: 'single_choice',
    subject: 'Cybersecurity',
    topic: 'Authentication & Cryptography',
    options: [
      { id: 'opt_q_a', label: 'A', text: 'Parameter Set Alpha-512' },
      { id: 'opt_q_b', label: 'B', text: 'Parameter Set Beta-768' },
      { id: 'opt_q_c', label: 'C', text: 'Parameter Set Gamma-1024' }
    ]
    // Ambiguous/unverified question to demonstrate transparent Uncertain status
  }
];

export const EDGE_CASE_FAULT_QUESTIONS: SyntheticQuizQuestion[] = [
  ...STANDARD_PRACTICE_QUESTIONS.slice(0, 4),
  {
    questionId: 'q_edge_dup_1',
    questionText:
      'According to the CAP theorem, when a distributed data store experiences a network partition (P), which trade-off is unavoidable?',
    questionType: 'single_choice',
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
    options: STANDARD_PRACTICE_QUESTIONS[0].options,
    officialAnswer: ['opt_cap_a'],
    officialExplanation: 'Duplicate question fixture to verify fingerprint deduplication.'
  },
  {
    questionId: 'q_edge_missing_opts',
    questionText:
      'Malformed Question Fixture: Which distributed lock lease duration is selected when option elements fail to render?',
    questionType: 'single_choice',
    subject: 'Distributed Systems',
    topic: 'Fault Tolerance & Idempotency',
    options: [] // Missing options!
  },
  {
    questionId: 'q_edge_disabled_btn',
    questionText:
      'Transient Disabled Control Fixture: Which browser storage API supports structured indexing for large offline question banks?',
    questionType: 'single_choice',
    subject: 'Database Systems',
    topic: 'Transactions & Indexing',
    initiallyDisabled: true,
    options: [
      { id: 'opt_idb_a', label: 'A', text: 'IndexedDB', disabled: true },
      { id: 'opt_idb_b', label: 'B', text: 'Session Cookie Header', disabled: true }
    ],
    officialAnswer: ['opt_idb_a'],
    officialExplanation: 'IndexedDB provides asynchronous object stores and secondary indexes for large client-side datasets.'
  },
  {
    questionId: 'q_edge_unsupported_canvas',
    questionText: 'Draw a topological sort state diagram on the interactive WebGL canvas below:',
    questionType: 'unsupported',
    subject: 'Algorithms & Data Structures',
    topic: 'Complexity & Graph Algorithms',
    options: [],
    unsupportedLayoutReason: 'interactive-webgl-canvas-drawing'
  }
];

export const DEFAULT_ANSWER_KEY_ENTRIES: AnswerKeyEntry[] = [
  {
    questionId: 'q_std_1',
    questionPattern: 'CAP theorem, when a distributed data store experiences a network partition',
    acceptedAnswers: ['opt_cap_a'],
    sourceType: 'official_key',
    explanation:
      'Official Key: Under a network partition (P), a distributed system must choose between linearizable Consistency (C) and 100% Availability (A).',
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
    subtopic: 'Raft, Paxos & Quorum Consistency',
    difficulty: 'medium',
    sourceCitation: 'Official Distributed Systems Practice Key v2.4 (Item #1)'
  },
  {
    questionId: 'q_std_2',
    questionPattern: 'Chrome Extension Manifest V3, which component replaces persistent background pages',
    acceptedAnswers: ['opt_mv3_b'],
    sourceType: 'official_key',
    explanation:
      'Official Key: Manifest V3 uses an event-driven Background Service Worker instead of persistent background pages.',
    subject: 'Cybersecurity',
    topic: 'Web & Browser Security',
    subtopic: 'CSP, XSS, CSRF & Same-Origin Policy',
    difficulty: 'easy',
    sourceCitation: 'Official Browser Security Practice Key v2.4 (Item #2)'
  },
  {
    questionId: 'q_std_3',
    questionPattern: 'database recovery mechanism guarantees Atomicity and Durability by flushing redo/undo',
    acceptedAnswers: ['opt_wal_a'],
    sourceType: 'official_key',
    explanation:
      'Official Key: Write-Ahead Logging (WAL) flushes log records to stable storage before data pages are overwritten.',
    subject: 'Database Systems',
    topic: 'Transactions & Indexing',
    subtopic: 'ACID, Isolation Levels & B-Tree/WAL',
    difficulty: 'medium',
    sourceCitation: 'Official Database Internals Answer Key v2.4 (Item #3)'
  },
  {
    questionId: 'q_std_4',
    questionPattern: 'HTTP methods are defined as idempotent by RFC 9110',
    // Deliberately omit opt_http_delete here in one test profile or include all 3 in full key:
    // Let's include only ['opt_http_get', 'opt_http_put'] in the learner's pre-selected choice or let the official feedback grade it so we also demonstrate a realistic partial multi-select mistake in sample reports!
    acceptedAnswers: ['opt_http_get', 'opt_http_put', 'opt_http_delete'],
    sourceType: 'official_key',
    explanation:
      'Official Key (RFC 9110): GET, PUT, and DELETE are idempotent; POST is not idempotent.',
    subject: 'Networking & Systems',
    topic: 'HTTP & Transport Protocols',
    subtopic: 'TCP/UDP, HTTP/2, HTTP/3 & DNS',
    difficulty: 'hard',
    sourceCitation: 'Official Networking Practice Key v2.4 (Item #4)'
  },
  {
    questionId: 'q_std_5',
    questionPattern: 'defense-in-depth controls directly mitigate Cross-Site Scripting (XSS)',
    acceptedAnswers: ['opt_xss_a', 'opt_xss_b', 'opt_xss_d'],
    sourceType: 'official_key',
    explanation:
      'Official Key: Safe DOM APIs (textContent), strict CSP, and HTML sanitization mitigate XSS.',
    subject: 'Cybersecurity',
    topic: 'Web & Browser Security',
    subtopic: 'CSP, XSS, CSRF & Same-Origin Policy',
    difficulty: 'medium',
    sourceCitation: 'Official Web Security Practice Key v2.4 (Item #5)'
  },
  {
    questionId: 'q_std_6',
    questionPattern: 'Binary search over a sorted array of n elements has a worst-case time complexity',
    acceptedAnswers: ['opt_tf_true'],
    sourceType: 'official_key',
    explanation: 'Official Key: True. Binary search runs in O(log n) worst-case time.',
    subject: 'Algorithms & Data Structures',
    topic: 'Complexity & Graph Algorithms',
    subtopic: 'Asymptotic Analysis, Trees & Shortest Paths',
    difficulty: 'easy',
    sourceCitation: 'Official Algorithms Practice Key v2.4 (Item #6)'
  },
  {
    questionId: 'q_std_7',
    questionPattern: 'In Raft consensus, a follower node can unilaterally commit log entries',
    acceptedAnswers: ['opt_raft_false'],
    sourceType: 'official_key',
    explanation:
      'Official Key: False. Raft requires a majority quorum led by the cluster leader to commit entries.',
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
    subtopic: 'Raft, Paxos & Quorum Consistency',
    difficulty: 'medium',
    sourceCitation: 'Official Distributed Systems Practice Key v2.4 (Item #7)'
  },
  {
    questionId: 'q_std_8',
    questionPattern: 'numeric HTTP status code returned when a client exceeds the permitted request rate limit',
    acceptedAnswers: ['429'],
    sourceType: 'official_key',
    explanation: 'Official Key: HTTP 429 Too Many Requests (RFC 6585).',
    subject: 'Networking & Systems',
    topic: 'HTTP & Transport Protocols',
    subtopic: 'TCP/UDP, HTTP/2, HTTP/3 & DNS',
    difficulty: 'easy',
    sourceCitation: 'Official Networking Practice Key v2.4 (Item #8)'
  },
  {
    questionId: 'q_std_9',
    questionPattern: 'In Raft leader election, what minimum fraction of cluster votes',
    acceptedAnswers: ['majority'],
    sourceType: 'official_key',
    explanation: 'Official Key: A Raft candidate requires a strict majority of cluster votes.',
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
    subtopic: 'Raft, Paxos & Quorum Consistency',
    difficulty: 'medium',
    sourceCitation: 'Official Distributed Systems Practice Key v2.4 (Item #9)'
  },
  {
    questionId: 'q_std_10',
    questionPattern: 'retry logic for transient RPC timeouts in distributed microservices',
    acceptedAnswers: ['opt_retry_a'],
    sourceType: 'instructor_note',
    explanation:
      'Instructor Explanation: Exponential backoff with randomized jitter spreads out client retries and prevents cascading thundering-herd overload. (Note: Sourced from instructor lecture notes; not yet verified by an official grading key.)',
    subject: 'Distributed Systems',
    topic: 'Fault Tolerance & Idempotency',
    subtopic: 'Retries, Backoff & Circuit Breakers',
    difficulty: 'medium',
    sourceCitation: 'CS-402 Instructor Lecture Notes — Fault Tolerance Week 4'
  },
  {
    questionId: 'q_std_11',
    questionPattern: 'experimental quantum-resistant lattice parameter set is optimal',
    acceptedAnswers: ['opt_q_a', 'opt_q_b'],
    sourceType: 'approved_bank',
    explanation:
      'Conflicting entries in study bank: Draft A lists Alpha-512 while Addendum B lists Beta-768. Flagged as uncertain until instructor clarifies.',
    subject: 'Cybersecurity',
    topic: 'Authentication & Cryptography',
    subtopic: 'OAuth2, JWT, TLS & Key Management',
    difficulty: 'hard',
    isAmbiguousOrConflicting: true,
    conflictReason:
      'Conflicting reference key: Study Guide v1 specifies Alpha-512 whereas Errata Sheet v2 specifies Beta-768.',
    sourceCitation: 'Community Study Bank (Conflicting Errata #11)'
  },
  {
    questionId: 'q_edge_disabled_btn',
    questionPattern: 'Transient Disabled Control Fixture: Which browser storage API',
    acceptedAnswers: ['opt_idb_a'],
    sourceType: 'official_key',
    explanation: 'Official Key: IndexedDB supports indexed structured storage for large question banks.',
    subject: 'Database Systems',
    topic: 'Transactions & Indexing',
    subtopic: 'ACID, Isolation Levels & B-Tree/WAL',
    difficulty: 'easy',
    sourceCitation: 'Official Edge-Case Fixture Key (#7)'
  }
];

/**
 * Generates a deterministic large question bank (e.g., 60 questions) for stress testing
 * persistence, pagination, filtering, and export generation (Section 9).
 */
export function generateLargeSyntheticQuestionSet(count = 60): SyntheticQuizQuestion[] {
  const result: SyntheticQuizQuestion[] = [];
  for (let i = 0; i < count; i++) {
    const base = STANDARD_PRACTICE_QUESTIONS[i % STANDARD_PRACTICE_QUESTIONS.length];
    result.push({
      ...base,
      questionId: `q_large_${i + 1}`,
      questionText: `[Large Bank #${i + 1}] ${base.questionText}`
    });
  }
  return result;
}
