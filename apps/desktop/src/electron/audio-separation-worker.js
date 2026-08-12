'use strict';

process.env.ORT_LOGGING_LEVEL = '3';

const fs = require('fs');
const {
  deinterleaveStereo,
  normalizeStereoTracksTogether,
  sumStereoTracks,
  writeInterleavedStereo,
} = require('./runtime/audio-separation/pcm');

function send(message) {
  if (process.parentPort) process.parentPort.postMessage(message);
  else if (process.send) process.send(message);
}

async function separate(message) {
  // Electron's executable installs Chromium's allocator even with
  // ELECTRON_RUN_AS_NODE. Large Demucs Conv allocations in onnxruntime-node
  // can therefore terminate the child with SIGTRAP on macOS. The WASM runtime
  // is process-isolated, cross-platform and is the runtime demucs-web targets.
  const ort = require('onnxruntime-web');
  const { DemucsProcessor } = await import('demucs-web');
  const pcm = deinterleaveStereo(await fs.promises.readFile(message.inputPcmPath));
  const threadCount = Math.max(1, Math.min(4, Math.floor(Number(message.threadCount) || 2)));
  ort.env.wasm.numThreads = threadCount;
  ort.env.wasm.proxy = false;
  const sessionOptions = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  };
  const processor = new DemucsProcessor({
    ort,
    sessionOptions,
    onProgress: progress => {
      const rawFraction = Number(progress?.progress);
      const currentSegment = Math.max(1, Math.floor(Number(progress?.currentSegment) || 1));
      const totalSegments = Math.max(currentSegment, Math.floor(Number(progress?.totalSegments) || 1));
      send({
        type: 'progress',
        operationId: message.operationId,
        fraction: Number.isFinite(rawFraction) ? Math.max(0, Math.min(1, rawFraction)) : currentSegment / totalSegments,
        currentSegment,
        totalSegments,
      });
    },
  });
  try {
    send({ type: 'stage', operationId: message.operationId, stage: 'loading-model' });
    // demucs-web's public loadModel fetches the entire model into a JS buffer.
    // onnxruntime-node accepts a local path directly and avoids that 180 MB copy.
    const modelSource = new Uint8Array(await fs.promises.readFile(message.modelPath));
    processor.session = await ort.InferenceSession.create(modelSource, sessionOptions);
    send({ type: 'stage', operationId: message.operationId, stage: 'separating' });
    const stems = await processor.separate(pcm.left, pcm.right);
    if (!stems?.drums || !stems?.bass || !stems?.other || !stems?.vocals) {
      throw new Error('Demucs returned an unexpected stem layout.');
    }
    const accompaniment = sumStereoTracks([stems.drums, stems.bass, stems.other]);
    const vocals = stems.vocals;
    const normalized = normalizeStereoTracksTogether([vocals, accompaniment]);
    await Promise.all([
      writeInterleavedStereo(message.vocalsPcmPath, vocals),
      writeInterleavedStereo(message.accompanimentPcmPath, accompaniment),
    ]);
    send({
      type: 'done',
      operationId: message.operationId,
      sampleCount: pcm.left.length,
      gain: normalized.gain,
    });
  } finally {
    await processor.session?.release?.();
  }
}

const messagePort = process.parentPort || process;
messagePort.on('message', incoming => {
  const message = incoming?.data || incoming;
  if (message?.type !== 'separate') return;
  separate(message).catch(error => {
    send({
      type: 'error',
      operationId: message.operationId,
      error: error?.message || String(error),
    });
  });
});
