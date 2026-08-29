'use strict';

const { spawn } = require('node:child_process');
const {
  parseProgressSeconds,
  runProbe,
} = require('./demux');
const {
  createPinnedLookup,
  parsePublicHttpsUrl,
  resolvePublicAddresses,
} = require('./public-https');
const {
  createAudioSeparationEngine,
  MAX_INPUT_SECONDS,
  sanitizeOperationId,
} = require('../../runtime/audio-separation/engine');
const {
  DEFAULT_AUDIO_SEPARATION_MODEL,
} = require('../../runtime/audio-separation/models');

const MAX_REMOTE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const PROGRESS_CHANNEL = 'video-audio-separation-progress';

function operationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function throwIfCancelled(job) {
  if (job.cancelled) {
    throw operationError('AUDIO_SEPARATION_CANCELLED', 'Đã huỷ tách giọng nói khỏi video.');
  }
}

function createProgressEmitter(event, operationId) {
  const intervalMs = 125;
  let lastSentAt = 0;
  let lastStage = null;
  let pending = null;
  let timer = null;

  const deliver = payload => {
    lastSentAt = Date.now();
    lastStage = payload.stage;
    try {
      event.sender.send(PROGRESS_CHANNEL, payload);
    } catch {
    }
  };

  const emit = (stage, percent, extra = {}) => {
    const normalizedPercent = Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : undefined;
    const payload = {
      operationId,
      stage,
      ...extra,
      ...(normalizedPercent == null
        ? {}
        : {
          percent: normalizedPercent,
          fraction: normalizedPercent / 100,
        }),
    };
    const now = Date.now();
    const terminal = stage === 'done';
    const stageChanged = stage !== lastStage;
    if (terminal || stageChanged || now - lastSentAt >= intervalMs) {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      deliver(payload);
      return;
    }
    pending = payload;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (!pending) return;
        const latest = pending;
        pending = null;
        deliver(latest);
      }, Math.max(1, intervalMs - (now - lastSentAt)));
    }
  };

  const dispose = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return { emit, dispose };
}

async function downloadRemoteSource({
  https,
  fs,
  source,
  targetPath,
  job,
  event,
  operationId,
  redirectCount = 0,
}) {
  throwIfCancelled(job);
  const parsed = parsePublicHttpsUrl(source);
  const addresses = await resolvePublicAddresses(parsed.hostname);
  throwIfCancelled(job);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const request = https.get(parsed, {
      lookup: createPinnedLookup(addresses),
    }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          finish(operationError('REMOTE_REDIRECT_LIMIT', 'Nguồn video chuyển hướng quá nhiều lần.'));
          return;
        }
        downloadRemoteSource({
          https,
          fs,
          source: new URL(response.headers.location, parsed).toString(),
          targetPath,
          job,
          event,
          operationId,
          redirectCount: redirectCount + 1,
        }).then(value => finish(null, value), finish);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        finish(operationError('REMOTE_DOWNLOAD_FAILED', `Không tải được video HTTPS (HTTP ${status}).`));
        return;
      }

      const total = Number(response.headers['content-length'] || 0);
      if (total > MAX_REMOTE_BYTES) {
        response.destroy();
        finish(operationError('REMOTE_SOURCE_TOO_LARGE', 'Video HTTPS vượt quá giới hạn 2 GB.'));
        return;
      }
      let received = 0;
      const output = fs.createWriteStream(targetPath, { flags: 'wx' });
      const fail = error => {
        output.destroy();
        response.destroy();
        finish(job.cancelled
          ? operationError('AUDIO_SEPARATION_CANCELLED', 'Đã huỷ tách giọng nói khỏi video.')
          : error);
      };
      response.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_REMOTE_BYTES) {
          fail(operationError('REMOTE_SOURCE_TOO_LARGE', 'Video HTTPS vượt quá giới hạn 2 GB.'));
          return;
        }
        job.emitProgress(
          'downloading-source',
          total ? received / total * 10 : undefined,
          {
            bytesReceived: received,
            bytesTotal: total || undefined,
          },
        );
      });
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => output.close(() => finish(null, targetPath)));
      response.pipe(output);
    });
    job.request = request;
    request.setTimeout(120_000, () => {
      request.destroy(operationError('REMOTE_DOWNLOAD_TIMEOUT', 'Tải video HTTPS quá thời gian cho phép.'));
    });
    request.on('error', error => {
      finish(job.cancelled
        ? operationError('AUDIO_SEPARATION_CANCELLED', 'Đã huỷ tách giọng nói khỏi video.')
        : error);
    });
  });
}

function runFfmpeg({
  ffmpegBin,
  args,
  job,
  event,
  operationId,
  stage,
  percentStart,
  percentEnd,
  duration,
}) {
  throwIfCancelled(job);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, [
      '-y',
      '-hide_banner',
      '-progress', 'pipe:1',
      '-nostats',
      ...args,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.child = child;
    let stdoutBuffer = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const seconds = parseProgressSeconds(line);
        if (seconds == null) continue;
        const fraction = duration > 0 ? Math.min(1, seconds / duration) : 0;
        job.emitProgress(
          stage,
          percentStart + (percentEnd - percentStart) * fraction,
          { seconds, duration: duration || undefined },
        );
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on('error', reject);
    child.on('close', code => {
      job.child = null;
      if (job.cancelled) {
        reject(operationError('AUDIO_SEPARATION_CANCELLED', 'Đã huỷ tách giọng nói khỏi video.'));
      } else if (code === 0) {
        job.emitProgress(stage, percentEnd, { duration: duration || undefined });
        resolve();
      } else {
        reject(operationError(
          stage === 'decoding' ? 'AUDIO_DECODE_FAILED' : 'AUDIO_ENCODE_FAILED',
          stderr.slice(-2000) || `FFmpeg thoát với mã ${code}.`,
        ));
      }
    });
  });
}

function encodeStem({
  ffmpegBin,
  pcmPath,
  outputPath,
  format,
  sampleRate,
  duration,
  job,
  event,
  operationId,
  percentStart,
  percentEnd,
}) {
  const codecArgs = format === 'mp3'
    ? ['-c:a', 'libmp3lame', '-q:a', '2']
    : ['-c:a', 'pcm_s16le'];
  return runFfmpeg({
    ffmpegBin,
    args: [
      '-f', 'f32le',
      '-ar', String(sampleRate),
      '-ac', '2',
      '-i', pcmPath,
      ...codecArgs,
      outputPath,
    ],
    job,
    event,
    operationId,
    stage: 'encoding',
    percentStart,
    percentEnd,
    duration,
  });
}

function registerAudioSeparationIpc(dependencies) {
  const {
    app,
    ipcMain,
    https,
    fs,
    path,
    pathToFileURL,
    fileURLToPath,
    getFfmpegBin,
    getVideoOutputDir,
  } = dependencies;
  const model = dependencies.audioSeparationModel || DEFAULT_AUDIO_SEPARATION_MODEL;
  const engine = dependencies.audioSeparationEngine || createAudioSeparationEngine({
    cacheDir: path.join(app.getPath('userData'), 'models', 'audio-separation'),
    fetchImpl: dependencies.net?.fetch
      ? (...args) => dependencies.net.fetch(...args)
      : global.fetch,
    model,
  });
  const jobs = new Map();

  ipcMain.handle('video-audio-separate-stems', async (event, params = {}) => {
    const source = String(params.source || '').trim();
    if (!source) throw operationError('INVALID_SOURCE', 'Thiếu nguồn video để tách giọng nói.');
    const operationId = sanitizeOperationId(params.operationId);
    if (jobs.has(operationId)) {
      throw operationError('AUDIO_SEPARATION_ACTIVE', `Operation ${operationId} đang chạy.`);
    }
    const format = params.format === 'mp3' ? 'mp3' : 'wav';
    const requestedRole = params.role === 'vocals' ? 'vocals' : 'background';
    const threadCount = Math.max(1, Math.min(4, Math.floor(Number(params.threadCount) || 2)));
    const job = {
      cancelled: false,
      child: null,
      request: null,
      separation: null,
      emitProgress: null,
      disposeProgress: null,
    };
    const progressEmitter = createProgressEmitter(event, operationId);
    job.emitProgress = progressEmitter.emit;
    job.disposeProgress = progressEmitter.dispose;
    const outputDir = path.join(getVideoOutputDir(), 'audio-separation');
    await fs.promises.mkdir(outputDir, { recursive: true });
    const workDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'genyu-stems-'));
    const outputStem = `${operationId}-${Date.now()}`;
    const vocalsPath = path.join(outputDir, `${outputStem}-vocals.${format}`);
    const backgroundPath = path.join(outputDir, `${outputStem}-background.${format}`);
    const inputPcmPath = path.join(workDir, `${operationId}-input.f32le`);
    let completed = false;
    jobs.set(operationId, job);

    try {
      let inputPath;
      if (/^https:/i.test(source)) {
        const remoteExtension = path.extname(new URL(source).pathname).slice(0, 12);
        const extension = /^\.[a-zA-Z0-9]{1,10}$/.test(remoteExtension) ? remoteExtension : '.video';
        inputPath = path.join(workDir, `source${extension}`);
        job.emitProgress('downloading-source', 0);
        await downloadRemoteSource({
          https,
          fs,
          source,
          targetPath: inputPath,
          job,
          event,
          operationId,
        });
      } else {
        if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^file:/i.test(source)) {
          throw operationError('INVALID_SOURCE', 'Chỉ hỗ trợ đường dẫn local, file:// hoặc HTTPS.');
        }
        inputPath = source.startsWith('file://') ? fileURLToPath(source) : path.resolve(source);
        if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
          throw operationError('SOURCE_NOT_FOUND', `File video không tồn tại: ${inputPath}`);
        }
      }

      throwIfCancelled(job);
      job.emitProgress('probing', 10);
      const probe = await runProbe(getFfmpegBin(), inputPath, job);
      if (probe.duration > MAX_INPUT_SECONDS) {
        throw operationError(
          'AUDIO_SEPARATION_TOO_LONG',
          `Audio separation chỉ hỗ trợ tối đa ${MAX_INPUT_SECONDS / 60} phút.`,
        );
      }

      job.emitProgress('decoding', 10, { duration: probe.duration || undefined });
      await runFfmpeg({
        ffmpegBin: getFfmpegBin(),
        args: [
          '-i', inputPath,
          '-map', '0:a:0',
          '-vn',
          '-ac', '2',
          '-ar', String(model.sampleRate),
          '-c:a', 'pcm_f32le',
          '-f', 'f32le',
          inputPcmPath,
        ],
        job,
        event,
        operationId,
        stage: 'decoding',
        percentStart: 10,
        percentEnd: 20,
        duration: probe.duration,
      });

      throwIfCancelled(job);
      const separation = engine.separatePcm({
        operationId,
        inputPcmPath,
        outputDir: workDir,
        threadCount,
        onProgress: progress => {
          const fraction = Math.max(0, Math.min(1, Number(progress.fraction) || 0));
          const stage = progress.stage || 'separating';
          const percent = stage === 'downloading-model'
            ? 20 + fraction * 30
            : stage === 'loading-model'
              ? 50
              : 50 + fraction * 40;
          job.emitProgress(stage, percent, {
            modelFraction: fraction,
            cached: progress.cached,
            currentSegment: progress.currentSegment,
            totalSegments: progress.totalSegments,
          });
        },
      });
      job.separation = separation;
      const separated = await separation.promise;
      job.separation = null;
      throwIfCancelled(job);

      const sampleRate = Number(separated.sampleRate || model.sampleRate);
      const duration = separated.sampleCount > 0
        ? separated.sampleCount / sampleRate
        : probe.duration;
      job.emitProgress('encoding', 90, { duration });
      await encodeStem({
        ffmpegBin: getFfmpegBin(),
        pcmPath: separated.vocalsPcmPath,
        outputPath: vocalsPath,
        format,
        sampleRate,
        duration,
        job,
        event,
        operationId,
        percentStart: 90,
        percentEnd: 95,
      });
      await encodeStem({
        ffmpegBin: getFfmpegBin(),
        pcmPath: separated.accompanimentPcmPath,
        outputPath: backgroundPath,
        format,
        sampleRate,
        duration,
        job,
        event,
        operationId,
        percentStart: 95,
        percentEnd: 99,
      });

      const [vocalsStat, backgroundStat] = await Promise.all([
        fs.promises.stat(vocalsPath),
        fs.promises.stat(backgroundPath),
      ]);
      if (!vocalsStat.size || !backgroundStat.size) {
        throw operationError('EMPTY_SEPARATION_OUTPUT', 'Audio separation tạo output rỗng.');
      }
      completed = true;
      job.emitProgress('done', 100, { duration });
      const modelId = separated.modelId || model.id;
      const modelChecksum = model.sha256;
      const vocalsUrl = pathToFileURL(vocalsPath).toString();
      const backgroundUrl = pathToFileURL(backgroundPath).toString();
      const outputPath = requestedRole === 'vocals' ? vocalsPath : backgroundPath;
      const outputUrl = requestedRole === 'vocals' ? vocalsUrl : backgroundUrl;
      const outputBytes = requestedRole === 'vocals' ? vocalsStat.size : backgroundStat.size;
      return {
        operationId,
        role: requestedRole,
        duration,
        format,
        sampleRate,
        sampleCount: separated.sampleCount,
        gain: separated.gain,
        modelId,
        modelChecksum,
        model: {
          id: modelId,
          displayName: model.displayName,
          runtime: model.runtime,
          sha256: modelChecksum,
        },
        vocalsPath,
        vocalsUrl,
        vocalsBytes: vocalsStat.size,
        backgroundPath,
        backgroundUrl,
        backgroundBytes: backgroundStat.size,
        instrumentalPath: backgroundPath,
        instrumentalUrl: backgroundUrl,
        instrumentalBytes: backgroundStat.size,
        accompanimentPath: backgroundPath,
        accompanimentUrl: backgroundUrl,
        accompanimentBytes: backgroundStat.size,
        outputPath,
        outputUrl,
        outputBytes,
        outputFileName: path.basename(outputPath),
      };
    } finally {
      jobs.delete(operationId);
      job.request?.destroy();
      if (job.child && !job.child.killed) job.child.kill('SIGTERM');
      job.separation?.cancel?.();
      job.disposeProgress?.();
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      if (!completed) {
        await Promise.allSettled([
          fs.promises.rm(vocalsPath, { force: true }),
          fs.promises.rm(backgroundPath, { force: true }),
        ]);
      }
    }
  });

  ipcMain.handle('video-audio-separate-stems-cancel', async (_, params = {}) => {
    const operationId = sanitizeOperationId(params.operationId);
    const job = jobs.get(operationId);
    if (!job) return { cancelled: false };
    job.cancelled = true;
    job.request?.destroy(operationError('AUDIO_SEPARATION_CANCELLED', 'Đã huỷ tách giọng nói khỏi video.'));
    if (job.child && !job.child.killed) job.child.kill('SIGTERM');
    job.separation?.cancel?.();
    engine.cancel?.(operationId);
    return { cancelled: true };
  });
}

module.exports = registerAudioSeparationIpc;
module.exports.downloadRemoteSource = downloadRemoteSource;
module.exports.resolvePublicAddresses = resolvePublicAddresses;
