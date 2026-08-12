'use strict';

module.exports = function registerSystemIpc(dependencies) {
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
    avisProvider,
    cloudflareImagesProvider,
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
    findFlowWebview,
    findChromePath,
    httpGetJson,
    createCdpClient,
    injectChromeWarningOverlay,
    startPersistentChrome,
    getCaptchaFromChrome,
    makeApiRequestViaChrome,
    reloadFlowWebviewForSlot,
    reloadChromeCdpLabs,
    makeApiRequestViaWebview,
    setActiveWebviewSlot,
    getChromeRuntime,
    localPiperTextToSpeech,
  } = dependencies;

// ── IPC: Lấy version hiện tại ──
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-arch', () => {
  return process.arch;
});

// Keep renderer diagnostics reachable even when React fails before mounting.
// The matching control lives outside #root in index.html, so customers can
// still open Console from a blank/black application window.
ipcMain.handle('open-dev-tools', (event) => {
  const webContents = event.sender;
  if (webContents.isDestroyed()) return false;
  webContents.openDevTools({ mode: 'detach', activate: true });
  return true;
});

// ── IPC: Ngôn ngữ giao diện (i18n) ──
// A saved user choice always wins. Otherwise every install starts in English;
// users can switch to Vietnamese or Chinese from Settings.
const UI_LANGUAGES = ['vi', 'en', 'zh'];

function resolveUiLanguage() {
  const settings = loadSettings();
  if (UI_LANGUAGES.includes(settings.uiLanguage)) {
    return { language: settings.uiLanguage, source: 'settings' };
  }

  const language = 'en';
  saveSettings({ uiLanguage: language });
  return { language, source: 'default' };
}

ipcMain.handle('get-ui-language', () => resolveUiLanguage());

ipcMain.handle('set-ui-language', (_event, language) => {
  if (!UI_LANGUAGES.includes(language)) {
    return { success: false, language: resolveUiLanguage().language, error: 'Ngôn ngữ không hợp lệ.' };
  }
  saveSettings({ uiLanguage: language });
  return { success: true, language };
});

// ── IPC: Mac Auto-Install Update (download ZIP → extract → reveal) ──

const loadTtsRuntime = () => {
  const settings = loadSettings();
  const secretCandidates = [
    process.env.ITERA102_KEY_FILE,
    path.join(process.cwd(), '.secrets', 'tts.json'),
    (() => { try { return path.join(app.getAppPath(), '.secrets', 'tts.json'); } catch { return null; } })(),
    // Internal test builds bundle the itera102 credential as an Electron
    // extraResource. This is intentionally a test-only fallback: a packaged
    // desktop secret can be extracted and must not be treated as secure.
    (() => { try { return path.join(process.resourcesPath, 'tts.json'); } catch { return null; } })(),
    (() => { try { return path.join(app.getPath('userData'), 'tts.json'); } catch { return null; } })(),
  ].filter(Boolean);
  let secret = {};
  for (const candidate of secretCandidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      secret = JSON.parse(fs.readFileSync(candidate, 'utf8')) || {};
      break;
    } catch (error) {
      console.warn('[TTS] Cannot read secret config:', error.message);
    }
  }
  return {
    apiKey: String(
      settings.ttsApiKey || process.env.ITERA102_API_KEY ||
      process.env.ELEVENLABS_API_KEY || secret.apiKey || secret.api_key || ''
    ).trim(),
    baseUrl: String(secret.baseUrl || secret.base_url || secret.apiBase || 'https://api.itera102.space').replace(/\/$/, ''),
  };
};
const getTtsHeaders = (json = false) => {
  const { apiKey } = loadTtsRuntime();
  if (!apiKey) throw new Error('TTS chưa cấu hình API key. Thêm key vào .secrets/tts.json.');
  return json
    ? { 'Content-Type': 'application/json', 'xi-api-key': apiKey }
    : { 'xi-api-key': apiKey };
};
const TTS_VOICE_ID = 'UgBBYS2sOqTuMpoF3BR0';
const activeTtsRequests = new Map();

const waitForTtsPoll = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(new Error('TTS request cancelled'));
    return;
  }
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new Error('TTS request cancelled'));
  }, { once: true });
});

ipcMain.handle('text-to-speech-cancel', async (_event, { requestId, progressTag } = {}) => {
  const key = String(requestId || progressTag || '').trim();
  if (!key) return { cancelled: false };
  const controller = activeTtsRequests.get(key);
  if (!controller) return { cancelled: false };
  controller.abort();
  activeTtsRequests.delete(key);
  console.log(`[TTS] Cancelled request: ${key}`);
  return { cancelled: true };
});

ipcMain.handle('text-to-speech', async (event, { text, voiceId, stability, language, provider: prov, model, progressTag, requestId }) => {
  if (!text || !text.trim()) throw new Error('Text is required');

  const useProvider = prov || 'elevenlabs';
  const vid = voiceId || (useProvider === 'minimax' ? 'Vietnamese_Serene_Man' : TTS_VOICE_ID);
  if (useProvider === 'local-piper') {
    return localPiperTextToSpeech(event, { text, voiceId: vid, progressTag });
  }
  const useModel = model || (useProvider === 'minimax' ? 'speech-2.8-hd' : 'eleven_v3');
  const { baseUrl } = loadTtsRuntime();
  const headers = getTtsHeaders(true);
  const requestKey = String(requestId || progressTag || `tts-${Date.now()}`).trim();
  activeTtsRequests.get(requestKey)?.abort();
  const controller = new AbortController();
  activeTtsRequests.set(requestKey, controller);

  try {
    // Step 1: Submit TTS job
    console.log(`[TTS] Submitting job: ${text.length} chars, voice=${vid}, provider=${useProvider}, model=${useModel}`);
    const submitRes = await net.fetch(`${baseUrl}/v1/text-to-speech/${encodeURIComponent(vid)}`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        text: text.trim(),
        model_id: useModel,
        provider: useProvider,
        language_code: language || 'vi',
        voice_settings: {
          stability: stability != null ? stability / 100 : 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true,
          speed: 1,
        },
      }),
    });

    if (!submitRes.ok) {
      const errData = await submitRes.json().catch(() => ({}));
      throw new Error(errData.error || `TTS submit error: ${submitRes.status}`);
    }

    const submitData = await submitRes.json();
    const jobId = submitData.id;
    if (!jobId) throw new Error('No job ID returned');
    console.log(`[TTS] Job submitted: ${jobId}, status=${submitData.status}`);

    // Step 2: Poll for completion (max 120s, poll every 3s)
    const maxPollTime = 120000;
    const pollInterval = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      await waitForTtsPoll(pollInterval, controller.signal);

      const pollRes = await net.fetch(`${baseUrl}/v1/history/${jobId}`, {
        method: 'GET',
        headers: getTtsHeaders(),
        signal: controller.signal,
      });

      if (!pollRes.ok) {
        console.warn(`[TTS] Poll error: ${pollRes.status}`);
        continue;
      }

      const pollData = await pollRes.json();
      console.log(`[TTS] Poll: status=${pollData.status}`);

      if (pollData.status === 'completed') {
        const audioUrl = pollData.result?.audio_url || '';
        if (!audioUrl) throw new Error('Completed but no audio URL');
        console.log(`[TTS] ✅ Done: ${audioUrl}`);
        return { audio_url: audioUrl, id: jobId, chars: pollData.characters_used };
      }

      if (pollData.status === 'failed' || pollData.error) {
        throw new Error(pollData.error || pollData.detail_error || 'TTS generation failed');
      }
    }

    throw new Error('TTS timeout — generation took too long (>120s)');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('TTS request cancelled');
    throw error;
  } finally {
    if (activeTtsRequests.get(requestKey) === controller) activeTtsRequests.delete(requestKey);
  }
});

// ── Fetch TTS Models by provider ──────────────────────────────────────
ipcMain.handle('tts-models', async (_, { provider }) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const url = provider === 'minimax'
      ? `${baseUrl}/v1/models?provider=minimax`
      : `${baseUrl}/v1/models`;
    const res = await net.fetch(url, {
      headers: getTtsHeaders(),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('[TTS] Models fetch error:', err.message);
    return [];
  }
});

// ── Fetch TTS Languages by provider ──────────────────────────────────
ipcMain.handle('tts-languages', async (_, { provider }) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const url = provider === 'minimax'
      ? `${baseUrl}/v1/languages?provider=minimax`
      : `${baseUrl}/v1/languages`;
    const res = await net.fetch(url, {
      headers: getTtsHeaders(),
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('[TTS] Languages fetch error:', err.message);
    return [];
  }
});
// ── Fetch shared voices (Voice Library) ───────────────────────────────
ipcMain.handle('tts-minimax-voices', async (_, params = {}) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const q = new URLSearchParams();
    q.set('page', String(params.page || 1));
    q.set('page_size', String(params.page_size || 100));
    if (params.search) q.set('search', params.search);
    if (params.gender) q.set('gender', params.gender);
    if (params.language) q.set('language', params.language);
    if (params.accent) q.set('accent', params.accent);
    if (params.age) q.set('age', params.age);
    if (params.use_cases) q.set('use_cases', params.use_cases);
    const res = await net.fetch(`${baseUrl}/v1/minimax/system-voices?${q}`, {
      headers: getTtsHeaders(),
    });
    if (!res.ok) return { voice_list: [], total: 0, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    console.error('[TTS] MiniMax voices error:', err.message);
    return { voice_list: [], total: 0, error: err.message };
  }
});

ipcMain.handle('tts-shared-voices', async (_, params = {}) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const q = new URLSearchParams();
    q.set('page_size', String(params.page_size || 30));
    q.set('sort', params.sort || 'trending');
    if (params.page) q.set('page', String(params.page));
    if (params.search) q.set('search', params.search);
    if (params.gender) q.set('gender', params.gender);
    if (params.age) q.set('age', params.age);
    if (params.accent) q.set('accent', params.accent);
    if (params.language) q.set('required_languages', params.language);
    if (params.category) q.set('category', params.category);
    const res = await net.fetch(`${baseUrl}/v1/shared-voices?${q}`, {
      headers: getTtsHeaders(),
    });
    if (!res.ok) return { voices: [] };
    return await res.json();
  } catch (err) {
    console.error('[TTS] Shared voices error:', err.message);
    return { voices: [] };
  }
});

// ── Fetch default voices ──────────────────────────────────────────────
ipcMain.handle('tts-default-voices', async (_, params = {}) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const q = new URLSearchParams();
    q.set('page_size', String(params.page_size || 30));
    if (params.search) q.set('search', params.search);
    const res = await net.fetch(`${baseUrl}/v1/default-voices?${q}`, {
      headers: getTtsHeaders(),
    });
    if (!res.ok) return { voices: [] };
    return await res.json();
  } catch (err) {
    console.error('[TTS] Default voices error:', err.message);
    return { voices: [] };
  }
});
// ── Fetch TTS generation history ──────────────────────────────────────
ipcMain.handle('tts-history', async (_, params = {}) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const q = new URLSearchParams();
    q.set('page_size', String(params.page_size || 30));
    q.set('page', String(params.page || 0));
    const res = await net.fetch(`${baseUrl}/v1/history?${q}`, {
      headers: getTtsHeaders(),
    });
    if (!res.ok) return { tasks: [], has_more: false };
    return await res.json();
  } catch (err) {
    console.error('[TTS] History fetch error:', err.message);
    return { tasks: [], has_more: false };
  }
});

// ── Delete history item ───────────────────────────────────────────────
ipcMain.handle('tts-history-delete', async (_, { id }) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const res = await net.fetch(`${baseUrl}/v1/history/${id}`, {
      method: 'DELETE',
      headers: getTtsHeaders(),
    });
    return { ok: res.ok };
  } catch (err) {
    console.error('[TTS] Delete error:', err.message);
    return { ok: false };
  }
});

// ── Retry history item ────────────────────────────────────────────────
ipcMain.handle('tts-history-retry', async (_, { id }) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const res = await net.fetch(`${baseUrl}/v1/history/${id}/retry`, {
      method: 'POST',
      headers: getTtsHeaders(),
    });
    if (!res.ok) return { ok: false };
    return { ok: true, ...(await res.json().catch(() => ({}))) };
  } catch (err) {
    console.error('[TTS] Retry error:', err.message);
    return { ok: false };
  }
});
// ── Dialogue TTS ──────────────────────────────────────────────────────
ipcMain.handle('tts-dialogue', async (_, params = {}) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const body = {
      text: params.text,
      speakers: params.speakers,
      pause_between_turns: params.pause_between_turns ?? 0.5,
    };
    console.log('[DIALOGUE] Submitting:', Object.keys(body.speakers || {}).length, 'speakers,', (params.text || '').length, 'chars');
    const res = await net.fetch(`${baseUrl}/v1/dialogue`, {
      method: 'POST',
      headers: getTtsHeaders(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Dialogue API error: ${res.status} ${errText}`);
    }
    const data = await res.json();
    const jobId = data.id || data.task_id;
    if (!jobId) return data;

    // Poll for completion
    const maxPoll = 120000;
    const start = Date.now();
    while (Date.now() - start < maxPoll) {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await net.fetch(`${baseUrl}/v1/history/${jobId}`, {
        headers: getTtsHeaders(),
      });
      if (!poll.ok) continue;
      const status = await poll.json();
      console.log('[DIALOGUE] Poll:', status.status);
      if (status.status === 'completed' && status.result?.audio_url) {
        return { audio_url: status.result.audio_url, id: jobId, status: 'completed' };
      }
      if (status.status === 'failed') throw new Error(status.error || 'Dialogue generation failed');
    }
    throw new Error('Dialogue generation timeout');
  } catch (err) {
    console.error('[DIALOGUE] Error:', err.message);
    throw err;
  }
});
// ── File dialog ───────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async (_, opts = {}) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: opts.filters || [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'aac', 'flac'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ── Voice Changer ─────────────────────────────────────────────────────
ipcMain.handle('tts-voice-changer', async (_, params = {}) => {
  try {
    const { baseUrl } = loadTtsRuntime();
    const fs = require('fs');
    const path = require('path');
    const filePath = params.filePath;
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Audio file not found');

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/m4a', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.aac': 'audio/aac', '.flac': 'audio/flac' };
    const mime = mimeMap[ext] || 'audio/mpeg';

    // Build multipart boundary
    const boundary = '----FormBoundary' + Date.now().toString(36);
    const parts = [];
    const addField = (name, value) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    };
    // File part
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`));
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n'));
    // Fields
    addField('voice_id', params.voice_id || '');
    addField('model_id', params.model_id || 'eleven_multilingual_sts_v2');
    if (params.remove_background_noise) addField('remove_background_noise', 'true');
    if (params.voice_settings) addField('voice_settings', JSON.stringify(params.voice_settings));
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    console.log('[VOICE-CHANGER] Submitting:', fileName, body.length, 'bytes');
    const res = await net.fetch(`${baseUrl}/v1/voice-changer`, {
      method: 'POST',
      headers: {
        ...getTtsHeaders(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Voice changer API error: ${res.status} ${errText}`);
    }
    const data = await res.json();
    const jobId = data.id || data.task_id;
    if (!jobId) return data;

    // Poll
    const start = Date.now();
    while (Date.now() - start < 120000) {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await net.fetch(`${baseUrl}/v1/history/${jobId}`, {
        headers: getTtsHeaders(),
      });
      if (!poll.ok) continue;
      const status = await poll.json();
      console.log('[VOICE-CHANGER] Poll:', status.status);
      if (status.status === 'completed' && status.result?.audio_url) {
        return { audio_url: status.result.audio_url, id: jobId, status: 'completed' };
      }
      if (status.status === 'failed') throw new Error(status.error || 'Voice changer failed');
    }
    throw new Error('Voice changer timeout');
  } catch (err) {
    console.error('[VOICE-CHANGER] Error:', err.message);
    throw err;
  }
});

};
