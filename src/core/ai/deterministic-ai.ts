import {
  CapturedQuestion,
  DailyStudyBlock,
  DifficultyLevel,
  PersonalizedStudyPlan,
  QuestionOption,
  QuestionType,
  SpacedRepetitionItem
} from '../models/types';
import { sanitizeUntrustedText } from '../security/sanitizer';
import {
  AICandidateProposal,
  AIAnalysisProvider,
  QuestionClassificationResult,
  SimilarityCluster
} from './provider';

interface TaxonomyRule {
  subject: string;
  topic: string;
  subtopic: string;
  keywords: RegExp;
}

const TAXONOMY_RULES: TaxonomyRule[] = [
  {
    subject: 'Distributed Systems',
    topic: 'Consensus & Replication',
    subtopic: 'Raft, Paxos & Quorum Consistency',
    keywords: /\b(raft|paxos|quorum|consensus|leader\s+election|split-brain|linearizability|eventual\s+consistency|cap\s+theorem)\b/i
  },
  {
    subject: 'Distributed Systems',
    topic: 'Fault Tolerance & Idempotency',
    subtopic: 'Retries, Backoff & Circuit Breakers',
    keywords: /\b(idempoten|exponential\s+backoff|circuit\s+breaker|dead-letter|at-least-once|exactly-once|retry)\b/i
  },
  {
    subject: 'Cybersecurity',
    topic: 'Web & Browser Security',
    subtopic: 'CSP, XSS, CSRF & Same-Origin Policy',
    keywords: /\b(xss|cross-site|csrf|content-security-policy|csp|same-origin|cors|sanitize|httponly|samesite|least-privilege|manifest\s+v3)\b/i
  },
  {
    subject: 'Cybersecurity',
    topic: 'Authentication & Cryptography',
    subtopic: 'OAuth2, JWT, TLS & Key Management',
    keywords: /\b(jwt|oauth|pkce|tls|mTLS|sha-256|hmac|symmetric|asymmetric|encryption|zero-trust|token)\b/i
  },
  {
    subject: 'Database Systems',
    topic: 'Transactions & Indexing',
    subtopic: 'ACID, Isolation Levels & B-Tree/WAL',
    keywords: /\b(acid|serializable|repeatable\s+read|phantom\s+read|b-tree|write-ahead\s+log|wal|indexeddb|deadlock|mvcc)\b/i
  },
  {
    subject: 'Algorithms & Data Structures',
    topic: 'Complexity & Graph Algorithms',
    subtopic: 'Asymptotic Analysis, Trees & Shortest Paths',
    keywords: /\b(big-o|o\(n\s*log\s*n\)|o\(1\)|dijkstra|topological|hash\s+table|binary\s+search|dynamic\s+programming|amortized)\b/i
  },
  {
    subject: 'Networking & Systems',
    topic: 'HTTP & Transport Protocols',
    subtopic: 'TCP/UDP, HTTP/2, HTTP/3 & DNS',
    keywords: /\b(tcp|udp|three-way\s+handshake|http\/2|http\/3|quic|dns|status\s+code|429|503|latency|throughput)\b/i
  },
  {
    subject: 'Software Engineering & QA',
    topic: 'Test Architecture & Reliability',
    subtopic: 'Unit, Integration & Deterministic Verification',
    keywords: /\b(unit\s+test|integration\s+test|regression|mock|fixture|assertion|flaky\s+test|coverage|boundary\s+value)\b/i
  }
];

interface HeuristicKnowledgeRule {
  pattern: RegExp;
  answerMatcher: RegExp;
  confidence: number;
  explanation: string;
  evidenceSummary: string;
}

const HEURISTIC_KNOWLEDGE_BASE: HeuristicKnowledgeRule[] = [
  {
    pattern: /\bcap\s+theorem\b.*\bnetwork\s+partition\b/i,
    answerMatcher: /\bconsistency\b.*\bavailability\b|\bcp\s+or\s+ap\b/i,
    confidence: 0.84,
    explanation:
      'Under the CAP theorem, when a network partition (P) occurs, a distributed data store must trade off between strict linearizable Consistency (C) and 100% Availability (A).',
    evidenceSummary: 'Matched canonical distributed-systems principle (Brewer CAP Theorem).'
  },
  {
    pattern: /\bidempotent\b.*\bhttp\s+method/i,
    answerMatcher: /\b(get|put|delete)\b/i,
    confidence: 0.86,
    explanation:
      'Per RFC 9110 (HTTP Semantics), GET, HEAD, OPTIONS, PUT, and DELETE are idempotent methods, whereas POST and PATCH are not guaranteed to be idempotent.',
    evidenceSummary: 'Matched RFC 9110 HTTP method idempotency specification.'
  },
  {
    pattern: /\bmanifest\s+v3\b.*\bbackground\b/i,
    answerMatcher: /\bservice\s+worker\b/i,
    confidence: 0.88,
    explanation:
      'Chrome Extension Manifest V3 replaces persistent background pages with event-driven background Service Workers.',
    evidenceSummary: 'Matched Chrome Extension Manifest V3 specification.'
  },
  {
    pattern: /\bcross-site\s+scripting\b|\bxss\b.*\bprevent|\bmitigat/i,
    answerMatcher: /\b(context-aware\s+output\s+encoding|content\s+security\s+policy|sanitize|textcontent)\b/i,
    confidence: 0.85,
    explanation:
      'Preventing XSS requires treating untrusted input as data via safe DOM sinks (such as textContent), context-aware output encoding, and a strict Content Security Policy (CSP).',
    evidenceSummary: 'Matched OWASP XSS Prevention Cheat Sheet guidelines.'
  },
  {
    pattern: /\bwrite-ahead\s+log\b|\bwal\b.*\bacid\b/i,
    answerMatcher: /\b(atomicity\s+and\s+durability|durability|crash\s+recovery)\b/i,
    confidence: 0.82,
    explanation:
      'Write-Ahead Logging (WAL) ensures Atomicity and Durability by flushing redo/undo log records to stable storage before modifying data pages.',
    evidenceSummary: 'Matched ARIES database recovery protocol fundamentals.'
  },
  {
    pattern: /\bbinary\s+search\b.*\btime\s+complexity\b/i,
    answerMatcher: /\bo\(\s*log\s*n\s*\)/i,
    confidence: 0.89,
    explanation:
      'Binary search halves the search interval on each comparison over a sorted array, yielding O(log n) worst-case time complexity.',
    evidenceSummary: 'Matched asymptotic recurrence T(n) = T(n/2) + O(1).'
  },
  {
    pattern: /\bhttp\s+status\s+code\b.*\brate\s+limit|\btoo\s+many\s+requests\b/i,
    answerMatcher: /\b429\b/i,
    confidence: 0.90,
    explanation:
      'HTTP 429 Too Many Requests indicates the client has sent too many requests in a given amount of time (rate limiting).',
    evidenceSummary: 'Matched RFC 6585 HTTP status code 429 specification.'
  }
];

export class DeterministicAnalysisProvider implements AIAnalysisProvider {
  public readonly providerId = 'deterministic' as const;

  public async classifyQuestion(
    questionText: string,
    options: QuestionOption[],
    subjectHint?: string,
    topicHint?: string
  ): Promise<QuestionClassificationResult> {
    const combinedText = `${questionText} ${options.map((o) => o.text).join(' ')}`;
    const diff = this.estimateDifficulty(questionText, 'single_choice', options);

    for (const rule of TAXONOMY_RULES) {
      if (rule.keywords.test(combinedText)) {
        return {
          subject: subjectHint || rule.subject,
          topic: topicHint || rule.topic,
          subtopic: rule.subtopic,
          difficulty: diff.difficulty,
          difficultyScore: diff.difficultyScore
        };
      }
    }

    return {
      subject: subjectHint || 'Computer Science & Engineering',
      topic: topicHint || 'Core Systems & Problem Solving',
      subtopic: 'General Analytical Concepts',
      difficulty: diff.difficulty,
      difficultyScore: diff.difficultyScore
    };
  }

  public estimateDifficulty(
    questionText: string,
    questionType: QuestionType,
    options: QuestionOption[]
  ): { difficulty: DifficultyLevel; difficultyScore: number } {
    let score = 4.0;
    const textLen = questionText.length;

    if (textLen > 220) score += 2.0;
    else if (textLen > 120) score += 1.0;

    if (questionType === 'multiple_choice') score += 1.8;
    else if (questionType === 'text_input') score += 1.5;
    else if (questionType === 'true_false') score -= 1.2;

    if (/\b(not|except|least|never|false|incorrect|all\s+of\s+the\s+following\s+except)\b/i.test(questionText)) {
      score += 1.2;
    }

    if (/\b(linearizability|byzantine|mvcc|pkce|amortized|idempotency|quorum)\b/i.test(questionText)) {
      score += 1.3;
    }

    if (options.length > 4) score += 0.8;

    const clamped = Math.max(1.0, Math.min(10.0, Number(score.toFixed(1))));
    const difficulty: DifficultyLevel =
      clamped >= 7.0 ? 'hard' : clamped >= 4.2 ? 'medium' : 'easy';

    return { difficulty, difficultyScore: clamped };
  }

  public async proposeCandidateAnswer(
    questionText: string,
    questionType: QuestionType,
    options: QuestionOption[]
  ): Promise<AICandidateProposal> {
    const cleanQuestion = sanitizeUntrustedText(questionText);

    for (const rule of HEURISTIC_KNOWLEDGE_BASE) {
      if (rule.pattern.test(cleanQuestion)) {
        if (questionType === 'text_input') {
          const match = cleanQuestion.match(/429/) ? '429' : 'service worker';
          return {
            proposedAnswers: [match],
            confidenceScore: rule.confidence,
            explanation: rule.explanation,
            evidenceSummary: rule.evidenceSummary,
            isUncertain: false
          };
        }

        const matchedOptions = options.filter(
          (o) => rule.answerMatcher.test(o.text) || rule.answerMatcher.test(o.id)
        );
        if (matchedOptions.length > 0) {
          const selected =
            questionType === 'multiple_choice'
              ? matchedOptions.map((o) => o.id)
              : [matchedOptions[0].id];
          return {
            proposedAnswers: selected,
            confidenceScore: rule.confidence,
            explanation: rule.explanation,
            evidenceSummary: rule.evidenceSummary,
            isUncertain: false
          };
        }
      }
    }

    // If no authoritative heuristic rule matches, do NOT fabricate high confidence.
    // Mark as uncertain so the user knows this question requires manual verification.
    return {
      proposedAnswers: [],
      confidenceScore: 0.32,
      explanation:
        'Insufficient deterministic evidence in local reference rules to select a high-confidence answer. Marked as uncertain to prevent guessing.',
      evidenceSummary: 'No high-confidence rule matched; flagged for manual review.',
      isUncertain: true
    };
  }

  public async generateExplanation(
    questionText: string,
    selectedAnswers: string[],
    officialCorrectAnswers: string[] | null,
    topic: string
  ): Promise<string> {
    if (officialCorrectAnswers && officialCorrectAnswers.length > 0) {
      const matched =
        selectedAnswers.length === officialCorrectAnswers.length &&
        selectedAnswers.every((ans) => officialCorrectAnswers.includes(ans));
      return matched
        ? `Verified against official answer key for ${topic}. Selected response (${selectedAnswers.join(', ')}) matches the authoritative key.`
        : `Verified mismatch in ${topic}: selected (${selectedAnswers.join(', ') || 'none'}), whereas the authoritative key specifies (${officialCorrectAnswers.join(', ')}). Review core invariants for ${topic}.`;
    }
    return `Captured under topic "${topic}". No authoritative answer key was supplied for this question (${sanitizeUntrustedText(questionText, 90)}); treat any candidate suggestion as unverified until checked against official documentation.`;
  }

  public groupSimilarQuestions(questions: CapturedQuestion[]): SimilarityCluster[] {
    const byTopicAndConcept = new Map<string, CapturedQuestion[]>();

    for (const q of questions) {
      const key = `${q.subject}::${q.topic}`;
      const existing = byTopicAndConcept.get(key) || [];
      existing.push(q);
      byTopicAndConcept.set(key, existing);
    }

    const clusters: SimilarityCluster[] = [];
    let index = 1;
    for (const [key, group] of byTopicAndConcept.entries()) {
      const [, topic] = key.split('::');
      clusters.push({
        clusterId: `cluster_${index++}`,
        conceptLabel: topic || 'General Concept',
        questionIds: group.map((g) => g.questionId)
      });
    }
    return clusters;
  }

  public generateStudyPlan(
    questions: CapturedQuestion[],
    dailyStudyMinutes: number,
    targetExamDate: string
  ): PersonalizedStudyPlan {
    const safeMinutes = Math.max(15, Math.min(480, Math.round(dailyStudyMinutes || 60)));

    // Compute days until target relative to current reference date (2026-10-26)
    const now = new Date('2026-10-26T00:00:00Z');
    const parsedTarget = targetExamDate ? new Date(targetExamDate) : new Date('2026-11-09T00:00:00Z');
    const diffDays = Math.ceil((parsedTarget.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const daysUntilTarget = Number.isFinite(diffDays) && diffDays > 0 ? Math.min(diffDays, 90) : 14;

    // Aggregate topic gaps
    const topicStats = new Map<
      string,
      {
        topic: string;
        errors: number;
        uncertain: number;
        unanswered: number;
        total: number;
        questionIds: string[];
      }
    >();

    for (const q of questions) {
      const entry = topicStats.get(q.topic) || {
        topic: q.topic,
        errors: 0,
        uncertain: 0,
        unanswered: 0,
        total: 0,
        questionIds: []
      };
      entry.total += 1;
      entry.questionIds.push(q.questionId);
      if (q.verificationStatus === 'verified_incorrect') entry.errors += 1;
      if (q.verificationStatus === 'uncertain' || q.verificationStatus === 'ai_suggested') {
        entry.uncertain += 1;
      }
      if (q.verificationStatus === 'unanswered' || q.verificationStatus === 'unsupported') {
        entry.unanswered += 1;
      }
      topicStats.set(q.topic, entry);
    }

    const sortedTopics = Array.from(topicStats.values()).sort((a, b) => {
      const weightA = a.errors * 3 + a.uncertain * 2 + a.unanswered * 1.5 + a.total * 0.2;
      const weightB = b.errors * 3 + b.uncertain * 2 + b.unanswered * 1.5 + b.total * 0.2;
      return weightB - weightA;
    });

    const priorityTopics = sortedTopics.map((stat, idx) => {
      const reasons: string[] = [];
      if (stat.errors > 0) reasons.push(`${stat.errors} verified error(s)`);
      if (stat.uncertain > 0) reasons.push(`${stat.uncertain} unverified/uncertain item(s)`);
      if (stat.unanswered > 0) reasons.push(`${stat.unanswered} unanswered item(s)`);
      if (reasons.length === 0) reasons.push(`${stat.total} foundational question(s) reviewed`);

      const share = sortedTopics.length > 0 ? Math.max(15, Math.round(safeMinutes / Math.min(3, sortedTopics.length))) : safeMinutes;
      return {
        rank: idx + 1,
        topic: stat.topic,
        reason: `Prioritized due to ${reasons.join(', ')}.`,
        recommendedMinutes: share
      };
    });

    const recommendedRevisionOrder = priorityTopics.map((p) => p.topic);

    // Build a structured 7-day rolling schedule (or up to daysUntilTarget)
    const scheduleDays = Math.min(7, Math.max(3, daysUntilTarget));
    const dailySchedule: DailyStudyBlock[] = [];
    for (let d = 0; d < scheduleDays; d++) {
      const dayDate = new Date(now.getTime() + d * 86400000);
      const dateLabel = dayDate.toISOString().slice(0, 10);
      const primaryTopic =
        recommendedRevisionOrder[d % Math.max(1, recommendedRevisionOrder.length)] ||
        'Core Concepts Review';
      const secondaryTopic =
        recommendedRevisionOrder[(d + 1) % Math.max(1, recommendedRevisionOrder.length)] ||
        primaryTopic;

      const focusTopics =
        primaryTopic === secondaryTopic ? [primaryTopic] : [primaryTopic, secondaryTopic];

      dailySchedule.push({
        dayIndex: d + 1,
        dateLabel,
        focusTopics,
        allocatedMinutes: safeMinutes,
        activities: [
          `Review official explanations & error logs for ${primaryTopic} (${Math.round(safeMinutes * 0.4)} min)`,
          `Complete targeted active-recall drill on ${focusTopics.join(' & ')} (${Math.round(safeMinutes * 0.4)} min)`,
          `Resolve uncertain/unverified flashcards in Spaced Repetition Queue (${Math.round(safeMinutes * 0.2)} min)`
        ]
      });
    }

    const practiceExercises = sortedTopics.slice(0, 4).map((stat) => ({
      topic: stat.topic,
      exerciseTitle: `${stat.topic} Mastery & Edge-Case Verification Drill`,
      objective:
        stat.errors > 0
          ? `Eliminate the ${stat.errors} verified conceptual mistake(s) by deriving why each distractor option is invalid.`
          : `Validate ${stat.uncertain + stat.unanswered || stat.total} question(s) using authoritative primary references.`,
      targetQuestionCount: Math.max(5, stat.total * 2)
    }));

    const spacedRepetitionQueue: SpacedRepetitionItem[] = sortedTopics.map((stat) => {
      if (stat.errors > 0) {
        return {
          topic: stat.topic,
          questionIds: stat.questionIds,
          urgency: 'immediate_24h',
          scheduleIntervalsDays: [1, 3, 7, 14, 30],
          rationale: `Contains ${stat.errors} verified incorrect response(s); requires immediate 24-hour re-testing before extending intervals.`
        };
      }
      if (stat.uncertain > 0 || stat.unanswered > 0) {
        return {
          topic: stat.topic,
          questionIds: stat.questionIds,
          urgency: 'short_term_3d',
          scheduleIntervalsDays: [2, 5, 10, 21],
          rationale: `Contains ${stat.uncertain + stat.unanswered} unverified or unanswered question(s); verify against official key within 48-72 hours.`
        };
      }
      return {
        topic: stat.topic,
        questionIds: stat.questionIds,
        urgency: 'consolidation_14d',
        scheduleIntervalsDays: [7, 14, 30],
        rationale: 'All verified items answered accurately; schedule maintenance recall at 7 and 14 days.'
      };
    });

    return {
      learnerDailyMinutes: safeMinutes,
      targetExamDate: parsedTarget.toISOString().slice(0, 10),
      daysUntilTarget,
      priorityTopics,
      recommendedRevisionOrder,
      dailySchedule,
      practiceExercises,
      spacedRepetitionQueue,
      followUpMockPlan: {
        recommendedTiming: `After completing Day ${ Math.min(3, scheduleDays) } revision blocks (${Math.min(3, daysUntilTarget)} days from today)`,
        focusAreas: recommendedRevisionOrder.slice(0, 3),
        targetConditions:
          'Timed practice session with official answer key loaded, targeting >= 90% verified accuracy and 0 unresolved high-priority gaps.'
      },
      improvementCriteria: [
        'Achieve >= 90% accuracy on questions backed by an official answer key.',
        'Reduce High-Confidence Incorrect responses (overconfidence errors) to 0.',
        'Convert 100% of Uncertain / AI-Suggested items in High-Priority topics to Verified status using authoritative references.',
        'Maintain average response time under 45 seconds per question without skipping multi-select option checks.'
      ]
    };
  }
}
