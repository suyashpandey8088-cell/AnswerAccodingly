import type {
  AppInfo,
  BackendConnection,
  BackendStatus,
  EnvironmentValidation,
  LiveRunEvent,
  Overview,
  Project,
  ProjectCreate,
  ProjectList,
  RunDetail,
  RunList,
  RunReport,
  SystemStatus,
  TestRun,
  VisibleWindowsResponse,
} from "../types";

export class APIError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function getConnection(): Promise<BackendConnection> {
  if (window.quizPilot) return window.quizPilot.getBackendConnection();
  return {
    baseUrl: "",
    token: import.meta.env.VITE_QUIZPILOT_API_TOKEN || "",
    state: "ready",
  };
}

async function parseError(response: Response): Promise<APIError> {
  try {
    const body = await response.json();
    const error = body.error || {};
    return new APIError(response.status, error.code || "request_failed", error.message || `Request failed (${response.status})`, error.details || {});
  } catch {
    return new APIError(response.status, "request_failed", `Request failed (${response.status})`);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const connection = await getConnection();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("X-QuizPilot-Token", connection.token);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${connection.baseUrl}${path}`, { ...options, headers });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function download(runId: string, format: "json" | "csv"): Promise<void> {
  const connection = await getConnection();
  const response = await fetch(`${connection.baseUrl}/api/runs/${runId}/export?format=${format}`, {
    headers: { "X-QuizPilot-Token": connection.token },
  });
  if (!response.ok) throw await parseError(response);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `quizpilot-${runId}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const api = {
  health: () => request<{ status: string; version: string; database: string }>("/health"),
  overview: () => request<Overview>("/api/overview"),
  systemStatus: () => request<SystemStatus>("/api/system/status"),
  visibleWindows: () => request<VisibleWindowsResponse>("/api/system/windows"),
  projects: () => request<ProjectList>("/api/projects?limit=100"),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (data: ProjectCreate) => request<Project>("/api/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: ProjectCreate) => request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  validateProject: (id: string, confirmed: boolean) => request<EnvironmentValidation>(`/api/projects/${id}/validate`, {
    method: "POST",
    body: JSON.stringify({ project_id: id, operator_confirmed: confirmed }),
  }),
  runs: (projectId?: string) => request<RunList>(`/api/runs?limit=100${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`),
  run: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  createRun: (projectId: string, confirmed: boolean) => request<TestRun>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, operator_confirmed: confirmed }),
  }),
  cancelRun: (id: string) => request<TestRun>(`/api/runs/${id}/cancel`, { method: "POST", body: "{}" }),
  report: (id: string) => request<RunReport>(`/api/runs/${id}/report`),
  download,
  backendStatus: (): Promise<BackendStatus> => window.quizPilot?.getBackendStatus() ?? Promise.resolve({ state: "ready", detail: "Development backend", port: 8765 }),
  restartBackend: (): Promise<BackendConnection> => window.quizPilot?.restartBackend() ?? Promise.reject(new Error("Backend lifecycle controls are available in the Electron app")),
  appInfo: (): Promise<AppInfo> => window.quizPilot?.getAppInfo() ?? Promise.resolve({ name: "QuizPilot AI", version: "0.1.0", platform: "web", packaged: false }),
};

export const DEFAULT_SELECTORS: Record<string, string> = {
  question_root: '[data-qa="question-screen"]',
  question: '[data-qa="question"]',
  options: '[data-qa="option"]',
  timer: '[data-qa="timer"]',
  text_answer: '[data-qa="text-answer"]',
  code_answer: '[data-qa="code-answer"]',
  submit: '[data-qa="submit"]',
  next: '[data-qa="next"]',
  feedback: '[data-qa="feedback"]',
  complete: '[data-qa="quiz-complete"]',
};

export function demoProject(baseUrl = "http://127.0.0.1:8765"): ProjectCreate {
  return {
    name: "Local demo · Release readiness",
    adapter_type: "browser",
    target_config: {
      url: `${baseUrl.replace(/\/$/, "")}/demo/?scenario=normal`,
      application_name: null,
      window_title: null,
      oracle_profile: "demo-v1",
      demo_scenario: "normal",
      headless: false,
      question_type: null,
      code_language: null,
      capture_mode: "calibrated",
      regions: {},
    },
    selector_config: { ...DEFAULT_SELECTORS },
    timeout_settings: { operation_ms: 10_000, feedback_ms: 5_000, run_seconds: 300 },
    solver_settings: { provider: "deterministic", model: null, timeout_seconds: 30, max_retries: 2, use_sandbox: true },
    safety_settings: { allow_submit: true, operator_confirmed: true, max_questions: 6, failure_threshold: 3, diagnostic_capture: false },
    question_types: ["multiple_choice", "multiple_select", "math", "logical", "text", "programming"],
  };
}

export function windowsAutopilotProject(windowTitle = ""): ProjectCreate {
  return {
    name: windowTitle ? `Live Autopilot · ${windowTitle}`.slice(0, 120) : "Windows Desktop Autopilot",
    adapter_type: "desktop",
    target_config: {
      url: null,
      application_name: windowTitle || null,
      window_title: windowTitle,
      oracle_profile: null,
      demo_scenario: "normal",
      headless: false,
      question_type: null,
      code_language: null,
      capture_mode: "live",
      regions: {},
    },
    selector_config: { ...DEFAULT_SELECTORS },
    timeout_settings: { operation_ms: 10_000, feedback_ms: 8_000, run_seconds: 900 },
    solver_settings: { provider: "llm", model: null, timeout_seconds: 45, max_retries: 2, use_sandbox: true },
    safety_settings: { allow_submit: true, operator_confirmed: true, max_questions: 25, failure_threshold: 3, diagnostic_capture: false },
    question_types: ["multiple_choice", "multiple_select", "math", "logical", "text", "programming"],
  };
}

export async function streamRunEvents(runId: string, onEvent: (event: LiveRunEvent) => void, signal: AbortSignal): Promise<void> {
  const connection = await getConnection();
  const response = await fetch(`${connection.baseUrl}/api/runs/${runId}/events`, {
    headers: { "X-QuizPilot-Token": connection.token, Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new Error("Event stream is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = block.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (event && dataLine) onEvent({ event, data: JSON.parse(dataLine) });
      boundary = buffer.indexOf("\n\n");
    }
  }
}
