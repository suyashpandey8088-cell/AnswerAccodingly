import { BrowserWindow, shell } from "electron";
import path from "node:path";

export function createApplicationWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: "#f5f6f8",
    title: "QuizPilot AI",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: true,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const trustedDevUrl = devUrl && /^http:\/\/(127\.0\.0\.1|localhost):5173\/?$/.test(devUrl) ? devUrl : null;
  const rendererFile = path.resolve(__dirname, "../../renderer/dist/index.html");
  const initialUrl = trustedDevUrl || `file://${rendererFile}`;

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== initialUrl && url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("did-fail-load", (_event, code, description) => {
    if (code !== -3) console.error(`Renderer failed to load: ${description}`);
  });
  window.once("ready-to-show", () => window.show());

  if (trustedDevUrl) void window.loadURL(trustedDevUrl);
  else void window.loadFile(rendererFile);
  return window;
}
