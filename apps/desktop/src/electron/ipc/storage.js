'use strict';

const { downloadRemoteMediaToFile } = require('../runtime/workspaceBackupMedia');
const { brand } = require('../runtime/brand');
const { isValidImageBuffer, validateGoogleMediaUrl } = require('../runtime/mediaSecurity');

const MAX_SAVED_IMAGE_BYTES = 25 * 1024 * 1024;
const ALLOWED_SAVED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/octet-stream',
]);

module.exports = function registerStorageIpc(dependencies) {
  const {
    app,
    BrowserWindow,
    ipcMain,
    session,
    clipboard,
    protocol,
    net,
    shell,
    dialog,
    path,
    https,
    http,
    fs,
    os,
    crypto,
    pathToFileURL,
    fileURLToPath,
    captchaBridge,
    runtime,
    getFfmpegBin,
    maybePromoteFilterComplexToScript,
    logFfmpegSpawnDiagnostics,
    truncatePreview,
    SESSION_PARTITION,
    MAX_SLOTS,
    isDev,
    SETTINGS_FILE,
    loadSettings,
    saveSettings,
    getVideoOutputDir,
    getImageOutputDir,
    getVoiceOutputDir,
    getVoiceOutputRoots,
    getNextFilename,
    buildCleanUserAgent,
    DEFAULTS,
    accountSlots,
    capturedAuth,
    getSlot,
    slotRequestCounts,
    markSlotBusy,
    markSlotFree,
    pickRandomSlot,
    refreshCapturedCookies,
    fetchSlotSession,
    clearSlotSessionData,
    fetchSlotEmail,
    createWindow,
    setupRequestInterception,
    getPlatformChHint,
    getChromeMajorVersion,
    buildHeaders,
    generateUUID,
    DRYRUN_FLAG_FILE,
    DRYRUN_CAPTURE_FILE,
    isDryRunActive,
    makeApiRequest,
    RECAPTCHA_SITE_KEY,
    findChromePath,
    httpGetJson,
    createCdpClient,
    injectChromeWarningOverlay,
    startPersistentChrome,
    getCaptchaFromChrome,
    makeApiRequestViaChrome,
    reloadFlowWebviewForSlot,
    reloadChromeCdpLabs,
    getChromeRuntime,
  } = dependencies;

// ── Get video output path ─────────────────────────────────────────────
ipcMain.handle('get-video-output-path', async () => {
  return getVideoOutputDir();
});

// ── Open output folder in system file manager ─────────────────────────
ipcMain.handle('open-output-folder', async (_, folderPath) => {
  const dir = folderPath || getVideoOutputDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const openError = await shell.openPath(dir);
  return { ok: !openError, error: openError || null };
});

// ── Director's Desk persistence ──────────────────────────────────────
// Keep all Director's Desk data inside userData. Renderer-provided names
// are never used as paths without sanitizing them first.
const DIRECTOR_MAX_SCENE_BYTES = 10 * 1024 * 1024;
const DIRECTOR_MAX_CAPTURE_BYTES = 50 * 1024 * 1024;

function getDirectorDeskDir(kind) {
  const allowed = new Set(['assets', 'scenes', 'captures']);
  if (!allowed.has(kind)) throw new Error('Invalid Director Desk directory');
  const dir = path.join(app.getPath('userData'), 'director-desk', kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeDirectorId(value, fallback = '') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function sanitizeDirectorLabel(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}

function uniqueDirectorPath(dir, stem, extension) {
  const safeStem = sanitizeDirectorId(stem, 'director-item');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const candidate = path.join(dir, `${safeStem}-${suffix}${extension}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique Director Desk file');
}

function directorFileMetadata(filePath, extra = {}) {
  const stat = fs.statSync(filePath);
  return {
    ...extra,
    fileName: path.basename(filePath),
    path: filePath,
    fileUrl: pathToFileURL(filePath).toString(),
    size: stat.size,
    updatedAt: stat.mtimeMs,
  };
}

ipcMain.handle('select-director-assets', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: "Import 3D assets into Director's Desk",
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '3D models', extensions: ['glb', 'gltf'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths.flatMap((filePath) => {
    try {
      const extension = path.extname(filePath).toLowerCase();
      const stat = fs.statSync(filePath);
      if (!['.glb', '.gltf'].includes(extension) || !stat.isFile()) return [];
      return [{
        name: path.basename(filePath, extension),
        fileName: path.basename(filePath),
        path: filePath,
        fileUrl: pathToFileURL(filePath).toString(),
        extension,
        size: stat.size,
      }];
    } catch {
      return [];
    }
  });
});

ipcMain.handle('import-director-asset', async (_, params = {}) => {
  const sourcePath = typeof params.filePath === 'string' ? path.resolve(params.filePath) : '';
  const extension = path.extname(sourcePath).toLowerCase();
  if (!['.glb', '.gltf'].includes(extension)) throw new Error('Director asset must be a .glb or .gltf file');
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new Error('Director asset path is not a file');

  const displayName = sanitizeDirectorLabel(params.name, path.basename(sourcePath, extension));
  const destination = uniqueDirectorPath(getDirectorDeskDir('assets'), displayName, extension);
  fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
  return directorFileMetadata(destination, {
    id: path.basename(destination, extension),
    name: displayName,
    extension,
    importedAt: Date.now(),
  });
});

ipcMain.handle('save-director-scene', async (_, params = {}) => {
  if (!params.scene || typeof params.scene !== 'object') throw new Error('Director scene must be an object');
  const id = sanitizeDirectorId(params.id, `scene-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  const name = sanitizeDirectorLabel(params.name, 'Untitled scene');
  const updatedAt = Date.now();
  const scenePath = path.join(getDirectorDeskDir('scenes'), `${id}.json`);
  const payload = JSON.stringify({ version: 1, id, name, updatedAt, scene: params.scene }, null, 2);
  if (Buffer.byteLength(payload, 'utf8') > DIRECTOR_MAX_SCENE_BYTES) throw new Error('Director scene exceeds the 10 MB limit');
  fs.writeFileSync(scenePath, payload, { encoding: 'utf8', mode: 0o600 });
  return { id, name, path: scenePath, fileUrl: pathToFileURL(scenePath).toString(), updatedAt };
});

ipcMain.handle('load-director-scene', async (_, params = {}) => {
  const id = sanitizeDirectorId(params.id);
  if (!id || id !== String(params.id || '')) throw new Error('Invalid Director scene ID');
  const scenePath = path.join(getDirectorDeskDir('scenes'), `${id}.json`);
  if (!fs.existsSync(scenePath)) return null;
  const stat = fs.statSync(scenePath);
  if (!stat.isFile() || stat.size > DIRECTOR_MAX_SCENE_BYTES) throw new Error('Invalid Director scene file');
  return JSON.parse(fs.readFileSync(scenePath, 'utf8'));
});

ipcMain.handle('list-director-scenes', async () => {
  const dir = getDirectorDeskDir('scenes');
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') return [];
    try {
      const scenePath = path.join(dir, entry.name);
      const stat = fs.statSync(scenePath);
      if (stat.size > DIRECTOR_MAX_SCENE_BYTES) return [];
      const stored = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
      const id = sanitizeDirectorId(stored.id);
      if (!id) return [];
      return [{
        id,
        name: sanitizeDirectorLabel(stored.name, 'Untitled scene'),
        updatedAt: Number(stored.updatedAt) || stat.mtimeMs,
        path: scenePath,
        fileUrl: pathToFileURL(scenePath).toString(),
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.updatedAt - a.updatedAt);
});

ipcMain.handle('save-director-capture', async (_, params = {}) => {
  const match = typeof params.dataUrl === 'string'
    ? params.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/)
    : null;
  if (!match) throw new Error('Director capture must be a PNG, JPEG, or WebP data URL');
  const extensionByMime = { png: '.png', jpeg: '.jpg', webp: '.webp' };
  const extension = extensionByMime[match[1]];
  const buffer = Buffer.from(match[2].replace(/[\r\n]/g, ''), 'base64');
  if (!buffer.length || buffer.length > DIRECTOR_MAX_CAPTURE_BYTES) throw new Error('Director capture is empty or exceeds the 50 MB limit');

  const requestedStem = path.basename(String(params.filename || 'director-shot'), path.extname(String(params.filename || '')));
  const scenePrefix = sanitizeDirectorId(params.sceneId);
  const stem = scenePrefix ? `${scenePrefix}-${requestedStem}` : requestedStem;
  const destination = uniqueDirectorPath(getDirectorDeskDir('captures'), stem, extension);
  fs.writeFileSync(destination, buffer, { flag: 'wx', mode: 0o600 });
  return directorFileMetadata(destination, {
    id: path.basename(destination, extension),
    name: sanitizeDirectorLabel(requestedStem, 'Director shot'),
    extension,
    mimeType: `image/${match[1]}`,
    createdAt: Date.now(),
  });
});

// ── Change output folder via dialog ───────────────────────────────────
ipcMain.handle('change-output-folder', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn thư mục lưu video',
    defaultPath: getVideoOutputDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const newPath = result.filePaths[0];
  saveSettings({ videoOutputPath: newPath });
  console.log(`[SETTINGS] Video output path changed to: ${newPath}`);
  return newPath;
});

// ── Image output path ─────────────────────────────────────────────────
ipcMain.handle('get-image-output-path', async () => {
  return getImageOutputDir();
});

ipcMain.handle('change-image-output-folder', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn thư mục lưu hình ảnh',
    defaultPath: getImageOutputDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const newPath = result.filePaths[0];
  saveSettings({ imageOutputPath: newPath });
  console.log(`[SETTINGS] Image output path changed to: ${newPath}`);
  return newPath;
});

// ── Voice output path ─────────────────────────────────────────────────
ipcMain.handle('get-voice-output-path', async () => {
  return getVoiceOutputDir();
});

ipcMain.handle('change-voice-output-folder', async () => {
  const previousPath = getVoiceOutputDir();
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn thư mục lưu Voice',
    defaultPath: getVoiceOutputDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const newPath = result.filePaths[0];
  const trustedPaths = [...new Set([...getVoiceOutputRoots(), previousPath, newPath])].slice(-20);
  saveSettings({ voiceOutputPath: newPath, voiceOutputPaths: trustedPaths });
  console.log(`[SETTINGS] Voice output path changed to: ${newPath}`);
  return newPath;
});

// ── List saved images from image output directory ─────────────────────
ipcMain.handle('list-image-files', async () => {
  const dir = getImageOutputDir();
  if (!fs.existsSync(dir)) return [];
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  try {
    const files = fs.readdirSync(dir)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        return {
          name: f,
          path: fp,
          fileUrl: pathToFileURL(fp).toString(),
          size: stat.size,
          time: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.time - a.time);
    return files;
  } catch { return []; }
});

// ── List video files in output folder ─────────────────────────────────
ipcMain.handle('list-video-files', async () => {
  const dir = getVideoOutputDir();
  if (!fs.existsSync(dir)) return [];
  const exts = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
  try {
    const files = fs.readdirSync(dir)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        return {
          name: f,
          path: fp,
          fileUrl: pathToFileURL(fp).toString(),
          size: stat.size,
          time: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.time - a.time);
    return files;
  } catch { return []; }
});

// ── List voice / audio files in output folder ─────────────────────────
ipcMain.handle('list-voice-files', async () => {
  const roots = typeof getVoiceOutputRoots === 'function'
    ? getVoiceOutputRoots()
    : [typeof getVoiceOutputDir === 'function' ? getVoiceOutputDir() : null].filter(Boolean);
  const exts = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac', '.opus'];
  const seenPaths = new Set();
  const allFiles = [];
  for (const dir of roots) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const f of entries) {
        if (!exts.includes(path.extname(f).toLowerCase())) continue;
        const fp = path.join(dir, f);
        if (seenPaths.has(fp)) continue;
        seenPaths.add(fp);
        const stat = fs.statSync(fp);
        if (!stat.isFile()) continue;
        allFiles.push({
          name: f,
          path: fp,
          fileUrl: pathToFileURL(fp).toString(),
          size: stat.size,
          time: stat.mtimeMs,
        });
      }
    } catch { /* ignore directory read error */ }
  }
  allFiles.sort((a, b) => b.time - a.time);
  return allFiles;
});

// ── Dashboard stats ───────────────────────────────────────────────────
ipcMain.handle('get-dashboard-stats', async () => {
  const imgDir = getImageOutputDir();
  const vidDir = getVideoOutputDir();
  const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const vidExts = ['.mp4', '.webm', '.mov'];

  function scanDir(dir, exts) {
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter(f => exts.includes(path.extname(f).toLowerCase()))
        .map(f => {
          const fp = path.join(dir, f);
          const stat = fs.statSync(fp);
          // Extract date from p-DD-MM-NNN format
          const m = f.match(/^p-(\d{2})-(\d{2})-(\d+)/);
          let date = null;
          if (m) {
            const year = new Date().getFullYear();
            date = `${year}-${m[2]}-${m[1]}`; // YYYY-MM-DD
          }
          return { name: f, size: stat.size, time: stat.mtimeMs, date };
        });
    } catch { return []; }
  }

  const imgFiles = scanDir(imgDir, imgExts);
  const vidFiles = scanDir(vidDir, vidExts);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Daily counts for last 14 days
  const dailyData = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    dailyData.push({
      date: label,
      images: imgFiles.filter(f => f.date === ds).length,
      videos: vidFiles.filter(f => f.date === ds).length,
    });
  }

  return {
    totalImages: imgFiles.length,
    totalVideos: vidFiles.length,
    todayImages: imgFiles.filter(f => f.date === todayStr).length,
    todayVideos: vidFiles.filter(f => f.date === todayStr).length,
    imageStorage: imgFiles.reduce((s, f) => s + f.size, 0),
    videoStorage: vidFiles.reduce((s, f) => s + f.size, 0),
    dailyData,
    recentImages: imgFiles.sort((a, b) => b.time - a.time).slice(0, 6).map(f => f.name),
    recentVideos: vidFiles.sort((a, b) => b.time - a.time).slice(0, 6).map(f => f.name),
  };
});

// ── Save file ─────────────────────────────────────────────────────────
ipcMain.handle('save-file', async (_, { data, filename, dir }) => {
  const saveDir = dir || path.join(app.getPath('pictures'), 'VEO3Flow');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
  const filepath = path.join(saveDir, filename);
  const buffer = Buffer.from(data, 'base64');
  fs.writeFileSync(filepath, buffer);
  return filepath;
});

ipcMain.handle('save-file-dialog', async (_, { data, filename, filters }) => {
  const result = await dialog.showSaveDialog(runtime.mainWindow, {
    title: 'Lưu file',
    defaultPath: path.join(app.getPath('documents'), filename || 'export.json'),
    filters: filters || [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const buffer = Buffer.from(data, 'base64');
  fs.writeFileSync(result.filePath, buffer);
  return result.filePath;
});

const sanitizeWorkspaceExportName = (value) => String(value || 'Workspace')
  .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 80) || 'Workspace';

const workspaceImportSessions = new Map();
const WORKSPACE_IMPORT_MAX_JSON_BYTES = 512 * 1024 * 1024;

function validateWorkspaceImportPayload(payload) {
  if (payload?.format !== 'genyu-workspace-backup' || payload?.version !== 1) {
    throw new Error(`Đây không phải file ${brand.displayName} Workspace hợp lệ`);
  }
  if (!payload.workspace || typeof payload.workspace !== 'object' || !String(payload.workspace.name || '').trim()) {
    throw new Error('File import thiếu thông tin Workspace');
  }
  if (!Array.isArray(payload.episodes) || !Array.isArray(payload.assets)) {
    throw new Error('File import thiếu danh sách Episode hoặc Assets');
  }
  if (payload.episodes.length > 2000 || payload.assets.length > 100000) {
    throw new Error('Bản import vượt giới hạn an toàn');
  }
}

function resolveWorkspaceBackupPath(root, relativePath) {
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, String(relativePath || ''));
  if (candidate === rootPath || !candidate.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Đường dẫn trong bản backup không hợp lệ');
  }
  return candidate;
}

async function sha256File(filePath) {
  const checksum = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) checksum.update(chunk);
  return checksum.digest('hex');
}

function importMimeType(filePath, value) {
  const supplied = String(value || '').split(';')[0].trim().toLowerCase();
  if (supplied && supplied !== 'application/octet-stream') return supplied;
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function readWorkspaceJsonFile(filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > WORKSPACE_IMPORT_MAX_JSON_BYTES) {
    throw new Error('File Workspace rỗng hoặc vượt giới hạn 512 MB');
  }
  const raw = await fs.promises.readFile(filePath, 'utf8');
  return { raw, value: JSON.parse(raw) };
}

async function prepareFullWorkspaceImport(manifestPath, manifest) {
  if (manifest?.format !== 'genyu-workspace-backup' || manifest?.version !== 1 || !Array.isArray(manifest.media)) {
    throw new Error('Manifest backup Workspace không hợp lệ');
  }
  const backupRoot = path.dirname(manifestPath);
  const workspacePath = resolveWorkspaceBackupPath(backupRoot, manifest.workspaceFile || 'workspace.json');
  const { raw: workspaceJson, value: payload } = await readWorkspaceJsonFile(workspacePath);
  validateWorkspaceImportPayload(payload);
  const actualWorkspaceChecksum = crypto.createHash('sha256').update(workspaceJson).digest('hex');
  if (!manifest.workspaceSha256 || actualWorkspaceChecksum !== manifest.workspaceSha256) {
    throw new Error('Checksum workspace.json không khớp; bản backup có thể đã bị thay đổi');
  }

  const media = [];
  let failedMediaCount = 0;
  for (const item of manifest.media) {
    if (item?.status !== 'saved' || !item.relativePath) {
      failedMediaCount += 1;
      continue;
    }
    const filePath = resolveWorkspaceBackupPath(backupRoot, item.relativePath);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size !== Number(item.size || stat.size)) {
      throw new Error(`Media không đầy đủ: ${item.relativePath}`);
    }
    const actualChecksum = await sha256File(filePath);
    if (!item.sha256 || actualChecksum !== item.sha256) {
      throw new Error(`Checksum media không khớp: ${item.relativePath}`);
    }
    media.push({
      sourceUrl: String(item.sourceUrl || ''),
      filePath,
      fileName: path.basename(filePath),
      mimeType: importMimeType(filePath, item.contentType),
      size: stat.size,
      sha256: actualChecksum,
    });
  }

  return { payload, mode: 'full', media, failedMediaCount, sourcePath: manifestPath };
}

ipcMain.handle('workspace-import-prepare', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Nhập Workspace',
    properties: ['openFile'],
    filters: [{ name: `${brand.displayName} Workspace JSON / Backup Manifest`, extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return null;

  const selectedPath = result.filePaths[0];
  const { value: selected } = await readWorkspaceJsonFile(selectedPath);
  let prepared;
  if (selected?.workspaceFile && Array.isArray(selected?.media)) {
    prepared = await prepareFullWorkspaceImport(selectedPath, selected);
  } else {
    validateWorkspaceImportPayload(selected);
    const siblingManifestPath = path.join(path.dirname(selectedPath), 'manifest.json');
    if (path.basename(selectedPath) === 'workspace.json' && fs.existsSync(siblingManifestPath)) {
      const { value: siblingManifest } = await readWorkspaceJsonFile(siblingManifestPath);
      prepared = await prepareFullWorkspaceImport(siblingManifestPath, siblingManifest);
    } else {
      prepared = { payload: selected, mode: 'json', media: [], failedMediaCount: 0, sourcePath: selectedPath };
    }
  }

  const sessionId = crypto.randomUUID();
  workspaceImportSessions.set(sessionId, prepared.media);
  while (workspaceImportSessions.size > 3) {
    workspaceImportSessions.delete(workspaceImportSessions.keys().next().value);
  }
  return {
    sessionId,
    mode: prepared.mode,
    sourcePath: prepared.sourcePath,
    payload: prepared.payload,
    media: prepared.media.map((item, index) => ({
      index,
      sourceUrl: item.sourceUrl,
      fileName: item.fileName,
      mimeType: item.mimeType,
      size: item.size,
      sha256: item.sha256,
    })),
    failedMediaCount: prepared.failedMediaCount,
  };
});

ipcMain.handle('workspace-import-media-read', async (_, { sessionId, index }) => {
  const items = workspaceImportSessions.get(String(sessionId || ''));
  const item = items?.[Number(index)];
  if (!item) throw new Error('Phiên import media không còn hợp lệ');
  const bytes = await fs.promises.readFile(item.filePath);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  if (checksum !== item.sha256) throw new Error(`Media đã thay đổi trong lúc import: ${item.fileName}`);
  return { data: bytes.toString('base64'), fileName: item.fileName, mimeType: item.mimeType, size: bytes.length };
});

ipcMain.handle('workspace-import-release', async (_, { sessionId }) => {
  workspaceImportSessions.delete(String(sessionId || ''));
  return true;
});

ipcMain.handle('workspace-export-json', async (_, { payload, suggestedName }) => {
  if (payload?.format !== 'genyu-workspace-backup' || payload?.version !== 1) {
    throw new Error('Dữ liệu Workspace export không hợp lệ');
  }
  const safeName = sanitizeWorkspaceExportName(suggestedName || payload?.workspace?.name);
  const result = await dialog.showSaveDialog(runtime.mainWindow, {
    title: 'Xuất Workspace dạng JSON',
    defaultPath: path.join(app.getPath('documents'), `${safeName}.genyu-workspace.json`),
    filters: [{ name: `${brand.displayName} Workspace JSON`, extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const json = JSON.stringify(payload, null, 2);
  const tempPath = `${result.filePath}.tmp`;
  await fs.promises.writeFile(tempPath, json, 'utf8');
  await fs.promises.rename(tempPath, result.filePath);
  return {
    filePath: result.filePath,
    episodeCount: Array.isArray(payload.episodes) ? payload.episodes.length : 0,
    assetCount: Array.isArray(payload.assets) ? payload.assets.length : 0,
  };
});

ipcMain.handle('workspace-backup-local', async (_, { payload, suggestedName }) => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn nơi lưu bản backup Workspace',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) return null;

  const safeName = sanitizeWorkspaceExportName(suggestedName || payload?.workspace?.name);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(result.filePaths[0], `${safeName} Backup ${stamp}`);
  const mediaDir = path.join(backupRoot, 'media');
  await fs.promises.mkdir(mediaDir, { recursive: true });

  const workspaceJson = JSON.stringify(payload, null, 2);
  const workspaceChecksum = crypto.createHash('sha256').update(workspaceJson).digest('hex');
  const workspacePath = path.join(backupRoot, 'workspace.json');
  const workspaceTempPath = `${workspacePath}.tmp`;
  await fs.promises.writeFile(workspaceTempPath, workspaceJson, 'utf8');
  await fs.promises.rename(workspaceTempPath, workspacePath);

  const mediaUrls = [];
  const seenUrls = new Set();
  const scan = (value, key = '') => {
    if (typeof value === 'string') {
      if (['src', 'thumbnailSrc', 'localUrl', 'publicUrl', 'mediaUrl', 'cloudflareUrl', 'posterUrl', 'thumbnailUrl'].includes(key)
        && /^https?:\/\//i.test(value)
        && !seenUrls.has(value)) {
        seenUrls.add(value);
        mediaUrls.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item, key);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) scan(child, childKey);
    }
  };
  scan(payload);

  const extensionFrom = (url, contentType) => {
    const pathname = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
    const fromPath = path.extname(pathname).replace(/[^.\w-]/g, '').slice(0, 10);
    if (fromPath && fromPath.length > 1) return fromPath;
    const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
    return ({
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/mp4': '.m4a',
    })[normalized] || '.bin';
  };

  const media = [];
  for (let index = 0; index < mediaUrls.length; index += 1) {
    const sourceUrl = mediaUrls[index];
    try {
      const urlHash = crypto.createHash('sha256').update(sourceUrl).digest('hex').slice(0, 12);
      const fileStem = `${String(index + 1).padStart(4, '0')}-${urlHash}`;
      const temporaryPath = path.join(mediaDir, `${fileStem}.download`);
      const downloaded = await downloadRemoteMediaToFile(sourceUrl, temporaryPath);
      const contentType = downloaded.contentType;
      const extension = extensionFrom(sourceUrl, contentType);
      const fileName = `${fileStem}${extension}`;
      const relativePath = path.join('media', fileName);
      const filePath = path.join(backupRoot, relativePath);
      await fs.promises.rename(temporaryPath, filePath);
      media.push({
        sourceUrl,
        relativePath,
        contentType,
        size: downloaded.size,
        sha256: downloaded.sha256,
        status: 'saved',
      });
    } catch (error) {
      media.push({ sourceUrl, relativePath: '', contentType: '', size: 0, sha256: '', status: 'failed', error: error.message });
    }
  }

  const manifest = {
    format: 'genyu-workspace-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    workspaceId: String(payload?.workspace?.id || ''),
    workspaceName: String(payload?.workspace?.name || safeName),
    episodeCount: Array.isArray(payload?.episodes) ? payload.episodes.length : 0,
    assetCount: Array.isArray(payload?.assets) ? payload.assets.length : 0,
    workspaceFile: 'workspace.json',
    workspaceSha256: workspaceChecksum,
    media,
    complete: media.every(item => item.status === 'saved'),
  };
  const manifestPath = path.join(backupRoot, 'manifest.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return {
    backupRoot,
    manifestPath,
    episodeCount: manifest.episodeCount,
    assetCount: manifest.assetCount,
    mediaCount: media.filter(item => item.status === 'saved').length,
    failedMediaCount: media.filter(item => item.status === 'failed').length,
    workspaceSha256: workspaceChecksum,
  };
});

ipcMain.handle('workspace-backup-verify', async () => {
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn manifest của bản backup',
    properties: ['openFile'],
    filters: [{ name: `${brand.displayName} Workspace Backup`, extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return null;
  const manifestPath = result.filePaths[0];
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  if (manifest?.format !== 'genyu-workspace-backup' || manifest?.version !== 1) throw new Error('Đây không phải bản backup Workspace hợp lệ');
  const backupRoot = path.dirname(manifestPath);
  const workspacePath = path.join(backupRoot, String(manifest.workspaceFile || 'workspace.json'));
  const workspaceJson = await fs.promises.readFile(workspacePath, 'utf8');
  const actualChecksum = crypto.createHash('sha256').update(workspaceJson).digest('hex');
  if (actualChecksum !== manifest.workspaceSha256) throw new Error('Checksum workspace.json không khớp');
  let verifiedMediaCount = 0;
  for (const item of manifest.media || []) {
    if (item.status !== 'saved' || !item.relativePath) continue;
    const mediaPath = path.resolve(backupRoot, item.relativePath);
    if (!mediaPath.startsWith(`${path.resolve(backupRoot)}${path.sep}`)) throw new Error('Đường dẫn media trong backup không hợp lệ');
    const bytes = await fs.promises.readFile(mediaPath);
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    if (checksum !== item.sha256) throw new Error(`Checksum media không khớp: ${item.relativePath}`);
    verifiedMediaCount += 1;
  }
  return {
    valid: true,
    backupRoot,
    workspaceName: manifest.workspaceName,
    episodeCount: manifest.episodeCount,
    assetCount: manifest.assetCount,
    verifiedMediaCount,
    failedMediaCount: (manifest.media || []).filter(item => item.status === 'failed').length,
    workspaceSha256: actualChecksum,
  };
});

function sanitizeStoryProjectName(value) {
  const raw = String(value || '').trim() || 'Story Project';
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Story Project';
}

function storyProjectSlug(value) {
  return sanitizeStoryProjectName(value)
    .replace(/[^a-z0-9\u00C0-\u1EF9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'story-project';
}

function writeTextFileIfMissing(filepath, content) {
  if (!fs.existsSync(filepath)) fs.writeFileSync(filepath, content, 'utf8');
}

ipcMain.handle('create-ai-agent-story-project', async (_, params = {}) => {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const projectName = sanitizeStoryProjectName(params.projectName || 'Story Project');
  const projectSlug = storyProjectSlug(projectName);
  const baseDir = path.join(app.getPath('documents'), 'VEO3Flow', 'AI-Agent-Story-Projects');
  const projectDir = path.join(baseDir, `${projectSlug}-${stamp}`);
  const dirs = [
    '00_Director_Setup',
    '01_Script_Analysis',
    '02_Characters_LoRA',
    '03_Location_Concepts',
    path.join('04_Production_Batches', 'Batch_A'),
    path.join('05_Seedance_Prompts', 'Batch_A'),
    path.join('06_Video_Outputs', 'Batch_A'),
    path.join('07_Extraction_Prompts', 'Batch_A'),
  ];
  for (const dir of dirs) fs.mkdirSync(path.join(projectDir, dir), { recursive: true });

  const brief = String(params.brief || '').trim();
  const style = String(params.style || '').trim() || 'TBD';
  const density = String(params.density || '').trim() || 'Standard';
  const characterStyle = String(params.characterStyle || '').trim() || 'none';
  const pacing = String(params.pacing || '').trim() || 'cinematic';
  const createdAt = now.toISOString();
  const files = [
    {
      rel: path.join('00_Director_Setup', 'director_brief.txt'),
      text: [
        `PROJECT_NAME: ${projectName}`,
        `CREATED_AT: ${createdAt}`,
        `STYLE: ${style}`,
        `DENSITY: ${density}`,
        `CHARACTER STYLE: ${characterStyle}`,
        `PACING: ${pacing}`,
        '',
        'DIRECTOR DNA:',
        '- Palette: TBD',
        '- Lighting: TBD',
        '- Camera language: TBD',
        '- Staging: TBD',
        '',
        'USER BRIEF:',
        brief || 'TBD',
        '',
      ].join('\n'),
    },
    {
      rel: path.join('01_Script_Analysis', 'raw_script.md'),
      text: ['# Raw Script', '', brief || '<paste script here>', ''].join('\n'),
    },
    {
      rel: path.join('01_Script_Analysis', 'script_breakdown.md'),
      text: [
        '# Script Breakdown',
        '',
        '## Coverage',
        '- Coverage target: >=85%',
        '- Current coverage: Pending',
        '',
        '## Batches',
        '| Batch | Source Range | Characters | Locations | Status |',
        '|---|---|---|---|---|',
        '| A | TBD | TBD | TBD | Pending |',
        '',
        '## Scene Beats',
        '| ID | Batch | Beat | Location Anchor | Subject + Action | Mood |',
        '|---|---|---|---|---|---|',
        '| beat_A_01 | A | TBD | TBD | TBD | TBD |',
        '',
      ].join('\n'),
    },
    {
      rel: 'ASSET_MAP.md',
      text: [
        `# ASSET MAP - ${projectName}`,
        '',
        `Created: ${createdAt}`,
        '',
        '## Workflow Status',
        '- [x] Step 0: Project structure created',
        '- [ ] Step 1: Script analysis',
        '- [ ] Step 2: Character design',
        '- [ ] Step 3: Location design',
        '- [ ] Step 4A: Storyboard generation',
        '- [ ] Step 4B: Video prompts',
        '- [ ] Step 4C: Video generation',
        '',
        '## Characters',
        '| ID | Name | Prompt File | Image File | Status |',
        '|---|---|---|---|---|',
        '',
        '## Locations',
        '| ID | Name | Prompt File | Image File | Status |',
        '|---|---|---|---|---|',
        '',
        '## Storyboards',
        '| ID | Batch | File | Reference Images Used | Status |',
        '|---|---|---|---|---|',
        '',
        '## Videos',
        '| ID | Batch | Segment | File | Source Prompt | Duration | Status |',
        '|---|---|---|---|---|---|---|',
        '',
      ].join('\n'),
    },
    {
      rel: path.join('04_Production_Batches', 'Batch_A', 'prompt_A.txt'),
      text: 'Storyboard Batch A prompt: TBD\n',
    },
    {
      rel: path.join('05_Seedance_Prompts', 'FILM_CONSISTENCY_BIBLE.md'),
      text: [
        '# Film Consistency Bible',
        '',
        '## Global Visual Rules',
        '- Faces/costumes/props must remain consistent across batches.',
        '- Keep camera language and palette from director_brief.txt.',
        '',
        '## Character State Memory',
        '| Batch | Character | Costume | Emotional State | Notes |',
        '|---|---|---|---|---|',
        '',
      ].join('\n'),
    },
    {
      rel: path.join('05_Seedance_Prompts', 'Batch_A', 'seedance_A.txt'),
      text: 'Video prompt Batch A: TBD\n',
    },
  ];
  for (const file of files) {
    const filepath = path.join(projectDir, file.rel);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    writeTextFileIfMissing(filepath, file.text);
  }
  return {
    ok: true,
    projectName,
    projectDir,
    files: files.map(file => path.join(projectDir, file.rel)),
  };
});

// ── Capture a region (CSS px) of the main window → base64 PNG ──────────
// Dùng cho nút "Xuất PNG" của graph AI Agent. rect tính theo CSS px (toạ độ
// trong cửa sổ); capturePage tự nhân theo devicePixelRatio nên ảnh sắc nét.
ipcMain.handle('capture-region', async (_, rect) => {
  if (!runtime.mainWindow || runtime.mainWindow.isDestroyed()) throw new Error('Không có cửa sổ để chụp');
  const hasRect = rect && rect.width > 0 && rect.height > 0;
  const img = hasRect
    ? await runtime.mainWindow.webContents.capturePage({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    : await runtime.mainWindow.webContents.capturePage();
  return img.toPNG().toString('base64');
});

// ── Save image locally (download from URL or save base64) ─────────────
ipcMain.handle('save-image-locally', async (_, { src, fileName, slotId = 0 } = {}) => {
  const imagesDir = getImageOutputDir();
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const requestedExt = path.extname(fileName || '').slice(1).toLowerCase();
  const ext = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(requestedExt)
    ? requestedExt
    : 'png';
  const uniqueName = getNextFilename(imagesDir, ext);
  const filepath = path.join(imagesDir, uniqueName);

  if (typeof src !== 'string' || !src.trim()) {
    throw new Error('Dữ liệu nguồn ảnh không hợp lệ.');
  }

  if (src.startsWith('data:')) {
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(src);
    if (!match) throw new Error('Data URL ảnh không hợp lệ hoặc không được hỗ trợ.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_SAVED_IMAGE_BYTES) {
      throw new Error('Dung lượng ảnh lưu local vượt quá giới hạn 25MB.');
    }
    if (!isValidImageBuffer(buffer)) {
      throw new Error('Dữ liệu lưu local không phải hình ảnh hợp lệ.');
    }
    fs.writeFileSync(filepath, buffer);
  } else if (src.startsWith('https:')) {
    validateGoogleMediaUrl(src);
    // Download from URL using Electron session downloadURL with matching slot partition
    const targetPartition = `persist:slot-${slotId ?? 0}`;
    const ses = session.fromPartition(targetPartition);
    await new Promise((resolve, reject) => {
      let done = false;
      let activeItem = null;
      let timeoutId = null;
      const finish = (err) => {
        if (done) return;
        done = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (err) reject(err); else resolve(null);
      };

      // Use will-download to intercept and save
      const handler = (event, item) => {
        const initialChain = typeof item.getURLChain === 'function' ? item.getURLChain() : [];
        const initialUrl = typeof item.getURL === 'function' ? item.getURL() : '';
        if (initialChain.length > 0 ? !initialChain.includes(src) : initialUrl && initialUrl !== src) return;
        activeItem = item;
        item.setSavePath(filepath);
        item.on('updated', () => {
          if (item.getReceivedBytes() > MAX_SAVED_IMAGE_BYTES) item.cancel();
        });
        item.on('done', (e, state) => {
          ses.removeListener('will-download', handler);
          if (state === 'completed') {
            try {
              const urlChain = typeof item.getURLChain === 'function' ? item.getURLChain() : [src];
              urlChain.forEach(validateGoogleMediaUrl);
              const mimeType = typeof item.getMimeType === 'function' ? item.getMimeType().toLowerCase() : '';
              const buffer = fs.readFileSync(filepath);
              if (buffer.length === 0 || buffer.length > MAX_SAVED_IMAGE_BYTES) {
                throw new Error('Dung lượng ảnh tải về vượt quá giới hạn 25MB.');
              }
              if (mimeType && !ALLOWED_SAVED_IMAGE_MIME_TYPES.has(mimeType)) {
                throw new Error(`MIME ảnh tải về không được hỗ trợ: ${mimeType}`);
              }
              if (!isValidImageBuffer(buffer)) {
                throw new Error('Nội dung tải về không phải hình ảnh hợp lệ.');
              }
              console.log(`[IMAGE] Downloaded: ${filepath} (${buffer.length} bytes)`);
              finish(null);
            } catch (error) {
              try { fs.unlinkSync(filepath); } catch {}
              finish(error);
            }
          } else {
            console.error(`[IMAGE] Download failed: ${state}`);
            try { fs.unlinkSync(filepath); } catch {}
            finish(new Error(`Download ${state}`));
          }
        });
      };
      ses.on('will-download', handler);

      console.log(`[IMAGE] Starting download for URL: ${src.substring(0, 100)}...`);
      ses.downloadURL(src);

      // Safety timeout
      timeoutId = setTimeout(() => {
        ses.removeListener('will-download', handler);
        try { activeItem?.cancel(); } catch {}
        try { fs.unlinkSync(filepath); } catch {}
        finish(new Error('Download timeout 60s'));
      }, 60000);
    });
  } else throw new Error('Nguồn ảnh phải là HTTPS hoặc data URL hợp lệ.');

  return pathToFileURL(filepath).toString();
});

// ── Media Library Persistence ─────────────────────────────────────────
const MEDIA_LIB_FILE = path.join(app.getPath('userData'), 'media-library.json');

ipcMain.handle('load-media-library', async () => {
  try {
    if (fs.existsSync(MEDIA_LIB_FILE)) {
      const data = fs.readFileSync(MEDIA_LIB_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[MEDIA-LIB] Error loading:', e);
  }
  return [];
});

ipcMain.handle('save-media-library', async (_, items) => {
  try {
    fs.writeFileSync(MEDIA_LIB_FILE, JSON.stringify(items, null, 2));
    return true;
  } catch (e) {
    console.error('[MEDIA-LIB] Error saving:', e);
    return false;
  }
});

// ── Result History Persistence (generic, per-key) ─────────────────────
function sanitizeHistoryKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(key)) {
    throw new Error(`Invalid history key: ${String(key).slice(0, 50)}`);
  }
  const baseDir = path.resolve(app.getPath('userData'));
  const resolved = path.resolve(baseDir, `history-${key}.json`);
  if (!resolved.startsWith(baseDir)) {
    throw new Error('Path traversal attempt in history storage');
  }
  return resolved;
}

function atomicWriteHistoryJson(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

ipcMain.handle('load-history', async (_, key) => {
  try {
    const filePath = sanitizeHistoryKey(key);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      try {
        return JSON.parse(data);
      } catch (parseErr) {
        console.error(`[HISTORY:${key}] Corrupted JSON file, creating backup:`, parseErr);
        const corruptBackup = `${filePath}.corrupt-${Date.now()}.bak`;
        try { fs.copyFileSync(filePath, corruptBackup); } catch {}
        return [];
      }
    }
  } catch (e) {
    console.error(`[HISTORY:${key}] Error loading:`, e);
  }
  return [];
});

ipcMain.handle('save-history', async (_, key, items) => {
  try {
    const filePath = sanitizeHistoryKey(key);
    atomicWriteHistoryJson(filePath, items);
    return true;
  } catch (e) {
    console.error(`[HISTORY:${key}] Error saving:`, e);
    return false;
  }
});

// ── User-defined Presets (CapCut transitions + effects) ───────────────
// End users can author their own transitions / effects without rebuilding
// the app. Storage layout under app.getPath('userData'):
//   user-presets.json   { version, transitions: [...], effects: [...] }
// All schema validation lives renderer-side in
// src/components/capcut/presets/userPresets.ts — main process is a dumb
// file I/O + dialog wrapper so the validation logic isn't duplicated.
function getUserPresetsPath() {
  return path.join(app.getPath('userData'), 'user-presets.json');
}

ipcMain.handle('load-user-presets', async () => {
  try {
    const filePath = getUserPresetsPath();
    if (!fs.existsSync(filePath)) {
      return { version: 1, transitions: [], effects: [] };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      transitions: Array.isArray(parsed.transitions) ? parsed.transitions : [],
      effects:     Array.isArray(parsed.effects)     ? parsed.effects     : [],
    };
  } catch (e) {
    console.error('[USER-PRESETS] Error loading:', e);
    return { version: 1, transitions: [], effects: [] };
  }
});

ipcMain.handle('save-user-presets', async (_, payload) => {
  try {
    const filePath = getUserPresetsPath();
    const data = {
      version: 1,
      transitions: Array.isArray(payload?.transitions) ? payload.transitions : [],
      effects:     Array.isArray(payload?.effects)     ? payload.effects     : [],
    };
    // Atomic write: temp file then rename. Avoids a half-written file
    // if the user kills the app mid-save.
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error('[USER-PRESETS] Error saving:', e);
    return false;
  }
});

// Open file picker → return raw JSON content as string. Renderer parses
// + validates. Returning `null` means user cancelled.
ipcMain.handle('import-user-preset-file', async () => {
  try {
    const result = await dialog.showOpenDialog(runtime.mainWindow, {
      title: 'Chọn file preset (.json) để import',
      properties: ['openFile'],
      filters: [{ name: 'Preset JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    const filePath = result.filePaths[0];
    const raw = fs.readFileSync(filePath, 'utf-8');
    return { filePath, raw };
  } catch (e) {
    console.error('[USER-PRESETS] Import dialog error:', e);
    return null;
  }
});

// Open save-as dialog → write the provided template object as pretty JSON.
// `kind` is just for the default filename. Returns the chosen path or null.
ipcMain.handle('export-user-preset-template', async (_, { kind, template, suggestedName }) => {
  try {
    const defaultName = suggestedName
      || (kind === 'transition' ? 'transition.template.json'
          : kind === 'effect'   ? 'effect.template.json'
          : 'preset.template.json');
    const result = await dialog.showSaveDialog(runtime.mainWindow, {
      title: 'Lưu file template preset',
      defaultPath: defaultName,
      filters: [{ name: 'Preset JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify(template, null, 2));
    return { filePath: result.filePath };
  } catch (e) {
    console.error('[USER-PRESETS] Export template error:', e);
    return null;
  }
});

// ── Project management (CapCut Pro) ────────────────────────────────
// Storage layout under app.getPath('userData'):
//   projects/
//     index.json          — array of ProjectMeta for the picker
//     {id}.json           — full Project (meta + state) per project
// Atomic writes: write to temp file then rename. The picker reads the
// index; opening a project reads its individual file.
function getProjectsDir() {
  const dir = path.join(app.getPath('userData'), 'projects');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return dir;
}

function readProjectIndex() {
  const idxPath = path.join(getProjectsDir(), 'index.json');
  if (!fs.existsSync(idxPath)) return [];
  try {
    const raw = fs.readFileSync(idxPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[PROJECTS] index parse failed:', err);
    return [];
  }
}

function writeProjectIndex(index) {
  const idxPath = path.join(getProjectsDir(), 'index.json');
  const tmp = idxPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, idxPath);
}

ipcMain.handle('projects:list', async () => {
  // Returns ProjectMeta[] sorted by updatedAt desc.
  const index = readProjectIndex();
  return index.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

ipcMain.handle('projects:get', async (_, { id }) => {
  if (!id) return null;
  const file = path.join(getProjectsDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error('[PROJECTS] read failed:', err);
    return null;
  }
});

ipcMain.handle('projects:save', async (_, project) => {
  if (!project?.id || !project.name) {
    throw new Error('projects:save requires { id, name, ... }');
  }
  const now = Date.now();
  // Update timestamps before writing.
  project.updatedAt = now;
  if (!project.createdAt) project.createdAt = now;

  // Write the full project to its own file (atomic via tmp + rename).
  const file = path.join(getProjectsDir(), `${project.id}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
  fs.renameSync(tmp, file);

  // Update the index — keep only meta fields (drop state).
  const meta = {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    duration: project.duration || 0,
    thumbnail: project.thumbnail,
    aspectRatio: project.aspectRatio,
  };
  const index = readProjectIndex();
  const i = index.findIndex(p => p.id === project.id);
  if (i >= 0) index[i] = meta; else index.push(meta);
  writeProjectIndex(index);
  console.log(`[PROJECTS] Saved ${project.id} (${project.name})`);
  return meta;
});

ipcMain.handle('projects:delete', async (_, { id }) => {
  if (!id) return false;
  const file = path.join(getProjectsDir(), `${id}.json`);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* already gone */ }
  const index = readProjectIndex().filter(p => p.id !== id);
  writeProjectIndex(index);
  console.log(`[PROJECTS] Deleted ${id}`);
  return true;
});

ipcMain.handle('projects:rename', async (_, { id, name }) => {
  if (!id || !name) return false;
  // Rename in the per-project file.
  const file = path.join(getProjectsDir(), `${id}.json`);
  if (fs.existsSync(file)) {
    try {
      const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
      project.name = name;
      project.updatedAt = Date.now();
      fs.writeFileSync(file, JSON.stringify(project, null, 2));
    } catch (err) {
      console.error('[PROJECTS] rename file write failed:', err);
    }
  }
  // And in the index.
  const index = readProjectIndex().map(p => p.id === id ? { ...p, name, updatedAt: Date.now() } : p);
  writeProjectIndex(index);
  return true;
});

ipcMain.handle('projects:duplicate', async (_, { id, newName }) => {
  if (!id) return null;
  const srcFile = path.join(getProjectsDir(), `${id}.json`);
  if (!fs.existsSync(srcFile)) return null;
  const src = JSON.parse(fs.readFileSync(srcFile, 'utf-8'));
  const newId = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dup = {
    ...src,
    id: newId,
    name: newName || `${src.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const dstFile = path.join(getProjectsDir(), `${newId}.json`);
  fs.writeFileSync(dstFile, JSON.stringify(dup, null, 2));
  const index = readProjectIndex();
  index.push({
    id: newId, name: dup.name, createdAt: dup.createdAt, updatedAt: dup.updatedAt,
    duration: dup.duration || 0, thumbnail: dup.thumbnail, aspectRatio: dup.aspectRatio,
  });
  writeProjectIndex(index);
  console.log(`[PROJECTS] Duplicated ${id} → ${newId}`);
  return newId;
});

// ── Select files dialog ───────────────────────────────────────────────
ipcMain.handle('select-files', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
  });

  if (result.canceled || !result.filePaths.length) return [];

  // Save copies to VEO3Flow/uploads for persistent access
  const uploadsDir = path.join(app.getPath('pictures'), 'VEO3Flow', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  return result.filePaths.map(fp => {
    const buffer = fs.readFileSync(fp);
    const ext = path.extname(fp).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };

    // Copy to uploads dir with unique name
    const uniqueName = `${Date.now()}_${path.basename(fp)}`;
    const localPath = path.join(uploadsDir, uniqueName);
    fs.writeFileSync(localPath, buffer);

    return {
      fileName: path.basename(fp),
      imageBytes: buffer.toString('base64'),
      mimeType: mimeMap[ext] || 'image/jpeg',
      localUrl: pathToFileURL(localPath).toString(),
    };
  });
});

// ── Select image folder / files dialog ────────────────────────────────
// Cho chọn NHIỀU file ảnh và/hoặc NHIỀU thư mục cùng lúc. Mỗi thư mục được
// duyệt ĐỆ QUY qua mọi sub-folder. Kết quả trả về cùng shape với
// 'select-files' để tái dùng luồng upload-lên-canvas.
const IMPORT_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif']);
const IMPORT_IMAGE_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
};
const IMPORT_MAX_IMAGES = 2000; // chặn an toàn tránh nổ RAM khi folder quá lớn

// Duyệt đệ quy 1 thư mục, gom mọi đường dẫn ảnh (folder sort trước, file sort trong folder).
function collectImagesRecursive(dir, out, limit) {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const files = sorted.filter(e => e.isFile() && IMPORT_IMAGE_EXT.has(path.extname(e.name).toLowerCase()));
  const dirs = sorted.filter(e => e.isDirectory() && !e.name.startsWith('.'));
  for (const f of files) {
    if (out.length >= limit) return;
    out.push(path.join(dir, f.name));
  }
  for (const d of dirs) {
    if (out.length >= limit) return;
    collectImagesRecursive(path.join(dir, d.name), out, limit);
  }
}

ipcMain.handle('select-image-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif'] }],
  });

  if (result.canceled || !result.filePaths.length) return [];

  // Gom tất cả đường dẫn ảnh từ các lựa chọn (file trực tiếp + đệ quy trong folder).
  const imagePaths = [];
  const seen = new Set();
  for (const selected of result.filePaths) {
    if (imagePaths.length >= IMPORT_MAX_IMAGES) break;
    let stat;
    try {
      stat = fs.statSync(selected);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      collectImagesRecursive(selected, imagePaths, IMPORT_MAX_IMAGES);
    } else if (stat.isFile() && IMPORT_IMAGE_EXT.has(path.extname(selected).toLowerCase())) {
      imagePaths.push(selected);
    }
  }

  const uniquePaths = imagePaths.filter(fp => {
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  }).slice(0, IMPORT_MAX_IMAGES);

  if (!uniquePaths.length) return [];

  const uploadsDir = path.join(app.getPath('pictures'), 'VEO3Flow', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // PERF: trước đây đọc/ghi/base64 từng ảnh bằng *Sync trong 1 vòng lặp → chặn main
  // thread suốt cả tác vụ (tới 2000 ảnh), khiến UI đơ + CPU nhảy vọt. Chuyển sang fs
  // bất đồng bộ (chạy trên libuv threadpool) và xử lý theo lô có giới hạn: mỗi lô
  // nhường lại event-loop, không nổ RAM, vẫn giữ nguyên thứ tự ảnh.
  const stamp = Date.now();
  const IMPORT_CONCURRENCY = 6;

  async function importOne(fp, index) {
    let buffer;
    try {
      buffer = await fs.promises.readFile(fp);
    } catch {
      return null;
    }
    const name = path.basename(fp);
    const ext = path.extname(fp).toLowerCase();
    const uniqueName = `${stamp}_${index}_${name}`;
    const localPath = path.join(uploadsDir, uniqueName);
    try {
      await fs.promises.writeFile(localPath, buffer);
    } catch {
      return null;
    }
    return {
      fileName: name,
      imageBytes: buffer.toString('base64'),
      mimeType: IMPORT_IMAGE_MIME[ext] || 'image/jpeg',
      localUrl: pathToFileURL(localPath).toString(),
    };
  }

  const results = new Array(uniquePaths.length);
  for (let i = 0; i < uniquePaths.length; i += IMPORT_CONCURRENCY) {
    const slice = uniquePaths.slice(i, i + IMPORT_CONCURRENCY);
    const settled = await Promise.all(slice.map((fp, j) => importOne(fp, i + j)));
    for (let j = 0; j < settled.length; j++) results[i + j] = settled[j];
  }
  const out = results.filter(Boolean);
  console.log(`[IMPORT] select-image-folder → ${out.length} ảnh (từ ${result.filePaths.length} lựa chọn)`);
  return out;
});

// ── Folder/File-based Skill (chuẩn chung .claude-plugin + flat + single file) ──
// Cây skill chuẩn: <root>/.claude-plugin/plugin.json + <root>/skills/<group>/SKILL.md
//                 + <root>/skills/<group>/references/*.md (mỗi file = 1 "skill con")
// Cây skill flat:  <root>/SKILL.md + <root>/references/*.md
// Skill 1 file:    <path>/SKILL-one.md
// Chỉ trả METADATA (không kèm nội dung lớn). Nội dung đọc qua 'read-skill-files'
// theo từng group; renderer quyết định đọc một phần hay full-layer.
function readSkillPluginMeta(rootPath) {
  let meta = {};
  let rootStat = null;
  try { rootStat = fs.statSync(rootPath); } catch { /* checked by caller later */ }
  try {
    const pj = path.join(rootPath, '.claude-plugin', 'plugin.json');
    if (rootStat?.isDirectory() && fs.existsSync(pj)) meta = JSON.parse(fs.readFileSync(pj, 'utf8')) || {};
  } catch { /* plugin.json hỏng → vẫn đọc cây được */ }
  if (meta && Object.keys(meta).length) return meta;
  try {
    const skillMdPath = rootStat?.isFile() ? rootPath : path.join(rootPath, 'SKILL.md');
    const skillMd = fs.readFileSync(skillMdPath, 'utf8');
    const fm = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fm) {
      const parsed = {};
      for (const line of fm[1].split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        parsed[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
      }
      meta = parsed;
    }
  } catch { /* không có root SKILL.md hoặc frontmatter */ }
  return meta || {};
}

function buildSkillReferenceChildren(refDir, titleCase) {
  const children = [];
  if (fs.existsSync(refDir) && fs.statSync(refDir).isDirectory()) {
    for (const f of fs.readdirSync(refDir)) {
      if (!f.toLowerCase().endsWith('.md')) continue;
      if (f.toLowerCase() === 'craft.md') continue; // craft = luật nghề chung, tự kèm — không phải skill con
      const id = f.replace(/\.md$/i, '');
      children.push({ id, fileName: f, label: titleCase(id) });
    }
  }
  children.sort((a, b) => a.id.localeCompare(b.id));
  return children;
}

function buildSkillFolderTree(rootPath) {
  let rootStat;
  try { rootStat = fs.statSync(rootPath); }
  catch { return { ok: false, error: 'Folder/file skill không còn tồn tại.' }; }
  if (rootStat.isFile()) {
    const isMarkdown = path.extname(rootPath).toLowerCase() === '.md';
    if (!isMarkdown) return { ok: false, error: 'File skill phải là markdown .md.' };
    const titleCaseFile = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const metaFile = readSkillPluginMeta(rootPath);
    const rawId = String(metaFile.name || path.basename(rootPath, path.extname(rootPath)) || 'skill');
    const groupId = rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
    return {
      ok: true,
      rootPath,
      layout: 'file',
      name: metaFile.name || path.basename(rootPath, path.extname(rootPath)),
      version: metaFile.version || '',
      description: metaFile.description || '',
      author: (metaFile.author && metaFile.author.name) || (typeof metaFile.author === 'string' ? metaFile.author : ''),
      keywords: Array.isArray(metaFile.keywords) ? metaFile.keywords : [],
      groups: [{
        id: groupId,
        label: titleCaseFile(groupId),
        layout: 'file',
        hasSkillMd: true,
        hasCraft: false,
        children: [],
      }],
    };
  }

  const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const meta = readSkillPluginMeta(rootPath);
  const skillsDir = path.join(rootPath, 'skills');
  const hasSkillsDir = fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory();
  const rootSkillPath = path.join(rootPath, 'SKILL.md');
  const rootRefDir = path.join(rootPath, 'references');
  const hasFlatSkill = fs.existsSync(rootSkillPath)
    && fs.statSync(rootSkillPath).isFile()
    && fs.existsSync(rootRefDir)
    && fs.statSync(rootRefDir).isDirectory();

  if (!hasSkillsDir && hasFlatSkill) {
    const rawId = String(meta.name || path.basename(rootPath) || 'skill');
    const groupId = rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
    const children = buildSkillReferenceChildren(rootRefDir, titleCase);
    return {
      ok: true,
      rootPath,
      layout: 'flat',
      name: meta.name || path.basename(rootPath),
      version: meta.version || '',
      description: meta.description || '',
      author: (meta.author && meta.author.name) || (typeof meta.author === 'string' ? meta.author : ''),
      keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
      groups: [{
        id: groupId,
        label: titleCase(groupId),
        layout: 'flat',
        hasSkillMd: true,
        hasCraft: fs.existsSync(path.join(rootRefDir, 'craft.md')),
        children,
      }],
    };
  }

  if (!hasSkillsDir) {
    return { ok: false, error: 'Folder không hợp lệ: thiếu thư mục skills/ hoặc cặp SKILL.md + references/.' };
  }

  const groups = [];
  for (const groupId of fs.readdirSync(skillsDir)) {
    const groupPath = path.join(skillsDir, groupId);
    let st; try { st = fs.statSync(groupPath); } catch { continue; }
    if (!st.isDirectory()) continue;
    const refDir = path.join(groupPath, 'references');
    const children = buildSkillReferenceChildren(refDir, titleCase);
    groups.push({
      id: groupId,
      label: titleCase(groupId),
      layout: 'group',
      hasSkillMd: fs.existsSync(path.join(groupPath, 'SKILL.md')),
      hasCraft: fs.existsSync(path.join(refDir, 'craft.md')),
      children,
    });
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));
  if (!groups.length) return { ok: false, error: 'Không tìm thấy nhóm skill nào trong skills/.' };
  return {
    ok: true,
    rootPath,
    layout: 'plugin',
    name: meta.name || path.basename(rootPath),
    version: meta.version || '',
    description: meta.description || '',
    author: (meta.author && meta.author.name) || (typeof meta.author === 'string' ? meta.author : ''),
    keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
    groups,
  };
}

ipcMain.handle('import-skill-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(runtime.mainWindow, {
    title: 'Chọn folder hoặc file skill',
    properties: ['openFile', 'openDirectory'],
    filters: [
      { name: 'Skill folder hoặc markdown', extensions: ['md'] },
      { name: 'Markdown skill', extensions: ['md'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  try { return buildSkillFolderTree(result.filePaths[0]); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// Re-đọc cây từ path đã lưu (khi mở lại app) — không mở dialog.
ipcMain.handle('read-skill-folder', async (_e, rootPath) => {
  try {
    if (!rootPath || !fs.existsSync(rootPath)) return { ok: false, error: 'Folder không còn tồn tại.' };
    return buildSkillFolderTree(rootPath);
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// Đọc root SKILL.md + group SKILL.md + craft.md + danh sách child .md được yêu cầu.
ipcMain.handle('read-skill-files', async (_e, params) => {
  try {
    const { rootPath, group, childIds } = params || {};
    if (!rootPath || !group) return { ok: false, error: 'Thiếu rootPath/group.' };
    let rootStat = null;
    try { rootStat = fs.statSync(rootPath); } catch { /* handled by safeRead */ }
    const isFileSkill = rootStat?.isFile() && path.extname(rootPath).toLowerCase() === '.md';
    if (isFileSkill) {
      const safeReadFile = (p) => { try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };
      return {
        ok: true,
        rootSkillMd: safeReadFile(rootPath),
        groupSkillMd: '',
        craftMd: '',
        children: [],
      };
    }
    const safeGroup = path.basename(String(group));
    let groupPath = path.join(rootPath, 'skills', safeGroup);
    let refDir = path.join(groupPath, 'references');
    const isFlatSkill = !fs.existsSync(groupPath)
      && fs.existsSync(path.join(rootPath, 'SKILL.md'))
      && fs.existsSync(path.join(rootPath, 'references'));
    if (isFlatSkill) {
      groupPath = rootPath;
      refDir = path.join(rootPath, 'references');
    }
    const safeRead = (p) => { try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };
    const rootSkillMd = safeRead(path.join(rootPath, 'SKILL.md'));
    const groupSkillMd = isFlatSkill ? '' : safeRead(path.join(groupPath, 'SKILL.md'));
    const craftMd = safeRead(path.join(refDir, 'craft.md'));
    const children = (Array.isArray(childIds) ? childIds : []).map(id => {
      const safeId = path.basename(String(id)); // chống path traversal
      return { id: safeId, text: safeRead(path.join(refDir, `${safeId}.md`)) };
    });
    return { ok: true, rootSkillMd, groupSkillMd, craftMd, children };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

};
