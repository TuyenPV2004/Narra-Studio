'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const AUTHORIZED_LOCAL_FILE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_AUTHORIZED_LOCAL_FILES = 256;
const authorizedLocalFilePaths = new Map();

function resolveLocalPathString(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) return '';
  let resolvedPath = inputPath.trim();
  try {
    if (resolvedPath.startsWith('file://')) resolvedPath = fileURLToPath(resolvedPath);
  } catch {
    resolvedPath = resolvedPath.replace(/^file:[/\\]{2,3}/, '');
    resolvedPath = decodeURIComponent(resolvedPath);
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(resolvedPath)) {
      resolvedPath = resolvedPath.slice(1);
    }
  }
  if (resolvedPath.includes('%')) {
    try { resolvedPath = decodeURIComponent(resolvedPath); } catch {}
  }
  return path.normalize(resolvedPath);
}

function capabilityKey(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function grantLocalFileCapability(inputPath) {
  const target = resolveLocalPathString(inputPath);
  if (!target) return '';
  const canonicalPath = fs.realpathSync(target);
  if (!fs.statSync(canonicalPath).isFile()) return '';
  const key = capabilityKey(canonicalPath);
  authorizedLocalFilePaths.delete(key);
  authorizedLocalFilePaths.set(key, Date.now() + AUTHORIZED_LOCAL_FILE_TTL_MS);
  while (authorizedLocalFilePaths.size > MAX_AUTHORIZED_LOCAL_FILES) {
    authorizedLocalFilePaths.delete(authorizedLocalFilePaths.keys().next().value);
  }
  return canonicalPath;
}

function hasLocalFileCapability(inputPath) {
  const target = resolveLocalPathString(inputPath);
  if (!target) return false;
  let canonicalPath;
  try { canonicalPath = fs.realpathSync(target); } catch { return false; }
  const key = capabilityKey(canonicalPath);
  const expiresAt = authorizedLocalFilePaths.get(key);
  if (!expiresAt || expiresAt <= Date.now()) {
    authorizedLocalFilePaths.delete(key);
    return false;
  }
  authorizedLocalFilePaths.set(key, Date.now() + AUTHORIZED_LOCAL_FILE_TTL_MS);
  return true;
}

module.exports = {
  grantLocalFileCapability,
  hasLocalFileCapability,
  resolveLocalPathString,
};
