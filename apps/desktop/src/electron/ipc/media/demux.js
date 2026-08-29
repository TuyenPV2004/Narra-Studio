'use strict';

const { spawn } = require('node:child_process');
const {
  createPinnedLookup,
  isPrivateAddress,
  parsePublicHttpsUrl,
  resolvePublicAddresses,
} = require('./public-https');

const MAX_REDIRECTS = 5;
const MAX_REMOTE_BYTES = 2 * 1024 * 1024 * 1024;
const PROGRESS_CHANNEL = 'video-audio-demux-progress';
const progressState = new Map();

function demuxError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function assertPublicDns(hostname) {
  return resolvePublicAddresses(hostname);
}

function sanitizeJobId(value) {
  const safe = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return safe || `demux-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseDurationSeconds(stderr) {
  const match = String(stderr || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseProgressSeconds(line) {
  const [key, rawValue] = String(line || '').trim().split('=');
  if (key === 'out_time_us' || key === 'out_time_ms') {
    const value = Number(rawValue);
    return Number.isFinite(value) ? value / 1_000_000 : null;
  }
  if (key !== 'out_time') return null;
  const match = String(rawValue || '').match(/^(\d+):(\d+):([\d.]+)$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function throwIfCancelled(job) {
  if (job.cancelled) throw demuxError('DEMUX_CANCELLED', 'Đã huỷ tách audio khỏi video.');
}

function emitProgress(event, payload) {
  const jobId = String(payload?.jobId || '');
  const now = Date.now();
  const previous = progressState.get(jobId);
  const rawPercent = Number.isFinite(Number(payload?.percent)) ? Math.floor(Number(payload.percent)) : undefined;
  const percent = rawPercent == null || previous?.percent == null
    ? rawPercent
    : Math.max(previous.percent, rawPercent);
  const terminal = payload?.stage === 'done';
  if (
    !terminal
    && previous
    && previous.stage === payload?.stage
    && previous.percent === percent
    && now - previous.at < 500
  ) return;
  progressState.set(jobId, { stage: payload?.stage, percent, at: now });
  try {
    event.sender.send(PROGRESS_CHANNEL, {
      ...payload,
      ...(percent == null ? {} : { percent }),
    });
  } catch {
  }
  if (terminal) progressState.delete(jobId);
}

async function downloadHttpsSource({ https, fs, url, targetPath, job, event, jobId, redirectCount = 0 }) {
  throwIfCancelled(job);
  const parsed = parsePublicHttpsUrl(url);
  const addresses = await assertPublicDns(parsed.hostname);
  throwIfCancelled(job);

  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      lookup: createPinnedLookup(addresses),
    }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(demuxError('REMOTE_REDIRECT_LIMIT', 'Nguồn video chuyển hướng quá nhiều lần.'));
          return;
        }
        const nextUrl = new URL(response.headers.location, parsed).toString();
        downloadHttpsSource({
          https, fs, url: nextUrl, targetPath, job, event, jobId,
          redirectCount: redirectCount + 1,
        }).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(demuxError('REMOTE_DOWNLOAD_FAILED', `Không tải được video HTTPS (HTTP ${status}).`));
        return;
      }

      const total = Number(response.headers['content-length'] || 0);
      if (total > MAX_REMOTE_BYTES) {
        response.destroy();
        reject(demuxError('REMOTE_SOURCE_TOO_LARGE', 'Video HTTPS vượt quá giới hạn 2 GB.'));
        return;
      }

      let received = 0;
      const output = fs.createWriteStream(targetPath, { flags: 'wx' });
      const fail = error => {
        output.destroy();
        response.destroy();
        reject(job.cancelled
          ? demuxError('DEMUX_CANCELLED', 'Đã huỷ tách audio khỏi video.')
          : error);
      };
      response.on('data', chunk => {
        received += chunk.length;
        if (received > MAX_REMOTE_BYTES) {
          fail(demuxError('REMOTE_SOURCE_TOO_LARGE', 'Video HTTPS vượt quá giới hạn 2 GB.'));
          return;
        }
        emitProgress(event, {
          jobId,
          stage: 'downloading',
          bytesReceived: received,
          bytesTotal: total || undefined,
          percent: total ? Math.min(35, received / total * 35) : undefined,
        });
      });
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        output.close(() => resolve(targetPath));
      });
      response.pipe(output);
    });
    job.request = request;
    request.setTimeout(120_000, () => {
      request.destroy(demuxError('REMOTE_DOWNLOAD_TIMEOUT', 'Tải video HTTPS quá thời gian cho phép.'));
    });
    request.on('error', error => {
      reject(job.cancelled
        ? demuxError('DEMUX_CANCELLED', 'Đã huỷ tách audio khỏi video.')
        : error);
    });
  });
}

function runProbe(ffmpegBin, inputPath, job) {
  throwIfCancelled(job);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-hide_banner', '-i', inputPath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    job.child = child;
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on('error', reject);
    child.on('close', () => {
      job.child = null;
      if (job.cancelled) {
        reject(demuxError('DEMUX_CANCELLED', 'Đã huỷ tách audio khỏi video.'));
        return;
      }
      if (!/\bVideo:\s/i.test(stderr)) {
        reject(demuxError('NO_VIDEO_STREAM', 'Nguồn không chứa luồng video.'));
        return;
      }
      if (!/\bAudio:\s/i.test(stderr)) {
        reject(demuxError('NO_AUDIO_STREAM', 'Video không chứa luồng audio để tách.'));
        return;
      }
      resolve({ duration: parseDurationSeconds(stderr) });
    });
  });
}

function runDemuxProcess({
  ffmpegBin, inputPath, audioPath, silentVideoPath, audioFormat,
  copyVideo, duration, job, event, jobId,
}) {
  throwIfCancelled(job);
  return new Promise((resolve, reject) => {
    const audioCodecArgs = audioFormat === 'mp3'
      ? ['-c:a', 'libmp3lame', '-q:a', '2']
      : ['-c:a', 'pcm_s16le'];
    const videoCodecArgs = copyVideo
      ? ['-c:v', 'copy']
      : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p'];
    const args = [
      '-y', '-hide_banner', '-progress', 'pipe:1', '-nostats', '-i', inputPath,
      '-map', '0:a:0', '-vn', ...audioCodecArgs, audioPath,
      '-map', '0:v:0', '-an', ...videoCodecArgs, '-movflags', '+faststart', silentVideoPath,
    ];
    const child = spawn(ffmpegBin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.child = child;
    let stderr = '';
    let stdoutBuffer = '';
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const seconds = parseProgressSeconds(line);
        if (seconds == null) continue;
        const processingPercent = duration > 0 ? Math.min(64, seconds / duration * 64) : 0;
        emitProgress(event, {
          jobId,
          stage: 'processing',
          seconds,
          duration: duration || undefined,
          percent: 35 + processingPercent,
        });
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
        reject(demuxError('DEMUX_CANCELLED', 'Đã huỷ tách audio khỏi video.'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(demuxError('FFMPEG_DEMUX_FAILED', stderr.slice(-2000) || `FFmpeg thoát với mã ${code}.`));
      }
    });
  });
}

function registerMediaDemuxIpc(dependencies) {
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
  const jobs = new Map();

  ipcMain.handle('video-audio-demux', async (event, params = {}) => {
    const source = String(params.source || '').trim();
    if (!source) throw demuxError('INVALID_SOURCE', 'Thiếu nguồn video để tách audio.');
    const jobId = sanitizeJobId(params.jobId);
    if (jobs.has(jobId)) throw demuxError('DEMUX_JOB_EXISTS', `Job ${jobId} đang chạy.`);

    const job = { cancelled: false, child: null, request: null };
    jobs.set(jobId, job);
    const audioFormat = params.audioFormat === 'mp3' ? 'mp3' : 'wav';
    const outputDir = path.join(getVideoOutputDir(), 'demux');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputStem = `${jobId}-${Date.now()}`;
    const audioPath = path.join(outputDir, `${outputStem}-audio.${audioFormat}`);
    const silentVideoPath = path.join(outputDir, `${outputStem}-silent.mp4`);
    let tempDir = null;
    let inputPath;
    let completed = false;

    try {
      if (/^https:/i.test(source)) {
        tempDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'genyu-demux-'));
        const remoteExtension = path.extname(new URL(source).pathname).slice(0, 12);
        const extension = /^\.[a-zA-Z0-9]{1,10}$/.test(remoteExtension) ? remoteExtension : '.video';
        inputPath = path.join(tempDir, `source${extension}`);
        emitProgress(event, { jobId, stage: 'downloading', percent: 0 });
        await downloadHttpsSource({
          https, fs, url: source, targetPath: inputPath, job, event, jobId,
        });
      } else {
        if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^file:/i.test(source)) {
          throw demuxError('INVALID_SOURCE', 'Chỉ hỗ trợ đường dẫn local, file:// hoặc HTTPS.');
        }
        inputPath = source.startsWith('file://') ? fileURLToPath(source) : path.resolve(source);
        if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
          throw demuxError('SOURCE_NOT_FOUND', `File video không tồn tại: ${inputPath}`);
        }
      }

      throwIfCancelled(job);
      emitProgress(event, { jobId, stage: 'probing', percent: 35 });
      const probe = await runProbe(getFfmpegBin(), inputPath, job);
      emitProgress(event, { jobId, stage: 'processing', percent: 36, duration: probe.duration || undefined });

      try {
        await runDemuxProcess({
          ffmpegBin: getFfmpegBin(),
          inputPath,
          audioPath,
          silentVideoPath,
          audioFormat,
          copyVideo: true,
          duration: probe.duration,
          job,
          event,
          jobId,
        });
      } catch (error) {
        if (job.cancelled) throw error;
        await Promise.allSettled([
          fs.promises.rm(audioPath, { force: true }),
          fs.promises.rm(silentVideoPath, { force: true }),
        ]);
        emitProgress(event, {
          jobId,
          stage: 'processing',
          percent: 36,
          duration: probe.duration || undefined,
          transcodingVideo: true,
        });
        await runDemuxProcess({
          ffmpegBin: getFfmpegBin(),
          inputPath,
          audioPath,
          silentVideoPath,
          audioFormat,
          copyVideo: false,
          duration: probe.duration,
          job,
          event,
          jobId,
        });
      }

      const [audioStat, videoStat] = await Promise.all([
        fs.promises.stat(audioPath),
        fs.promises.stat(silentVideoPath),
      ]);
      if (!audioStat.size || !videoStat.size) {
        throw demuxError('EMPTY_DEMUX_OUTPUT', 'FFmpeg tạo output rỗng.');
      }
      completed = true;
      emitProgress(event, { jobId, stage: 'done', percent: 100, duration: probe.duration || undefined });
      return {
        jobId,
        duration: probe.duration,
        audioPath,
        audioUrl: pathToFileURL(audioPath).toString(),
        audioFormat,
        audioBytes: audioStat.size,
        silentVideoPath,
        silentVideoUrl: pathToFileURL(silentVideoPath).toString(),
        silentVideoBytes: videoStat.size,
      };
    } finally {
      jobs.delete(jobId);
      progressState.delete(jobId);
      job.request?.destroy();
      if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      if (!completed) {
        await Promise.allSettled([
          fs.promises.rm(audioPath, { force: true }),
          fs.promises.rm(silentVideoPath, { force: true }),
        ]);
      }
    }
  });

  ipcMain.handle('video-audio-demux-cancel', async (_, params = {}) => {
    const jobId = sanitizeJobId(params.jobId);
    const job = jobs.get(jobId);
    if (!job) return { cancelled: false };
    job.cancelled = true;
    job.request?.destroy(demuxError('DEMUX_CANCELLED', 'Đã huỷ tách audio khỏi video.'));
    if (job.child && !job.child.killed) job.child.kill('SIGTERM');
    return { cancelled: true };
  });
}

module.exports = registerMediaDemuxIpc;
module.exports.isPrivateAddress = isPrivateAddress;
module.exports.parsePublicHttpsUrl = parsePublicHttpsUrl;
module.exports.parseDurationSeconds = parseDurationSeconds;
module.exports.parseProgressSeconds = parseProgressSeconds;
module.exports.sanitizeJobId = sanitizeJobId;
module.exports.runProbe = runProbe;
