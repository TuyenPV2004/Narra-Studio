const { parentPort } = require('worker_threads')

process.env.ORT_LOGGING_LEVEL = '3'

let _pipe = null
let _modelName = null
let _readyPromise = null

async function loadPipeline(modelName, cacheDir) {
  if (_pipe && _modelName === modelName) return _pipe
  if (_readyPromise) return _readyPromise

  _readyPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    env.allowRemoteModels = true
    env.cacheDir = cacheDir

    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = Math.min(4, require('os').cpus().length)
    }

    const pipe = await pipeline('automatic-speech-recognition', modelName, {
      quantized: true,
      progress_callback: (p) => {
        parentPort.postMessage({ type: 'progress', payload: p })
      },
    })
    _pipe = pipe
    _modelName = modelName
    parentPort.postMessage({ type: 'ready' })
    return pipe
  })()
  return _readyPromise
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'transcribe') {
      const pipe = await loadPipeline(msg.modelName, msg.cacheDir)
      const result = await pipe(msg.samples, {
        language: msg.language && msg.language !== 'auto' ? msg.language : null,
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      })
      parentPort.postMessage({
        type: 'result',
        payload: { chunks: result.chunks || [], text: result.text || '' },
      })
    } else if (msg.type === 'preload') {
      await loadPipeline(msg.modelName, msg.cacheDir)
    }
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      payload: err && err.message ? err.message : String(err),
    })
  }
})
