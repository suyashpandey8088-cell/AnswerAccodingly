import { AIAnalysisProvider } from '../ai/provider';
import {
  AutomationEvent,
  CapturedQuestion,
  ErrorCategory,
  PracticeSession,
  QuizPilotSettings,
  ScannedQuestionNode,
  StudyReport
} from '../models/types';
import { generateStudyReport } from '../reporting/report-generator';
import { inspectQuestionContainer, scanQuizDocument } from '../scanner/dom-scanner';
import { verifyPracticeAuthorization } from '../security/authorization';
import { sanitizeReferenceUrl, sanitizeUntrustedText } from '../security/sanitizer';
import { AnswerSourceManager, evaluateVerificationStatus } from '../sources/answer-sources';
import { QuizPilotRepository } from '../storage/repository';

export interface AutomationRunOptions {
  doc: Document;
  url: string;
  sessionId?: string; // Supply an existing sessionId to recover an interrupted session
  sessionTitle?: string;
  settings: QuizPilotSettings;
  answerSourceManager: AnswerSourceManager;
  aiProvider: AIAnalysisProvider;
  repository: QuizPilotRepository;
  onProgress?: (session: PracticeSession, latestQuestion?: CapturedQuestion) => void;
  confirmSubmitCallback?: (quizTitle: string) => Promise<boolean>;
}

export interface AutomationRunResult {
  session: PracticeSession;
  questions: CapturedQuestion[];
  report: StudyReport;
}

/**
 * Extensible Authorized Practice-Test Automation Engine (Section 4).
 */
export class PracticeAutomationEngine {
  private currentSession: PracticeSession | null = null;
  private isPaused = false;
  private isEmergencyStopped = false;
  private stopReason = '';

  public getActiveSession(): PracticeSession | null {
    return this.currentSession ? JSON.parse(JSON.stringify(this.currentSession)) : null;
  }

  public pause(): void {
    if (this.currentSession && this.currentSession.status === 'running') {
      this.isPaused = true;
      this.currentSession.status = 'paused';
      this.logEvent('info', 'SESSION_PAUSED', 'Practice automation paused by user.');
    }
  }

  public resume(): void {
    if (this.currentSession && this.currentSession.status === 'paused') {
      this.isPaused = false;
      this.currentSession.status = 'running';
      this.logEvent('info', 'SESSION_RESUMED', 'Practice automation resumed by user.');
    }
  }

  public emergencyStop(reason = 'Emergency stop triggered by user.'): void {
    this.isEmergencyStopped = true;
    this.isPaused = false;
    this.stopReason = reason;
    if (this.currentSession) {
      this.currentSession.status = 'stopped_by_user';
      this.currentSession.stopReason = reason;
      this.logEvent('safety', 'EMERGENCY_STOP', reason);
    }
  }

  public async runPracticeSession(options: AutomationRunOptions): Promise<AutomationRunResult> {
    const {
      doc,
      url,
      settings,
      answerSourceManager,
      aiProvider,
      repository,
      onProgress,
      confirmSubmitCallback
    } = options;

    this.isPaused = false;
    this.isEmergencyStopped = false;
    this.stopReason = '';

    const startTimeMs = Date.now();
    const { referenceUrl, originDomain } = sanitizeReferenceUrl(url);

    // 1. Verify practice authorization & check for CAPTCHA / proctoring / auth walls
    const auth = verifyPracticeAuthorization(doc, url, settings.authorizedDomains);
    const initialScan = scanQuizDocument(doc, url, settings.authorizedDomains);

    // Recover existing session or create new session
    let session: PracticeSession;
    const existingSession = options.sessionId
      ? await repository.getSession(options.sessionId)
      : null;

    if (existingSession) {
      session = {
        ...existingSession,
        status: 'running',
        updatedAt: new Date().toISOString()
      };
      this.currentSession = session;
      this.logEvent(
        'info',
        'SESSION_RECOVERED',
        `Recovered interrupted session ${session.sessionId} (${session.processedQuestionIds.length} questions already persisted).`
      );
    } else {
      const sessionId =
        options.sessionId || `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      session = {
        sessionId,
        title: options.sessionTitle || initialScan.quizTitle || 'Authorized Practice Session',
        profileName: settings.profileName,
        targetUrl: referenceUrl,
        status: 'running',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        elapsedMs: 0,
        totalDetectedQuestions: initialScan.detectedQuestionCount,
        processedQuestionIds: [],
        recoverableErrorCount: 0,
        uncertainAnswerCount: 0,
        unsupportedQuestionCount: 0,
        events: []
      };
      this.currentSession = session;
      this.logEvent(
        'info',
        'SESSION_STARTED',
        `Started practice session "${session.title}" on ${originDomain}.`
      );
    }

    // Immediate halt if safety restriction (CAPTCHA, proctoring, auth challenge) is present
    if (auth.hasSafetyRestriction) {
      session.status = 'stopped_safety_restriction';
      session.stopReason =
        auth.safetyRestrictionReason || 'Safety restriction detected on page.';
      this.logEvent('safety', 'SAFETY_RESTRICTION_HALT', session.stopReason);
      await repository.saveSession(session);
      const existingQuestions = await repository.getQuestionsBySession(session.sessionId);
      const report = generateStudyReport({
        session,
        questions: existingQuestions,
        aiProvider,
        learnerDailyStudyMinutes: settings.learnerDailyStudyMinutes,
        learnerTargetExamDate: settings.learnerTargetExamDate
      });
      await repository.saveReport(report);
      return { session, questions: existingQuestions, report };
    }

    // Immediate refusal if page is not an authorized practice environment
    if (!auth.isAuthorizedPractice) {
      session.status = 'stopped_safety_restriction';
      session.stopReason = auth.authorizationReason;
      this.logEvent('safety', 'UNAUTHORIZED_ENVIRONMENT', auth.authorizationReason);
      await repository.saveSession(session);
      const existingQuestions = await repository.getQuestionsBySession(session.sessionId);
      const report = generateStudyReport({
        session,
        questions: existingQuestions,
        aiProvider,
        learnerDailyStudyMinutes: settings.learnerDailyStudyMinutes,
        learnerTargetExamDate: settings.learnerTargetExamDate
      });
      await repository.saveReport(report);
      return { session, questions: existingQuestions, report };
    }

    // Load any previously captured questions for this session to avoid duplicating work
    const existingCaptured = await repository.getQuestionsBySession(session.sessionId);
    const processedFingerprints = new Set<string>(existingCaptured.map((q) => q.fingerprint));
    const processedIds = new Set<string>(existingCaptured.map((q) => q.questionId));

    // Discover question containers (including dynamic pagination / lazy-loaded containers)
    let passCount = 0;
    const maxNavigationPasses = 20;

    while (passCount < maxNavigationPasses) {
      passCount += 1;

      if (this.checkTermination(startTimeMs, settings.maxDurationMs, session)) {
        break;
      }

      // Re-verify authorization on every pass in case a dynamic CAPTCHA or login modal appeared
      const liveAuth = verifyPracticeAuthorization(doc, url, settings.authorizedDomains);
      if (liveAuth.hasSafetyRestriction) {
        session.status = 'stopped_safety_restriction';
        session.stopReason = liveAuth.safetyRestrictionReason;
        this.logEvent(
          'safety',
          'DYNAMIC_SAFETY_HALT',
          liveAuth.safetyRestrictionReason || 'Dynamic safety challenge detected.'
        );
        break;
      }

      // Wait for any simulated network/loading spinner with bounded retries
      const loadingResolved = await this.waitForLoadingState(doc, settings.maxRetries, session);
      if (!loadingResolved) {
        session.recoverableErrorCount += 1;
        this.logEvent(
          'warn',
          'LOADING_TIMEOUT',
          'Dynamic content remained in loading state after bounded retries.'
        );
      }

      const containers = Array.from(
        doc.querySelectorAll<HTMLElement>(
          '[data-quiz-question], .quiz-question-card, article[data-question-id], fieldset[data-question-id]'
        )
      ).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');

      session.totalDetectedQuestions = Math.max(
        session.totalDetectedQuestions,
        processedFingerprints.size + containers.length
      );

      let processedAnyInPass = false;

      for (let i = 0; i < containers.length; i++) {
        if (this.checkTermination(startTimeMs, settings.maxDurationMs, session)) {
          break;
        }
        await this.waitWhilePaused(startTimeMs, settings.maxDurationMs, session);
        if (this.isEmergencyStopped || session.status !== 'running') {
          break;
        }

        const container = containers[i];
        const scanned = inspectQuestionContainer(container, i + 1);

        // Skip duplicate or already recovered questions (Section 4 & Section 9)
        if (
          processedFingerprints.has(scanned.fingerprint) ||
          processedIds.has(scanned.questionId)
        ) {
          this.logEvent(
            'info',
            'DUPLICATE_SKIPPED',
            `Skipped already-processed or duplicate question ${scanned.questionId} (${scanned.fingerprint}).`,
            scanned.questionId
          );
          continue;
        }

        processedAnyInPass = true;
        const qStartMs = Date.now();

        const captured = await this.processSingleQuestion({
          container,
          scanned,
          session,
          settings,
          answerSourceManager,
          aiProvider,
          referenceUrl,
          originDomain,
          authorizationMode:
            auth.authorizationMode === 'unauthorized'
              ? 'synthetic_sandbox'
              : auth.authorizationMode
        });

        captured.timeSpentMs = Math.max(5, Date.now() - qStartMs);

        processedFingerprints.add(captured.fingerprint);
        processedIds.add(captured.questionId);
        if (!session.processedQuestionIds.includes(captured.questionId)) {
          session.processedQuestionIds.push(captured.questionId);
        }

        if (
          captured.verificationStatus === 'uncertain' ||
          captured.verificationStatus === 'ai_suggested'
        ) {
          session.uncertainAnswerCount += 1;
        }
        if (captured.questionType === 'unsupported') {
          session.unsupportedQuestionCount += 1;
        }

        session.elapsedMs = Date.now() - startTimeMs;
        session.updatedAt = new Date().toISOString();

        await repository.saveCapturedQuestion(captured);
        await repository.saveSession(session);
        onProgress?.(session, captured);

        if (settings.stepDelayMs > 0) {
          await sleep(Math.min(settings.stepDelayMs, 500));
        }
      }

      if (this.isEmergencyStopped || session.status !== 'running') {
        break;
      }

      // Check if there is a "Load More" or "Next Question" button for multi-page / dynamic quizzes
      const nextBtn = doc.querySelector<HTMLButtonElement | HTMLInputElement>(
        '[data-quiz-nav="next"]:not([disabled]):not([hidden])'
      );
      if (nextBtn && nextBtn.getAttribute('data-nav-exhausted') !== 'true') {
        const beforeSignature = containers.map((c) => c.id || c.textContent?.slice(0, 40)).join('|');
        nextBtn.click();
        await sleep(Math.max(15, settings.stepDelayMs));

        const afterContainers = Array.from(
          doc.querySelectorAll<HTMLElement>(
            '[data-quiz-question], .quiz-question-card, article[data-question-id], fieldset[data-question-id]'
          )
        ).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
        const afterSignature = afterContainers
          .map((c) => c.id || c.textContent?.slice(0, 40))
          .join('|');

        if (afterSignature === beforeSignature && !processedAnyInPass) {
          // Incorrect / broken navigation button detected!
          session.recoverableErrorCount += 1;
          nextBtn.setAttribute('data-nav-exhausted', 'true');
          this.logEvent(
            'warn',
            'BROKEN_NAVIGATION_CONTROL',
            'Next button triggered no page transition or new question content; halting navigation loop safely.'
          );
          break;
        }
      } else {
        break;
      }
    }

    // Handle optional practice submission if session completed normally
    if (session.status === 'running' && !this.isEmergencyStopped) {
      const submitBtn = doc.querySelector<HTMLButtonElement | HTMLInputElement>(
        '[data-quiz-nav="submit"]:not([disabled]):not([hidden])'
      );

      if (submitBtn && settings.autoSubmitAuthorizedPractice) {
        let canSubmit = true;
        if (
          settings.requireConfirmationForSubmit &&
          auth.authorizationMode !== 'synthetic_sandbox' &&
          confirmSubmitCallback
        ) {
          canSubmit = await confirmSubmitCallback(initialScan.quizTitle);
        }

        if (canSubmit) {
          submitBtn.click();
          this.logEvent(
            'info',
            'PRACTICE_SUBMITTED',
            'Submitted authorized practice quiz to reveal official feedback.'
          );
          // Re-scan containers for any newly revealed official feedback after submission
          await this.refreshOfficialFeedbackAfterSubmit(doc, session, settings, repository);
        }
      }

      session.status = 'completed';
      session.completedAt = new Date().toISOString();
      this.logEvent(
        'info',
        'SESSION_COMPLETED',
        `Completed practice session with ${session.processedQuestionIds.length} processed question(s).`
      );
    }

    session.elapsedMs = Date.now() - startTimeMs;
    session.updatedAt = new Date().toISOString();
    session.totalDetectedQuestions = Math.max(
      session.totalDetectedQuestions,
      session.processedQuestionIds.length
    );
    await repository.saveSession(session);

    const allQuestions = await repository.getQuestionsBySession(session.sessionId);
    const report = generateStudyReport({
      session,
      questions: allQuestions,
      aiProvider,
      learnerDailyStudyMinutes: settings.learnerDailyStudyMinutes,
      learnerTargetExamDate: settings.learnerTargetExamDate
    });
    await repository.saveReport(report);
    onProgress?.(session);

    return {
      session,
      questions: allQuestions,
      report
    };
  }

  private async processSingleQuestion(params: {
    container: HTMLElement;
    scanned: ScannedQuestionNode;
    session: PracticeSession;
    settings: QuizPilotSettings;
    answerSourceManager: AnswerSourceManager;
    aiProvider: AIAnalysisProvider;
    referenceUrl: string;
    originDomain: string;
    authorizationMode: 'synthetic_sandbox' | 'explicit_practice_attribute' | 'user_allowlisted_practice';
  }): Promise<CapturedQuestion> {
    const {
      container,
      scanned,
      session,
      settings,
      answerSourceManager,
      aiProvider,
      referenceUrl,
      originDomain,
      authorizationMode
    } = params;

    const classification = await aiProvider.classifyQuestion(
      scanned.questionText,
      scanned.options,
      scanned.subjectHint,
      scanned.topicHint
    );
    const diffEstimate = aiProvider.estimateDifficulty(
      scanned.questionText,
      scanned.questionType,
      scanned.options
    );

    // Handle unsupported layouts (e.g. missing options, canvas-only)
    if (scanned.questionType === 'unsupported') {
      this.logEvent(
        'warn',
        'UNSUPPORTED_QUESTION_LAYOUT',
        scanned.isUnsupportedReason || `Unsupported layout on ${scanned.questionId}.`,
        scanned.questionId
      );
      return {
        sessionId: session.sessionId,
        questionId: scanned.questionId,
        fingerprint: scanned.fingerprint,
        questionText: scanned.questionText,
        questionType: 'unsupported',
        options: scanned.options,
        selectedResponse: [],
        officialCorrectAnswer: null,
        aiProposedAnswer: null,
        explanation:
          scanned.isUnsupportedReason ||
          'Question layout is unsupported by the automation engine.',
        verificationStatus: 'unsupported',
        answerSource: 'none',
        confidenceScore: 0,
        subject: classification.subject,
        topic: classification.topic,
        subtopic: classification.subtopic,
        difficulty: diffEstimate.difficulty,
        difficultyScore: diffEstimate.difficultyScore,
        timeSpentMs: 10,
        errorCategory: 'ui_interaction_error',
        sourceMetadata: {
          referenceUrl,
          originDomain,
          quizTitle: session.title,
          authorizationMode,
          sourceProvenance: 'DOM Scanner (Unsupported Layout)'
        },
        timestamp: new Date().toISOString()
      };
    }

    // Resolve candidate answer across the 4 source tiers
    const resolution = await answerSourceManager.resolveQuestion(scanned);

    // Attempt DOM interaction with bounded retries (handles transient disabled buttons / network faults)
    let selectedResponse: string[] = [...scanned.currentSelection];
    let interactionSucceeded = false;

    if (resolution.proposedAnswers.length > 0 && !resolution.isUncertain) {
      for (let attempt = 1; attempt <= settings.maxRetries + 1; attempt++) {
        const applied = this.applyAnswerToDom(container, scanned, resolution.proposedAnswers);
        if (applied.success) {
          selectedResponse = applied.selected;
          interactionSucceeded = true;
          break;
        }
        session.recoverableErrorCount += 1;
        this.logEvent(
          'warn',
          'INTERACTION_RETRY',
          `Attempt ${attempt}/${settings.maxRetries + 1} failed on ${scanned.questionId}: ${applied.error}`,
          scanned.questionId,
          attempt
        );
        // Try triggering any retry/enable recovery hook on the container
        const retryBtn = container.querySelector<HTMLElement>('[data-retry-question], [data-unlock-controls]');
        retryBtn?.click();
        await sleep(15);
      }
    } else if (resolution.isUncertain) {
      this.logEvent(
        'info',
        'UNCERTAIN_ANSWER_FLAGGED',
        `Question ${scanned.questionId} marked as uncertain (${resolution.uncertaintyReason || 'insufficient evidence'}).`,
        scanned.questionId
      );
    }

    // Check if the container has an individual "Check Answer" button in practice mode
    const checkBtn = container.querySelector<HTMLElement>('[data-check-answer]:not([disabled])');
    if (checkBtn && selectedResponse.length > 0) {
      checkBtn.click();
    }

    // Re-inspect container to see if official post-answer feedback is now visible
    const postInspect = inspectQuestionContainer(container, scanned.questionNumber);
    const officialCorrectAnswer =
      postInspect.officialFeedbackAnswer || resolution.officialCorrectAnswers || null;
    const finalAnswerSource = postInspect.officialFeedbackAnswer
      ? 'official_feedback'
      : resolution.answerSource;

    const verificationStatus = evaluateVerificationStatus({
      questionType: scanned.questionType,
      selectedResponse,
      officialCorrectAnswer,
      aiProposedAnswer: resolution.aiProposedAnswers,
      isUncertain: resolution.isUncertain,
      confidenceScore: resolution.confidenceScore,
      minConfidenceThreshold: settings.minConfidenceThreshold
    });

    let errorCategory: ErrorCategory = 'none';
    if (verificationStatus === 'verified_incorrect') {
      errorCategory =
        scanned.questionType === 'multiple_choice' ? 'partial_multi_select' : 'conceptual_gap';
    } else if (verificationStatus === 'uncertain') {
      errorCategory = 'ambiguous_source';
    } else if (
      !interactionSucceeded &&
      resolution.proposedAnswers.length > 0 &&
      !resolution.isUncertain
    ) {
      errorCategory = 'ui_interaction_error';
    } else if (verificationStatus === 'unanswered') {
      errorCategory = 'unanswered_timeout';
    }

    const explanation =
      postInspect.officialFeedbackExplanation ||
      resolution.explanation ||
      (await aiProvider.generateExplanation(
        scanned.questionText,
        selectedResponse,
        officialCorrectAnswer,
        classification.topic
      ));

    return {
      sessionId: session.sessionId,
      questionId: scanned.questionId,
      fingerprint: scanned.fingerprint,
      questionText: scanned.questionText,
      questionType: scanned.questionType,
      options: scanned.options,
      selectedResponse,
      officialCorrectAnswer,
      aiProposedAnswer: resolution.aiProposedAnswers,
      explanation,
      verificationStatus,
      answerSource: finalAnswerSource,
      confidenceScore: resolution.confidenceScore,
      subject: resolution.subject || classification.subject,
      topic: resolution.topic || classification.topic,
      subtopic: resolution.subtopic || classification.subtopic,
      difficulty: resolution.difficulty || diffEstimate.difficulty,
      difficultyScore: diffEstimate.difficultyScore,
      timeSpentMs: 15,
      errorCategory,
      sourceMetadata: {
        referenceUrl,
        originDomain,
        quizTitle: session.title,
        authorizationMode,
        sourceProvenance: postInspect.officialFeedbackAnswer
          ? 'Official In-Quiz Practice Feedback'
          : resolution.sourceProvenance
      },
      timestamp: new Date().toISOString()
    };
  }

  private applyAnswerToDom(
    container: HTMLElement,
    scanned: ScannedQuestionNode,
    targetAnswers: string[]
  ): { success: boolean; selected: string[]; error?: string } {
    const WinEvent = container.ownerDocument?.defaultView?.Event || Event;

    if (scanned.questionType === 'text_input') {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[type="text"], input[type="search"], input[type="number"], textarea'
      );
      if (!input) {
        return { success: false, selected: [], error: 'Text input element missing.' };
      }
      if (input.disabled || input.readOnly) {
        return { success: false, selected: [], error: 'Text input control is disabled or read-only.' };
      }
      const val = sanitizeUntrustedText(targetAnswers[0] || '', 300);
      input.value = val;
      input.dispatchEvent(new WinEvent('input', { bubbles: true }));
      input.dispatchEvent(new WinEvent('change', { bubbles: true }));
      return { success: true, selected: [val] };
    }

    if (scanned.questionType === 'single_choice' || scanned.questionType === 'true_false') {
      const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      const desired = targetAnswers[0]?.trim().toLowerCase();
      const targetRadio = radios.find(
        (r, idx) =>
          r.value.trim().toLowerCase() === desired ||
          scanned.options[idx]?.id.trim().toLowerCase() === desired ||
          scanned.options[idx]?.text.trim().toLowerCase() === desired
      );

      if (!targetRadio) {
        return {
          success: false,
          selected: [],
          error: `Option "${targetAnswers[0]}" not found among radio inputs.`
        };
      }
      if (targetRadio.disabled) {
        return {
          success: false,
          selected: [],
          error: `Target radio option "${targetAnswers[0]}" is disabled.`
        };
      }

      targetRadio.checked = true;
      targetRadio.dispatchEvent(new WinEvent('change', { bubbles: true }));
      targetRadio.click();
      return { success: true, selected: [targetRadio.value || targetAnswers[0]] };
    }

    if (scanned.questionType === 'multiple_choice') {
      const checkboxes = Array.from(
        container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      );
      const desiredSet = new Set(targetAnswers.map((a) => a.trim().toLowerCase()));
      const selectedIds: string[] = [];

      for (let idx = 0; idx < checkboxes.length; idx++) {
        const cb = checkboxes[idx];
        const opt = scanned.options[idx];
        const shouldCheck =
          desiredSet.has(cb.value.trim().toLowerCase()) ||
          (opt && desiredSet.has(opt.id.trim().toLowerCase())) ||
          (opt && desiredSet.has(opt.text.trim().toLowerCase()));

        if (shouldCheck && cb.disabled) {
          return {
            success: false,
            selected: [],
            error: `Target checkbox option "${opt?.id || cb.value}" is disabled.`
          };
        }

        if (cb.checked !== shouldCheck) {
          cb.checked = shouldCheck;
          cb.dispatchEvent(new WinEvent('change', { bubbles: true }));
        }
        if (shouldCheck) {
          selectedIds.push(cb.value || opt?.id || `opt_${idx + 1}`);
        }
      }

      if (selectedIds.length === 0) {
        return {
          success: false,
          selected: [],
          error: 'None of the proposed multiple-choice options matched rendered checkboxes.'
        };
      }

      return { success: true, selected: selectedIds };
    }

    return { success: false, selected: [], error: 'Unsupported question type.' };
  }

  private async refreshOfficialFeedbackAfterSubmit(
    doc: Document,
    session: PracticeSession,
    settings: QuizPilotSettings,
    repository: QuizPilotRepository
  ): Promise<void> {
    const existingQuestions = await repository.getQuestionsBySession(session.sessionId);
    const byId = new Map(existingQuestions.map((q) => [q.questionId, q]));

    const containers = Array.from(
      doc.querySelectorAll<HTMLElement>(
        '[data-quiz-question], .quiz-question-card, article[data-question-id], fieldset[data-question-id]'
      )
    );

    for (let i = 0; i < containers.length; i++) {
      const scanned = inspectQuestionContainer(containers[i], i + 1);
      const existing = byId.get(scanned.questionId);
      if (existing && scanned.officialFeedbackAnswer && scanned.officialFeedbackAnswer.length > 0) {
        existing.officialCorrectAnswer = scanned.officialFeedbackAnswer;
        existing.answerSource = 'official_feedback';
        if (scanned.officialFeedbackExplanation) {
          existing.explanation = scanned.officialFeedbackExplanation;
        }
        existing.verificationStatus = evaluateVerificationStatus({
          questionType: existing.questionType,
          selectedResponse: existing.selectedResponse,
          officialCorrectAnswer: existing.officialCorrectAnswer,
          aiProposedAnswer: existing.aiProposedAnswer,
          isUncertain: false,
          confidenceScore: existing.confidenceScore,
          minConfidenceThreshold: settings.minConfidenceThreshold
        });
        existing.errorCategory =
          existing.verificationStatus === 'verified_incorrect' ? 'conceptual_gap' : 'none';
        await repository.saveCapturedQuestion(existing);
      }
    }
  }

  private async waitForLoadingState(
    doc: Document,
    maxRetries: number,
    session: PracticeSession
  ): Promise<boolean> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const loadingEl = doc.querySelector(
        '[data-quiz-loading="true"]:not([hidden]), [data-network-error="transient"]:not([hidden])'
      );
      if (!loadingEl) return true;

      const retryTrigger = doc.querySelector<HTMLElement>('[data-retry-network]');
      retryTrigger?.click();
      this.logEvent(
        'info',
        'WAITING_DYNAMIC_LOAD',
        `Waiting for dynamic quiz state to settle (retry ${attempt + 1}/${maxRetries + 1}).`,
        undefined,
        attempt + 1
      );
      await sleep(20);
    }
    return !doc.querySelector('[data-quiz-loading="true"]:not([hidden])');
  }

  private checkTermination(
    startTimeMs: number,
    maxDurationMs: number,
    session: PracticeSession
  ): boolean {
    if (this.isEmergencyStopped) {
      session.status = 'stopped_by_user';
      session.stopReason = this.stopReason || 'Stopped by user.';
      return true;
    }
    if (Date.now() - startTimeMs > maxDurationMs) {
      session.status = 'interrupted_recoverable';
      session.stopReason = `Maximum execution duration (${maxDurationMs} ms) reached; session saved for recovery.`;
      this.logEvent('warn', 'MAX_DURATION_REACHED', session.stopReason);
      return true;
    }
    return false;
  }

  private async waitWhilePaused(
    startTimeMs: number,
    maxDurationMs: number,
    session: PracticeSession
  ): Promise<void> {
    while (this.isPaused && !this.isEmergencyStopped) {
      if (Date.now() - startTimeMs > maxDurationMs) {
        this.isPaused = false;
        session.status = 'interrupted_recoverable';
        session.stopReason = 'Session timed out while paused.';
        break;
      }
      await sleep(25);
    }
  }

  private logEvent(
    level: AutomationEvent['level'],
    code: string,
    message: string,
    questionId?: string,
    retryAttempt?: number
  ): void {
    if (!this.currentSession) return;
    this.currentSession.events.push({
      id: `evt_${this.currentSession.events.length + 1}_${Date.now().toString(36)}`,
      sessionId: this.currentSession.sessionId,
      timestamp: new Date().toISOString(),
      level,
      code,
      message,
      questionId,
      retryAttempt
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
