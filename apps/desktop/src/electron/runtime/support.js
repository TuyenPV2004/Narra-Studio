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

// ── FFmpeg binary resolver (ffmpeg-static bundled) ─────────────────────
// ffmpeg-static is asarUnpacked → binary runs outside .asar archive
function getFfmpegBin() {
  try {
    let ffmpegPath = require('ffmpeg-static');
    // In packaged app, fix path from app.asar → app.asar.unpacked
    if (app.isPackaged) {
      ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
    return ffmpegPath;
  } catch (e) {
    // Fallback: hope ffmpeg is in system PATH
    console.warn('[FFMPEG] ffmpeg-static not found, falling back to system ffmpeg:', e.message);
    return 'ffmpeg';
  }
}

// ── filter_complex length guard (Windows cmdline overflow fix) ────────
// Windows CreateProcess caps total command-line length at 32,767 chars.
// Stacked features (Enhanced UHD + chroma key + denoise + multiple text
// overlays + stickers + speed curve + ...) can blow past that easily —
// FFmpeg then fails with the misleading "Result too large" error before
// it even parses the filter graph. The fix is FFmpeg's own escape hatch:
// `-filter_complex_script <file>` reads the chain from a file instead
// of the cmdline.
//
// This helper scans `args`, and when the inline `-filter_complex` value
// exceeds 4 KB (well under the limit, but with margin for binary path,
// output path, codec/bitrate flags, multiple `-i` paths, etc), it writes
// the value to a temp file and rewrites the arg vector to use the script
// flag. Returns the temp file path so the caller can clean it up after
// the spawn completes — even if the export fails. Returns null when no
// promotion was needed.
function maybePromoteFilterComplexToScript(args) {
  const idx = args.indexOf('-filter_complex');
  if (idx < 0 || idx + 1 >= args.length) return null;
  const value = args[idx + 1];
  if (typeof value !== 'string') return null;
  // 4 KB is a conservative threshold. Even on macOS/Linux (which have
  // 1 MB+ ARG_MAX) writing the chain to a file makes ffmpeg.log dumps
  // far easier to reason about, so we promote everywhere — not just on
  // Windows.
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

// ── Pre-spawn diagnostics for export pipeline ─────────────────────────
// When the customer reports "Result too large" we need ENOUGH info to
// distinguish three failure modes:
//
//   1. cmdline overflow on Windows  → total cmdline >32K, needs script
//      promotion. If the helper above already promoted, we should see
//      an `-filter_complex_script` arg here and the cmdline is short.
//   2. filter_complex specifically too long → value itself ~ KBs of
//      text. Either we promoted it (good) or threshold was too high
//      (we'd see it inline still).
//   3. Some specific filter parameter overflow (numeric) → unrelated
//      to length. The cmdline + filter sizes will be small but ffmpeg
//      still reports the same error. In that case the offending arg
//      is somewhere in `args` and we need the full dump to find it.
//
// `tag` is just a short label to disambiguate in console output
// (FILTERS / XFADE / CONCAT-SIMPLE / etc).
function logFfmpegSpawnDiagnostics(tag, ffmpegBin, args) {
  try {
    const tag1 = `[${tag}]`;
    // Per-arg lengths — sums to total cmdline (with separators).
    const argLengths = args.map(a => (typeof a === 'string' ? a.length : 0));
    const totalArgChars = argLengths.reduce((s, n) => s + n, 0);
    // CreateProcess on Windows joins args with spaces → +1 per arg.
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
    // Dump full filter chain for offline debugging when something fails.
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

// ── Performance flags - gọi trước khi app ready ────────────────────────
// Dense collaborative canvases retain real card DOM plus bounded thumbnail and
// snapshot caches. Initial hydration can still create a short-lived heap peak;
// do not cap a 16–32 GB creator workstation to the old 2 GB renderer ceiling.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');


const runtime = { mainWindow: null };
const SESSION_PARTITION = 'persist:slot-0';
const MAX_SLOTS = 5;
const isDev = process.argv.includes('--dev') || !app.isPackaged;

// ── Output folder settings ────────────────────────────────────────────
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

// Generate sequential filename: p-DD-MM-NNN.ext
// In-memory counter để cấp filename atomic — tránh race condition khi concurrent downloads
// Khi 2 jobs chạy song song đều gọi getNextFilename trước khi file được tạo
const _filenameCounters = {}; // key: "dirPath:ext:prefix" → maxSeq

function getNextFilename(dir, ext) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `p-${dd}-${mm}-`;

  const counterKey = `${dir}:${ext}:${prefix}`;

  // Khởi tạo counter từ disk nếu chưa có (lần đầu)
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

  // Atomic increment — không concurrent nào lấy cùng số
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
    getNextFilename,
  };
};
