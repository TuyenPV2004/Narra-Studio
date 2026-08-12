'use strict';

const { parentPort } = require('worker_threads');

process.env.ORT_LOGGING_LEVEL = '3';
const depthThreadCount = Math.max(1, Math.min(4, Math.floor(Number(process.env.GENYU_DEPTH_THREADS) || 2)));

const sendMessage = message => {
  if (parentPort) parentPort.postMessage(message);
  else if (process.send) process.send(message);
};

const receiveMessage = handler => {
  if (parentPort) parentPort.on('message', handler);
  else process.on('message', handler);
};

let depthPipeline;
let loadedModel;

async function getDepthPipeline(modelName, cacheDir) {
  if (depthPipeline && loadedModel === modelName) return depthPipeline;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.cacheDir = cacheDir;
  if (env.backends?.onnx?.wasm) {
    // This is a background Canvas tool: reserve the machine for renderer input,
    // pan/zoom, and other app work even if inference takes longer.
    env.backends.onnx.wasm.numThreads = depthThreadCount;
  }
  const sessionOptions = {
    executionMode: 'sequential',
    intraOpNumThreads: depthThreadCount,
    interOpNumThreads: 1,
  };
  const preferCoreMl = process.platform === 'darwin'
    && process.arch === 'arm64'
    && process.env.GENYU_DEPTH_COREML !== '0';
  if (preferCoreMl) {
    const requestedCoreMlFlags = Math.max(0, Math.floor(Number(process.env.GENYU_DEPTH_COREML_FLAGS) || 0));
    sessionOptions.executionProviders = [
      { name: 'coreml', coreMlFlags: requestedCoreMlFlags },
      'cpu',
    ];
  }
  const pipelineOptions = {
    dtype: 'q8',
    session_options: sessionOptions,
    progress_callback: payload => sendMessage({ type: 'model-progress', payload }),
  };
  try {
    depthPipeline = await pipeline('depth-estimation', modelName, pipelineOptions);
  } catch (error) {
    if (!preferCoreMl) throw error;
    sendMessage({
      type: 'backend-fallback',
      backend: 'cpu',
      reason: error?.message || String(error),
    });
    delete sessionOptions.executionProviders;
    depthPipeline = await pipeline('depth-estimation', modelName, pipelineOptions);
  }
  loadedModel = modelName;
  return depthPipeline;
}

receiveMessage(async message => {
  if (message.type !== 'process') return;
  try {
    const pipe = await getDepthPipeline(message.modelName, message.cacheDir);
    sendMessage({ type: 'ready' });
    for (let index = 0; index < message.inputFrames.length; index += 1) {
      let result;
      try {
        result = await pipe(message.inputFrames[index]);
        await result.depth.save(message.outputFrames[index]);
      } finally {
        // Transformers.js returns both the rendered RawImage and the backing
        // ONNX Tensor. The tensor owns native memory and is not reclaimed by
        // ordinary JS GC between video frames, so long clips otherwise grow
        // until macOS/Windows kills the worker with a null exit code.
        if (typeof result?.predicted_depth?.dispose === 'function') {
          await result.predicted_depth.dispose();
        }
        result = null;
        // RawImage output buffers are ordinary JavaScript/native-backed memory.
        // Give the isolated worker a bounded collection point on long videos so
        // low-memory Macs do not accumulate several decoded/output frames.
        if (typeof global.gc === 'function' && (index + 1) % 8 === 0) {
          global.gc();
        }
      }
      sendMessage({
        type: 'frame',
        index: index + 1,
        total: message.inputFrames.length,
      });
    }
    sendMessage({ type: 'done' });
  } catch (error) {
    sendMessage({
      type: 'error',
      error: error && error.message ? error.message : String(error),
    });
  }
});
