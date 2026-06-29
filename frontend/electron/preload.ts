import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
});
