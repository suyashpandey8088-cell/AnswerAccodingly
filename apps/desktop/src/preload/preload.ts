import { contextBridge, ipcRenderer } from "electron";
import type { AppInfo, BackendConnection, BackendStatus, QuizPilotBridge } from "./types";

const bridge: QuizPilotBridge = {
  getBackendConnection: (): Promise<BackendConnection> => ipcRenderer.invoke("backend:get-connection"),
  getBackendStatus: (): Promise<BackendStatus> => ipcRenderer.invoke("backend:get-status"),
  restartBackend: (): Promise<BackendConnection> => ipcRenderer.invoke("backend:restart"),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:get-info"),
};

// Only four fixed, argument-free operations are exposed. There is no generic
// ipcRenderer, filesystem, shell, or Node primitive in the renderer global.
contextBridge.exposeInMainWorld("quizPilot", Object.freeze(bridge));
