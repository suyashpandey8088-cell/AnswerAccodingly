/**
 * Hardened Preload Bridge for Optional Electron Companion Shell
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quizpilotDesktopBridge', {
  checkCompanionHealth: () => ipcRenderer.invoke('quizpilot:companion-health')
});
