const { spawn } = require('child_process');
const crypto = require('crypto');

const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;
const MAX_REFERENCE_FILES = 5;
const MAX_REFERENCE_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;
const MODEL_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const WORKER_READY_TIMEOUT_MS = 10 * 60 * 1000;
const WORKER_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const COQUI_TTS_PACKAGE = 'coqui-tts==0.27.5';
const TORCH_VERSION = '2.11.0';
const CUDA_WHEEL_INDEX = 'https://download.pytorch.org/whl/cu128';
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh-cn', 'ja', 'hu', 'ko', 'hi']);
const activeJobs = new Map();

function logVoiceEvent(message, level = 'log') {
  const allowed = ['event', 'requestId', 'device', 'torchVersion', 'cudaAvailable', 'cudaName', 'loadMs', 'speakerCount', 'mode', 'language', 'speed', 'textChars', 'elapsedMs', 'outputBytes', 'sampleRate', 'audioFrames', 'segmentIndex', 'totalSegments', 'completedSegments', 'resumedSegments', 'segmentChars'];
  const details = {};
  for (const field of allowed) if (message[field] !== undefined) details[field] = message[field];
  console[level]('[XTTS-V2]', details);
}

function safeName(value, fallback = 'narra-voice') {
  return String(value || fallback).trim().replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\.+$/g, '').slice(0, 80) || fallback;
}

function isAudioHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  return (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE')
    || buffer.toString('ascii', 0, 4) === 'fLaC'
    || buffer.toString('ascii', 0, 4) === 'OggS'
    || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    || buffer.toString('ascii', 0, 3) === 'ID3'
    || buffer.toString('ascii', 4, 8) === 'ftyp';
}

function parseLastJson(output) {
  for (const line of String(output || '').trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch { /* ignore dependency/runtime noise */ }
  }
  return {};
}

function terminateProcessTree(proc, spawnProcess = spawn) {
  if (!proc || !Number.isInteger(proc.pid)) return;
  if (process.platform === 'win32') {
    const killer = spawnProcess('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { shell: false, stdio: 'ignore', windowsHide: true });
    killer.once('error', () => { try { proc.kill('SIGKILL'); } catch { /* already stopped */ } });
    return;
  }
  try { proc.kill('SIGKILL'); } catch { /* already stopped */ }
}

module.exports = function registerVoiceIpc({ app, ipcMain, dialog, path, fs, shell, pathToFileURL, getVoiceOutputDir, getVoiceOutputRoots, runtime, spawnProcess = spawn }) {
  const runtimeRoot = () => process.env.NARRA_XTTS_RUNTIME_ROOT || path.join(app.getPath('userData'), 'xtts-v2');
  const pythonPath = () => process.env.NARRA_XTTS_PYTHON || (process.platform === 'win32' ? path.join(runtimeRoot(), '.venv', 'Scripts', 'python.exe') : path.join(runtimeRoot(), '.venv', 'bin', 'python'));
  const workerPath = path.join(__dirname, '..', 'runtime', 'xtts-worker.py');
  const outputDir = () => getVoiceOutputDir();
  const referenceDir = () => path.join(runtimeRoot(), 'references');
  const workerEnv = () => ({ ...process.env, NARRA_XTTS_RUNTIME_ROOT: runtimeRoot(), TTS_HOME: path.join(runtimeRoot(), 'models'), COQUI_TOS_AGREED: '1', PYTHONUTF8: '1' });
  let worker = null;
  let workerReady = null;
  let workerDetails = null;
  let cancelWorkerStart = null;
  let workerError = '';
  let idleTimer = null;

  const run = (command, args, options = {}) => new Promise((resolve, reject) => {
    const { timeout = 0, ...spawnOptions } = options;
    const proc = spawnProcess(command, args, { shell: false, windowsHide: true, ...spawnOptions });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeout ? setTimeout(() => { timedOut = true; terminateProcessTree(proc, spawnProcess); }, timeout) : null;
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.once('error', error => { if (timer) clearTimeout(timer); reject(error); });
    proc.once('close', code => {
      if (timer) clearTimeout(timer);
      if (timedOut) reject(new Error(`Process timed out after ${Math.round(timeout / 1000)} seconds`));
      else if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || stdout.trim() || `Process exited with ${code}`));
    });
  });

  async function hasNvidiaGpu() {
    try { return Boolean((await run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { timeout: 15_000 })).trim()); } catch { return false; }
  }

  const stopWorker = error => {
    const proc = worker;
    const cancelStart = cancelWorkerStart;
    worker = null;
    workerReady = null;
    workerDetails = null;
    cancelWorkerStart = null;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    cancelStart?.(error);
    terminateProcessTree(proc, spawnProcess);
    for (const pending of activeJobs.values()) pending.reject(error);
    activeJobs.clear();
  };

  const scheduleIdleStop = () => {
    if (activeJobs.size || !worker) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (activeJobs.size || !worker) return;
      logVoiceEvent({ event: 'worker_idle_stopped', device: workerDetails?.device });
      stopWorker(new Error('XTTS-v2 worker released after being idle.'));
    }, WORKER_IDLE_TIMEOUT_MS);
  };

  app.once('before-quit', () => stopWorker(new Error('Narra Studio đang đóng.')));

  async function status() {
    const python = pythonPath();
    if (!fs.existsSync(python)) return { installed: false, pythonPath: python, runtimeRoot: runtimeRoot(), reason: 'python' };
    if (worker && workerDetails) return { installed: true, pythonPath: python, runtimeRoot: runtimeRoot(), ...workerDetails };
    try {
      const details = parseLastJson(await run(python, [workerPath, '--check'], { cwd: runtimeRoot(), env: workerEnv(), timeout: 60_000 }));
      return { installed: Boolean(details.installed), pythonPath: python, runtimeRoot: runtimeRoot(), ...details };
    } catch (error) {
      return { installed: false, pythonPath: python, runtimeRoot: runtimeRoot(), reason: error.message };
    }
  }

  function ensureWorker() {
    if (worker && workerReady) return workerReady;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    workerError = '';
    const proc = spawnProcess(pythonPath(), [workerPath, '--serve'], { cwd: runtimeRoot(), env: workerEnv(), shell: false, windowsHide: true });
    worker = proc;
    let stdout = '';
    let resolveReady;
    let rejectReady;
    let settled = false;
    let timer;
    const settle = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancelWorkerStart = null;
      error ? rejectReady(error) : resolveReady(proc);
    };
    cancelWorkerStart = settle;
    workerReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    timer = setTimeout(() => {
      const error = new Error('XTTS-v2 mất quá 10 phút để nạp model.');
      settle(error);
      if (worker === proc) stopWorker(error);
    }, WORKER_READY_TIMEOUT_MS);
    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      for (const line of lines) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'ready') {
          workerDetails = { device: message.device, cudaAvailable: Boolean(message.cudaAvailable), cudaName: message.cudaName || '', torchVersion: message.torchVersion || '', speakers: message.speakers || [], languages: message.languages || [] };
          logVoiceEvent({ ...message, speakerCount: workerDetails.speakers.length });
          settle();
        } else if (message.type === 'lifecycle' || message.type === 'progress') {
          logVoiceEvent(message);
          if (message.type === 'progress' && message.requestId) {
            const window = runtime?.mainWindow;
            if (window && !window.isDestroyed?.() && !window.webContents.isDestroyed?.()) {
              window.webContents.send('xtts-progress', {
                requestId: String(message.requestId),
                event: String(message.event || ''),
                segmentIndex: Number(message.segmentIndex || 0),
                totalSegments: Number(message.totalSegments || 0),
                completedSegments: Number(message.completedSegments || 0),
                resumedSegments: Number(message.resumedSegments || 0),
              });
            }
          }
        }
        else if (message.type === 'diagnostic') console.error('[XTTS-V2]', { event: message.event, requestId: message.requestId, stage: message.stage, errorType: message.errorType, traceback: message.traceback });
        else if (message.type === 'result') {
          const pending = activeJobs.get(String(message.requestId || ''));
          if (!pending) continue;
          activeJobs.delete(String(message.requestId));
          message.ok ? pending.resolve(message) : pending.reject(new Error(message.error || 'XTTS-v2 generation failed.'));
          scheduleIdleStop();
        }
      }
    });
    proc.stderr.on('data', chunk => { workerError = `${workerError}${chunk.toString()}`.slice(-4000); });
    proc.once('error', error => { settle(error); if (worker === proc) stopWorker(error); });
    proc.once('close', code => {
      if (worker !== proc) return;
      const error = new Error(workerError.trim() || `XTTS-v2 worker stopped (${code}).`);
      settle(error);
      stopWorker(error);
    });
    return workerReady;
  }

  ipcMain.handle('xtts-status', status);
  ipcMain.handle('xtts-prepare', async () => {
    if (activeJobs.size) throw new Error('Hãy dừng tác vụ XTTS-v2 trước khi cập nhật runtime.');
    stopWorker(new Error('XTTS-v2 runtime is being updated.'));
    const root = runtimeRoot();
    fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(pythonPath())) {
      if (process.env.NARRA_XTTS_PYTHON) throw new Error('NARRA_XTTS_PYTHON không trỏ tới Python hợp lệ.');
      try { await run(process.platform === 'win32' ? 'py' : 'python3', ['-m', 'venv', path.join(root, '.venv')], { cwd: root, timeout: 600_000 }); }
      catch { throw new Error('Không tìm thấy Python tương thích (3.10 đến 3.14).'); }
    }
    try {
      await run(pythonPath(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip'], { cwd: root, timeout: 600_000 });
      const torchArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', `torch==${TORCH_VERSION}`, `torchaudio==${TORCH_VERSION}`];
      if (await hasNvidiaGpu()) torchArgs.push('--index-url', CUDA_WHEEL_INDEX);
      await run(pythonPath(), torchArgs, { cwd: root, timeout: 1_800_000 });
      await run(pythonPath(), ['-m', 'pip', 'install', '--disable-pip-version-check', 'torchcodec', 'transformers>=4.57,<5', COQUI_TTS_PACKAGE], { cwd: root, timeout: 1_800_000 });
      await run(pythonPath(), [workerPath, '--download'], { cwd: root, env: workerEnv(), timeout: MODEL_DOWNLOAD_TIMEOUT_MS });
    } catch (error) {
      throw new Error(`Không thể cài XTTS-v2: ${String(error.message || error).slice(-1000)}`);
    }
    return status();
  });

  ipcMain.handle('xtts-import-reference', async (_, { limit } = {}) => {
    const allowedCount = Math.max(1, Math.min(MAX_REFERENCE_FILES, Number(limit) || MAX_REFERENCE_FILES));
    const picked = await dialog.showOpenDialog({ title: 'Chọn giọng mẫu cho XTTS-v2', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }] });
    if (picked.canceled || !picked.filePaths.length) return [];
    if (picked.filePaths.length > allowedCount) throw new Error(`Chỉ có thể thêm tối đa ${allowedCount} file giọng mẫu nữa.`);
    const validated = picked.filePaths.map(selectedPath => {
      const source = fs.realpathSync(selectedPath);
      const extension = path.extname(source).toLowerCase();
      if (!new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a']).has(extension)) throw new Error('Định dạng giọng mẫu không được hỗ trợ.');
      const stat = fs.statSync(source);
      if (!stat.isFile() || stat.size < 12 || stat.size > MAX_REFERENCE_BYTES) throw new Error('Mỗi file giọng mẫu phải từ 12 byte đến 50 MB.');
      const fd = fs.openSync(source, 'r');
      const header = Buffer.alloc(Math.min(64, stat.size));
      try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
      if (!isAudioHeader(header)) throw new Error(`File “${path.basename(source)}” không có định dạng audio hợp lệ.`);
      return { source, extension, size: stat.size };
    });
    if (validated.reduce((total, item) => total + item.size, 0) > MAX_REFERENCE_TOTAL_BYTES) {
      throw new Error('Tổng dung lượng giọng mẫu không được vượt quá 100 MB.');
    }
    fs.mkdirSync(referenceDir(), { recursive: true });
    const imported = [];
    try {
      for (const item of validated) {
        const id = `${Date.now()}-${crypto.randomUUID()}`;
        const target = path.join(referenceDir(), `${id}${item.extension}`);
        await fs.promises.copyFile(item.source, target);
        imported.push({ id, name: path.basename(item.source), localPath: target, fileUrl: pathToFileURL(target).toString() });
      }
      return imported;
    } catch (error) {
      for (const item of imported) try { await fs.promises.rm(item.localPath, { force: true }); } catch { /* best-effort rollback */ }
      throw error;
    }
  });

  ipcMain.handle('xtts-generate', async (_, payload = {}) => {
    const requestId = String(payload.requestId || '');
    const text = String(payload.text || '').trim();
    const mode = payload.mode === 'clone' ? 'clone' : 'preset';
    const language = String(payload.language || '');
    const speaker = String(payload.speaker || '');
    const speed = Number(payload.speed ?? 1);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || !text || text.length > MAX_TEXT_CHARS) throw new Error('Yêu cầu XTTS-v2 không hợp lệ.');
    if (!SUPPORTED_LANGUAGES.has(language)) throw new Error('Ngôn ngữ không được XTTS-v2 hỗ trợ.');
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('Tốc độ phải từ 0.5 đến 2.0.');
    const currentStatus = await status();
    if (!currentStatus.installed) throw new Error('XTTS-v2 chưa tải đủ model. Hãy bấm “Cài XTTS-v2” trước.');
    if (mode === 'preset' && !currentStatus.speakers?.includes(speaker)) throw new Error('Giọng dựng sẵn không tồn tại trong XTTS-v2.');
    let referencePaths = [];
    if (mode === 'clone') {
      if (!fs.existsSync(referenceDir())) throw new Error('Hãy chọn giọng mẫu trước.');
      const root = fs.realpathSync(referenceDir());
      const supplied = Array.isArray(payload.referencePaths)
        ? payload.referencePaths
        : payload.referencePath ? [payload.referencePath] : [];
      if (!supplied.length || supplied.length > MAX_REFERENCE_FILES) throw new Error('Hãy chọn từ một đến năm file giọng mẫu.');
      referencePaths = [...new Set(supplied.map(item => fs.realpathSync(String(item || ''))))];
      if (referencePaths.length !== supplied.length || referencePaths.some(referencePath => {
        const relative = path.relative(root, referencePath);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return true;
        const stat = fs.statSync(referencePath);
        if (!stat.isFile() || stat.size < 12 || stat.size > MAX_REFERENCE_BYTES) return true;
        const fd = fs.openSync(referencePath, 'r');
        const header = Buffer.alloc(Math.min(64, stat.size));
        try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
        return !isAudioHeader(header);
      })) throw new Error('Giọng mẫu không thuộc thư viện XTTS-v2 của Narra.');
      if (referencePaths.reduce((total, referencePath) => total + fs.statSync(referencePath).size, 0) > MAX_REFERENCE_TOTAL_BYTES) {
        throw new Error('Tổng dung lượng giọng mẫu không được vượt quá 100 MB.');
      }
    }
    if (activeJobs.has(requestId)) throw new Error('Tác vụ XTTS-v2 đang chạy.');
    let resolveJob;
    let rejectJob;
    const result = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject; });
    activeJobs.set(requestId, { resolve: resolveJob, reject: rejectJob });
    let outputPath = '';
    try {
      fs.mkdirSync(outputDir(), { recursive: true });
      outputPath = path.join(outputDir(), `${safeName(payload.taskName)}-${Date.now()}.wav`);
      const proc = await Promise.race([ensureWorker(), result]);
      if (!activeJobs.has(requestId)) throw new Error('Tác vụ XTTS-v2 đã bị hủy.');
      proc.stdin.write(`${JSON.stringify({ requestId, text, mode, language, speaker, referencePaths, speed, outputPath })}\n`, error => {
        if (!error) return;
        activeJobs.get(requestId)?.reject(error);
        activeJobs.delete(requestId);
      });
      await result;
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 44) throw new Error('XTTS-v2 không tạo được WAV hợp lệ.');
      return { id: requestId, localPath: outputPath, fileUrl: pathToFileURL(outputPath).toString(), filename: path.basename(outputPath) };
    } catch (error) {
      activeJobs.delete(requestId);
      scheduleIdleStop();
      if (outputPath) try { fs.rmSync(outputPath, { force: true }); } catch { /* partial output cleanup */ }
      throw error;
    }
  });

  ipcMain.handle('xtts-cancel', async (_, { requestId } = {}) => {
    const id = String(requestId || '');
    const active = activeJobs.has(id);
    if (active) stopWorker(new Error('Tác vụ XTTS-v2 đã bị hủy.'));
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      try { fs.rmSync(path.join(runtimeRoot(), 'jobs', id), { recursive: true, force: true }); } catch { /* best-effort checkpoint cleanup */ }
    }
    return { cancelled: active };
  });
  ipcMain.handle('xtts-show-in-folder', async (_, { filePath } = {}) => {
    const resolved = fs.realpathSync(String(filePath || ''));
    const allowedRoots = getVoiceOutputRoots()
      .filter(root => fs.existsSync(root))
      .map(root => fs.realpathSync(root));
    const isAllowed = allowedRoots.some(root => {
      const relative = path.relative(root, resolved);
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (!isAllowed || path.extname(resolved).toLowerCase() !== '.wav' || !fs.statSync(resolved).isFile()) {
      throw new Error('File không thuộc thư mục kết quả XTTS-v2.');
    }
    shell.showItemInFolder(resolved);
    return { ok: true };
  });
};

module.exports.isAudioHeader = isAudioHeader;
