/**
 * QuizPilot AI — Optional Hardened Electron Desktop Shell (Section 3 & Section 8)
 * - Enforces contextIsolation: true, nodeIntegration: false, sandbox: true
 * - Generates a per-launch random cryptographic session token for local FastAPI companion calls
 * - Never grants the browser extension unrestricted computer access
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');

const SESSION_TOKEN = crypto.randomBytes(24).toString('hex');
const COMPANION_URL = process.env.QUIZPILOT_COMPANION_URL || 'http://127.0.0.1:8765';

function createDesktopWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    backgroundColor: '#0b0d14',
    title: 'QuizPilot AI — Desktop Dashboard & Companion Shell',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  // Block navigation to untrusted external websites inside the desktop shell
  win.webContents.on('will-navigate', (event, targetUrl) => {
    const parsed = new URL(targetUrl);
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1' && parsed.protocol !== 'file:') {
      event.preventDefault();
    }
  });

  const devServerUrl = process.env.QUIZPILOT_DEV_URL || 'http://localhost:5173/dashboard.html';
  win.loadURL(devServerUrl);
}

ipcMain.handle('quizpilot:companion-health', async () => {
  const res = await fetch(`${COMPANION_URL}/health`, {
    headers: { 'X-QuizPilot-Token': SESSION_TOKEN }
  });
  return res.json();
});

app.whenReady().then(createDesktopWindow);
