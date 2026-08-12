// ─────────────────────────────────────────────────────────────────────
// Whisper inference worker
//
// Runs the Hugging Face Transformers ASR pipeline in a Node worker_thread so
// it doesn't block the Electron main process (which would freeze the UI
// for the duration of the 5-30s inference).
//
// Protocol:
//   parent → worker:
//     { type: 'transcribe', samples: Float32Array, language?, modelName, cacheDir }
//   worker → parent:
//     { type: 'progress', payload: { status, file?, progress? } }
//     { type: 'ready' }
//     { type: 'result', payload: { chunks, text } }
//     { type: 'error',  payload: string }
// ─────────────────────────────────────────────────────────────────────

const { parentPort } = require('worker_threads')

// Suppress noisy ONNX Runtime "Removing initializer" warnings
process.env.ORT_LOGGING_LEVEL = '3' // 0=verbose 1=info 2=warning 3=error 4=fatal

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
    // Less ORT log noise + use available cores
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
