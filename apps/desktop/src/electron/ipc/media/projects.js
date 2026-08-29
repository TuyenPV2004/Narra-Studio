'use strict';

const { grantLocalFileCapability } = require('../../runtime/localFileCapabilities');

module.exports = function registerMediaProjectsIpc(dependencies) {
  const {
    app,
    ipcMain,
    dialog,
    shell,
    path,
    fs,
    pathToFileURL,
    fileURLToPath,
    runtime,
    getImageOutputDir,
    getVideoOutputDir,
    loadSettings,
  } = dependencies;

const PROJECTS_DIR = path.join(app.getPath('userData'), 'video-projects');
if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

ipcMain.handle('list-video-projects', async () => {
  try {
    const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
    const projects = files.map(f => {
      const full = path.join(PROJECTS_DIR, f);
      const stat = fs.statSync(full);
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
        return {
          id: f.replace('.json', ''),
          name: data.name || f.replace('.json', ''),
          description: data.description || '',
          thumbnail: data.thumbnail || null,
          createdAt: data.createdAt || stat.birthtime.toISOString(),
          updatedAt: data.updatedAt || stat.mtime.toISOString(),
          clipCount: (data.timelineClips || []).length,
          videoSrc: data.videoSrc || null,
          videoName: data.videoName || '',
        };
      } catch { return null; }
    }).filter(Boolean);
    projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return projects;
  } catch (err) {
    console.error('[PROJECT] List error:', err);
    return [];
  }
});

ipcMain.handle('save-video-project', async (_, { id, data }) => {
  try {
    const projectId = id || `project_${Date.now()}`;
    const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
    const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : {};
    const projectData = {
      ...data,
      id: projectId,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(projectData, null, 2));
    console.log(`[PROJECT] Saved: ${projectId}`);
    return { id: projectId, success: true };
  } catch (err) {
    console.error('[PROJECT] Save error:', err);
    throw err;
  }
});

ipcMain.handle('load-video-project', async (_, projectId) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
    if (!fs.existsSync(filePath)) throw new Error('Project not found');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('[PROJECT] Load error:', err);
    throw err;
  }
});

ipcMain.handle('delete-video-project', async (_, projectId) => {
  try {
    const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.log(`[PROJECT] Deleted: ${projectId}`);
    return true;
  } catch (err) {
    console.error('[PROJECT] Delete error:', err);
    throw err;
  }
});

ipcMain.handle('select-video-files', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn video để chỉnh sửa',
    properties: ['openFile', 'multiSelections'],

    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'flv', 'wmv', '3gp', 'mts', 'm2ts'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const urls = result.filePaths
    .map(grantLocalFileCapability)
    .filter(Boolean)
    .map(p => pathToFileURL(p).toString());

  return urls.length === 1 ? urls[0] : urls;
});

ipcMain.handle('select-media-files', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn file media để import',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Media', extensions: [

        'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'flv', 'wmv', '3gp', 'mts', 'm2ts',

        'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff', 'tif',

        'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma',
      ] },
      { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'flv', 'wmv', '3gp', 'mts', 'm2ts'] },
      { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff', 'tif'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const urls = result.filePaths
    .map(grantLocalFileCapability)
    .filter(Boolean)
    .map(p => pathToFileURL(p).toString());
  return urls.length === 1 ? urls[0] : urls;
});

ipcMain.handle('select-agent-canvas-media-files', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn Media cho Canvas',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: [
        'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'flv', 'wmv', '3gp', 'mts', 'm2ts',
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff', 'tif', 'avif',
        'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma',
      ] },
      { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'flv', 'wmv', '3gp', 'mts', 'm2ts'] },
      { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff', 'tif', 'avif'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return [];

  const imageExtensions = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp']);
  const videoExtensions = new Set(['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mts', 'webm', 'wmv']);
  const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'wma']);
  const mimeByExtension = {
    avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
    jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', tif: 'image/tiff',
    tiff: 'image/tiff', webp: 'image/webp',
    '3gp': 'video/3gpp', avi: 'video/x-msvideo', flv: 'video/x-flv', m2ts: 'video/mp2t',
    m4v: 'video/x-m4v', mkv: 'video/x-matroska', mov: 'video/quicktime', mp4: 'video/mp4',
    mts: 'video/mp2t', webm: 'video/webm', wmv: 'video/x-ms-wmv',
    aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg',
    opus: 'audio/opus', wav: 'audio/wav', wma: 'audio/x-ms-wma',
  };

  const selectedMedia = result.filePaths.flatMap(filePath => {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const kind = imageExtensions.has(extension)
      ? 'image'
      : videoExtensions.has(extension)
        ? 'video'
        : audioExtensions.has(extension)
          ? 'audio'
          : null;
    if (!kind) return [];
    return [{
      filePath,
      fileName: path.basename(filePath),
      mimeType: mimeByExtension[extension] || 'application/octet-stream',
      kind,
    }];
  });
  return selectedMedia;
});

const { validateMediaDeleteTarget } = require('../../runtime/mediaSecurity');

ipcMain.handle('delete-file', async (_, filePath) => {
  try {
    const validation = validateMediaDeleteTarget(filePath, dependencies);
    if (!validation.valid) {
      console.warn(`[FILE] Rejected delete: ${validation.reason} (target: "${filePath}")`);
      return false;
    }

    const resolvedPath = validation.resolvedPath;
    console.log(`[FILE] Deleting target: "${filePath}" -> resolved: "${resolvedPath}"`);
    if (shell && typeof shell.trashItem === 'function') {
      try {
        await shell.trashItem(resolvedPath);
        console.log(`[FILE] Moved to Recycle Bin: ${resolvedPath}`);
        return true;
      } catch (trashErr) {
        console.warn('[FILE] trashItem failed, falling back to unlinkSync:', trashErr);
      }
    }
    fs.unlinkSync(resolvedPath);
    console.log(`[FILE] Deleted: ${resolvedPath}`);
    return true;
  } catch (err) {
    console.error('[FILE] Delete error:', err);
    throw err;
  }
});
};
