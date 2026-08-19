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
  resolveLocalFilePath,
  getAllowedMediaDirectories,
  isPathInsideRealDirectory,
  validateMediaDeleteTarget,
};
