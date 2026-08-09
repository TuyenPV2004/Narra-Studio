import {
  ProjectStore,
  type AssetStatusInput,
  type CreateAssetTaskInput,
  type CreateProjectInput,
  type ApprovalGate,
  type EditorialDocument,
  type RenderTarget,
} from '@narra/project-store';
import {app, BrowserWindow, dialog, ipcMain, net, protocol} from 'electron';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {IPC_CHANNELS} from './ipc-channels.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let projectStore: ProjectStore | null = null;

protocol.registerSchemesAsPrivileged([
  {scheme: 'narra-media', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true}},
]);

const getProjectStore = (): ProjectStore => {
  if (!projectStore) throw new Error('Project workspace is not ready.');
  return projectStore;
};

const registerProjectHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.listProjects, () => getProjectStore().listProjects());
  ipcMain.handle(IPC_CHANNELS.createProject, (_event, input: CreateProjectInput) =>
    getProjectStore().createProject(input),
  );
  ipcMain.handle(IPC_CHANNELS.getProject, (_event, projectId: string) =>
    getProjectStore().getProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.duplicateProject, (_event, projectId: string) =>
    getProjectStore().duplicateProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.archiveProject, (_event, projectId: string) =>
    getProjectStore().archiveProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.refreshProject, (_event, projectId: string) =>
    getProjectStore().refreshProject(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndOpenProject, async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Open Narra project folder',
      properties: ['openDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().openProjectDirectory(selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.getStoryboard, (_event, projectId: string) =>
    getProjectStore().getStoryboardWorkspace(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndImportStoryboard, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import scenes.json and shots.json',
      properties: ['openFile', 'multiSelections'],
      filters: [{name: 'Narra JSON artifacts', extensions: ['json']}],
    });
    if (selection.canceled) return null;
    const scenesPath = selection.filePaths.find((filePath) => path.basename(filePath).toLowerCase() === 'scenes.json');
    const shotsPath = selection.filePaths.find((filePath) => path.basename(filePath).toLowerCase() === 'shots.json');
    if (!scenesPath || !shotsPath) throw new Error('Select both scenes.json and shots.json in the same import action.');
    return getProjectStore().importStoryboard(projectId, scenesPath, shotsPath);
  });
  ipcMain.handle(
    IPC_CHANNELS.createAssetTask,
    (_event, projectId: string, input: CreateAssetTaskInput) => getProjectStore().createAssetTask(projectId, input),
  );
  ipcMain.handle(
    IPC_CHANNELS.updateAssetStatus,
    (_event, projectId: string, assetId: string, input: AssetStatusInput) =>
      getProjectStore().updateAssetStatus(projectId, assetId, input),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndImportAssetMedia, async (_event, projectId: string, assetId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import asset media',
      properties: ['openFile'],
      filters: [{name: 'Image and video', extensions: ['png', 'jpg', 'jpeg', 'svg', 'mp4', 'mov', 'webm', 'mkv']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importAssetMedia(projectId, assetId, selection.filePaths[0]);
  });
  ipcMain.handle(
    IPC_CHANNELS.importAssetMediaPath,
    (_event, projectId: string, assetId: string, sourcePath: string) =>
      getProjectStore().importAssetMedia(projectId, assetId, sourcePath),
  );
  ipcMain.handle(IPC_CHANNELS.exportStoryboardRenderInput, (_event, projectId: string) =>
    getProjectStore().exportStoryboardRenderInput(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.getVoiceWorkspace, (_event, projectId: string) =>
    getProjectStore().getVoiceWorkspace(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.syncNarrationSegments, (_event, projectId: string) =>
    getProjectStore().syncNarrationSegments(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndImportNarrationAudio, async (_event, projectId: string, segmentId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import narration segment audio',
      properties: ['openFile'],
      filters: [{name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importNarrationAudio(projectId, segmentId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.chooseAndImportCaptions, async (_event, projectId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Import captions or word timestamps',
      properties: ['openFile'],
      filters: [{name: 'Captions and timestamps', extensions: ['srt', 'vtt', 'json']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().importCaptions(projectId, selection.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.fitTimelineToNarration, (_event, projectId: string) =>
    getProjectStore().fitTimelineToNarration(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.getEditorialWorkspace, (_event, projectId: string) =>
    getProjectStore().getEditorialWorkspace(projectId),
  );
  ipcMain.handle(
    IPC_CHANNELS.saveEditorialDocument,
    (_event, projectId: string, document: EditorialDocument, content: string) =>
      getProjectStore().saveEditorialDocument(projectId, document, content),
  );
  ipcMain.handle(IPC_CHANNELS.getReviewWorkspace, (_event, projectId: string) =>
    getProjectStore().getReviewWorkspace(projectId),
  );
  ipcMain.handle(IPC_CHANNELS.approveGate, (_event, projectId: string, gate: ApprovalGate, note: string) =>
    getProjectStore().approveGate(projectId, gate, note),
  );
  ipcMain.handle(IPC_CHANNELS.revokeGate, (_event, projectId: string, gate: ApprovalGate, note: string) =>
    getProjectStore().revokeGate(projectId, gate, note),
  );
  ipcMain.handle(IPC_CHANNELS.queueRender, (_event, projectId: string, target: RenderTarget) =>
    getProjectStore().queueRender(projectId, target),
  );
  ipcMain.handle(IPC_CHANNELS.chooseAndAttachRenderOutput, async (_event, projectId: string, jobId: string) => {
    const selection = await dialog.showOpenDialog({
      title: 'Attach completed render output',
      properties: ['openFile'],
      filters: [{name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm']}],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return getProjectStore().attachRenderOutput(projectId, jobId, selection.filePaths[0]);
  });
};

const createWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0d12',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const developmentUrl = process.env.NARRA_DEV_SERVER_URL;
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
    return window;
  }

  await window.loadFile(path.join(currentDirectory, '../dist/index.html'));
  return window;
};

void app.whenReady().then(async () => {
  const workspaceRoot =
    process.env.NARRA_WORKSPACE_ROOT ?? path.join(app.getPath('documents'), 'Narra Studio', 'projects');
  projectStore = new ProjectStore(workspaceRoot);
  registerProjectHandlers();
  protocol.handle('narra-media', (request) => {
    try {
      const url = new URL(request.url);
      const [projectId, assetId] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (!['asset', 'narration'].includes(url.hostname) || !projectId || !assetId) {
        return new Response('Invalid media URL', {status: 400});
      }
      const filePath = url.hostname === 'narration'
        ? getProjectStore().getNarrationFilePath(projectId, assetId)
        : getProjectStore().getAssetFilePath(projectId, assetId);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Media not found', {status: 404});
    }
  });
  const mainWindow = await createWindow();

  if (process.env.NARRA_SMOKE_TEST === '1') {
    const result = (await mainWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const startedAt = Date.now();
        const check = () => {
          const heading = document.querySelector('h1')?.textContent;
          if (heading) {
            Promise.resolve(window.narra?.listProjects())
              .then((projects) => resolve({
                heading,
                apiVersion: window.narra?.version,
                projectCount: Array.isArray(projects) ? projects.length : -1,
              }))
              .catch((error) => resolve({heading, apiVersion: window.narra?.version, apiError: String(error)}));
            return;
          }
          if (Date.now() - startedAt > 5000) {
            resolve({heading, apiVersion: window.narra?.version});
            return;
          }
          setTimeout(check, 50);
        };
        check();
      })
    `)) as {heading?: string; apiVersion?: number; projectCount?: number; apiError?: string};
    if (result.heading !== 'Projects' || result.apiVersion !== 5 || typeof result.projectCount !== 'number' || result.projectCount < 0) {
      throw new Error(`Desktop smoke test received ${JSON.stringify(result)}.`);
    }
    writeFileSync(
      path.join(workspaceRoot, '.desktop-smoke-ok'),
      `renderer=Projects\napiVersion=5\nprojectCount=${result.projectCount}\n`,
      'utf8',
    );
    console.log('NARRA_DESKTOP_SMOKE_OK');
    await new Promise((resolve) => setTimeout(resolve, 100));
    projectStore.close();
    projectStore = null;
    app.exit(0);
    return;
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}).catch((error: unknown) => {
  console.error('NARRA_DESKTOP_STARTUP_FAILED', error);
  if (process.env.NARRA_SMOKE_TEST === '1' && process.env.NARRA_WORKSPACE_ROOT) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    writeFileSync(path.join(process.env.NARRA_WORKSPACE_ROOT, '.desktop-smoke-failed'), message, 'utf8');
  }
  projectStore?.close();
  projectStore = null;
  app.exit(1);
});

app.on('before-quit', () => {
  projectStore?.close();
  projectStore = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
