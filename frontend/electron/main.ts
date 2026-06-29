import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;

function readConfig() {
  // In development, the config is in the project root (frontend/)
  // In packaged app, config.json will be adjacent to the app executable
  let configPath = path.join(app.getAppPath(), 'config.json');

  if (!app.isPackaged) {
    configPath = path.join(__dirname, '../../config.json');
  } else {
    // In production, check if config.json is in the directory of the executable
    const exeDirConfig = path.join(path.dirname(app.getPath('exe')), 'config.json');
    if (fs.existsSync(exeDirConfig)) {
      configPath = exeDirConfig;
    }
  }

  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to read config.json:', error);
  }

  // Fallback default
  return { apiUrl: 'http://127.0.0.1:8000' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the Vite dev server URL in dev, or static index.html in production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle IPC config requests from Renderer
ipcMain.handle('get-config', () => {
  return readConfig();
});

// Handle check-for-updates (FR-012)
ipcMain.handle('check-for-updates', async () => {
  const config = readConfig();
  try {
    // Dynamic fetch of desktop app version from backend settings API
    // We mock/stub local fetch using Node http/https/fetch
    const response = await fetch(`${config.apiUrl}/api/v1/settings`);
    if (response.ok) {
      const settings: any = await response.json();
      // Assume backend returns {"desktop_min_version": "1.0.0", "desktop_download_url": "..."}
      const currentVersion = app.getVersion() || '1.0.0';
      const minVersion = settings.desktop_min_version || '1.0.0';
      
      // Basic comparison
      if (currentVersion < minVersion) {
        return {
          updateAvailable: true,
          downloadUrl: settings.desktop_download_url || `${config.apiUrl}/downloads/techno-setup.exe`,
          version: minVersion,
        };
      }
    }
  } catch (err) {
    console.error('Failed to check for updates:', err);
  }
  return { updateAvailable: false };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
