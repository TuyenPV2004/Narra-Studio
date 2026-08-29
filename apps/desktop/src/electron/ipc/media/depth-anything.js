'use strict';

const { execFile, fork } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { brand } = require('../../runtime/brand');

const MODEL_NAMES = Object.freeze({
  small: 'onnx-community/depth-anything-v2-small',
  base: 'onnx-community/depth-anything-v2-base',
  large: 'onnx-community/depth-anything-v2-large',
});
const OUTPUT_STYLES = new Set(['grayscale', 'heatmap', 'side-by-side']);
const PROCESSING_FPS = new Set(['source', 6, 12, 24]);
const DEPTH_FRAME_SCALE_FILTER = "scale=w='if(gte(iw,ih),min(1280,iw),-2)':h='if(gte(iw,ih),-2,min(1280,ih))'";
const activeJobs = new Map();
let depthQueue = Promise.resolve();

function isDepthWorkerMemoryExit(error) {
  return /bị hệ thống dừng|dừng với mã null|SIGKILL|SIGABRT|out of memory|allocation failed/i
    .test(String(error?.message || error || ''));
}

function normalizeDepthRuntimeError(error) {
  const message = String(error?.message || error || '');
  if (
    /cannot find package ['"]?@huggingface\/transformers/i.test(message)
    || /cannot find module ['"]?@huggingface\/transformers/i.test(message)
    || /cannot find module ['"]?(?:onnxruntime-node|sharp)/i.test(message)
    || /onnxruntime_binding|libonnxruntime|sharp.*(?:\.node|dylib|dll|\.so)/i.test(message)
  ) {
    return new Error(
      `Bản cài đặt ${brand.displayName} đang thiếu bộ xử lý video độ sâu. `
      + `Vui lòng cập nhật hoặc cài lại ${brand.displayName} phiên bản mới nhất, rồi thử lại.`,
    );
  }
  if (/bị hệ thống dừng|dừng với mã null|SIGKILL|out of memory|allocation failed/i.test(message)) {
    return new Error(
      `Máy vẫn không đủ bộ nhớ sau khi ${brand.displayName} đã tự chuyển sang chế độ nhẹ hơn. `
      + 'Hãy đóng bớt ứng dụng đang mở hoặc giảm Độ mượt, rồi thử lại.',
    );
  }
  return error instanceof Error ? error : new Error(message || 'Không thể chạy bộ xử lý video độ sâu.');
}

function execFfmpeg(ffmpegBin, args, timeout = 0) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBin, args, {
      timeout: timeout || undefined,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || 'FFmpeg failed').slice(-1200)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseVideoFps(stderr) {
  const match = String(stderr || '').match(/,\s*(\d+(?:\.\d+)?)\s*fps(?:,|$)/i);
  const fps = match ? Number(match[1]) : 24;
  return Number.isFinite(fps) && fps > 0 ? Math.min(60, fps) : 24;
}

function sanitizeJobId(value) {
  return String(value || `depth-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function remoteMediaExtension(source, inputKind, path) {
  try {
    const extension = path.extname(new URL(source).pathname).toLowerCase();
    const allowed = inputKind === 'image'
      ? new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])
      : new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
    if (allowed.has(extension)) return extension;
  } catch {  }
  return inputKind === 'image' ? '.jpg' : '.mp4';
}

async function downloadRemoteMedia({ source, tempDir, inputKind, path, fs, fetchImpl, state }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error(`Không thể tải nội dung đầu vào trên máy này. Vui lòng cập nhật ${brand.displayName} rồi thử lại.`);
  }
  const controller = new AbortController();
  state.abortController = controller;
  const localPath = path.join(tempDir, `remote-input${remoteMediaExtension(source, inputKind, path)}`);
  try {
    const response = await fetchImpl(source, { redirect: 'follow', signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(localPath));
    return localPath;
  } catch (error) {
    if (state.cancelled || error?.name === 'AbortError') throw new Error('DEPTH_CANCELLED');

    throw new Error(
      `Không thể tải ${inputKind === 'image' ? 'hình ảnh' : 'video'} đầu vào từ kho lưu trữ. `
      + 'Hãy tải lại Canvas hoặc tạo lại liên kết nguồn rồi thử lại.',
    );
  } finally {
    if (state.abortController === controller) state.abortController = null;
  }
}

function buildEncodingArgs({ fps, inputDir, outputDir, outputPath, outputStyle }) {
  const commonOutput = [
    '-filter_threads', '1',
    '-c:v', 'libx264',
    '-threads', '1',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ];
  if (outputStyle === 'side-by-side') {
    return [
      '-y',
      '-framerate', String(fps),
      '-i', pathForSequence(inputDir, 'jpg'),
      '-framerate', String(fps),
      '-i', pathForSequence(outputDir, 'png'),
      '-filter_complex',
      "[0:v]scale=w='min(960,iw)':h=-2,setsar=1,format=yuv420p[left];"
        + "[1:v]scale=w='min(960,iw)':h=-2,setsar=1,format=yuv420p[right];"
        + '[left][right]hstack=inputs=2[out]',
      '-map', '[out]',
      ...commonOutput,
    ];
  }
  const videoFilter = outputStyle === 'heatmap'
    ? 'format=yuv444p,pseudocolor=preset=turbo,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p'
    : 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p';
  return [
    '-y',
    '-framerate', String(fps),
    '-i', pathForSequence(outputDir, 'png'),
    '-vf', videoFilter,
    ...commonOutput,
  ];
}

function pathForSequence(directory, extension) {
  return require('path').join(directory, `frame-%08d.${extension}`);
}

module.exports = function registerDepthAnythingIpc(dependencies) {
  const {
    app,
    ipcMain,
    path,
    fs,
    os,
    pathToFileURL,
    fileURLToPath,
    fetchImpl = global.fetch,
    getFfmpegBin,
    getImageOutputDir,
    getVideoOutputDir,
  } = dependencies;

  ipcMain.handle('depth-anything-cancel', async (_event, payload = {}) => {
    const job = activeJobs.get(sanitizeJobId(payload.jobId));
    if (!job) return { cancelled: false };
    job.cancelled = true;
    job.abortController?.abort();
    if (job.worker && !job.worker.killed) job.worker.kill();
    return { cancelled: true };
  });

  ipcMain.handle('depth-anything-video', async (event, payload = {}) => {
    const source = String(payload.source || '').trim();
    if (!source) throw new Error('Depth Anything cần một Video Node đầu vào.');
    const outputStyle = OUTPUT_STYLES.has(payload.outputStyle) ? payload.outputStyle : 'grayscale';
    const inputKind = payload.inputKind === 'image' ? 'image' : 'video';
    const modelSize = Object.hasOwn(MODEL_NAMES, payload.modelSize) ? payload.modelSize : 'small';
    const modelName = MODEL_NAMES[modelSize];
    const requestedFpsValue = payload.processingFps === 'source' ? 'source' : Number(payload.processingFps);
    const processingFps = PROCESSING_FPS.has(requestedFpsValue) ? requestedFpsValue : 'source';
    const jobId = sanitizeJobId(payload.jobId);
    if (activeJobs.has(jobId)) throw new Error('Depth job này đang chạy.');
    const state = { cancelled: false, worker: null, abortController: null };
    activeJobs.set(jobId, state);

    const run = async () => {
      if (state.cancelled) {
        activeJobs.delete(jobId);
        throw new Error('Đã hủy xử lý Depth Anything V2.');
      }
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `genyu-depth-${jobId}-`));
      const inputDir = path.join(tempDir, 'input');
      const outputDir = path.join(tempDir, 'depth');
      fs.mkdirSync(inputDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });
      let lastProgressEmitAt = 0;
      const emit = progress => {
        try { event.sender.send('depth-anything-progress', { jobId, ...progress }); } catch {  }
      };
      const emitThrottled = (progress, force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressEmitAt < 500) return;
        lastProgressEmitAt = now;
        emit(progress);
      };

      try {
        let resolvedSource = source.startsWith('file://') ? fileURLToPath(source) : source;
        if (/^https?:\/\//i.test(resolvedSource)) {
          resolvedSource = await downloadRemoteMedia({
            source: resolvedSource,
            tempDir,
            inputKind,
            path,
            fs,
            fetchImpl,
            state,
          });
        }
        if (!fs.existsSync(resolvedSource)) {
          throw new Error(`Video nguồn không tồn tại: ${resolvedSource}`);
        }

        emit({ stage: 'extracting', progress: 2 });
        let sourceFps = 0;
        let fps = 0;
        if (inputKind === 'image') {
          await execFfmpeg(getFfmpegBin(), [
            '-y',
            '-threads', '1',
            '-i', resolvedSource,
            '-frames:v', '1',
            '-vf', DEPTH_FRAME_SCALE_FILTER,
            '-threads', '1',
            '-q:v', '2',
            path.join(inputDir, 'frame-00000001.jpg'),
          ]);
        } else {
          const probe = await execFfmpeg(getFfmpegBin(), ['-hide_banner', '-i', resolvedSource], 10_000)
            .catch(error => ({ stderr: error.message }));
          sourceFps = parseVideoFps(probe.stderr);
          fps = processingFps === 'source'
            ? sourceFps
            : Math.min(processingFps, sourceFps);
          const extractionArgs = ['-y', '-threads', '1', '-i', resolvedSource, '-map', '0:v:0'];
          const extractionFilters = [];
          if (processingFps === 'source') extractionArgs.push('-vsync', '0');
          else extractionFilters.push(`fps=${fps}`);
          extractionFilters.push(DEPTH_FRAME_SCALE_FILTER);
          extractionArgs.push('-vf', extractionFilters.join(','));
          extractionArgs.push('-threads', '1', '-q:v', '2', path.join(inputDir, 'frame-%08d.jpg'));
          await execFfmpeg(getFfmpegBin(), extractionArgs);
        }
        if (state.cancelled) throw new Error('DEPTH_CANCELLED');

        const inputFrames = fs.readdirSync(inputDir)
          .filter(name => name.endsWith('.jpg'))
          .sort()
          .map(name => path.join(inputDir, name));
        if (!inputFrames.length) throw new Error('Không tách được frame từ Video Node.');
        const outputFrames = inputFrames.map((_, index) => path.join(outputDir, `frame-${String(index + 1).padStart(8, '0')}.png`));

        emit({ stage: 'loading-model', progress: 5, totalFrames: inputFrames.length });
        const depthThreadCount = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4) || 1));
        const processFramesWithWorker = async coreMlEnabled => {
          const worker = fork(path.join(__dirname, '../../depth-anything-worker.js'), [], {
            execArgv: ['--expose-gc'],
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: '1',
              GENYU_DEPTH_THREADS: String(coreMlEnabled ? depthThreadCount : 1),
              GENYU_DEPTH_COREML: coreMlEnabled ? '1' : '0',

              GENYU_DEPTH_COREML_FLAGS: String(0x004 | 0x008 | 0x010),
            },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          });
          let workerStderr = '';
          worker.stderr?.on('data', chunk => {
            workerStderr = `${workerStderr}${String(chunk)}`.slice(-2400);
          });
          try { os.setPriority(worker.pid, 10); } catch {  }
          state.worker = worker;
          try {
            await new Promise((resolve, reject) => {
              worker.on('message', message => {
                if (message.type === 'model-progress') {
                  const modelProgress = Number(message.payload?.progress);
                  emitThrottled({
                    stage: 'loading-model',
                    progress: Number.isFinite(modelProgress) ? Math.min(12, 5 + modelProgress * 0.07) : 7,
                    modelFile: message.payload?.file,
                    totalFrames: inputFrames.length,
                  });
                } else if (message.type === 'ready') {
                  emit({ stage: 'processing', progress: 12, processedFrames: 0, totalFrames: inputFrames.length });
                } else if (message.type === 'frame') {
                  emitThrottled({
                    stage: 'processing',
                    progress: 12 + Math.round((message.index / message.total) * 78),
                    processedFrames: message.index,
                    totalFrames: message.total,
                  }, message.index === message.total);
                } else if (message.type === 'done') {
                  resolve();
                } else if (message.type === 'error') {
                  reject(new Error(message.error));
                }
              });
              worker.once('error', reject);
              worker.once('exit', (code, signal) => {
                if (state.cancelled) {
                  reject(new Error('DEPTH_CANCELLED'));
                  return;
                }
                const reason = signal
                  ? `Bộ xử lý độ sâu bị hệ thống dừng (${signal}).`
                  : `Bộ xử lý độ sâu dừng với mã ${code}.`;
                reject(new Error(`${reason}${workerStderr ? ` ${workerStderr}` : ''}`));
              });
              worker.send({
                type: 'process',
                modelName,
                cacheDir: path.join(app.getPath('userData'), 'depth-anything-cache'),
                inputFrames,
                outputFrames,
              });
            });
          } finally {
            if (!worker.killed) worker.kill();
            if (state.worker === worker) state.worker = null;
          }
        };
        try {
          await processFramesWithWorker(true);
        } catch (error) {
          if (state.cancelled || !isDepthWorkerMemoryExit(error)) throw error;
          outputFrames.forEach(framePath => {
            try { fs.rmSync(framePath, { force: true }); } catch {  }
          });
          emit({
            stage: 'loading-model',
            progress: 6,
            totalFrames: inputFrames.length,
            fallback: 'cpu',
          });
          await processFramesWithWorker(false);
        }
        if (state.cancelled) throw new Error('DEPTH_CANCELLED');

        emit({ stage: 'encoding', progress: 92, totalFrames: inputFrames.length });
        const saveDir = path.join(
          inputKind === 'image' ? getImageOutputDir() : getVideoOutputDir(),
          'depth-anything',
        );
        fs.mkdirSync(saveDir, { recursive: true });
        const extension = inputKind === 'image' ? 'png' : 'mp4';
        const outputPath = path.join(saveDir, `depth-${outputStyle}-${Date.now()}.${extension}`);
        if (inputKind === 'image') {
          if (outputStyle === 'grayscale') {
            fs.copyFileSync(outputFrames[0], outputPath);
          } else if (outputStyle === 'heatmap') {
            await execFfmpeg(getFfmpegBin(), [
              '-y',
              '-threads', '1',
              '-i', outputFrames[0],
              '-vf', 'format=yuv444p,pseudocolor=preset=turbo,format=rgb24',
              '-frames:v', '1',
              outputPath,
            ]);
          } else {
            await execFfmpeg(getFfmpegBin(), [
              '-y',
              '-threads', '1',
              '-i', inputFrames[0],
              '-i', outputFrames[0],
              '-filter_complex', '[0:v]format=rgb24[left];[1:v]format=rgb24[right];[left][right]hstack=inputs=2[out]',
              '-map', '[out]',
              '-frames:v', '1',
              outputPath,
            ]);
          }
        } else {
          await execFfmpeg(getFfmpegBin(), buildEncodingArgs({
            fps,
            inputDir,
            outputDir,
            outputPath,
            outputStyle,
          }));
        }
        emit({ stage: 'done', progress: 100, totalFrames: inputFrames.length });
        return {
          jobId,
          kind: inputKind,
          src: pathToFileURL(outputPath).toString(),
          filePath: outputPath,
          fileName: path.basename(outputPath),
          mimeType: inputKind === 'image' ? 'image/png' : 'video/mp4',
          fps,
          sourceFps,
          processingFps,
          outputStyle,
          frames: inputFrames.length,
          model: modelName,
          modelSize,
        };
      } catch (error) {
        if (state.cancelled || error?.message === 'DEPTH_CANCELLED') {
          throw new Error('Đã hủy xử lý Depth Anything V2.');
        }
        throw normalizeDepthRuntimeError(error);
      } finally {
        if (state.worker) {
          try {
            if (!state.worker.killed) state.worker.kill();
          } catch {  }
        }
        activeJobs.delete(jobId);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {  }
      }
    };

    const queued = depthQueue.then(run, run);
    depthQueue = queued.catch(() => undefined);
    return queued;
  });
};
