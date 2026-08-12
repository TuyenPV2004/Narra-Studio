'use strict';

const { normalizeGridSelection, resolveGridCropCells } = require('./grid-segmentation');

/**
 * Read-only media inspection and OS dialogs: audio/thumbnail extraction,
 * ffprobe info, file pickers, reveal in Finder, open external URL.
 *
 * Registered by `electron/ipc/media.js`.
 */

module.exports = function registerMediaProbeIpc(dependencies) {
  const {
    app,
    ipcMain,
    net,
    shell,
    dialog,
    path,
    https,
    http,
    fs,
    crypto,
    pathToFileURL,
    fileURLToPath,
    getFfmpegBin,
    getVideoOutputDir,
    getImageOutputDir,
  } = dependencies;

// ── Extract Audio from Video ──────────────────────────────────────────
ipcMain.handle('extract-audio', async (_, { filePath, format }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const ffmpegBin = getFfmpegBin();

  const ext = format === 'mp3' ? 'mp3' : 'wav';
  const saveDir = path.join(getVideoOutputDir(), 'audio');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const aPrefix = `A_${dd}_${mm}_`;
  let maxSeq = 0;
  try {
    const files = fs.readdirSync(saveDir);
    for (const f of files) {
      if (f.startsWith(aPrefix)) {
        const match = f.match(new RegExp(`^${aPrefix}(\\d+)`));
        if (match) { const n = parseInt(match[1], 10); if (n > maxSeq) maxSeq = n; }
      }
    }
  } catch { }
  const seq = String(maxSeq + 1).padStart(3, '0');
  const outPath = path.join(saveDir, `${aPrefix}${seq}.${ext}`);

  const args = ['-y', '-i', resolved, '-vn'];
  if (ext === 'mp3') {
    args.push('-acodec', 'libmp3lame', '-q:a', '2');
  } else {
    args.push('-acodec', 'pcm_s16le');
  }
  args.push(outPath);

  console.log(`[AUDIO] Extracting audio to ${outPath}`);

  await new Promise((resolve, reject) => {
    execFile(ffmpegBin, args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[AUDIO] ffmpeg error:', stderr || err.message);
        reject(new Error('ffmpeg audio extract lỗi: ' + (stderr?.slice(-300) || err.message)));
      } else {
        console.log(`[AUDIO] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
        resolve(null);
      }
    });
  });

  return pathToFileURL(outPath).toString();
});

// ── Extract Thumbnail (Frame Capture) ─────────────────────────────────
ipcMain.handle('extract-thumbnail', async (_, { filePath, timeSeconds, asDataUrl }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const ffmpegBin = getFfmpegBin();

  const saveDir = getImageOutputDir();
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const tPrefix = `T_${dd}_${mm}_`;
  let maxSeq = 0;
  try {
    const files = fs.readdirSync(saveDir);
    for (const f of files) {
      if (f.startsWith(tPrefix)) {
        const match = f.match(new RegExp(`^${tPrefix}(\\d+)`));
        if (match) { const n = parseInt(match[1], 10); if (n > maxSeq) maxSeq = n; }
      }
    }
  } catch { }
  const seq = String(maxSeq + 1).padStart(3, '0');
  const outPath = path.join(saveDir, `${tPrefix}${seq}.jpg`);

  const args = [
    '-y', '-ss', String(timeSeconds || 0),
    '-i', resolved,
    '-frames:v', '1', '-q:v', '2',
    outPath,
  ];

  console.log(`[THUMBNAIL] Capturing frame at ${timeSeconds}s → ${outPath}`);

  await new Promise((resolve, reject) => {
    execFile(ffmpegBin, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[THUMBNAIL] ffmpeg error:', stderr || err.message);
        reject(new Error('ffmpeg thumbnail lỗi: ' + (stderr?.slice(-300) || err.message)));
      } else {
        console.log(`[THUMBNAIL] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
        resolve(null);
      }
    });
  });

  // Return base64 data URL if requested (more reliable in renderer)
  if (asDataUrl) {
    const buf = fs.readFileSync(outPath);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return pathToFileURL(outPath).toString();
});

// ── Image Thumbnail (nativeImage downscale, renderer-only LOD) ─────────
// Trả về một dataURL JPEG nhỏ để card ảnh trên canvas không phải paint
// texture full-res (1K–4K) hàng trăm lần. Resize ở main process qua
// nativeImage nên không dính CORS của signed storage.googleapis.com URL.
// Return null nếu ảnh gốc đã nhỏ hơn maxDim (renderer dùng thẳng src).
ipcMain.handle('image-thumbnail', async (_, { src, maxDim, includeMetadata = false } = {}) => {
  if (!src || typeof src !== 'string') return null;
  const dim = Math.max(64, Math.min(1024, Number(maxDim) || 384));

  const { nativeImage } = require('electron');

  const thumbDir = path.join(app.getPath('userData'), 'agent-image-thumbs');
  const key = crypto.createHash('sha1').update(`${dim}|${src}`).digest('hex');
  const cachePath = path.join(thumbDir, `${key}.jpg`);
  const metadataPath = path.join(thumbDir, `${key}.json`);

  // Disk cache: reload nhanh, không fetch lại.
  try {
    if (fs.existsSync(cachePath)) {
      const cached = fs.readFileSync(cachePath);
      if (cached.length) {
        const cachedSrc = `data:image/jpeg;base64,${cached.toString('base64')}`;
        if (!includeMetadata) return cachedSrc;
        if (fs.existsSync(metadataPath)) {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          if (metadata?.width && metadata?.height) {
            return { src: cachedSrc, width: metadata.width, height: metadata.height };
          }
        }
      }
    }
  } catch { }

  // Load bytes: data:/file:/http(s).
  let buf = null;
  try {
    if (src.startsWith('data:')) {
      const comma = src.indexOf(',');
      if (comma === -1) return null;
      const meta = src.slice(5, comma);
      const payload = src.slice(comma + 1);
      buf = meta.includes('base64')
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');
    } else if (src.startsWith('file://') || src.startsWith('/')) {
      const resolved = src.startsWith('file://') ? fileURLToPath(src) : src;
      if (!fs.existsSync(resolved)) return null;
      buf = fs.readFileSync(resolved);
    } else if (/^https?:\/\//i.test(src)) {
      const res = await net.fetch(src);
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      return null;
    }
  } catch (err) {
    console.warn('[IMG-THUMB] load failed:', err?.message || err);
    return null;
  }

  if (!buf || !buf.length) return null;

  let img;
  try {
    img = nativeImage.createFromBuffer(buf);
  } catch {
    return null;
  }
  if (!img || img.isEmpty()) return null;

  const size = img.getSize();
  const longest = Math.max(size.width, size.height);
  // Ảnh gốc đã nhỏ: renderer dùng thẳng src, khỏi tốn thêm 1 texture.
  if (longest <= dim) {
    return includeMetadata ? { src: null, width: size.width, height: size.height } : null;
  }

  const resized = size.width >= size.height
    ? img.resize({ width: dim, quality: 'good' })
    : img.resize({ height: dim, quality: 'good' });
  const jpeg = resized.toJPEG(72);
  if (!jpeg || !jpeg.length) return null;

  try {
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    fs.writeFileSync(cachePath, jpeg);
    fs.writeFileSync(metadataPath, JSON.stringify({ width: size.width, height: size.height }));
  } catch { }

  const thumbnailSrc = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  return includeMetadata
    ? { src: thumbnailSrc, width: size.width, height: size.height }
    : thumbnailSrc;
});

// ── Image Grid Segmentation (nativeImage crop, no renderer CORS) ─────
// Splits only the requested cells from the original image bytes. The renderer
// immediately sends these bytes through the existing Cloudflare image ingest,
// so no base64 payload is persisted in Canvas/Team realtime state.
ipcMain.handle('image-grid-segment', async (_, {
  src,
  rows,
  columns,
  cells,
  fileName = 'image',
} = {}) => {
  if (!src || typeof src !== 'string') throw new Error('Thiếu ảnh nguồn để tách lưới.');
  const selection = normalizeGridSelection({ rows, columns, cells });
  if (!selection.cells.length) throw new Error('Hãy chọn ít nhất một ô ảnh.');

  let buf = null;
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    if (comma === -1) throw new Error('Data URL ảnh không hợp lệ.');
    const meta = src.slice(5, comma);
    const payload = src.slice(comma + 1);
    buf = meta.includes('base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
  } else if (src.startsWith('file://') || src.startsWith('/')) {
    const resolved = src.startsWith('file://') ? fileURLToPath(src) : src;
    if (!fs.existsSync(resolved)) throw new Error('Không tìm thấy ảnh nguồn trên máy.');
    buf = fs.readFileSync(resolved);
  } else if (/^https?:\/\//i.test(src)) {
    const response = await net.fetch(src);
    if (!response.ok) throw new Error(`Không tải được ảnh nguồn (${response.status}).`);
    buf = Buffer.from(await response.arrayBuffer());
  } else {
    throw new Error('Định dạng đường dẫn ảnh không được hỗ trợ.');
  }

  const { nativeImage } = require('electron');
  const image = nativeImage.createFromBuffer(buf);
  if (!image || image.isEmpty()) throw new Error('Không đọc được dữ liệu ảnh nguồn.');
  const size = image.getSize();
  const baseName = String(fileName || 'image')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';

  return resolveGridCropCells({
    width: size.width,
    height: size.height,
    rows: selection.rows,
    columns: selection.columns,
    cells: selection.cells,
  }).map(cell => {
    const crop = image.crop({
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
    });
    const jpeg = crop.toJPEG(92);
    return {
      index: cell.index,
      row: cell.row,
      column: cell.column,
      width: cell.width,
      height: cell.height,
      fileName: `${baseName}-grid-${cell.row + 1}-${cell.column + 1}.jpg`,
      mimeType: 'image/jpeg',
      imageBytes: jpeg.toString('base64'),
    };
  });
});

// ── Get Video Info (FFprobe) ──────────────────────────────────────────
ipcMain.handle('get-video-info', async (_, { filePath }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  // Try ffprobe first (system), fall back to bundled ffmpeg
  const probeBin = (() => {
    const ffprobeCandidates = [
      '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe',
    ];
    for (const c of ffprobeCandidates) {
      try { if (fs.existsSync(c)) return c; } catch { }
    }
    return getFfmpegBin(); // fallback to bundled ffmpeg
  })();

  const isProbe = probeBin.includes('ffprobe');
  const args = isProbe
    ? ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', resolved]
    : ['-i', resolved, '-f', 'null', '-'];
  const fileSize = fs.statSync(resolved).size;

  return new Promise((resolve, reject) => {
    execFile(probeBin, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      if (isProbe && !err) {
        try {
          const data = JSON.parse(stdout);
          const vs = data.streams?.find(s => s.codec_type === 'video') || {};
          const fmt = data.format || {};
          resolve({
            width: vs.width || 0,
            height: vs.height || 0,
            fps: vs.r_frame_rate ? eval(vs.r_frame_rate) : 0,
            codec: vs.codec_name || 'unknown',
            bitrate: Math.round((fmt.bit_rate || 0) / 1000),
            duration: parseFloat(fmt.duration || 0),
            fileSize,
          });
        } catch { resolve({ width: 0, height: 0, fps: 0, codec: 'unknown', bitrate: 0, duration: 0, fileSize }); }
      } else {
        // Parse ffmpeg -i stderr output
        const all = (stderr || '') + (stdout || '');
        const resMatch = all.match(/(\d{2,5})x(\d{2,5})/);
        const fpsMatch = all.match(/([\d.]+)\s*fps/);
        const codecMatch = all.match(/Video:\s*(\w+)/);
        const brMatch = all.match(/bitrate:\s*(\d+)\s*kb/);
        const durMatch = all.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        resolve({
          width: resMatch ? parseInt(resMatch[1]) : 0,
          height: resMatch ? parseInt(resMatch[2]) : 0,
          fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
          codec: codecMatch ? codecMatch[1] : 'unknown',
          bitrate: brMatch ? parseInt(brMatch[1]) : 0,
          duration: durMatch ? parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]) : 0,
          fileSize,
        });
      }
    });
  });
});

// ── Get Audio Info (FFprobe) ──────────────────────────────────────────
ipcMain.handle('get-audio-info', async (_, { filePath }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  // Try ffprobe first (system), fall back to bundled ffmpeg
  const probeBin = (() => {
    const ffprobeCandidates = [
      '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe',
    ];
    for (const c of ffprobeCandidates) {
      try { if (fs.existsSync(c)) return c; } catch { }
    }
    return getFfmpegBin(); // fallback to bundled ffmpeg
  })();

  const isProbe = probeBin.includes('ffprobe');
  const args = isProbe
    ? ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', resolved]
    : ['-i', resolved, '-f', 'null', '-'];

  return new Promise((resolve, reject) => {
    execFile(probeBin, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      const stat = fs.statSync(resolved);
      const fileSize = stat.size;

      if (isProbe && !err) {
        try {
          const data = JSON.parse(stdout);
          const as = data.streams?.find(s => s.codec_type === 'audio') || {};
          const fmt = data.format || {};
          resolve({
            codec: as.codec_name || 'unknown',
            sampleRate: Number(as.sample_rate || 0),
            channels: as.channels || 0,
            bitrate: Math.round((fmt.bit_rate || 0) / 1000),
            duration: parseFloat(fmt.duration || 0),
            fileSize,
          });
        } catch { resolve({ codec: 'unknown', sampleRate: 0, channels: 0, bitrate: 0, duration: 0, fileSize }); }
      } else {
        // Parse ffmpeg -i stderr output
        const all = (stderr || '') + (stdout || '');
        const codecMatch = all.match(/Audio:\s*(\w+)/);
        const rateMatch = all.match(/(\d+)\s*Hz/);
        const chMatch = all.match(/Hz,\s*(mono|stereo|[\d.]+ channels)/);
        const brMatch = all.match(/bitrate:\s*(\d+)\s*kb/);
        const durMatch = all.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        resolve({
          codec: codecMatch ? codecMatch[1] : 'unknown',
          sampleRate: rateMatch ? parseInt(rateMatch[1]) : 0,
          channels: chMatch ? (chMatch[1] === 'mono' ? 1 : chMatch[1] === 'stereo' ? 2 : parseInt(chMatch[1])) : 0,
          bitrate: brMatch ? parseInt(brMatch[1]) : 0,
          duration: durMatch ? parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]) : 0,
          fileSize,
        });
      }
    });
  });
});

// ── Select SRT File ───────────────────────────────────────────────────
ipcMain.handle('select-srt-file', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: 'Chọn file phụ đề SRT',
    filters: [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa', 'vtt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return pathToFileURL(result.filePaths[0]).toString();
});

// ── Select Audio File (for BGM) ───────────────────────────────────────
ipcMain.handle('select-audio-file', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: 'Chọn nhạc nền',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return pathToFileURL(result.filePaths[0]).toString();
});

// Audio Node upload: keep the existing path-only picker above for video tools,
// while this dedicated picker returns bytes + metadata for the shared CDN.
async function readAudioFilePayload(filePath) {
  const stats = await fs.promises.stat(filePath);
  const maxBytes = 8 * 1024 * 1024;
  if (stats.size > maxBytes) throw new Error('File audio vượt quá 8 MB.');
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = ({
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  })[extension] || 'application/octet-stream';
  const duration = await new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile(getFfmpegBin(), ['-i', filePath, '-f', 'null', '-'], { timeout: 10_000 }, (_err, stdout, stderr) => {
      const match = `${stderr || ''}${stdout || ''}`.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return resolve(0);
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
  });
  return {
    fileName: path.basename(filePath),
    mimeType,
    size: stats.size,
    duration,
    data: (await fs.promises.readFile(filePath)).toString('base64'),
  };
}

ipcMain.handle('select-audio-upload-file', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: 'Chọn file audio',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return readAudioFilePayload(result.filePaths[0]);
});

// Reads a known local audio file (e.g. output of trim-audio) as bytes + metadata
// for the shared CDN, without opening a picker dialog.
ipcMain.handle('read-local-audio-file', async (_, { filePath }) => {
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);
  return readAudioFilePayload(resolved);
});

// ── Select Output Folder ──────────────────────────────────────────────
ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Chọn thư mục lưu',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ── Show file in Finder ───────────────────────────────────────────────
ipcMain.handle('show-in-folder', async (_, filePath) => {
  const { shell } = require('electron');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  shell.showItemInFolder(resolved);
});

// ── Open URL in default browser ───────────────────────────────────────
ipcMain.handle('open-external-url', async (_, url) => {
  await shell.openExternal(url);
});

};
