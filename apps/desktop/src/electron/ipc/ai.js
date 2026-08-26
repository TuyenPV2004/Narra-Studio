'use strict';

const { brand } = require('../runtime/brand');
const { normalizeBaseUrl } = require('../providers/openai-compatible');

module.exports = function registerAiIpc(dependencies) {
  const {
    app,
    BrowserWindow,
    ipcMain,
    session,
    clipboard,
    protocol,
    net,
    shell,
    dialog,
    path,
    https,
    http,
    fs,
    os,
    crypto,
    pathToFileURL,
    fileURLToPath,
    captchaBridge,
    runtime,
    getFfmpegBin,
    maybePromoteFilterComplexToScript,
    logFfmpegSpawnDiagnostics,
    truncatePreview,
    SESSION_PARTITION,
    MAX_SLOTS,
    isDev,
    SETTINGS_FILE,
    loadSettings,
    saveSettings,
    getVideoOutputDir,
    getImageOutputDir,
    getNextFilename,
    buildCleanUserAgent,
    DEFAULTS,
    accountSlots,
    capturedAuth,
    getSlot,
    slotRequestCounts,
    markSlotBusy,
    markSlotFree,
    pickRandomSlot,
    refreshCapturedCookies,
    fetchSlotSession,
    clearSlotSessionData,
    fetchSlotEmail,
    createWindow,
    setupRequestInterception,
    getPlatformChHint,
    getChromeMajorVersion,
    buildHeaders,
    generateUUID,
    DRYRUN_FLAG_FILE,
    DRYRUN_CAPTURE_FILE,
    isDryRunActive,
    makeApiRequest,
    RECAPTCHA_SITE_KEY,
    findChromePath,
    httpGetJson,
    createCdpClient,
    injectChromeWarningOverlay,
    startPersistentChrome,
    getCaptchaFromChrome,
    makeApiRequestViaChrome,
    reloadFlowWebviewForSlot,
    reloadChromeCdpLabs,
    getChromeRuntime,
    openAiProvider,
  } = dependencies;

// ── AI Lip sync video render (local MuseTalk default + Sync.so fallback) ──
function getLipSyncApiKey() {
  const profile = openAiProvider?.getActiveRuntime?.('lip-sync');
  return String(profile?.apiKey || '').trim();
}

function getLipSyncRuntime() {
  return openAiProvider?.getActiveRuntime?.('lip-sync') || null;
}

function getLipSyncSettings() {
  const key = getLipSyncApiKey();
  const profile = getLipSyncRuntime();
  // Provider is now always Sync.so cloud — local Wav2Lip/MuseTalk has been
  // removed. We ignore any persisted `lipSyncProvider` from earlier app
  // versions so users on a fresh build don't see "Local engine not installed"
  // when local mode no longer exists.
  return {
    provider: profile?.protocol || 'sync-v2',
    apiBase: profile?.apiBase || '',
    model: profile?.visionModel || '',
    apiKeySet: !!key,
    apiKeyPreview: key ? `••••••${key.slice(-4)}` : '',
    local: getLocalLipSyncStatusSync(),
  };
}

function emitLipSyncProgress(event, tag, percent, stage) {
  if (!tag || !event?.sender) return;
  try {
    event.sender.send('export-progress', {
      tag,
      percent: Math.max(0, Math.min(100, Number(percent) || 0)),
      stage,
    });
  } catch { /* sender gone */ }
}

function resolveLocalPath(input) {
  if (!input) return '';
  const { fileURLToPath } = require('url');
  return input.startsWith('file://') ? fileURLToPath(input) : input;
}

function safeMediaName(name, fallback = 'lip-sync.mp4') {
  const cleaned = String(name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim();
  return /\.(mp4|mov|mkv|webm)$/i.test(cleaned) ? cleaned : `${cleaned || fallback}.mp4`;
}

async function runFfmpeg(args, label, timeout = 600_000) {
  const { spawn } = require('child_process');
  const ffmpegBin = getFfmpegBin();
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { timeout });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => reject(new Error(`${label} spawn lỗi: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve(null);
      else reject(new Error(`${label} lỗi: ${stderr.slice(-500)}`));
    });
  });
}

async function downloadUrlToFile(downloadUrl, outPath, { event, tag, from = 0, to = 100 } = {}) {
  const http = require('http');
  const httpsMod = require('https');
  await new Promise((resolve, reject) => {
    const requestOnce = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects while downloading Lip sync output'));
        return;
      }
      const proto = url.startsWith('https') ? httpsMod : http;
      const req = proto.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          requestOnce(new URL(res.headers.location, url).toString(), redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          req.destroy();
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0;
        let lastPct = -1;
        const file = fs.createWriteStream(outPath);
        res.on('data', chunk => {
          done += chunk.length;
          if (total > 0) {
            const pct = from + (done / total) * (to - from);
            const intPct = Math.floor(pct);
            if (intPct !== lastPct) {
              lastPct = intPct;
              emitLipSyncProgress(event, tag, pct, 'downloading');
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
        res.on('error', reject);
      });
      req.on('error', reject);
    };
    requestOnce(downloadUrl);
  });
}

async function videoHasAudio(filePath) {
  const { execFile } = require('child_process');
  const probe = (() => {
    const candidates = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch { }
    }
    return getFfmpegBin();
  })();
  const isProbe = probe.includes('ffprobe');
  return new Promise((resolve) => {
    const args = isProbe
      ? ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath]
      : ['-hide_banner', '-i', filePath, '-f', 'null', '-'];
    execFile(probe, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`;
      resolve(isProbe ? text.includes('audio') : /Audio:/i.test(text));
    });
  });
}

function getLipSyncEngineRoot() {
  return path.join(app.getPath('userData'), 'lipsync-engine');
}

// Lip-sync engine paths — kept lean because the local lip-sync engine has
// been removed in favor of Sync.so cloud. We still keep the venv path here
// because the local Vietnamese TTS (Piper) shares this venv.
function getLocalLipSyncPaths() {
  const root = getLipSyncEngineRoot();
  const isWin = process.platform === 'win32';
  const venv = path.join(root, '.venv');
  const binDir = isWin ? path.join(venv, 'Scripts') : path.join(venv, 'bin');
  return {
    root,
    uvDir: path.join(root, 'uv'),
    uvBin: isWin ? path.join(root, 'uv', 'uv.exe') : path.join(root, 'uv', 'uv'),
    venv,
    python: isWin ? path.join(binDir, 'python.exe') : path.join(binDir, 'python'),
    pip: isWin ? path.join(binDir, 'pip.exe') : path.join(binDir, 'pip'),
  };
}

// Cloud-only mode: there's no local lip-sync engine to install anymore.
// We still report a status object for the renderer's settings panel — but
// `installed: false` is permanent, and the UI hides the "Setup local engine"
// button entirely (see VideoPanel.tsx).
function getLocalLipSyncStatusSync() {
  return {
    engineRoot: getLipSyncEngineRoot(),
    installed: false,
    cloudOnly: true,
    missing: [],
    gpu: { type: 'cloud', label: 'Sync.so cloud', usable: true, warning: '' },
  };
}

function uvAssetName() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'uv-aarch64-apple-darwin.tar.gz' : 'uv-x86_64-apple-darwin.tar.gz';
  }
  if (process.platform === 'win32') return 'uv-x86_64-pc-windows-msvc.zip';
  return 'uv-x86_64-unknown-linux-gnu.tar.gz';
}

function runCommand(command, args, { cwd, env, timeout = 900_000, event, tag, from = 0, to = 100, stage = 'running' } = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env, timeout, shell: false });
    let stderr = '';
    let lastPct = Math.floor(from);
    const parseProgress = (text) => {
      const pctMatch = text.match(/(\d{1,3})%/);
      if (!pctMatch) return;
      const pct = from + (Math.min(100, Number(pctMatch[1])) / 100) * (to - from);
      const intPct = Math.floor(pct);
      if (intPct !== lastPct) {
        lastPct = intPct;
        emitLipSyncProgress(event, tag, pct, stage);
      }
    };
    emitLipSyncProgress(event, tag, from, stage);
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      console.log(`[LIP_SYNC][${stage}]`, text.trim());
      parseProgress(text);
    });
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      console.log(`[LIP_SYNC][${stage}]`, text.trim());
      parseProgress(text);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        emitLipSyncProgress(event, tag, to, stage);
        resolve(null);
      } else {
        const cleanError = stderr.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
        reject(new Error(`${command} ${args.join(' ')} failed: ${cleanError.slice(-700)}`));
      }
    });
  });
}

async function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (/\.zip$/i.test(archivePath)) {
    if (process.platform === 'win32') {
      await runCommand('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destDir)} -Force`], { timeout: 300_000, stage: 'extract' });
    } else {
      await runCommand('unzip', ['-o', '-q', archivePath, '-d', destDir], { timeout: 300_000, stage: 'extract' });
    }
  } else {
    await runCommand('tar', ['-xzf', archivePath, '-C', destDir, '--strip-components', '1'], { timeout: 300_000, stage: 'extract' });
  }
}

async function ensureUv(event, tag) {
  const p = getLocalLipSyncPaths();
  if (fs.existsSync(p.uvBin)) return p.uvBin;
  fs.mkdirSync(p.uvDir, { recursive: true });
  const asset = uvAssetName();
  const archive = path.join(p.root, asset);
  await downloadUrlToFile(`https://github.com/astral-sh/uv/releases/latest/download/${asset}`, archive, { event, tag, from: 2, to: 8 });
  const tmpExtract = path.join(p.root, 'uv-extract');
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  fs.mkdirSync(tmpExtract, { recursive: true });
  await extractArchive(archive, tmpExtract);
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (entry === (process.platform === 'win32' ? 'uv.exe' : 'uv')) found.push(full);
    }
  };
  walk(tmpExtract);
  if (!found.length) throw new Error('Cannot find uv binary after extraction');
  fs.copyFileSync(found[0], p.uvBin);
  if (process.platform !== 'win32') fs.chmodSync(p.uvBin, 0o755);
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  return p.uvBin;
}


function getLocalTtsPaths() {
  const p = getLocalLipSyncPaths();
  const voicesDir = path.join(p.root, 'tts-voices');
  const bin = path.dirname(p.python);
  return {
    ...p,
    voicesDir,
    piperBin: process.platform === 'win32' ? path.join(bin, 'piper.exe') : path.join(bin, 'piper'),
    viModel: path.join(voicesDir, 'vi_VN-vais1000-medium.onnx'),
    viConfig: path.join(voicesDir, 'vi_VN-vais1000-medium.onnx.json'),
  };
}

function getLocalTtsStatusSync() {
  const p = getLocalTtsPaths();
  const required = [
    p.python,
    p.viModel,
    p.viConfig,
  ];
  const missing = required.filter(file => !fs.existsSync(file));
  return {
    engineRoot: p.root,
    pythonPath: p.python,
    voicesDir: p.voicesDir,
    installed: missing.length === 0,
    missing,
    voices: [
      {
        id: 'vi_VN-vais1000-medium',
        label: 'Vietnamese Local',
        language: 'vi',
        modelPath: p.viModel,
      },
    ],
  };
}

function venvEnv() {
  const p = getLocalLipSyncPaths();
  const binDir = path.dirname(p.python);
  return {
    ...process.env,
    VIRTUAL_ENV: p.venv,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
  };
}

async function ensurePythonEnv(event, tag = 'lipVoiceSetup') {
  const p = getLocalLipSyncPaths();
  if (fs.existsSync(p.python)) return p.python;
  fs.mkdirSync(p.root, { recursive: true });
  const uv = await ensureUv(event, tag);
  await runCommand(uv, ['venv', p.venv], {
    cwd: p.root,
    timeout: 600_000,
    event,
    tag,
    from: 8,
    to: 12,
    stage: 'python_env',
  });
  if (!fs.existsSync(p.python)) throw new Error('Local Python environment was not created');
  return p.python;
}

async function ensureLocalPiperTts(event, tag = 'lipVoiceSetup') {
  const p = getLocalTtsPaths();
  fs.mkdirSync(p.voicesDir, { recursive: true });
  emitLipSyncProgress(event, tag, 1, 'checking');
  await ensurePythonEnv(event, tag);
  const marker = path.join(p.root, '.piper-tts-installed');
  if (!fs.existsSync(marker)) {
    const uv = await ensureUv(event, tag);
    await runCommand(uv, ['pip', 'install', '--python', p.python, 'piper-tts'], {
      cwd: p.root,
      timeout: 1_800_000,
      event,
      tag,
      from: 12,
      to: 42,
      stage: 'tts_deps',
    });
    fs.writeFileSync(marker, new Date().toISOString());
  }
  if (!fs.existsSync(p.viModel)) {
    await downloadUrlToFile(
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx',
      p.viModel,
      { event, tag, from: 42, to: 70 },
    );
  }
  if (!fs.existsSync(p.viConfig)) {
    await downloadUrlToFile(
      'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json',
      p.viConfig,
      { event, tag, from: 70, to: 88 },
    );
  }
  emitLipSyncProgress(event, tag, 100, 'done');
  return getLocalTtsStatusSync();
}

async function localPiperTextToSpeech(event, { text, voiceId, progressTag }) {
  const status = getLocalTtsStatusSync();
  if (!status.installed) await ensureLocalPiperTts(event, progressTag || 'lipVoiceSetup');
  const p = getLocalTtsPaths();
  const voice = voiceId || 'vi_VN-vais1000-medium';
  if (voice !== 'vi_VN-vais1000-medium') {
    throw new Error(`Local TTS voice is not installed: ${voice}`);
  }
  const outDir = path.join(getVideoOutputDir(), 'lip-sync', 'voice');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `tts-${Date.now()}.wav`);
  const exe = fs.existsSync(p.piperBin) ? p.piperBin : p.python;
  const args = exe === p.python
    ? ['-m', 'piper', '--model', p.viModel, '--config', p.viConfig, '--output_file', outPath]
    : ['--model', p.viModel, '--config', p.viConfig, '--output_file', outPath];
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(exe, args, { cwd: p.root, env: venvEnv(), timeout: 300_000 });
    let stderr = '';
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
      console.log('[TTS][local]', chunk.toString().trim());
    });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve(null);
      else reject(new Error(`Local TTS failed: ${stderr.slice(-600)}`));
    });
    proc.stdin.write(String(text || '').trim());
    proc.stdin.end();
  });
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size <= 0) {
    throw new Error('Local TTS did not produce audio');
  }
  return {
    audio_url: pathToFileURL(outPath).toString(),
    audio_path: outPath,
    id: `local-piper-${Date.now()}`,
    provider: 'local-piper',
    voice_id: voice,
  };
}

ipcMain.handle('get-lip-sync-settings', async () => getLipSyncSettings());

ipcMain.handle('get-local-lip-sync-status', async () => getLocalLipSyncStatusSync());

ipcMain.handle('prepare-local-lip-sync-engine', async () => {
  // Local lip-sync engine has been removed in favor of Sync.so cloud. The
  // renderer may still call this on startup before reading the cloud-only
  // status — return a friendly error instead of crashing.
  throw new Error('Local lip-sync engine has been deprecated. Lip sync now runs on Sync.so cloud — no setup needed.');
});

ipcMain.handle('get-local-tts-status', async () => getLocalTtsStatusSync());

ipcMain.handle('prepare-local-tts-engine', async (event, params = {}) => {
  return ensureLocalPiperTts(event, params.progressTag || 'lipVoiceSetup');
});

ipcMain.handle('save-lip-sync-settings', async (_, params = {}) => {
  void params;
  throw new Error('Configure lip-sync through Provider Account custom profiles.');
});

async function getAgentTextRuntimeSettings() {
  const configured = openAiProvider?.getActiveRuntime?.('text');
  return configured || {
    apiKey: '',
    apiKeySet: false,
    apiUrl: '',
    source: 'none',
    format: 'openai',
    visionModel: '',
  };
}

async function getVisionProviderRuntime() {
  const settings = openAiProvider?.getActiveRuntime?.('vision');
  if (!settings?.apiKey) {
    throw new Error('AI provider is not configured. Add Base URL, API key and model in Provider Account.');
  }
  if (settings.format !== 'openai') {
    throw new Error('The active provider does not support OpenAI-compatible vision requests.');
  }
  return settings;
}

function getMissingAgentTextRuntimeError(settings) {
  return new Error(settings.source === 'none'
    ? 'AI chat chÆ°a Ä‘Æ°á»£c cáº¥u hÃ¬nh. HÃ£y thÃªm Base URL, API key vÃ  model trong TÃ i khoáº£n provider.'
    : 'AI provider API key khÃ´ng kháº£ dá»¥ng.');
}

async function requestAgentTextChatWithSettings(settings, { messages, model, numPredict = 1000, content }) {
  if (!settings.apiKey) {
    throw getMissingAgentTextRuntimeError(settings);
  }
  const requestMessages = messages || [{ role: 'user', content }];
  const body = {
    model: model || settings.visionModel,
    stream: false,
    messages: requestMessages,
    max_tokens: numPredict,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let res;
  try {
    res = await net.fetch(settings.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`AI provider error ${res.status}: ${text.slice(0, 400)}`);
  let data;
  try {
    data = JSON.parse(text || '{}');
  } catch {
    throw new Error('AI provider returned a non-JSON text response.');
  }
  const contentToText = value => {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value
      .filter(part => part && typeof part === 'object' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  };
  const choiceContent = Array.isArray(data?.choices) && data.choices[0]?.message
    ? contentToText(data.choices[0].message.content)
    : '';
  const nativeContent = data?.message && typeof data.message === 'object'
    ? contentToText(data.message.content)
    : '';
  const reply = choiceContent || nativeContent || (typeof data?.response === 'string' ? data.response : '');
  if (!reply.trim()) {
    throw new Error('AI provider returned an empty text response.');
  }
  return { reply: reply.trim(), model: settings.visionModel, source: settings.source };
}

async function requestAgentTextChat(args) {
  return requestAgentTextChatWithSettings(await getAgentTextRuntimeSettings(), args);
}

const activeChatHttpRequests = new Map();

function extractAgentTextStreamDelta(data) {
  if (!data || typeof data !== 'object') return '';
  const choice = data.choices?.[0];
  if (choice) {
    if (typeof choice.delta?.content === 'string') return choice.delta.content;
    if (Array.isArray(choice.delta?.content)) {
      return choice.delta.content.map(p => typeof p === 'string' ? p : p?.text || '').join('');
    }
    if (typeof choice.text === 'string') return choice.text;
    if (typeof choice.message?.content === 'string') return choice.message.content;
  }
  if (typeof data.candidates?.[0]?.content?.parts?.[0]?.text === 'string') {
    return data.candidates[0].content.parts[0].text;
  }
  if (typeof data.message?.content === 'string') return data.message.content;
  if (typeof data.response === 'string') return data.response;
  return '';
}

function postJsonStreaming(urlString, { headers = {}, body, timeoutMs = 120000, providerLabel = 'AI provider', onLine, onCancelRegister }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const client = url.protocol === 'http:' ? http : https;
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let errorText = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { errorText += chunk; });
        res.on('end', () => {
          if (!settled) {
            settled = true;
            reject(new Error(`${providerLabel} error ${res.statusCode}: ${errorText.slice(0, 400)}`));
          }
        });
        return;
      }
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) onLine(line);
      });
      res.on('end', () => {
        if (buffer.trim()) onLine(buffer);
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });

    const abortFn = () => {
      if (!settled) {
        settled = true;
        try { req.destroy(new Error('Request cancelled by user')); } catch {}
        reject(new Error('Request cancelled by user'));
      }
    };
    if (onCancelRegister) onCancelRegister(abortFn);

    req.on('timeout', () => {
      req.destroy(new Error(`${providerLabel} stream timeout after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', err => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    req.write(payload);
    req.end();
  });
}

async function requestAgentTextChatStream({ event, requestId, messages, model, numPredict = 2000, content }) {
  const settings = await getAgentTextRuntimeSettings();
  const requestMessages = messages || [{ role: 'user', content }];
  const send = (payload) => {
    if (!event?.sender?.isDestroyed?.()) {
      event.sender.send('ai-agent-chat-stream', { requestId, ...payload });
    }
  };
  let reply = '';
  let cancelCallback = null;

  activeChatHttpRequests.set(requestId, {
    abort: () => {
      send({ type: 'cancelled', requestId });
      if (cancelCallback) cancelCallback();
    },
  });

  const streamWithSettings = async (runtimeSettings) => {
    if (!runtimeSettings.apiKey) throw getMissingAgentTextRuntimeError(runtimeSettings);
    const body = {
      model: model || runtimeSettings.visionModel,
      stream: true,
      messages: requestMessages,
      max_tokens: numPredict,
    };
    await postJsonStreaming(runtimeSettings.apiUrl, {
      headers: {
        'Authorization': `Bearer ${runtimeSettings.apiKey}`,
      },
      body,
      timeoutMs: 120000,
      providerLabel: 'AI provider',
      onCancelRegister(fn) {
        cancelCallback = fn;
      },
      onLine(rawLine) {
        let line = rawLine.trim();
        if (!line) return;
        if (line.startsWith('data:')) line = line.slice(5).trim();
        if (!line || line === '[DONE]') return;
        let data;
        try {
          data = JSON.parse(line);
        } catch {
          return;
        }
        if (data?.error) {
          throw new Error(`Provider error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        const delta = String(extractAgentTextStreamDelta(data) || '');
        if (delta) {
          reply += delta;
          send({ type: 'delta', delta, model: runtimeSettings.visionModel, source: runtimeSettings.source });
        }
      },
    });
  };

  try {
    await streamWithSettings(settings);
    if (!reply.trim()) throw new Error('AI provider returned an empty text stream.');
    const finalReply = reply.trim();
    send({ type: 'done', reply: finalReply, model: settings.visionModel, source: settings.source });
    return { reply: finalReply, model: settings.visionModel, source: settings.source };
  } finally {
    activeChatHttpRequests.delete(requestId);
  }
}

function extractJsonPayload(reply) {
  const text = String(reply || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const start = objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) return '';
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  return end > start ? text.slice(start, end + 1) : text.slice(start);
}

async function parseModelJson(reply, schemaHint, numPredict = 2200) {
  const payload = extractJsonPayload(reply);
  if (!payload) throw new Error(`Model returned non-JSON response: ${String(reply).slice(0, 240)}`);
  try {
    return JSON.parse(payload);
  } catch (firstErr) {
    const repaired = await requestAgentTextChat({
      numPredict,
      messages: [{
        role: 'user',
        content: [
          'Fix the following malformed JSON into valid JSON only.',
          'Do not explain. Do not use markdown. Preserve the original meaning and schema.',
          schemaHint ? `Schema hint: ${schemaHint}` : '',
          '',
          payload.slice(0, 12000),
        ].filter(Boolean).join('\n'),
      }],
    });
    const repairedPayload = extractJsonPayload(repaired.reply);
    try {
      return JSON.parse(repairedPayload);
    } catch (secondErr) {
      throw new Error(`Model returned invalid JSON and repair failed: ${firstErr.message}; repair: ${secondErr.message}`);
    }
  }
}

ipcMain.handle('ai-agent-chat-cancel', async (_, { requestId } = {}) => {
  if (!requestId) return { cancelled: false };
  const entry = activeChatHttpRequests.get(requestId);
  if (entry) {
    try {
      entry.abort();
    } catch {}
    activeChatHttpRequests.delete(requestId);
    return { cancelled: true, requestId };
  }
  return { cancelled: false, requestId };
});

ipcMain.handle('ai-agent-chat', async (_, { message, history = [], hasPlan = false, workflowContext = null } = {}) => {
  if (!message || !String(message).trim()) throw new Error('Missing chat message');

  const recent = Array.isArray(history) ? history.slice(-12) : [];
  const systemPrompt = [
    `You are the Creative AI Agent inside ${brand.displayName}.`,
    'Chat naturally like ChatGPT in Vietnamese unless the user uses another language.',
    'You specialize in turning creative concepts into actionable workflows for AI image and video generation.',
    'If the user is greeting or asking general questions, answer concisely and warmly.',
    'When the user wants creative assistance, provide concrete scene ideas, artistic direction, lighting, mood, and composition.',
    'Keep your advice structured and practical. Do not output raw internal code.',
    hasPlan ? 'There is an active production plan in the current session.' : 'There is no workflow plan yet.',
    workflowContext?.brief ? `Project Brief: ${String(workflowContext.brief).slice(0, 300)}` : '',
    workflowContext?.planTitle ? `Active Plan: ${String(workflowContext.planTitle).slice(0, 100)}` : '',
    typeof workflowContext?.runItemsCount === 'number' && workflowContext.runItemsCount > 0 ? `Queued Scenes: ${workflowContext.runItemsCount}` : '',
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 2500) })),
    { role: 'user', content: String(message).trim().slice(0, 20000) },
  ];

  const out = await requestAgentTextChat({ messages, numPredict: 2000 });
  return { reply: out.reply, model: out.model, source: out.source };
});

ipcMain.handle('ai-agent-chat-stream', async (event, { requestId, message, history = [], hasPlan = false, workflowContext = null } = {}) => {
  if (!requestId) throw new Error('Missing stream requestId');
  if (!message || !String(message).trim()) throw new Error('Missing chat message');

  const recent = Array.isArray(history) ? history.slice(-12) : [];
  const systemPrompt = [
    `You are the Creative AI Agent inside ${brand.displayName}.`,
    'Chat naturally like ChatGPT in Vietnamese unless the user uses another language.',
    'You specialize in turning creative concepts into actionable workflows for AI image and video generation.',
    'If the user is greeting or asking general questions, answer concisely and warmly.',
    'When the user wants creative assistance, provide concrete scene ideas, artistic direction, lighting, mood, and composition.',
    'Keep your advice structured and practical. Do not output raw internal code.',
    hasPlan ? 'There is an active production plan in the current session.' : 'There is no workflow plan yet.',
    workflowContext?.brief ? `Project Brief: ${String(workflowContext.brief).slice(0, 300)}` : '',
    workflowContext?.planTitle ? `Active Plan: ${String(workflowContext.planTitle).slice(0, 100)}` : '',
    typeof workflowContext?.runItemsCount === 'number' && workflowContext.runItemsCount > 0 ? `Queued Scenes: ${workflowContext.runItemsCount}` : '',
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 2500) })),
    { role: 'user', content: String(message).trim().slice(0, 20000) },
  ];

  try {
    return await requestAgentTextChatStream({ event, requestId, messages, numPredict: 2000 });
  } catch (err) {
    if (!event?.sender?.isDestroyed?.()) {
      event.sender.send('ai-agent-chat-stream', {
        requestId,
        type: 'error',
        error: err?.message || String(err),
      });
    }
    throw err;
  }
});

ipcMain.handle('ai-agent-intent', async (_, { message, history = [], hasReference = false, hasPriorImage = false } = {}) => {
  if (!message || !String(message).trim()) throw new Error('Missing intent message');

  const recent = (Array.isArray(history) ? history.slice(-12) : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content).slice(0, 700)}`)
    .join('\n');

  const prompt = [
    `You are an intent router for an AI image/video generation agent (${brand.displayName}).`,
    'Read the conversation and the latest user message, then decide what the user wants RIGHT NOW.',
    'Return ONLY valid JSON, no markdown, exactly matching this schema:',
    '{"decision":"run|clarify|chat","kind":"image|video|auto","confidence":0-100,"reason":"short Vietnamese"}',
    '',
    'Decision meanings:',
    '- "run": Materialize the requested workflow as queued Canvas nodes, wires, and one enclosing group NOW. This does NOT submit media or spend credit; the user runs the group later.',
    '- "clarify": The user wants a Canvas workflow/draft but the intended subject or output structure is genuinely unknown.',
    '- "chat": Greeting, casual talk, questions, advice/options/ideas, comparisons, or discussion with no current request to create/change Canvas nodes.',
    '',
    'CRITICAL rules (these strongly imply "run"):',
    '- If the assistant just PROPOSED a concept/style/prompt and the user echoes it back, pastes it, repeats those concept words, confirms it, or gives any go-ahead ("ok", "làm đi", "chạy đi", "tạo luôn", "auto", "cái đó", "đúng rồi", "y vậy") => decision="run".',
    '- A short but concrete concept phrase that has a subject + at least one of {style, setting, mood, action} (e.g. "chú mèo cute phong cách 3D Pixar") means the user has decided => decision="run".',
    '- When in doubt between "run" and "clarify", and a concrete concept already exists in the recent conversation, prefer "run".',
    '- "Create/draft/build nodes, wires, graph, group, storyboard, or workflow on Canvas" => decision="run", even if the user also says "do not render", "không render", or "I will run it myself". That negative phrase blocks media submission, not draft creation.',
    '- If the user explicitly says not to create/change nodes and only wants discussion/advice => decision="chat".',
    '- Only use "clarify" when you genuinely cannot tell WHAT to create.',
    '- Pure greetings, "bạn là ai", thanks, or "nên chọn hướng nào?" => decision="chat".',
    '- Default kind to "image" unless the user clearly wants motion/video/clip; use "auto" only if truly ambiguous.',
    hasReference ? '- A reference image/video is already attached or tagged this session.' : '- No reference media attached this session.',
    hasPriorImage ? '- An image has already been generated earlier this session.' : '- No image generated yet this session.',
    '',
    `Conversation so far:\n${recent || '(empty)'}`,
    '',
    `Latest user message:\n${String(message).trim()}`,
  ].join('\n');

  const out = await requestAgentTextChat({ messages: [{ role: 'user', content: prompt }], numPredict: 200 });
  let parsed = null;
  try {
    parsed = await parseModelJson(
      out.reply,
      '{"decision":"run|clarify|chat","kind":"image|video|auto","confidence":0-100,"reason":"string"}',
      200
    );
  } catch {
    parsed = null;
  }

  let decision = parsed && ['run', 'clarify', 'chat'].includes(parsed.decision) ? parsed.decision : 'chat';
  let kind = parsed && ['image', 'video', 'auto'].includes(parsed.kind) ? parsed.kind : 'auto';
  let confidence = parsed && Number.isFinite(Number(parsed.confidence))
    ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidence))))
    : 0;
  let reason = parsed && typeof parsed.reason === 'string' ? parsed.reason : '';
  let reviewed = false;

  // A second, narrow LLM adjudication is intentionally used instead of another
  // growing list of Vietnamese/English approval keywords. The first router can be
  // overly conservative on long production briefs and classify a fully specified
  // final command as "clarify". The reviewer sees the first verdict and decides
  // whether a genuinely renderable contract is already present in the conversation.
  if (decision !== 'run') {
    const reviewPrompt = [
      'You are the senior adjudicator for an AI image/video generation intent router.',
      'Review the junior router verdict. Decide the action required RIGHT NOW from meaning and conversation state, not from a fixed keyword list.',
      'Return ONLY valid JSON matching:',
      '{"decision":"run|clarify|chat","kind":"image|video|auto","confidence":0-100,"reason":"short Vietnamese"}',
      '',
      'Adjudication policy:',
      '- Choose run when the latest turn finalizes, approves, or directly requests a queued Canvas workflow/draft and the conversation identifies the intended output scope.',
      '- Exact counts, output types, aspect, duration, phase/scope corrections, or an explicit finalization are strong evidence that the user expects execution now.',
      '- Late corrections override older ideas. A request may be renderable even when some aesthetic details must be inferred.',
      '- Missing attached media is not by itself a reason to clarify unless the user explicitly requires unavailable media and generation cannot proceed without it.',
      '- Choose clarify only when the requested media subject or required output is genuinely unknown. Choose chat only for discussion with no current execution request.',
      '- Do not upgrade to run if the latest turn explicitly asks only for advice, options, or a proposal. Saying not to render is still run when the user explicitly asks to create Canvas nodes/group, because media submission is a later manual action.',
      '',
      `Junior verdict:\n${JSON.stringify({ decision, kind, confidence, reason })}`,
      '',
      `Conversation so far:\n${recent || '(empty)'}`,
      '',
      `Latest user message:\n${String(message).trim()}`,
    ].join('\n');
    try {
      const reviewOut = await requestAgentTextChat({ messages: [{ role: 'user', content: reviewPrompt }], numPredict: 220 });
      const review = await parseModelJson(
        reviewOut.reply,
        '{"decision":"run|clarify|chat","kind":"image|video|auto","confidence":0-100,"reason":"string"}',
        220
      );
      if (review && ['run', 'clarify', 'chat'].includes(review.decision)) {
        decision = review.decision;
        kind = ['image', 'video', 'auto'].includes(review.kind) ? review.kind : kind;
        confidence = Number.isFinite(Number(review.confidence))
          ? Math.max(0, Math.min(100, Math.round(Number(review.confidence))))
          : confidence;
        reason = typeof review.reason === 'string' ? review.reason : reason;
        reviewed = true;
      }
    } catch (reviewError) {
      console.warn('[AI-AGENT] Intent adjudication failed, keeping first verdict:', reviewError?.message || reviewError);
    }
  }

  // Long chats can contain assistant questions/proposals that bias both routers
  // toward "chat" even when the user's final turn clearly closes the decision.
  // A last semantic appeal uses user-authored turns only. It runs solely when the
  // two earlier decisions still refuse execution, so normal latency is unchanged.
  if (decision !== 'run') {
    const userOnlyContext = (Array.isArray(history) ? history : [])
      .filter(item => item?.role === 'user' && item.content)
      .slice(-8)
      .map((item, index) => `User turn ${index + 1}: ${String(item.content).slice(0, 900)}`)
      .join('\n');
    const appealPrompt = [
      'You are the final execution-intent judge for an AI media production agent.',
      'Read only what the user authored. Decide whether the latest turn asks the app to materialize a sufficiently defined queued Canvas workflow now.',
      'Reason semantically across the whole user brief. Earlier user turns may contain subject, style, counts, copy, and constraints while the final turn only approves/finalizes them.',
      'Return ONLY JSON: {"decision":"run|clarify|chat","kind":"image|video|auto","confidence":0-100,"reason":"short Vietnamese"}.',
      'Use run for current Canvas draft creation/final approval; clarify only when the intended subject/output is unknown; chat for advice/discussion with no graph mutation request. A no-render instruction still permits run when it accompanies an explicit request for nodes/wires/group, because run does not submit media.',
      '',
      userOnlyContext || '(no earlier user turns)',
      `Latest user turn: ${String(message).trim()}`,
    ].join('\n');
    try {
      const appealOut = await requestAgentTextChat({ messages: [{ role: 'user', content: appealPrompt }], numPredict: 220 });
      const appeal = await parseModelJson(
        appealOut.reply,
        '{"decision":"run|clarify|chat","kind":"image|video|auto","confidence":0-100,"reason":"string"}',
        220
      );
      if (appeal && ['run', 'clarify', 'chat'].includes(appeal.decision)) {
        decision = appeal.decision;
        kind = ['image', 'video', 'auto'].includes(appeal.kind) ? appeal.kind : kind;
        confidence = Number.isFinite(Number(appeal.confidence))
          ? Math.max(0, Math.min(100, Math.round(Number(appeal.confidence))))
          : confidence;
        reason = typeof appeal.reason === 'string' ? appeal.reason : reason;
        reviewed = true;
      }
    } catch (appealError) {
      console.warn('[AI-AGENT] Final user-only intent appeal failed, keeping prior verdict:', appealError?.message || appealError);
    }
  }

  return { decision, kind, confidence, reason, reviewed, model: out.model, source: out.source };
});

ipcMain.handle('ai-agent-workflow', async (_, {
  systemPrompt,
  brief,
  finalInstruction = '',
  expectedImageCount = null,
  expectedVideoCount = null,
  kind = 'campaign',
  aspect = 'landscape',
} = {}) => {
  if (!brief || !String(brief).trim()) throw new Error('Missing workflow brief');

  const authoritativeFinalInstruction = String(finalInstruction || '').trim();
  let requestedImageCount = expectedImageCount !== null && expectedImageCount !== undefined
    && Number.isInteger(Number(expectedImageCount)) && Number(expectedImageCount) >= 0
    ? Number(expectedImageCount)
    : null;
  let requestedVideoCount = expectedVideoCount !== null && expectedVideoCount !== undefined
    && Number.isInteger(Number(expectedVideoCount)) && Number(expectedVideoCount) >= 0
    ? Number(expectedVideoCount)
    : null;

  // Deterministic parsing covers explicit common nouns, but production briefs
  // also use semantic output names such as character sheet, moodboard, keyframe
  // set, animatic, or hero asset. Ask the selected LLM only for missing count
  // dimensions instead of growing a domain-specific keyword dictionary.
  if (authoritativeFinalInstruction && (requestedImageCount === null || requestedVideoCount === null)) {
    try {
      const scopeOut = await requestAgentTextChat({
        numPredict: 260,
        messages: [{
          role: 'user',
          content: [
            'Extract the CURRENT approved media output counts from the instruction by meaning.',
            'Return ONLY JSON: {"imageCount":number|null,"videoCount":number|null}.',
            'Count image-like deliverables (image, photo, poster, key visual, character sheet, moodboard, keyframe, product shot) as images.',
            'Count motion deliverables (video, clip, reel, animation, animatic) as videos.',
            'Use null when that output kind is truly not specified. Respect exclusions, phase limits, reductions, and late corrections; do not count references or future/unapproved outputs.',
            'The full context may define counts while the final instruction only approves/finalizes them. In that case, return the approved contextual counts. The final instruction always overrides older context.',
            '',
            `FULL CREATIVE CONTEXT:\n${String(brief).trim().slice(0, 12000)}`,
            '',
            `AUTHORITATIVE FINAL INSTRUCTION:\n${authoritativeFinalInstruction}`,
          ].join('\n'),
        }],
      });
      const scope = await parseModelJson(scopeOut.reply, '{"imageCount":0,"videoCount":0}', 260);
      if (requestedImageCount === null && scope?.imageCount !== null && scope?.imageCount !== undefined && Number.isInteger(Number(scope.imageCount)) && Number(scope.imageCount) >= 0) {
        requestedImageCount = Number(scope.imageCount);
      }
      if (requestedVideoCount === null && scope?.videoCount !== null && scope?.videoCount !== undefined && Number.isInteger(Number(scope.videoCount)) && Number(scope.videoCount) >= 0) {
        requestedVideoCount = Number(scope.videoCount);
      }
    } catch (scopeError) {
      console.warn('[AI-AGENT] Dynamic output-scope extraction failed, preserving deterministic/baseline counts:', scopeError?.message || scopeError);
    }
  }
  const structuredScope = requestedImageCount !== null || requestedVideoCount !== null
    ? `Validated explicit output contract: images=${requestedImageCount ?? 'unspecified'}, videos=${requestedVideoCount ?? 'unspecified'}.`
    : '';

  const out = await requestAgentTextChat({
    numPredict: 3200,
    messages: [
      { role: 'system', content: String(systemPrompt || '') },
      {
        role: 'user',
        content: [
          `Workflow kind: ${kind}`,
          `Aspect: ${aspect}`,
          authoritativeFinalInstruction
            ? [
              'AUTHORITATIVE FINAL INSTRUCTION (current approved scope):',
              authoritativeFinalInstruction,
              structuredScope,
              'Use earlier conversation only for subject/style/continuity context. This final instruction overrides earlier counts, phases, aspect, duration, selected concepts, and discarded subjects.',
              'Do not create extra image/video scenes beyond this final scope.',
            ].join('\n')
            : '',
          'Brief:',
          String(brief).trim(),
        ].filter(Boolean).join('\n'),
      },
    ],
  });
  let plan = await parseModelJson(
    out.reply,
    '{"title":"string","assistantReply":"Vietnamese natural reply","summary":"string","kind":"image|video|campaign","aspect":"landscape|portrait","imagePrompts":["string"],"videoPrompts":["string"],"scenes":[{"title":"string","intent":"image|video","prompt":"string","camera":"string","duration":"string"}]}',
    3200
  );

  let qualityReviewed = false;
  const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
  if (authoritativeFinalInstruction && scenes.length) {
    const baselineImageCount = scenes.filter(scene => scene?.intent === 'image').length;
    const baselineVideoCount = scenes.filter(scene => scene?.intent === 'video').length;
    const protectedImageCount = requestedImageCount ?? baselineImageCount;
    const protectedVideoCount = requestedVideoCount ?? baselineVideoCount;
    const reviewScope = `Protected review structure: images=${protectedImageCount}, videos=${protectedVideoCount}. Explicit validated counts override the draft; unspecified output kinds preserve the draft count.`;
    const reviewPrompt = [
      'You are the final production editor for an AI image/video workflow.',
      'Audit the proposed scene prompts against the conversation and the authoritative final instruction.',
      'Use semantic judgment. Do not rely on a fixed keyword checklist.',
      '',
      'Look for meaningful omissions such as: brand/product identity, exact visible copy or slogan, defining materials/colors, selected location/concept, required action or ending state, continuity anchors, and explicit exclusions or late corrections.',
      'If the proposed plan has the wrong number or mix of image/video scenes, rebuild it to match the exact final instruction. Give every output a distinct production purpose instead of duplicating one generic scene.',
      'Use only supported per-video durations 4s, 6s, or 8s. When a total duration is requested, distribute it across the exact requested clip count when mathematically possible; otherwise choose the nearest valid total without exceeding six clips.',
      'Do not force every constraint into every scene; place each relevant constraint in the scene(s) where it belongs.',
      'Discarded concepts may be expressed as concise negative constraints, but must not become positive visual content.',
      '',
      'Return ONLY valid JSON matching:',
      '{"plan":{"title":"string","assistantReply":"Vietnamese natural reply","summary":"string","kind":"image|video|campaign","aspect":"landscape|portrait","imagePrompts":["string"],"videoPrompts":["string"],"scenes":[{"title":"string","intent":"image|video","prompt":"string","camera":"string","duration":"4s|6s|8s"}]}}',
      'Always return the complete reviewed plan, even when no changes are needed.',
      '',
      `AUTHORITATIVE FINAL INSTRUCTION:\n${authoritativeFinalInstruction}`,
      structuredScope,
      reviewScope,
      '',
      `FULL CREATIVE CONTEXT:\n${String(brief).trim()}`,
      '',
      `PROPOSED PLAN:\n${JSON.stringify(plan)}`,
      '',
      `FINAL CONTRACT CHECK — obey exactly:\n${authoritativeFinalInstruction}`,
      structuredScope,
      reviewScope,
    ].join('\n');
    try {
      const reviewOut = await requestAgentTextChat({ messages: [{ role: 'user', content: reviewPrompt }], numPredict: 3600 });
      const review = await parseModelJson(
        reviewOut.reply,
        '{"plan":{"title":"string","assistantReply":"string","summary":"string","kind":"image|video|campaign","aspect":"landscape|portrait","imagePrompts":["string"],"videoPrompts":["string"],"scenes":[{"title":"string","intent":"image|video","prompt":"string","camera":"string","duration":"string"}]}}',
        3600
      );
      // Some OpenAI-compatible models occasionally honor the inner workflow
      // schema but omit the cosmetic top-level { plan } wrapper. Accept both
      // valid shapes; structural validation below still rejects malformed data.
      let reviewedPlan = review?.plan || (Array.isArray(review?.scenes) ? review : null);
      const matchesExplicitCounts = candidate => {
        const candidateScenes = Array.isArray(candidate?.scenes) ? candidate.scenes : [];
        const imageCount = candidateScenes.filter(scene => scene?.intent === 'image').length;
        const videoCount = candidateScenes.filter(scene => scene?.intent === 'video').length;
        return imageCount === protectedImageCount && videoCount === protectedVideoCount;
      };
      if ((!reviewedPlan || !matchesExplicitCounts(reviewedPlan)) && structuredScope) {
        const rejectedScenes = Array.isArray(reviewedPlan?.scenes) ? reviewedPlan.scenes : [];
        const rejectedImages = rejectedScenes.filter(scene => scene?.intent === 'image').length;
        const rejectedVideos = rejectedScenes.filter(scene => scene?.intent === 'video').length;
        const retryOut = await requestAgentTextChat({
          messages: [{
            role: 'user',
            content: [
              reviewPrompt,
              '',
              `REJECTED STRUCTURE: your previous review returned images=${rejectedImages}, videos=${rejectedVideos}.`,
              reviewScope,
              'Rebuild the complete plan now with the exact validated counts. Every scene must have a distinct purpose. Return JSON only.',
            ].join('\n'),
          }],
          numPredict: 3600,
        });
        const retryReview = await parseModelJson(
          retryOut.reply,
          '{"plan":{"title":"string","assistantReply":"string","summary":"string","kind":"image|video|campaign","aspect":"landscape|portrait","imagePrompts":["string"],"videoPrompts":["string"],"scenes":[{"title":"string","intent":"image|video","prompt":"string","camera":"string","duration":"string"}]}}',
          3600
        );
        const retryPlan = retryReview?.plan || (Array.isArray(retryReview?.scenes) ? retryReview : null);
        if (retryPlan && matchesExplicitCounts(retryPlan)) reviewedPlan = retryPlan;
      }
      const reviewedScenes = Array.isArray(reviewedPlan?.scenes) ? reviewedPlan.scenes : null;
      if (reviewedScenes && matchesExplicitCounts(reviewedPlan) && reviewedScenes.length && reviewedScenes.every(scene =>
        scene && ['image', 'video'].includes(scene.intent) && typeof scene.prompt === 'string' && scene.prompt.trim()
      )) {
        plan = {
          ...plan,
          ...reviewedPlan,
          assistantReply: typeof reviewedPlan.assistantReply === 'string' && reviewedPlan.assistantReply.trim()
            ? reviewedPlan.assistantReply
            : plan.assistantReply,
          scenes: reviewedScenes,
          imagePrompts: reviewedScenes.filter(scene => scene.intent === 'image').map(scene => scene.prompt),
          videoPrompts: reviewedScenes.filter(scene => scene.intent === 'video').map(scene => scene.prompt),
        };
        qualityReviewed = true;
      }
    } catch (reviewError) {
      // Quality review is additive. A timeout or malformed patch must never make
      // a valid workflow unavailable, so keep the original structurally valid plan.
      console.warn('[AI-AGENT] Workflow quality review failed, keeping original plan:', reviewError?.message || reviewError);
    }
  }

  return {
    plan,
    assistantReply: plan && typeof plan.assistantReply === 'string' ? plan.assistantReply : '',
    qualityReviewed,
    model: out.model,
    source: out.source,
  };
});

ipcMain.handle('ai-agent-polish-workflow', async (_, { brief, finalInstruction = '', plan } = {}) => {
  const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
  if (!scenes.length) return { plan, polished: false };
  const ensureDistinctVideoBeats = inputPlan => {
    const inputScenes = Array.isArray(inputPlan?.scenes) ? inputPlan.scenes : [];
    const videoIndexes = inputScenes
      .map((scene, index) => scene?.intent === 'video' ? index : -1)
      .filter(index => index >= 0);
    if (videoIndexes.length < 2) return { plan: inputPlan, changed: false };
    const normalizePrompt = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const groups = new Map();
    for (const index of videoIndexes) {
      const key = normalizePrompt(inputScenes[index]?.prompt)
        .replace(/this is clip \d+\/\d+[^.]*\.?/g, '')
        .replace(/clip \d+/g, 'clip')
        .trim()
        .slice(0, 320);
      const indexes = groups.get(key) || [];
      indexes.push(index);
      groups.set(key, indexes);
    }
    const duplicateIndexes = new Set([...groups.values()].filter(indexes => indexes.length > 1).flat());
    if (!duplicateIndexes.size) return { plan: inputPlan, changed: false };
    const nextScenes = inputScenes.map((scene, index) => {
      if (!duplicateIndexes.has(index)) return scene;
      const beat = videoIndexes.indexOf(index) + 1;
      return {
        ...scene,
        prompt: `${scene.prompt}\nDistinct production beat ${beat}/${videoIndexes.length}: progress the approved journey instead of repeating another clip. Authoritative final journey and constraints: ${String(finalInstruction || '').trim()}`.trim(),
      };
    });
    return {
      changed: true,
      plan: {
        ...inputPlan,
        scenes: nextScenes,
        imagePrompts: nextScenes.filter(scene => scene.intent === 'image').map(scene => scene.prompt),
        videoPrompts: nextScenes.filter(scene => scene.intent === 'video').map(scene => scene.prompt),
      },
    };
  };
  const prompt = [
    'You are the last scene-level production editor after structural safety guardrails have already run.',
    'The scene count, order, intent, duration, and aspect are LOCKED. Rewrite content only.',
    'Ensure every image/video scene has a distinct purpose and together they cover the approved story/product journey, including required final locations/actions/copy/continuity. Repair duplicated prompts created by duration splitting.',
    'Do not add, remove, reorder, or change intent/duration. Return one update for every image/video scene index that needs improvement.',
    'Return ONLY JSON: {"updates":[{"index":0,"title":"string","prompt":"complete replacement prompt","camera":"string"}]}.',
    '',
    `FULL CONTEXT:\n${String(brief || '').slice(0, 12000)}`,
    `FINAL INSTRUCTION:\n${String(finalInstruction || '')}`,
    `LOCKED PLAN:\n${JSON.stringify(plan).slice(0, 18000)}`,
  ].join('\n');
  try {
    const out = await requestAgentTextChat({ messages: [{ role: 'user', content: prompt }], numPredict: 3600 });
    const review = await parseModelJson(
      out.reply,
      '{"updates":[{"index":0,"title":"string","prompt":"string","camera":"string"}]}',
      3600
    );
    const updates = Array.isArray(review?.updates) ? review.updates : [];
    if (!updates.length) {
      const fallback = ensureDistinctVideoBeats(plan);
      return { plan: fallback.plan, polished: fallback.changed, model: out.model, source: out.source };
    }
    const nextScenes = scenes.map(scene => ({ ...scene }));
    let applied = false;
    for (const update of updates) {
      const index = Number(update?.index);
      if (!Number.isInteger(index) || index < 0 || index >= nextScenes.length) continue;
      const current = nextScenes[index];
      if (!current || !['image', 'video'].includes(current.intent)) continue;
      const nextPrompt = typeof update.prompt === 'string' ? update.prompt.trim() : '';
      if (!nextPrompt) continue;
      current.prompt = nextPrompt;
      if (typeof update.title === 'string' && update.title.trim()) current.title = update.title.trim();
      if (current.intent === 'video' && typeof update.camera === 'string' && update.camera.trim()) current.camera = update.camera.trim();
      applied = true;
    }
    if (!applied) {
      const fallback = ensureDistinctVideoBeats(plan);
      return { plan: fallback.plan, polished: fallback.changed, model: out.model, source: out.source };
    }
    const polishedPlan = {
      ...plan,
      scenes: nextScenes,
      imagePrompts: nextScenes.filter(scene => scene.intent === 'image').map(scene => scene.prompt),
      videoPrompts: nextScenes.filter(scene => scene.intent === 'video').map(scene => scene.prompt),
    };
    const distinct = ensureDistinctVideoBeats(polishedPlan);
    return { plan: distinct.plan, polished: true, model: out.model, source: out.source };
  } catch (error) {
    console.warn('[AI-AGENT] Final workflow polish failed, keeping guarded plan:', error?.message || error);
    const fallback = ensureDistinctVideoBeats(plan);
    return { plan: fallback.plan, polished: fallback.changed };
  }
});

ipcMain.handle('ai-agent-deep-analyze', async (_, { brief, localAnalysis = {}, references = [] } = {}) => {
  if (!brief || !String(brief).trim()) throw new Error('Missing brief for deep analysis');

  const prompt = [
    'You are a senior creative strategist for an AI image/video workflow agent.',
    'Analyze the user brief, infer missing production decisions, and prepare it for Google Flow image/video generation.',
    'Return ONLY valid JSON, no markdown, exactly compatible with this schema:',
    '{"intent":"image|video|campaign","aspect":"landscape|portrait","domain":"product|character|real_estate|food|fashion|education|app_promo|music_video|other","audience":"Vietnamese short text","goal":"Vietnamese short text","sceneStrategy":"Vietnamese short text","riskWarnings":["Vietnamese warning"],"missingInfo":["Vietnamese missing info"],"questions":["Vietnamese question"],"productionBrief":"English production-ready creative brief for image/video generation","rubric":{"subject":"pass|warn|missing","style":"pass|warn|missing","camera":"pass|warn|missing","lighting":"pass|warn|missing","action":"pass|warn|missing","format":"pass|warn|missing","cta":"pass|warn|missing"}}',
    '',
    'Rules:',
    '- If the user is low technical, ask only practical questions that improve output.',
    '- productionBrief must be in English, concrete, and usable as input for downstream prompt generation.',
    '- Prefer portrait for TikTok/Reels/Shorts/mobile social; landscape for YouTube/website/cinematic/storyboard unless brief says otherwise.',
    '- If references are attached, preserve identity/product shape/color/material/style from them.',
    '- Keep questions under 5 and missingInfo under 6.',
    '',
    `User brief:\n${String(brief).trim()}`,
    '',
    `Local heuristic analysis:\n${JSON.stringify(localAnalysis).slice(0, 4000)}`,
    '',
    `Reference images:\n${JSON.stringify(references).slice(0, 3000)}`,
  ].join('\n');

  const out = await requestAgentTextChat({ messages: [{ role: 'user', content: prompt }], numPredict: 1400 });
  const analysis = await parseModelJson(
    out.reply,
    '{"intent":"image|video|campaign","aspect":"landscape|portrait","domain":"string","audience":"string","goal":"string","sceneStrategy":"string","riskWarnings":["string"],"missingInfo":["string"],"questions":["string"],"productionBrief":"string","rubric":{"subject":"pass|warn|missing","style":"pass|warn|missing","camera":"pass|warn|missing","lighting":"pass|warn|missing","action":"pass|warn|missing","format":"pass|warn|missing","cta":"pass|warn|missing"}}',
    1800
  );
  return {
    analysis,
    model: out.model,
    source: out.source,
  };
});

ipcMain.handle('ai-agent-review-output', async (_, { prompt, outputKind = 'image', outputUrl = '' } = {}) => {
  if (!prompt || !String(prompt).trim()) throw new Error('Missing prompt for output review');

  const reviewPrompt = [
    'You are a strict creative director reviewing AI-generated image/video output for a production workflow.',
    'Return ONLY a JSON object, no markdown:',
    '{"score":0-100,"verdict":"short Vietnamese verdict","issues":["issue in Vietnamese"],"improvedPrompt":"improved English prompt for retry"}',
    '',
    `Output kind: ${outputKind}`,
    `Original prompt: ${String(prompt).trim()}`,
    outputUrl ? `Output URL: ${String(outputUrl).slice(0, 1000)}` : '',
    '',
    'Judge prompt-output fitness, composition, consistency, product/character clarity, lighting, motion quality for video, and common AI artifacts. If you cannot inspect the media URL, still review the prompt and produce a stronger retry prompt.',
  ].filter(Boolean).join('\n');

  const content = [{ type: 'text', text: reviewPrompt }];
  if (outputKind === 'image' && outputUrl && /^https?:\/\//.test(outputUrl)) {
    content.push({ type: 'image_url', image_url: { url: outputUrl } });
  }

  const out = await requestAgentTextChat({ messages: [{ role: 'user', content }], numPredict: 1000 });
  return parseModelJson(out.reply, '{"score":0,"verdict":"string","issues":["string"],"improvedPrompt":"string"}', 1200);
});

// AI auto-detect for the Remove flickers feature.
//
// Pipeline:
//   1. Extract 5 frames evenly spaced across the requested clip range (via
//      ffmpeg's `select=eq(n\,X)` filter), encoded to small JPEG (256×256).
//   2. Send the frames to the active custom OpenAI-compatible vision provider
//      with a structured prompt that asks for JSON output.
//   3. Parse the JSON, normalize the values to our enum, return to renderer.
//
// The model only DECIDES the Mode + Level — actual flicker removal is still
// done by FFmpeg's `deflicker` filter at export time. So this is "AI advisor"
// not "AI processing" — much cheaper, and the model's answer just sets
// dropdowns the user can override.
ipcMain.handle('ai-suggest-deflicker', async (_, { videoPath, startTime = 0, endTime = 0 } = {}) => {
  const provider = await getVisionProviderRuntime();
  if (!videoPath) throw new Error('Missing video path for AI flicker analysis');

  const resolved = resolveLocalPath(videoPath);
  if (!fs.existsSync(resolved)) throw new Error(`Video không tồn tại: ${resolved}`);

  // Step 1: extract 5 sample frames into /tmp.
  const tmpRoot = path.join(app.getPath('temp'), `veo3-ai-deflicker-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    const dur = Math.max(0.1, Number(endTime) > Number(startTime) ? Number(endTime) - Number(startTime) : 0);
    // If we don't have a known duration, just sample the first 6 seconds.
    const sampleSpan = dur > 0 ? dur : 6;
    const start = Math.max(0, Number(startTime) || 0);
    // Pick 5 evenly-spaced timestamps across the span.
    const timestamps = [0.05, 0.275, 0.5, 0.725, 0.95].map(p => start + p * sampleSpan);

    const frameFiles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const out = path.join(tmpRoot, `frame-${i}.jpg`);
      // -ss before -i for fast seek; small JPEG to keep API payload tiny.
      await runFfmpeg(
        ['-y', '-ss', String(timestamps[i]), '-i', resolved, '-frames:v', '1', '-vf', 'scale=256:256:force_original_aspect_ratio=decrease,pad=256:256:(ow-iw)/2:(oh-ih)/2:black', '-q:v', '5', out],
        `AI deflicker frame ${i + 1}`,
        30_000,
      );
      if (!fs.existsSync(out)) throw new Error(`Frame ${i + 1} extraction failed`);
      frameFiles.push(out);
    }

    // Step 2: build OpenAI-compatible vision messages and POST to the active provider.
    // Using /v1/chat/completions because it has a stable schema for image
    // inputs across many vision models.
    const images = frameFiles.map(f => `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`);
    const prompt = [
      'You are a video flicker analysis assistant. The 5 attached images are evenly-spaced sample frames from a short video clip.',
      '',
      'Compare the OVERALL BRIGHTNESS / EXPOSURE across the frames. Look for:',
      '- "flashlight" pattern: sudden bright spikes / strobe (one frame much brighter or darker than its neighbors). Common with fluorescent or LED lights at the wrong shutter speed.',
      '- "timelapse" pattern: gradual exposure drift (each frame slightly brighter/darker than the previous one). Common with time-lapse photography and auto-exposure.',
      '- "none": no visible flicker.',
      '',
      'Then judge severity:',
      '- "weak": subtle flicker, barely visible',
      '- "recommended": noticeable but not severe',
      '- "strong": severe strobing or large drift',
      '',
      'Return ONLY a JSON object, no prose, no markdown fences:',
      '{"mode": "flashlight" | "timelapse", "level": "weak" | "recommended" | "strong", "confidence": 0-100, "reason": "<one short sentence>"}',
      '',
      'If no flicker is visible, still recommend a default {"mode":"flashlight","level":"weak","confidence":10,"reason":"No clear flicker detected — applying minimal smoothing."}',
    ].join('\n');

    const body = {
      model: provider.visionModel,
      stream: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...images.map(url => ({ type: 'image_url', image_url: { url } })),
        ],
      }],
    };

    const res = await net.fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`AI provider error ${res.status}: ${text.slice(0, 400)}`);
    }
    const data = JSON.parse(text || '{}');
    const reply = data.choices?.[0]?.message?.content || '';

    // Step 3: extract JSON. Models occasionally wrap in ```json fences; strip them.
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Model returned non-JSON response: ${reply.slice(0, 200)}`);
    }
    const parsed = JSON.parse(jsonMatch[0]);

    // Normalize / clamp to our enum values so a hallucinated label doesn't
    // crash the renderer.
    const validModes = ['flashlight', 'timelapse'];
    const validLevels = ['weak', 'recommended', 'strong'];
    const mode = validModes.includes(parsed.mode) ? parsed.mode : 'flashlight';
    const level = validLevels.includes(parsed.level) ? parsed.level : 'recommended';
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    const reason = String(parsed.reason || '').slice(0, 240);

    return { mode, level, confidence, reason, model: settings.visionModel };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

ipcMain.handle('lip-sync-video', async (event, {
  videoPath,
  audioPath,
  audioUrl,
  startTime = 0,
  endTime = 0,
  outputName,
  keepBgSound = true,
  model,
  progressTag,
}) => {
  // Cloud-only path. Local Wav2Lip/MuseTalk has been removed entirely —
  // it had too many platform-specific failure modes (mmcv ABI, missing
  // pkg_resources, "Face not detected" on non-human videos, etc.) and the
  // Sync.so cloud API handles all the same cases more reliably.
  const settings = getLipSyncSettings();
  const apiKey = getLipSyncApiKey();
  if (!apiKey) {
    throw new Error('Lip-sync provider is not configured. Select a lip-sync provider profile.');
  }
  if (!settings.apiBase || !settings.model) throw new Error('Lip-sync provider Base URL and model are required.');
  if (!videoPath) throw new Error('Missing video source for Lip sync');
  if (!audioPath && !audioUrl) throw new Error('Missing audio source for Lip sync');

  const videoResolved = resolveLocalPath(videoPath);
  if (!fs.existsSync(videoResolved)) throw new Error(`Video không tồn tại: ${videoResolved}`);

  const tmpRoot = path.join(app.getPath('temp'), `veo3-lipsync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const finalDir = path.join(getVideoOutputDir(), 'lip-sync');
  fs.mkdirSync(tmpRoot, { recursive: true });
  fs.mkdirSync(finalDir, { recursive: true });

  const clipDuration = Math.max(0.1, Number(endTime) > Number(startTime) ? Number(endTime) - Number(startTime) : 0);
  const sourceDuration = clipDuration || 15;
  const maxUploadBytes = 19 * 1024 * 1024;
  const maxVideoKbps = Math.floor((maxUploadBytes * 8 / Math.max(1, sourceDuration) / 1000) - 180);
  const videoKbps = Math.max(420, Math.min(2200, maxVideoKbps));
  if (videoKbps < 420) {
    throw new Error('Clip quá dài để upload Lip sync trực tiếp. Hãy cắt clip ngắn hơn trước khi Generate.');
  }

  const preparedVideo = path.join(tmpRoot, 'video.mp4');
  const preparedAudio = path.join(tmpRoot, 'audio.mp3');
  const downloadedAudio = path.join(tmpRoot, 'source-audio.bin');
  const downloadedOutput = path.join(tmpRoot, 'sync-output.mp4');
  const finalName = safeMediaName(outputName || `lip-sync-${Date.now()}.mp4`);
  const finalPath = path.join(finalDir, finalName);
  const mixedPath = path.join(finalDir, finalName.replace(/\.mp4$/i, '-with-bg.mp4'));

  try {
    emitLipSyncProgress(event, progressTag, 3, 'preparing');

    const videoArgs = ['-y'];
    if (Number(startTime) > 0) videoArgs.push('-ss', String(startTime));
    videoArgs.push('-i', videoResolved);
    if (clipDuration > 0) videoArgs.push('-t', String(clipDuration));
    videoArgs.push(
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', "scale=-2:'min(720,ih)':flags=lanczos,setsar=1",
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-b:v', `${videoKbps}k`,
      '-maxrate', `${Math.round(videoKbps * 1.15)}k`,
      '-bufsize', `${videoKbps * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      preparedVideo,
    );
    await runFfmpeg(videoArgs, 'Lip sync video prepare');
    emitLipSyncProgress(event, progressTag, 14, 'preparing');

    if (audioUrl) {
      await downloadUrlToFile(audioUrl, downloadedAudio, { event, tag: progressTag, from: 14, to: 20 });
    }
    const audioResolved = audioPath ? resolveLocalPath(audioPath) : downloadedAudio;
    if (!fs.existsSync(audioResolved)) throw new Error(`Audio không tồn tại: ${audioResolved}`);

    const audioArgs = ['-y', '-i', audioResolved, '-vn'];
    if (clipDuration > 0) audioArgs.push('-t', String(clipDuration));
    audioArgs.push('-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', preparedAudio);
    await runFfmpeg(audioArgs, 'Lip sync audio prepare', 180_000);
    emitLipSyncProgress(event, progressTag, 24, 'uploading');

    let jobId = '';
    {
      const vSize = fs.statSync(preparedVideo).size;
      const aSize = fs.statSync(preparedAudio).size;
      if (vSize > 20 * 1024 * 1024 || aSize > 20 * 1024 * 1024) {
        throw new Error(`Lip sync upload quá lớn (${Math.round((vSize + aSize) / 1024 / 1024)}MB). Hãy cắt clip/audio ngắn hơn.`);
      }

      const form = new FormData();
      form.append('model', model || settings.model || 'sync-3');
      form.append('options', JSON.stringify({ sync_mode: 'loop' }));
      form.append('video', new Blob([fs.readFileSync(preparedVideo)], { type: 'video/mp4' }), 'video.mp4');
      form.append('audio', new Blob([fs.readFileSync(preparedAudio)], { type: 'audio/mpeg' }), 'audio.mp3');

      const createRes = await net.fetch(`${settings.apiBase}/v2/generate`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: form,
      });
      const createText = await createRes.text();
      if (!createRes.ok) {
        throw new Error(`Sync.so create error ${createRes.status}: ${createText.slice(0, 400)}`);
      }
      const createData = JSON.parse(createText || '{}');
      jobId = createData.id || createData.job_id || createData.generation?.id;
      if (!jobId) throw new Error('Sync.so did not return a job id');
      emitLipSyncProgress(event, progressTag, 32, 'processing');

      let outputUrl = '';
      const maxPolls = 240;
      for (let i = 0; i < maxPolls; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 1200 : 3000));
        const pollRes = await net.fetch(`${settings.apiBase}/v2/generate/${jobId}`, {
          headers: { 'x-api-key': apiKey },
        });
        const pollText = await pollRes.text();
        if (!pollRes.ok) {
          throw new Error(`Sync.so poll error ${pollRes.status}: ${pollText.slice(0, 400)}`);
        }
        const data = JSON.parse(pollText || '{}');
        const status = String(data.status || data.state || '').toUpperCase();
        outputUrl = data.outputUrl || data.output_url || data.result?.outputUrl || data.result?.url || '';
        const timePct = 32 + Math.min(56, (i / Math.max(1, maxPolls - 1)) * 56);
        emitLipSyncProgress(event, progressTag, data.progress ? 32 + Number(data.progress) * 0.56 : timePct, 'processing');
        if ((status === 'COMPLETED' || status === 'DONE' || status === 'SUCCEEDED') && outputUrl) break;
        if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED' || status === 'CANCELLED') {
          throw new Error(data.error || data.message || `Sync.so job ${status}`);
        }
      }
      if (!outputUrl) throw new Error('Sync.so Lip sync timeout or missing output URL');

      await downloadUrlToFile(outputUrl, downloadedOutput, { event, tag: progressTag, from: 88, to: 96 });
    }

    let outPath = finalPath;
    if (keepBgSound && await videoHasAudio(preparedVideo)) {
      const mixArgs = [
        '-y',
        '-i', downloadedOutput,
        '-i', preparedVideo,
        '-filter_complex', '[0:a]volume=1[a0];[1:a]volume=0.35[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]',
        '-map', '0:v:0',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        mixedPath,
      ];
      try {
        await runFfmpeg(mixArgs, 'Lip sync background mix', 240_000);
        outPath = mixedPath;
      } catch (mixErr) {
        console.warn('[LIP_SYNC] Background mix failed, using synced output:', mixErr.message);
        fs.copyFileSync(downloadedOutput, finalPath);
      }
    } else {
      fs.copyFileSync(downloadedOutput, finalPath);
    }

    emitLipSyncProgress(event, progressTag, 100, 'done');
    return {
      outputUrl: pathToFileURL(outPath).toString(),
      outputPath: outPath,
      jobId,
      provider: settings.provider,
      model: model || settings.model || 'sync-3',
    };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── Multi-clip Concat with Transitions ────────────────────────────────
ipcMain.handle('concat-with-transitions', async (_, { clips, transitions, scale, crf, outputDir }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const tmpDir = path.join(require('os').tmpdir(), 'fxflow-concat');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  if (!clips || clips.length < 2) throw new Error('Cần ít nhất 2 clip');

  const ffmpegBin = getFfmpegBin();

  // Step 1: Trim each clip to temp file with consistent format
  const trimmedPaths = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const resolved = clip.filePath.startsWith('file://') ? fileURLToPath(clip.filePath) : clip.filePath;
    if (!fs.existsSync(resolved)) throw new Error(`Clip ${i + 1}: file không tồn tại`);

    const tmpPath = path.join(tmpDir, `clip_${i}_${Date.now()}.mp4`);
    const dur = (clip.endTime || 0) - (clip.startTime || 0);
    const args = ['-y'];
    if (clip.startTime > 0) args.push('-ss', String(clip.startTime));
    args.push('-i', resolved);
    if (dur > 0) args.push('-t', String(dur));

    // Scale to consistent resolution if needed
    const scaleMap = { '1080p': '1920:1080', '720p': '1280:720', '480p': '854:480' };
    const scaleStr = scaleMap[scale] || null;
    if (scaleStr) {
      args.push('-vf', `scale=${scaleStr}:force_original_aspect_ratio=decrease,pad=${scaleStr}:(ow-iw)/2:(oh-ih)/2`);
    }

    args.push('-c:v', 'libx264', '-c:a', 'aac', '-preset', 'fast', '-crf', String(crf || 18));
    args.push('-pix_fmt', 'yuv420p', tmpPath);

    console.log(`[CONCAT] Trimming clip ${i + 1}/${clips.length}: ${resolved}`);
    await new Promise((resolve, reject) => {
      execFile(ffmpegBin, args, { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`Trim clip ${i + 1} lỗi: ${(stderr || err.message).slice(-200)}`));
        else resolve(null);
      });
    });
    trimmedPaths.push(tmpPath);
  }

  // Step 2: Apply transitions using xfade
  const outDir = outputDir || getVideoOutputDir();
  const outPath = path.join(outDir, `multiclip_${Date.now()}.mp4`);

  if (!transitions || transitions.length === 0 || transitions.every(t => t.type === 'none')) {
    // Simple concat without transitions
    const listFile = path.join(tmpDir, `list_${Date.now()}.txt`);
    const listContent = trimmedPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    await new Promise((resolve, reject) => {
      execFile(ffmpegBin, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath],
        { timeout: 300_000 }, (err) => err ? reject(err) : resolve(null));
    });
  } else {
    // Chain xfade transitions sequentially
    let currentInput = trimmedPaths[0];

    for (let i = 1; i < trimmedPaths.length; i++) {
      const trans = transitions[i - 1] || { type: 'fade', duration: 0.5 };
      const transType = trans.type || 'fade';
      const transDur = Math.max(0.1, Math.min(3, trans.duration || 0.5));

      // Get duration of current input to calculate offset
      const probeDur = await new Promise((resolve) => {
        execFile(ffmpegBin, ['-i', currentInput, '-f', 'null', '-'], { timeout: 10_000 }, (err, stdout, stderr) => {
          const all = (stderr || '') + (stdout || '');
          const dm = all.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
          resolve(dm ? parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]) : 10);
        });
      });

      const offset = Math.max(0, probeDur - transDur);
      const isLast = i === trimmedPaths.length - 1;
      const tmpOut = isLast ? outPath : path.join(tmpDir, `xfade_${i}_${Date.now()}.mp4`);

      const args = ['-y', '-i', currentInput, '-i', trimmedPaths[i]];

      if (transType === 'none') {
        // No transition, just concat
        const listFile = path.join(tmpDir, `pair_${i}.txt`);
        fs.writeFileSync(listFile, `file '${currentInput}'\nfile '${trimmedPaths[i]}'`);
        args.length = 0;
        args.push('-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', tmpOut);
      } else {
        args.push(
          '-filter_complex',
          `[0:v][1:v]xfade=transition=${transType}:duration=${transDur}:offset=${offset}[outv];[0:a][1:a]acrossfade=d=${transDur}[outa]`,
          '-map', '[outv]', '-map', '[outa]',
          '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'fast', '-crf', String(crf || 18),
          '-movflags', '+faststart',
          tmpOut
        );
      }

      console.log(`[CONCAT] Transition ${i}: ${transType} (${transDur}s) offset=${offset.toFixed(2)}s`);
      await new Promise((resolve, reject) => {
        execFile(ffmpegBin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(`Transition ${i} lỗi: ${(stderr || err.message).slice(-200)}`));
          else resolve(null);
        });
      });

      // Clean up intermediate
      if (i > 1 && currentInput.includes(tmpDir)) {
        try { fs.unlinkSync(currentInput); } catch { }
      }
      currentInput = tmpOut;
    }
  }

  // Cleanup trimmed temps
  for (const p of trimmedPaths) {
    try { fs.unlinkSync(p); } catch { }
  }

  console.log(`[CONCAT] Done: ${outPath}`);
  return pathToFileURL(outPath).toString();
});

// ── AI: Auto Generate Subtitles ──────────────────────────────────────
// ── Local audio transcription via Whisper WASM (offline, off-thread) ─
//
// Inference is delegated to a Node worker_thread (electron/whisper-worker.js)
// so the Electron main process stays responsive while ONNX crunches.
// Without the worker, a 2-3 minute clip freezes the UI for ~25s.
//
// The worker is started lazily on first transcription, kept alive across
// requests (the loaded pipeline is cached in worker memory), and reused.
const { Worker } = require('worker_threads');
let _whisperWorker = null;
let _whisperWorkerModel = null;

function getWhisperWorker(modelName, cacheDir) {
  if (_whisperWorker && _whisperWorkerModel === modelName) return _whisperWorker;
  if (_whisperWorker) {
    try { _whisperWorker.terminate(); } catch { /* ignore */ }
    _whisperWorker = null;
  }
  const workerPath = path.join(__dirname, 'whisper-worker.js');
  console.log(`[STT] Spawning worker → ${workerPath}`);
  _whisperWorker = new Worker(workerPath);
  _whisperWorker.on('error', (err) => {
    console.error('[STT] Worker error:', err);
    _whisperWorker = null;
    _whisperWorkerModel = null;
  });
  _whisperWorker.on('exit', (code) => {
    if (code !== 0) console.warn(`[STT] Worker exited with code ${code}`);
    _whisperWorker = null;
    _whisperWorkerModel = null;
  });
  _whisperWorkerModel = modelName;
  // Eagerly preload the model so subsequent transcriptions are faster
  _whisperWorker.postMessage({ type: 'preload', modelName, cacheDir });
  return _whisperWorker;
}

// In-flight tracker — coalesces concurrent calls for the same file path
// (defensive: stops a double-fired useEffect from running inference twice)
const _sttInFlight = new Map();

// ─── Disk-backed transcript cache ───────────────────────────────────
// Keyed by (filePath, fileSize, mtime, modelName). When the user re-opens
// the Transcript modal for a video they've already transcribed, we skip
// the whole FFmpeg + Whisper pipeline and return the saved SRT instantly.
//
// Cache is invalidated automatically if the file is modified (different
// mtime/size) so editing the source then re-opening will re-transcribe.
function getTranscriptCacheDir() {
  const dir = path.join(app.getPath('userData'), 'transcript-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function transcriptCacheKey(filePath, modelName) {
  const stat = fs.statSync(filePath);
  const crypto = require('crypto');
  return crypto.createHash('md5')
    .update(`${filePath}|${stat.size}|${Math.floor(stat.mtimeMs)}|${modelName}`)
    .digest('hex');
}
function readTranscriptCache(filePath, modelName) {
  try {
    const key = transcriptCacheKey(filePath, modelName);
    const p = path.join(getTranscriptCacheDir(), `${key}.srt`);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  } catch (e) { /* ignore */ }
  return null;
}
function writeTranscriptCache(filePath, modelName, srt) {
  try {
    const key = transcriptCacheKey(filePath, modelName);
    const p = path.join(getTranscriptCacheDir(), `${key}.srt`);
    fs.writeFileSync(p, srt, 'utf-8');
  } catch (e) { /* ignore */ }
}

// ─── Cancellable transcription registry ─────────────────────────────
// Lets the renderer abort an in-flight job (e.g. user closes the modal)
// by terminating the underlying worker thread. The thread is restarted
// lazily on next request.
const _sttCancelTokens = new Map(); // dedupeKey -> { worker, reject, sender }

function cancelTranscription(dedupeKey, reason = 'cancelled') {
  const entry = _sttCancelTokens.get(dedupeKey);
  if (!entry) return false;
  console.log(`[STT] Cancelling job ${dedupeKey.slice(0, 40)}... reason=${reason}`);
  try { entry.worker.terminate(); } catch { /* ignore */ }
  // Clear singleton so next call spawns a fresh worker
  if (_whisperWorker === entry.worker) {
    _whisperWorker = null;
    _whisperWorkerModel = null;
  }
  entry.reject(new Error('CANCELLED'));
  _sttCancelTokens.delete(dedupeKey);
  return true;
}

ipcMain.handle('ai-transcribe-cancel', (event, { filePath }) => {
  if (!filePath) return { cancelled: 0 };
  const { fileURLToPath: furl } = require('url');
  const resolved = filePath.startsWith('file://') ? furl(filePath) : filePath;
  let count = 0;
  for (const [key, entry] of [..._sttCancelTokens.entries()]) {
    if (entry.sender !== event.sender) continue;
    if (key.startsWith(resolved + '|')) {
      if (cancelTranscription(key, 'user-close')) count++;
    }
  }
  return { cancelled: count };
});

function transcribeViaWorker({ samples, language, modelName, cacheDir, onProgress }) {
  return new Promise((resolve, reject) => {
    const w = getWhisperWorker(modelName, cacheDir);
    const onMessage = (msg) => {
      if (msg.type === 'result') {
        w.off('message', onMessage);
        resolve(msg.payload);
      } else if (msg.type === 'error') {
        w.off('message', onMessage);
        reject(new Error(msg.payload));
      } else if (msg.type === 'progress') {
        const p = msg.payload || {};
        if (p.status === 'progress' && typeof p.progress === 'number') {
          console.log(`[STT] Download ${p.file || ''}: ${p.progress.toFixed(0)}%`);
          onProgress?.({ stage: 'downloading', file: p.file, progress: p.progress, loaded: p.loaded, total: p.total });
        } else if (p.status === 'ready' || p.status === 'done') {
          onProgress?.({ stage: 'analyzing' });
        } else if (p.status === 'initiate') {
          onProgress?.({ stage: 'downloading', file: p.file, progress: 0 });
        }
      } else if (msg.type === 'ready') {
        console.log('[STT] Model ready (worker)');
        onProgress?.({ stage: 'analyzing' });
      }
    };
    w.on('message', onMessage);
    // Transfer the samples buffer to the worker — zero-copy
    w.postMessage({ type: 'transcribe', samples, language, modelName, cacheDir }, [samples.buffer]);
  });
}

// Parse a 16-bit PCM WAV file into Float32 samples normalized to [-1, 1].
function readWavToFloat32(wavPath) {
  const buf = fs.readFileSync(wavPath);
  // Locate "data" chunk (allow non-standard headers like LIST/INFO chunks)
  let offset = 12; // skip RIFF header
  let dataOffset = -1, dataSize = 0;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') { dataOffset = offset + 8; dataSize = size; break; }
    offset += 8 + size;
  }
  if (dataOffset < 0) throw new Error('WAV data chunk không tìm thấy');
  const samples = dataSize / 2; // int16
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return out;
}

// Format Whisper output chunks as SRT
function chunksToSrt(chunks) {
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  };
  const lines = [];
  let n = 1;
  for (const c of chunks) {
    if (!c || !c.timestamp) continue;
    const [a, b] = c.timestamp;
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const text = (c.text || '').trim();
    if (!text) continue;
    lines.push(String(n));
    lines.push(`${fmt(a)} --> ${fmt(b)}`);
    lines.push(text);
    lines.push('');
    n++;
  }
  return lines.join('\n');
}

ipcMain.handle('ai-transcribe-audio', async (event, { filePath, language, modelName }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath: furl } = require('url');
  const resolved = filePath.startsWith('file://') ? furl(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const hfModel = modelName || 'Xenova/whisper-tiny';
  const cacheDir = path.join(app.getPath('userData'), 'whisper-cache');

  // Helper to push progress events to the renderer that initiated the call
  const emit = (payload) => {
    try { event.sender.send('stt-progress', payload); } catch { /* sender gone */ }
  };

  // Coalesce duplicate concurrent requests for the same file (defensive
  // against double-fired React effects).
  const dedupeKey = `${resolved}|${language || ''}|${hfModel}`;
  if (_sttInFlight.has(dedupeKey)) {
    console.log(`[STT] Reusing in-flight transcription for ${path.basename(resolved)}`);
    return _sttInFlight.get(dedupeKey);
  }

  // ── Cache check ────────────────────────────────────────────────────
  // If we've already transcribed this exact file with this model, return
  // the saved SRT immediately. The cache is keyed by (size, mtime) so
  // editing the source file invalidates it automatically.
  const cachedSrt = readTranscriptCache(resolved, hfModel);
  if (cachedSrt) {
    console.log(`[STT] Cache hit for ${path.basename(resolved)} — instant`);
    emit({ stage: 'done', cached: true });
    return {
      srtPath: '',
      srtContent: cachedSrt,
      cached: true,
    };
  }

  const promise = (async () => {
    const ffmpegBin = getFfmpegBin();
    const tmpDir = path.join(require('os').tmpdir(), 'fxflow-stt');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const audioPath = path.join(tmpDir, `audio_${Date.now()}.wav`);

    // 1) Extract 16kHz mono PCM WAV
    emit({ stage: 'extracting' });
    console.log(`[STT] FFmpeg → 16kHz mono WAV: ${audioPath}`);
    await new Promise((resolve, reject) => {
      execFile(
        ffmpegBin,
        ['-y', '-i', resolved, '-vn', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', audioPath],
        { timeout: 180_000 },
        (err) => err ? reject(err) : resolve(null),
      );
    });
    if (!fs.existsSync(audioPath)) throw new Error('Không thể extract audio từ video');
    const stat = fs.statSync(audioPath);
    if (stat.size < 1024) {
      try { fs.unlinkSync(audioPath); } catch { /* ignore */ }
      throw new Error('Audio extract bị rỗng — clip có thể không có âm thanh');
    }

    // 2) Read WAV → Float32Array
    const samples = readWavToFloat32(audioPath);
    try { fs.unlinkSync(audioPath); } catch { /* ignore */ }
    const audioSec = samples.length / 16000;
    emit({ stage: 'loaded', durationSec: audioSec });
    console.log(`[STT] Loaded ${samples.length} samples (${audioSec.toFixed(1)}s) — running on worker thread`);

    // 3) Run Whisper in worker (non-blocking)
    const t0 = Date.now();
    emit({ stage: 'analyzing', durationSec: audioSec });

    // Register cancel token so the renderer can abort this job
    let rejectThis;
    const cancellable = new Promise((_, rej) => { rejectThis = rej; });
    _sttCancelTokens.set(dedupeKey, {
      worker: getWhisperWorker(hfModel, cacheDir),
      reject: rejectThis,
      sender: event.sender,
    });

    const transcribePromise = transcribeViaWorker({
      samples, language, modelName: hfModel, cacheDir,
      onProgress: (p) => emit({ ...p, durationSec: audioSec }),
    });

    let result;
    try {
      result = await Promise.race([transcribePromise, cancellable]);
    } finally {
      _sttCancelTokens.delete(dedupeKey);
    }
    const { chunks: rawChunks, text } = result;
    console.log(`[STT] Inference done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    emit({ stage: 'parsing' });

    // 4) Format SRT
    const chunks = Array.isArray(rawChunks) ? rawChunks : [];
    let srtContent = chunksToSrt(chunks);
    if (!srtContent && text) {
      srtContent = `1\n00:00:00,000 --> ${
        ((s) => {
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sc = Math.floor(s % 60);
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')},000`;
        })(samples.length / 16000)
      }\n${text}\n`;
    }

    // 5) Persist for reference + write to cache for instant re-open
    const saveDir = path.join(getVideoOutputDir(), 'subtitles');
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    const srtPath = path.join(saveDir, `whisper_${Date.now()}.srt`);
    fs.writeFileSync(srtPath, srtContent, 'utf-8');
    writeTranscriptCache(resolved, hfModel, srtContent);

    console.log(`[STT] ${chunks.length} chunks → ${srtContent.length} chars (cached)`);
    emit({ stage: 'done', cached: false });
    return { srtPath: pathToFileURL(srtPath).toString(), srtContent };
  })();

  _sttInFlight.set(dedupeKey, promise);
  promise.finally(() => _sttInFlight.delete(dedupeKey));
  return promise;
});

ipcMain.handle('ai-generate-subtitles', async (_, { filePath, duration, transcript }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath: furl } = require('url');
  const https = require('https');
  const resolved = filePath.startsWith('file://') ? furl(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);
  const provider = await getVisionProviderRuntime();

  const ffmpegBin = getFfmpegBin();

  // Extract frames at key timestamps
  const tmpDir = path.join(require('os').tmpdir(), 'fxflow-ai-sub');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const dur = duration || 30;
  const numFrames = Math.min(8, Math.max(3, Math.ceil(dur / 10)));
  const frames = [];

  for (let i = 0; i < numFrames; i++) {
    const t = Math.round((dur / numFrames) * i + (dur / numFrames / 2));
    const framePath = path.join(tmpDir, `frame_${i}.jpg`);
    await new Promise((resolve, reject) => {
      execFile(ffmpegBin, ['-y', '-ss', String(t), '-i', resolved, '-vframes', '1', '-q:v', '5', '-vf', 'scale=640:-1', framePath],
        { timeout: 15_000 }, (err) => err ? reject(err) : resolve(null));
    });
    if (fs.existsSync(framePath)) {
      const b64 = fs.readFileSync(framePath).toString('base64');
      frames.push({ time: t, base64: b64 });
      fs.unlinkSync(framePath);
    }
  }

  console.log(`[AI-SUB] Extracted ${frames.length} frames from ${dur}s video`);

  // Build message for Claude
  const content = [];
  content.push({
    type: 'text',
    text: `You are a professional subtitle generator. Analyze these video frames captured at specific timestamps and generate SRT subtitle content.

Video duration: ${dur} seconds
${transcript ? `User-provided transcript/hint: "${transcript}"` : 'No transcript provided - analyze visual cues and infer dialogue/narration.'}

Rules:
1. Output ONLY valid SRT format (no markdown, no explanation)
2. Each subtitle should be 1-2 lines, max 42 chars per line
3. Use the frame timestamps as reference points to space subtitles
4. Create natural, well-timed subtitles (2-4 seconds each)
5. Number each subtitle sequentially starting from 1
6. Timestamp format: HH:MM:SS,mmm --> HH:MM:SS,mmm
7. If transcript is provided, split it into natural subtitle segments with proper timing
8. If no transcript, describe what's happening in each scene briefly

Example format:
1
00:00:01,000 --> 00:00:04,000
Hello everyone, welcome
to our video today

2
00:00:04,500 --> 00:00:07,000
Let's get started`
  });

  // Add frames as images
  for (const f of frames) {
    content.push({
      type: 'text',
      text: `[Frame at ${f.time}s]:`
    });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${f.base64}` }
    });
  }

  // Call Claude API
  const body = JSON.stringify({
    model: provider.visionModel,
    messages: [{ role: 'user', content }],
    max_tokens: 4096,
  });

  const srtContent = await new Promise((resolve, reject) => {
    const req = require('https').request(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content || '';
          resolve(text.trim());
        } catch (e) { reject(new Error('AI response parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => { req.destroy(); reject(new Error('AI request timeout')); });
    req.write(body);
    req.end();
  });

  // Save SRT file
  const saveDir = path.join(getVideoOutputDir(), 'subtitles');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
  const srtPath = path.join(saveDir, `auto_sub_${Date.now()}.srt`);
  fs.writeFileSync(srtPath, srtContent, 'utf-8');

  console.log(`[AI-SUB] Generated SRT: ${srtPath} (${srtContent.length} chars)`);
  return { srtPath: pathToFileURL(srtPath).toString(), srtContent };
});

// ── AI: Detect Watermark/Logo Position ──────────────────────────────
ipcMain.handle('ai-detect-watermark', async (_, { filePath, timeSeconds }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath: furl } = require('url');
  const resolved = filePath.startsWith('file://') ? furl(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);
  const provider = await getVisionProviderRuntime();

  const ffmpegBin = getFfmpegBin();

  // Capture frame
  const tmpFrame = path.join(require('os').tmpdir(), `watermark_detect_${Date.now()}.jpg`);
  await new Promise((resolve, reject) => {
    execFile(ffmpegBin, ['-y', '-ss', String(timeSeconds || 1), '-i', resolved, '-vframes', '1', '-q:v', '3', tmpFrame],
      { timeout: 15_000 }, (err) => err ? reject(err) : resolve(null));
  });

  if (!fs.existsSync(tmpFrame)) throw new Error('Không thể chụp frame');
  const b64 = fs.readFileSync(tmpFrame).toString('base64');
  fs.unlinkSync(tmpFrame);

  // Get video dimensions
  let vidW = 1920, vidH = 1080;
  try {
    const info = await new Promise((resolve, reject) => {
      execFile(ffmpegBin, ['-i', resolved], { timeout: 5000 }, (err, stdout, stderr) => {
        const all = (stderr || '') + (stdout || '');
        const resMatch = all.match(/(\d{2,5})x(\d{2,5})/);
        resolve({ w: resMatch ? parseInt(resMatch[1]) : 1920, h: resMatch ? parseInt(resMatch[2]) : 1080 });
      });
    });
    vidW = info.w; vidH = info.h;
  } catch { }

  // Call Claude Vision API
  const body = JSON.stringify({
    model: provider.visionModel,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Analyze this video frame (${vidW}x${vidH} pixels) and detect any logos, watermarks, or channel branding overlays.

For EACH detected watermark/logo, return a JSON array with objects containing:
- x: left position in pixels (from left edge)
- y: top position in pixels (from top edge)
- w: width in pixels
- h: height in pixels
- label: brief description of what it is

Rules:
1. Output ONLY a valid JSON array, no markdown, no explanation
2. If no watermark found, output: []
3. Coordinates must be in absolute pixels for ${vidW}x${vidH} resolution
4. Include small corner logos, channel names, timestamps, etc.
5. Be generous with bounding box size (add ~10px padding)

Example output:
[{"x": 50, "y": 30, "w": 120, "h": 40, "label": "Channel logo"}, {"x": 1700, "y": 950, "w": 200, "h": 60, "label": "Watermark text"}]`
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` }
        }
      ]
    }],
    max_tokens: 1024,
  });

  const result = await new Promise((resolve, reject) => {
    const req = require('https').request(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content || '[]';
          // Parse JSON from response (might have markdown wrapper)
          const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const regions = JSON.parse(clean);
          resolve(regions);
        } catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(60_000, () => { req.destroy(); resolve([]); });
    req.write(body);
    req.end();
  });

  console.log(`[AI-WATERMARK] Detected ${result.length} regions`);
  return { regions: result, videoWidth: vidW, videoHeight: vidH };
});

  return { localPiperTextToSpeech };
};
