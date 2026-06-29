interface ElectronAPI {
  getConfig: () => Promise<{ apiUrl: string }>;
  checkForUpdates: () => Promise<{
    updateAvailable: boolean;
    downloadUrl?: string;
    version?: string;
  }>;
}

interface Window {
  electronAPI: ElectronAPI;
}
