import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { BackendManager } from "./backend-manager";
import { validateIpcArguments } from "./ipc-validation";
import { createApplicationWindow } from "./window-manager";

const backend = new BackendManager();
let quitting = false;

function registerIpc(channel: string, handler: () => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    validateIpcArguments(args);
    return handler();
  });
}

app.whenReady().then(() => {
  registerIpc("backend:get-connection", () => backend.getConnection());
  registerIpc("backend:get-status", () => backend.getStatus());
  registerIpc("backend:restart", () => backend.restart());
  registerIpc("app:get-info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  createApplicationWindow();
  void backend.start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown backend startup error";
    void dialog.showMessageBox({
      type: "error",
      title: "QuizPilot backend unavailable",
      message: "The local Python backend could not start.",
      detail: `${message}\n\nRun controls remain disabled. See README.md for setup and troubleshooting.`,
    });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createApplicationWindow();
  });
});


app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void backend.stop().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
