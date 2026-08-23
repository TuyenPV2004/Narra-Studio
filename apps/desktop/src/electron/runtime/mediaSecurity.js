'use strict';

const nativePath = require('node:path');
const nativeFs = require('node:fs');
const { fileURLToPath: nativeFileURLToPath } = require('node:url');

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg', '.heic', '.avif',
  // Videos
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.flv', '.wmv', '.3gp',
  // Audios
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus',
]);

function isValidImageBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
  return buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
}

function isAllowedGoogleMediaHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const lower = hostname.toLowerCase();
  return lower === 'labs.google' ||
    lower === 'flow-content.google' ||
    lower === 'aisandbox-pa.googleapis.com' ||
    lower === 'storage.googleapis.com' ||
    lower.endsWith('.google') ||
    lower.endsWith('.labs.google') ||
    lower.endsWith('.googleusercontent.com') ||
    lower.endsWith('.googleapis.com') ||
    lower.endsWith('.ggpht.com');
}

function validateGoogleMediaUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('URL media không hợp lệ.');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Định dạng URL media không hợp lệ.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Chỉ chấp nhận URL media dùng HTTPS.');
  }
  if (!isAllowedGoogleMediaHost(parsed.hostname)) {
    throw new Error(`Host media không được phép: ${parsed.hostname}`);
  }
  return parsed;
}

function resolveLocalFilePath(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') return '';
  const fileURLToPath = options.fileURLToPath || nativeFileURLToPath;
  const path = options.path || nativePath;

  if (filePath.startsWith('file:')) {
    try {
      return fileURLToPath(filePath);
    } catch {}
  }
  let decoded = filePath;
  try {
    decoded = decodeURIComponent(filePath);
  } catch {}
  decoded = decoded.replace(/^file:[/\\]{2,3}/, '').replace(/^\/([A-Za-z]:)/, '$1');
  return path.normalize(decoded);
}

function getAllowedMediaDirectories(context = {}) {
  const path = context.path || nativePath;
  const { getImageOutputDir, getVideoOutputDir, loadSettings, app } = context;
  const allowed = [];

  try {
    if (typeof getImageOutputDir === 'function') allowed.push(path.resolve(getImageOutputDir()));
  } catch {}
  try {
    if (typeof getVideoOutputDir === 'function') allowed.push(path.resolve(getVideoOutputDir()));
  } catch {}
  try {
    if (typeof loadSettings === 'function') {
      const settings = loadSettings() || {};
      if (settings.imageOutputPath) allowed.push(path.resolve(settings.imageOutputPath));
      if (settings.videoOutputPath) allowed.push(path.resolve(settings.videoOutputPath));
    }
  } catch {}
  try {
    if (app && typeof app.getPath === 'function') {
      const userData = app.getPath('userData');
      allowed.push(path.resolve(path.join(userData, 'images')));
      allowed.push(path.resolve(path.join(userData, 'videos')));
    }
  } catch {}

  return [...new Set(allowed.filter(Boolean))];
}

function isPathInsideRealDirectory(targetPath, parentDir, options = {}) {
  if (!targetPath || !parentDir) return false;
  const path = options.path || nativePath;
  const fs = options.fs || nativeFs;

  let realTarget;
  try {
    realTarget = fs.realpathSync(targetPath);
  } catch {
    realTarget = path.resolve(targetPath);
  }

  let realParent;
  try {
    realParent = fs.realpathSync(parentDir);
  } catch {
    realParent = path.resolve(parentDir);
  }

  if (path.resolve(realTarget).toLowerCase() === path.resolve(realParent).toLowerCase()) {
    return true;
  }

  const relative = path.relative(realParent, realTarget);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function validateMediaDeleteTarget(filePath, context = {}) {
  const path = context.path || nativePath;
  const fs = context.fs || nativeFs;

  const resolved = resolveLocalFilePath(filePath, context);
  if (!resolved) {
    return { valid: false, reason: 'Invalid or empty file path.' };
  }

  const normalizedPath = path.resolve(resolved);
  const ext = path.extname(normalizedPath).toLowerCase();
  if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `Disallowed media extension: "${ext}".` };
  }

  const allowedDirs = getAllowedMediaDirectories(context);
  const isAllowed = allowedDirs.some(dir => isPathInsideRealDirectory(normalizedPath, dir, context));
  if (!isAllowed) {
    return { valid: false, reason: `Path "${normalizedPath}" is outside allowed media directories.` };
  }

  if (!fs.existsSync(normalizedPath)) {
    return { valid: false, reason: `Target file does not exist: "${normalizedPath}".` };
  }

  return { valid: true, resolvedPath: normalizedPath };
}

module.exports = {
  ALLOWED_MEDIA_EXTENSIONS,
  isAllowedGoogleMediaHost,
  isValidImageBuffer,
  validateGoogleMediaUrl,
  resolveLocalFilePath,
  getAllowedMediaDirectories,
  isPathInsideRealDirectory,
  validateMediaDeleteTarget,
};
