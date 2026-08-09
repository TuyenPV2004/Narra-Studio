import {app, BrowserWindow} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0d12',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const developmentUrl = process.env.NARRA_DEV_SERVER_URL;
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
    return;
  }

  await window.loadFile(path.join(currentDirectory, '../dist/index.html'));
};

app.whenReady().then(async () => {
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

