'use strict';

module.exports = function createSupportRuntime(dependencies) {
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
  } = dependencies;

function getFfmpegBin() {
  try {
    let ffmpegPath = require('ffmpeg-static');

    if (app.isPackaged) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
    return ffmpegPath;
  } catch (e) {
    console.warn('[FFMPEG] ffmpeg-static not found, falling back to system ffmpeg:', e.message);
    return 'ffmpeg';
  }
}

function maybePromoteFilterComplexToScript(args) {
  const idx = args.indexOf('-filter_complex');
  if (idx < 0 || idx + 1 >= args.length) return null;
  const value = args[idx + 1];
  if (typeof value !== 'string') return null;

  if (value.length < 4096) return null;
  try {
    const os = require('os');
    const tmpPath = path.join(os.tmpdir(), `veo3-fc-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(tmpPath, value, 'utf-8');
    args[idx] = '-filter_complex_script';
    args[idx + 1] = tmpPath;
    console.log(`[FILTERS] Promoted filter_complex (${value.length} chars) → script file: ${tmpPath}`);
    return tmpPath;
  } catch (e) {
    console.warn('[FILTERS] Failed to promote filter_complex to script file (will fall back to inline):', e && e.message);
    return null;
  }
}

function logFfmpegSpawnDiagnostics(tag, ffmpegBin, args) {
  try {
    const tag1 = `[${tag}]`;

    const argLengths = args.map(a => (typeof a === 'string' ? a.length : 0));
    const totalArgChars = argLengths.reduce((s, n) => s + n, 0);

    const approxCmdline = totalArgChars + args.length;
    const fcInline = args.indexOf('-filter_complex');
    const fcScript = args.indexOf('-filter_complex_script');
    const fcInlineLen = fcInline >= 0 ? (args[fcInline + 1] || '').length : 0;
    const fcScriptPath = fcScript >= 0 ? args[fcScript + 1] : null;
    const longestArgIdx = argLengths.indexOf(Math.max(...argLengths));
    const longestArgLen = argLengths[longestArgIdx];

    console.log(
      `${tag1} spawn diagnostics:\n` +
      `  • platform:           ${process.platform}\n` +
      `  • argc:               ${args.length}\n` +
      `  • total chars:        ${totalArgChars} (~cmdline ${approxCmdline})\n` +
      `  • windows safe:       ${approxCmdline < 30000 ? 'YES' : 'NO ⚠️ near 32K cap'}\n` +
      `  • -filter_complex:    ${fcInline >= 0 ? `INLINE, ${fcInlineLen} chars ${fcInlineLen > 4096 ? '⚠️ would normally be promoted' : ''}` : '— none'}\n` +
      `  • -filter_complex_script: ${fcScriptPath ? fcScriptPath : '— none'}\n` +
      `  • longest arg [${longestArgIdx}]: ${longestArgLen} chars  →  ${truncatePreview(args[longestArgIdx], 200)}`
    );

    if (fcInline >= 0 && fcInlineLen > 0) {
      const preview = args[fcInline + 1];
      console.log(`${tag1} filter_complex (${fcInlineLen} chars):\n${preview.slice(0, 1500)}${fcInlineLen > 1500 ? `\n... [${fcInlineLen - 1500} more chars]` : ''}`);
    }
  } catch (e) {
    console.warn('[DIAG] logFfmpegSpawnDiagnostics failed (non-fatal):', e && e.message);
  }
}

function truncatePreview(s, maxLen) {
  if (typeof s !== 'string') return String(s);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + ` ... [+${s.length - maxLen} chars]`;
}

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

const runtime = { mainWindow: null };
const SESSION_PARTITION = 'persist:slot-0';
const MAX_SLOTS = 5;
const isDev = process.argv.includes('--dev') || !app.isPackaged;

const SETTINGS_FILE = path.join(app.getPath('userData'), 'flow-settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch { return {}; }
}
function saveSettings(data) {
  const current = loadSettings();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, ...data }, null, 2));
}
function getVideoOutputDir() {
  const s = loadSettings();
  return s.videoOutputPath || path.join(app.getPath('pictures'), 'VEO3Flow', 'videos');
}
function getImageOutputDir() {
  const s = loadSettings();
  return s.imageOutputPath || path.join(app.getPath('pictures'), 'VEO3Flow', 'images');
}
function getVoiceOutputDir() {
  const s = loadSettings();
  return s.voiceOutputPath || path.join(app.getPath('music'), 'Narra Studio', 'Voice');
}
function getVoiceOutputRoots() {
  const settings = loadSettings();
  const historical = Array.isArray(settings.voiceOutputPaths)
    ? settings.voiceOutputPaths.filter(value => typeof value === 'string' && value.trim())
    : [];
  return [...new Set([
    getVoiceOutputDir(),
    ...historical,
    path.join(app.getPath('userData'), 'xtts-v2', 'output'),
  ].map(value => path.resolve(value)))];
}

const _filenameCounters = {};

function getNextFilename(dir, ext) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `p-${dd}-${mm}-`;

  const counterKey = `${dir}:${ext}:${prefix}`;

  if (_filenameCounters[counterKey] === undefined) {
    let maxSeq = 0;
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.startsWith(prefix)) {
          const match = f.match(new RegExp(`^${prefix.replace(/[-]/g, '\\-')}(\\d+)`));
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxSeq) maxSeq = num;
          }
        }
      }
    } catch { }
    _filenameCounters[counterKey] = maxSeq;
  }

  _filenameCounters[counterKey] += 1;
  const seq = String(_filenameCounters[counterKey]).padStart(3, '0');
  return `${prefix}${seq}.${ext}`;
}

  return {
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
    getVoiceOutputDir,
    getVoiceOutputRoots,
    getNextFilename,
  };
};
