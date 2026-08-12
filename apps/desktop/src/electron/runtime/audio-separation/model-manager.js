'use strict';

const { once } = require('events');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const pendingDownloads = new Map();

function cancellationError() {
  const error = new Error('Audio separation model download cancelled.');
  error.code = 'AUDIO_SEPARATION_CANCELLED';
  return error;
}

function assertActive(signal) {
  if (signal?.aborted) throw cancellationError();
}

async function hashFile(filePath, fsImpl = fs) {
  const hash = createHash('sha256');
  const stream = fsImpl.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyModelFile(filePath, model, fsImpl = fs) {
  let stat;
  try {
    stat = await fsImpl.promises.stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.size !== model.size) return false;
  return (await hashFile(filePath, fsImpl)) === model.sha256;
}

async function removeIfExists(filePath, fsImpl) {
  try {
    await fsImpl.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function downloadAndVerify({
  model,
  modelPath,
  fetchImpl,
  fsImpl,
  signal,
  onProgress,
}) {
  assertActive(signal);
  const partialPath = `${modelPath}.partial-${process.pid}-${Date.now()}`;
  let file;
  try {
    const response = await fetchImpl(model.url, { redirect: 'follow', signal });
    if (!response.ok || !response.body) {
      throw new Error(`Model download failed with HTTP ${response.status}.`);
    }
    file = fsImpl.createWriteStream(partialPath, { flags: 'wx' });
    const hash = createHash('sha256');
    let received = 0;
    for await (const value of response.body) {
      assertActive(signal);
      const chunk = Buffer.from(value);
      received += chunk.length;
      if (received > model.size) throw new Error('Downloaded model is larger than its manifest.');
      hash.update(chunk);
      if (!file.write(chunk)) await once(file, 'drain');
      onProgress?.({ received, total: model.size, fraction: received / model.size });
    }
    file.end();
    await once(file, 'close');
    file = null;
    assertActive(signal);
    if (received !== model.size || hash.digest('hex') !== model.sha256) {
      throw new Error('Downloaded audio separation model failed checksum verification.');
    }
    await removeIfExists(modelPath, fsImpl);
    await fsImpl.promises.rename(partialPath, modelPath);
    return modelPath;
  } catch (error) {
    file?.destroy();
    await removeIfExists(partialPath, fsImpl);
    if (signal?.aborted || error?.name === 'AbortError') throw cancellationError();
    throw error;
  }
}

async function ensureAudioSeparationModel({
  cacheDir,
  model,
  fetchImpl = global.fetch,
  fsImpl = fs,
  pathImpl = path,
  signal,
  onProgress,
}) {
  if (!cacheDir || !model?.id || !model?.fileName || !model?.sha256 || !model?.size) {
    throw new Error('Invalid audio separation model manifest.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('This runtime cannot download audio separation models.');
  await fsImpl.promises.mkdir(cacheDir, { recursive: true });
  const modelPath = pathImpl.join(cacheDir, model.fileName);
  assertActive(signal);
  if (await verifyModelFile(modelPath, model, fsImpl)) {
    onProgress?.({ received: model.size, total: model.size, fraction: 1, cached: true });
    return modelPath;
  }
  await removeIfExists(modelPath, fsImpl);

  // One writer per model cache entry. Callers still get deterministic
  // checksum verification instead of competing over partial files.
  const key = pathImpl.resolve(modelPath);
  let pending = pendingDownloads.get(key);
  if (!pending) {
    pending = downloadAndVerify({
      model,
      modelPath,
      fetchImpl,
      fsImpl,
      signal,
      onProgress,
    }).finally(() => pendingDownloads.delete(key));
    pendingDownloads.set(key, pending);
  }
  const resolvedPath = await pending;
  assertActive(signal);
  return resolvedPath;
}

module.exports = {
  ensureAudioSeparationModel,
  hashFile,
  verifyModelFile,
};
