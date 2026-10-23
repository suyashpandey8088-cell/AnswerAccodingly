export type BackendState = "starting" | "ready" | "error" | "stopped";

export interface BackendConnection {
  baseUrl: string;
  token: string;
  state: BackendState;
}

export interface BackendStatus {
  state: BackendState;
  detail: string;
  port: number | null;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  packaged: boolean;
}

export interface QuizPilotBridge {
  getBackendConnection(): Promise<BackendConnection>;
  getBackendStatus(): Promise<BackendStatus>;
  restartBackend(): Promise<BackendConnection>;
  getAppInfo(): Promise<AppInfo>;
}
