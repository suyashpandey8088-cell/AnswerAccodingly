export type AdapterType = "browser" | "desktop";
export type QuestionType = "multiple_choice" | "multiple_select" | "math" | "logical" | "text" | "programming" | "unknown";
export type TestStatus = "pending" | "running" | "passed" | "failed" | "timeout" | "error" | "unknown" | "skipped";
export type RunStatus = TestStatus | "cancelled";

export interface TargetConfig {
  url: string | null;
  application_name: string | null;
  window_title: string | null;
  oracle_profile: string | null;
  demo_scenario: "normal" | "delayed" | "incorrect_feedback" | "missing_element" | "timeout";
  headless: boolean;
  question_type: string | null;
  code_language: string | null;
  regions: Record<string, { x: number; y: number; width: number; height: number }>;
}

export interface TimeoutSettings { operation_ms: number; feedback_ms: number; run_seconds: number }
export interface SolverSettings { provider: "deterministic" | "llm"; model: string | null; timeout_seconds: number; max_retries: number; use_sandbox: boolean }
export interface SafetySettings { allow_submit: boolean; operator_confirmed: boolean; max_questions: number; failure_threshold: number; diagnostic_capture: boolean }

export interface ProjectCreate {
  name: string;
  adapter_type: AdapterType;
  target_config: TargetConfig;
  selector_config: Record<string, string>;
  timeout_settings: TimeoutSettings;
  solver_settings: SolverSettings;
  safety_settings: SafetySettings;
  question_types: QuestionType[];
}

export interface Project extends ProjectCreate {
  id: string;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_status: RunStatus | null;
}
export interface ProjectList { items: Project[]; total: number; limit: number; offset: number }

export interface TimerData {
  status: "present" | "absent" | "failed" | "uncertain";
  raw_text: string | null;
  seconds: number | null;
  method: string | null;
  confidence: number | null;
  error: string | null;
}
export interface ProposedAnswer { kind: "options" | "text" | "code"; options: string[]; text: string | null; code: string | null; language: string | null }
export interface SolverResult {
  status: "solved" | "uncertain" | "error" | "timeout" | "unsupported";
  confidence: number;
  method: string;
  provider: string | null;
  model: string | null;
  duration_ms: number;
  validation_status: string;
  uncertainty_reason: string | null;
  error: string | null;
  retry_count: number;
  sandbox_status: "not_required" | "passed" | "failed" | "unsupported" | "timeout" | "error";
  sandbox_details: Record<string, unknown> | null;
}
export interface AssertionOutcome { name: string; expected: unknown; actual: unknown; status: "passed" | "failed" | "unknown"; explanation: string }
export interface QuestionResult {
  id: number;
  run_id: string;
  sequence: number;
  question_identifier: string | null;
  question_type: QuestionType;
  extraction_result: { text?: string; options?: { label: string; value: string }[]; extraction_confidence?: number } | null;
  timer_data: TimerData | null;
  proposed_answer: ProposedAnswer | null;
  solver_result: SolverResult | null;
  solver_method: string | null;
  verification_result: Record<string, unknown> | null;
  final_status: TestStatus;
  failure_category: string | null;
  stage_timings: Record<string, number | null>;
  error_details: string | null;
  diagnostic_refs: string[];
  assertions: AssertionOutcome[];
  created_at: string;
}
export interface TestRun {
  id: string;
  project_id: string;
  project_name: string | null;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  config_snapshot: { project?: ProjectCreate; operator_confirmed_at?: string };
  summary_metrics: Partial<ReportSummary>;
  error_summary: string | null;
}
export interface RunDetail extends TestRun { question_results: QuestionResult[] }
export interface RunList { items: TestRun[]; total: number; limit: number; offset: number }

export interface StageSummary { count: number; median_ms: number | null; p95_ms: number | null }
export interface ReportSummary {
  total_questions: number;
  executed_questions: number;
  passed_questions: number;
  failed_questions: number;
  timeout_questions: number;
  error_questions: number;
  unknown_questions: number;
  skipped_questions: number;
  passed_assertions: number;
  failed_assertions: number;
  unknown_assertions: number;
  assertions_with_pass_criteria: number;
  verified_correct_answers: number;
  correctness_eligible_answers: number;
  pass_rate: number | null;
  verified_correctness_rate: number | null;
  timeout_rate: number | null;
  median_total_latency_ms: number | null;
  p95_total_latency_ms: number | null;
  run_duration_ms: number | null;
  failure_categories: Record<string, number>;
  stage_latency: Record<string, StageSummary>;
}
export interface RunReport { run: TestRun; summary: ReportSummary; questions: QuestionResult[] }

export interface Overview {
  total_projects: number;
  total_runs: number;
  recent_runs: TestRun[];
  passed_questions: number;
  failed_questions: number;
  timeout_rate: number | null;
  verified_correctness_rate: number | null;
  average_latency_ms: number | null;
  p95_latency_ms: number | null;
  recent_failures: { run_id: string; project_name: string | null; question_id: string | null; sequence: number; status: TestStatus; failure_category: string | null; error: string | null }[];
  performance_trends: { run_id: string; started_at: string; label: string; pass_rate: number | null; p95_latency_ms: number | null }[];
}
export interface EnvironmentCheck { name: string; passed: boolean; detail: string }
export interface EnvironmentValidation { valid: boolean; checks: EnvironmentCheck[] }
export interface SystemStatus {
  python_version: string;
  browser: { available: boolean; detail: string };
  desktop: { available: boolean; detail: string; supported_window_selection: string; platform: string; windows_window_targeting: boolean };
  sandbox: { available: boolean; detail: string };
  llm: { configured: boolean; provider: string; model: string; detail: string };
  persistence: string;
  target_policy: { allowlisted_hosts: string[]; loopback_only: boolean };
}
export interface BackendConnection { baseUrl: string; token: string; state: "starting" | "ready" | "error" | "stopped" }
export interface BackendStatus { state: "starting" | "ready" | "error" | "stopped"; detail: string; port: number | null }
export interface AppInfo { name: string; version: string; platform: string; packaged: boolean }
export interface QuizPilotBridge {
  getBackendConnection(): Promise<BackendConnection>;
  getBackendStatus(): Promise<BackendStatus>;
  restartBackend(): Promise<BackendConnection>;
  getAppInfo(): Promise<AppInfo>;
}
export interface LiveRunEvent {
  event: string;
  data: {
    stage?: string;
    sequence?: number;
    question_id?: string | null;
    question_text?: string | null;
    timer?: TimerData;
    run?: TestRun;
  };
}
