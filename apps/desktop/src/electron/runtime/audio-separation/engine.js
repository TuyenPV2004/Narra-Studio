'use strict';

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_AUDIO_SEPARATION_MODEL,
} = require('./models');
const {
  ensureAudioSeparationModel,
} = require('./model-manager');

const MAX_INPUT_SECONDS = 8 * 60;

function cancelledError() {
  const error = new Error('Đã huỷ tách giọng nói khỏi video.');
  error.code = 'AUDIO_SEPARATION_CANCELLED';
  return error;
}

function sanitizeOperationId(value) {
  const normalized = String(value || `audio-separation-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  return normalized || `audio-separation-${Date.now()}`;
}

function createAudioSeparationEngine({
  cacheDir,
  workerPath = path.join(__dirname, '../../audio-separation-worker.js'),
  fetchImpl = global.fetch,
  fsImpl = fs,
  forkImpl = fork,
  model = DEFAULT_AUDIO_SEPARATION_MODEL,
} = {}) {
  if (!cacheDir) throw new Error('Audio separation model cache directory is required.');
  const active = new Map();
  let queue = Promise.resolve();

  function cancel(operationId) {
    const state = active.get(sanitizeOperationId(operationId));
    if (!state) return false;
    state.cancelled = true;
    state.controller.abort();
    if (state.worker && !state.worker.killed) state.worker.kill();
    return true;
  }

  async function runWorker({
    operationId,
    modelPath,
    inputPcmPath,
    vocalsPcmPath,
    accompanimentPcmPath,
    threadCount,
    state,
    onProgress,
  }) {
    if (state.cancelled) throw cancelledError();
    const worker = forkImpl(workerPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    state.worker = worker;
    return new Promise((resolve, reject) => {
      let settled = false;
      let stderr = '';
      worker.stderr?.on?.('data', chunk => {
        stderr += chunk.toString();
        if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
      });
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        state.worker = null;
        worker.removeAllListeners();
        if (!worker.killed) worker.kill();
        if (error) reject(error);
        else resolve(result);
      };
      worker.on('message', message => {
        if (message?.operationId !== operationId) return;
        if (message.type === 'stage') onProgress?.({ stage: message.stage });
        if (message.type === 'progress') {
          onProgress?.({
            stage: 'separating',
            fraction: message.fraction,
            currentSegment: message.currentSegment,
            totalSegments: message.totalSegments,
          });
        }
        if (message.type === 'done') finish(null, message);
        if (message.type === 'error') finish(new Error(message.error || 'Audio separation worker failed.'));
      });
      worker.on('error', error => finish(state.cancelled ? cancelledError() : error));
      worker.on('exit', (code, signal) => {
        if (settled) return;
        if (state.cancelled) finish(cancelledError());
        else {
          const detail = stderr.trim();
          finish(new Error(
            `Audio separation worker stopped (${signal || code}).${detail ? `\n${detail}` : ''}`,
          ));
        }
      });
      worker.send({
        type: 'separate',
        operationId,
        modelPath,
        inputPcmPath,
        vocalsPcmPath,
        accompanimentPcmPath,
        threadCount,
      });
    });
  }

  function separatePcm({
    operationId: requestedId,
    inputPcmPath,
    outputDir,
    threadCount = 2,
    onProgress,
  }) {
    const operationId = sanitizeOperationId(requestedId);
    if (active.has(operationId)) throw new Error('This audio separation operation is already active.');
    if (!inputPcmPath || !outputDir) throw new Error('Audio separation input and output paths are required.');
    const state = { cancelled: false, controller: new AbortController(), worker: null };
    active.set(operationId, state);

    const run = async () => {
      if (state.cancelled) throw cancelledError();
      const stat = await fsImpl.promises.stat(inputPcmPath);
      if (!stat.isFile() || stat.size % 8 !== 0) throw new Error('Audio separation input is not stereo float32 PCM.');
      const sampleCount = stat.size / 8;
      if (sampleCount > model.sampleRate * MAX_INPUT_SECONDS) {
        throw new Error(`Audio separation is limited to ${MAX_INPUT_SECONDS / 60} minutes per operation.`);
      }
      await fsImpl.promises.mkdir(outputDir, { recursive: true });
      const vocalsPcmPath = path.join(outputDir, `${operationId}-vocals.f32le`);
      const accompanimentPcmPath = path.join(outputDir, `${operationId}-accompaniment.f32le`);
      onProgress?.({ stage: 'downloading-model', fraction: 0 });
      const modelPath = await ensureAudioSeparationModel({
        cacheDir,
        model,
        fetchImpl,
        fsImpl,
        signal: state.controller.signal,
        onProgress: progress => onProgress?.({
          stage: 'downloading-model',
          fraction: progress.fraction,
          cached: progress.cached,
        }),
      });
      const result = await runWorker({
        operationId,
        modelPath,
        inputPcmPath,
        vocalsPcmPath,
        accompanimentPcmPath,
        threadCount,
        state,
        onProgress,
      });
      return {
        operationId,
        modelId: model.id,
        sampleRate: model.sampleRate,
        sampleCount,
        vocalsPcmPath,
        accompanimentPcmPath,
        gain: result.gain,
      };
    };

    const promise = queue.then(run, run).finally(() => active.delete(operationId));
    queue = promise.catch(() => {});
    return { operationId, promise, cancel: () => cancel(operationId) };
  }

  return {
    cancel,
    separatePcm,
  };
}

module.exports = {
  MAX_INPUT_SECONDS,
  createAudioSeparationEngine,
  sanitizeOperationId,
};
