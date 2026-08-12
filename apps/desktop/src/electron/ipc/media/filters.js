'use strict';

/**
 * `apply-video-filters`: the combined CapCut export pipeline — color grading,
 * curves, LUT, vignette, text/sticker overlays, effects, speed curves, audio
 * compensation — plus the offscreen sticker-template rasterizers it feeds on.
 *
 * One handler by design: the filter_complex chain is assembled in a single
 * pass and every stage appends to the same graph.
 * Registered by `electron/ipc/media.js`.
 */

module.exports = function registerMediaFiltersIpc(dependencies) {
  const {
    app,
    BrowserWindow,
    ipcMain,
    session,
    path,
    fs,
    pathToFileURL,
    fileURLToPath,
    getFfmpegBin,
    maybePromoteFilterComplexToScript,
    logFfmpegSpawnDiagnostics,
    getVideoOutputDir,
  } = dependencies;

// ── Sticker template SVG → PNG rasterizer ───────────────────────────
// Animated SVG sticker templates (STICKER_TEMPLATES) need to be turned
// into a real bitmap before FFmpeg can overlay them onto a video. We
// use Electron's offscreen BrowserWindow as the renderer:
//   1. Create a transparent BrowserWindow at the SVG's intrinsic size.
//   2. Load a minimal HTML page that inlines the SVG centered on a
//      transparent canvas.
//   3. capturePage() to get a NativeImage → save as PNG to userData.
//
// Limitations:
//   • Captures the RESTING frame of the animation (animation timeline
//     can't be advanced programmatically without a JS hook). Future
//     enhancement: capture N frames over the animation duration and
//     encode as GIF for animated export.
//   • The window must remain open until capture finishes (~200ms in
//     practice) — we await `did-finish-load` then capturePage.
async function rasterizeStickerTemplateToPng(svgMarkup, width, height) {
  const fs = require('fs');
  const path = require('path');
  // Use the Electron userData folder so the temp PNGs are cleanable
  // and don't collide with other apps.
  const tmpDir = path.join(app.getPath('userData'), 'sticker-template-cache');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* exists */ }
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outPath = path.join(tmpDir, `tpl-${stamp}.png`);

  // Build a self-contained HTML page that hosts the SVG. Lime-green bg
  // works as a chroma-key fallback for the case where the hidden
  // BrowserWindow returns an opaque capture instead of one with alpha.
  // (See rasterizeAnimatedTemplate for the full rationale.)
  const CHROMA_BG = '#00ff14';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  html, body { margin: 0; padding: 0; background: ${CHROMA_BG}; overflow: hidden; }
  body { width: ${width}px; height: ${height}px; }
  svg { width: 100%; height: 100%; display: block; }
</style>
</head><body>${svgMarkup}</body></html>`;

  const win = new BrowserWindow({
    width: Math.max(16, Math.round(width)),
    height: Math.max(16, Math.round(height)),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    hasShadow: false,
    webPreferences: {
      offscreen: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try { win.setBackgroundColor('#00000000'); } catch { /* ignore */ }
  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);
    try { win.webContents.setBackgroundColor && win.webContents.setBackgroundColor('#00000000'); } catch { /* ignore */ }
    // Give the SVG ~200ms to settle (CSS transforms apply, layout flush).
    await new Promise(r => setTimeout(r, 200));
    const img = await win.webContents.capturePage();
    const png = img.toPNG();
    // Save raw PNG first; then post-process with FFmpeg to chroma-key
    // out the lime-green background. Result is the alpha-correct PNG
    // that the overlay pipeline expects.
    const rawPath = outPath + '.raw.png';
    fs.writeFileSync(rawPath, png);
    const { spawn } = require('child_process');
    await new Promise((resolve, reject) => {
      // Same sharp-cutoff chromakey as the animated rasterizer — avoids
      // the missing-despill failure and eliminates the halo by rendering
      // hard-edge alpha. See rasterizeAnimatedTemplate for the rationale.
      const proc = spawn(getFfmpegBin(), [
        '-y', '-i', rawPath,
        '-vf', 'format=rgba,chromakey=0x00ff14:0.3:0.0,format=rgba',
        '-frames:v', '1',
        outPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`PNG chroma-key failed (${code}): ${stderr.slice(-300)}`)));
      proc.on('error', err => reject(err));
    });
    try { fs.unlinkSync(rawPath); } catch { /* ignore */ }
    console.log(`[STICKER] Rasterized template SVG → ${outPath}`);
    return outPath;
  } catch (err) {
    console.error('[STICKER] rasterize failed:', err);
    return null;
  } finally {
    try { win.destroy(); } catch { /* ignore */ }
  }
}

// ── Animated sticker template rasterizer ─────────────────────────────
// Captures the running SVG animation across multiple frames and encodes
// the result as a WebM clip with alpha channel. This preserves the
// embedded CSS @keyframes (sparkle twinkles, hearts float, fire flickers)
// in the final exported video — the static PNG path above only captures
// the resting frame.
//
// Pipeline:
//   1. Open an offscreen transparent BrowserWindow with the SVG inlined.
//   2. capturePage() at fixed wall-clock intervals so the SVG's CSS
//      animations advance naturally between snapshots.
//   3. Persist each frame as PNG (preserves alpha).
//   4. FFmpeg encodes the PNG sequence to WebM VP9 with `yuva420p`
//      pixel format (alpha-aware). The downstream overlay filter chain
//      treats WebM the same way it treats GIF: `-stream_loop -1` plus
//      `-itsoffset` to align with the sticker's visible window.
//
// Fallback strategy:
//   • If WebM encoding fails (libvpx-vp9 missing in this build of
//     ffmpeg-static, or capture returned no frames), the caller falls
//     back to the static PNG path so the sticker still appears in the
//     export — just without animation.
async function rasterizeAnimatedTemplate(svgMarkup, width, height, durationSec = 3.0, fps = 20) {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');

  const cacheDir = path.join(app.getPath('userData'), 'sticker-template-cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch { /* exists */ }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const framesDir = path.join(cacheDir, `frames-${stamp}`);
  try { fs.mkdirSync(framesDir, { recursive: true }); } catch { /* shouldn't happen */ }

  // Belt-and-braces transparency: paint a unique chroma color (lime
  // green) as the background then chroma-key it out at encode time.
  // If true alpha capture works, the bg never shows so chromakey is a
  // no-op. If the captured PNGs are opaque (hidden-window-paint bug),
  // we still get a clean cutout via the key. Lime is chosen because no
  // sticker template uses it as a foreground color.
  const CHROMA_BG = '#00ff14';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  html, body { margin: 0; padding: 0; background: ${CHROMA_BG}; overflow: hidden; }
  body { width: ${width}px; height: ${height}px; }
  svg { width: 100%; height: 100%; display: block; }
</style>
</head><body>${svgMarkup}</body></html>`;

  // ── BrowserWindow config tuned for transparent capture ──
  // Critical flags:
  //   • paintWhenInitiallyHidden: true — without this, a hidden window
  //     (`show: false`) does NOT run its compositor pipeline. capturePage()
  //     then returns either a black image or stale content, which is what
  //     produced the "black square sticker" bug at export.
  //   • backgroundThrottling: false — Chromium throttles painting on
  //     hidden tabs by default; turn that off so animations advance
  //     between our captures.
  //   • backgroundColor + transparent — the actual transparency. Electron
  //     requires BOTH the window flag and the alpha-aware bg color.
  //   • hasShadow: false — macOS only; shadow can leak into capture.
  const win = new BrowserWindow({
    width: Math.max(16, Math.round(width)),
    height: Math.max(16, Math.round(height)),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    hasShadow: false,
    webPreferences: {
      offscreen: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Re-assert transparent bg in case the constructor option was clamped
  // by the platform (Linux occasionally needs the post-create call).
  try { win.setBackgroundColor('#00000000'); } catch { /* ignore */ }

  let frameCount = 0;
  let alphaVerified = false;
  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);
    // Force the renderer's compositor to honor a transparent backdrop.
    // Some Chromium versions only pick up the value after it's set on
    // the live webContents (not just the window).
    try { win.webContents.setBackgroundColor && win.webContents.setBackgroundColor('#00000000'); } catch { /* ignore */ }
    // Longer settle — gives the SVG layout + CSS animation pipeline a
    // chance to start producing real frames before we capture. Skipping
    // this leads to the first capture being a blank/partial paint.
    await new Promise(r => setTimeout(r, 220));

    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const frameInterval = 1000 / fps;

    for (let i = 0; i < totalFrames; i++) {
      const t0 = Date.now();
      try {
        const img = await win.webContents.capturePage();
        const png = img.toPNG();
        if (png && png.length > 0) {
          fs.writeFileSync(path.join(framesDir, `frame_${String(i).padStart(4, '0')}.png`), png);
          frameCount++;
          // Verify alpha on the first non-empty frame. PNG header byte
          // at offset 25 holds color type — 6 = RGBA, 4 = grayscale+alpha.
          // We use this as a quick check; the encoder will need real
          // transparency to bake correctly.
          if (!alphaVerified && png.length > 30) {
            const colorType = png[25];
            alphaVerified = colorType === 6 || colorType === 4;
            if (!alphaVerified) {
              console.warn(`[STICKER] capturePage returned PNG without alpha (colorType=${colorType}). Will rely on chroma-key fallback at encode.`);
            }
          }
        }
      } catch (err) {
        console.warn('[STICKER] frame capture failed at i=' + i, err && err.message);
      }
      // Sleep the remainder of this frame's wall-clock budget. If
      // capturePage() ran longer than the budget we just continue
      // immediately — the resulting WebM will be slightly slower than
      // the design timing but the animation cycle stays intact.
      const wait = Math.max(0, frameInterval - (Date.now() - t0));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
  } catch (err) {
    console.error('[STICKER] animated capture session failed:', err);
  } finally {
    try { win.destroy(); } catch { /* ignore */ }
  }

  if (frameCount === 0) {
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return null;
  }

  // Post-process the captured PNG sequence to bake real alpha:
  //   1. format=rgba — ensure RGBA channels.
  //   2. chromakey — replace lime-green bg pixels with alpha 0.
  //      similarity=0.4 + blend=0.1 are deliberately permissive so any
  //      anti-aliasing color shifts at SVG edges still get keyed out.
  //
  // Why output PNG sequence instead of WebM?
  //   We tried encoding to WebM VP9 with `-pix_fmt yuva420p` first, but
  //   ffmpeg-static's libvpx-vp9 build dropped the alpha plane during
  //   encode — the resulting WebM looped fine but its alpha channel was
  //   solid 1.0 everywhere, so the lime-green chroma background showed
  //   through as a solid colored box on the exported video.
  //   PNG natively supports 8-bit alpha; image2 demuxer handles PNG
  //   sequences as a video stream when fed `-framerate N -i %04d.png`.
  //   No encoder-specific alpha quirks. Disk usage is higher (~2-5MB per
  //   sticker for 60 frames at 256x256) but it's always cleaned up
  //   after export completes.
  const ffmpegBin = getFfmpegBin();
  const processedDir = path.join(cacheDir, `frames-keyed-${stamp}`);
  try { fs.mkdirSync(processedDir, { recursive: true }); } catch { /* exists */ }

  // FFmpeg image2 muxer defaults to start_number=1 — force output to
  // start at 0 so numbering matches our capture loop.
  //
  // Filter chain (no despill — that filter isn't in every ffmpeg-static
  // build and silently fails the whole pass when missing). Instead we
  // use a sharp-cutoff chromakey to avoid producing the semi-transparent
  // edge halo in the first place:
  //
  //   format=rgba             — RGBA channels.
  //   chromakey=0x00ff14:0.3:0.0
  //     similarity=0.3  — TIGHT match (only near-pure lime green keys
  //                       out). Wider thresholds (>0.5) start matching
  //                       sticker content too — we saw an entire sticker
  //                       go transparent when this was 0.55. 0.3 is
  //                       conservative enough that hearts/fire/sparkle
  //                       palettes survive intact.
  //     blend=0.0       — HARD cutoff. Pixels are either fully transparent
  //                       (within similarity) or fully opaque. No
  //                       semi-transparent gradient ⇒ no halo when
  //                       composited over the video.
  //   format=rgba             — final pixel format for the PNG output.
  //
  // Trade-off: a thin ring of mixed-color pixels may stay opaque at the
  // sticker outline. They keep their original (slightly-green-tinted)
  // RGB but they're FULLY opaque, so the result reads as a thin colored
  // outline rather than a translucent halo. Acceptable.
  const args = [
    '-y',
    '-start_number', '0',
    '-i', path.join(framesDir, 'frame_%04d.png'),
    '-vf', 'format=rgba,chromakey=0x00ff14:0.3:0.0,format=rgba',
    '-start_number', '0',
    path.join(processedDir, 'frame_%04d.png'),
  ];

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin, args);
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg chromakey pass exit ${code}: ${stderr.slice(-400)}`));
      });
      proc.on('error', err => reject(err));
    });
    // Discard the raw (lime-bg) frames; keep only the keyed sequence.
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`[STICKER] Animated template → ${processedDir} (${frameCount} frames @ ${fps}fps, PNG sequence)`);
    // Return a structured handle so the overlay pipeline knows to use
    // image2 demuxer with the right framerate.
    return {
      kind: 'png-sequence',
      pattern: path.join(processedDir, 'frame_%04d.png'),
      fps,
      frameCount,
      durationSec: frameCount / fps,
    };
  } catch (err) {
    console.error('[STICKER] chromakey pass failed:', err.message);
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(processedDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return null;
  }
}

// ── Apply Video Filters (Phase 2 — combined export) ───────────────────
ipcMain.handle('apply-video-filters', async (event, {
  filePath, startTime, endTime, filters, outputName, scale, crf,
  videoBitrateKbps, maxrateKbps, bufsizeKbps,
  subtitlePath, bgmPath, bgmVolume, fadeIn, fadeOut, delogoRegions,
  // Export-pipeline extras: explicit dimensions + codec + framerate
  width, height, codec, fps,
  tempOutput,
  // When set, FFmpeg progress events are streamed back to the renderer
  // tagged with this id so the export modal can show a real progress bar.
  progressTag,
  // User-specified output folder (Export modal). When omitted, falls back
  // to the configured default "edited" subfolder.
  outputDir,
}) => {
  const { execFile } = require('child_process');

  // Sweep stale sticker-template caches from previous exports. We keep
  // only entries created in the last hour to avoid deleting frames an
  // in-flight parallel export might be reading. Anything older is safe
  // to remove.
  try {
    const fsx = require('fs');
    const pathx = require('path');
    const cacheRoot = pathx.join(app.getPath('userData'), 'sticker-template-cache');
    if (fsx.existsSync(cacheRoot)) {
      const cutoff = Date.now() - 60 * 60 * 1000; // 1h
      for (const entry of fsx.readdirSync(cacheRoot)) {
        const p = pathx.join(cacheRoot, entry);
        try {
          const stat = fsx.statSync(p);
          if (stat.mtimeMs < cutoff) fsx.rmSync(p, { recursive: true, force: true });
        } catch { /* file vanished, ignore */ }
      }
    }
  } catch (err) {
    console.warn('[STICKER] cache sweep failed (non-fatal):', err && err.message);
  }

  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const ffmpegBin = getFfmpegBin();

  const saveDir = tempOutput
    ? path.join(app.getPath('temp'), 'veo3-flow-enhance')
    : (outputDir || path.join(getVideoOutputDir(), 'edited'));
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ePrefix = `E_${dd}_${mm}_`;
  let maxSeq = 0;
  try {
    const files = fs.readdirSync(saveDir);
    for (const f of files) {
      if (f.startsWith(ePrefix)) {
        const match = f.match(new RegExp(`^${ePrefix}(\\d+)`));
        if (match) { const n = parseInt(match[1], 10); if (n > maxSeq) maxSeq = n; }
      }
    }
  } catch { }
  const seq = String(maxSeq + 1).padStart(3, '0');
  const outFilename = (() => {
    const n = outputName || `${ePrefix}${seq}.mp4`;
    return /\.(mp4|mov|mkv|webm|avi)$/i.test(n) ? n : `${n}.mp4`;
  })();
  const outPath = path.join(saveDir, outFilename);

  // Build FFmpeg filter complex
  const videoFilters = [];
  const {
    brightness = 0, contrast = 1, saturation = 1, hue = 0,
    rotate = 0, flipH = false, flipV = false,
    cropX = 0, cropY = 0, cropW = 0, cropH = 0,
    blur = 0,
    sharpen = 0,
    stabilize = null,
    denoise = null,
    opticalFlow = null,
    deflicker = null,
    motionBlur = null,
    layout = null,
    textOverlay = null, // { text, fontSize, fontColor, x, y }
  } = filters || {};
  const hasCanvasLayout = !!(layout && Number(layout.canvasWidth) > 0 && Number(layout.canvasHeight) > 0);

  const even = (n) => Math.max(2, Math.round(Number(n || 0) / 2) * 2);
  const clamp = (v, min, max, fallback = min) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  const ffNum = (v, fallback = 0) => {
    const n = Number.isFinite(Number(v)) ? Number(v) : fallback;
    const fixed = n.toFixed(6).replace(/\.?0+$/, '');
    return fixed === '-0' || fixed === '' ? '0' : fixed;
  };
  const buildAnimatedExpr = (points, fallback, transform = (v) => v) => {
    const normalized = Array.isArray(points)
      ? points
          .map((point) => ({
            time: Number(point?.time),
            value: transform(Number(point?.value)),
          }))
          .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
          .sort((a, b) => a.time - b.time)
      : [];

    if (normalized.length === 0) {
      return { expr: ffNum(transform(fallback)), animated: false };
    }
    if (normalized.length === 1) {
      return { expr: ffNum(normalized[0].value), animated: false };
    }

    let expr = ffNum(normalized[normalized.length - 1].value);
    for (let i = normalized.length - 2; i >= 0; i--) {
      const a = normalized[i];
      const b = normalized[i + 1];
      const span = Math.max(0.000001, b.time - a.time);
      const interp = `${ffNum(a.value)}+(${ffNum(b.value)}-${ffNum(a.value)})*(t-${ffNum(a.time)})/${ffNum(span)}`;
      expr = `if(lte(t\\,${ffNum(b.time)})\\,${interp}\\,${expr})`;
    }
    return { expr, animated: true };
  };

  // eq filter (brightness/contrast/saturation) — CLAMPED to FFmpeg safe ranges
  // FFmpeg `eq` accepts:
  //   brightness: -1.0 .. 1.0  (additive; values outside clip to white/black → posterized noise)
  //   contrast:    0.0 .. 2.0  (multiplicative; >2 produces extreme banding/tearing)
  //   saturation:  0.0 .. 3.0  (multiplicative; >3 → noise / color crush)
  // When user has many effects ON, the orchestrator multiplies them together
  // and can push values way out of range, which is what created the
  // shattered horizontal-stripe artifacts in exports.
  const safeB = Math.max(-1, Math.min(1, Number(brightness) || 0));
  const safeC = Math.max(0, Math.min(2, Number(contrast) || 1));
  const safeS = Math.max(0, Math.min(3, Number(saturation) || 1));
  if (Math.abs(safeB) > 0.005 || Math.abs(safeC - 1) > 0.005 || Math.abs(safeS - 1) > 0.005) {
    videoFilters.push(`eq=brightness=${safeB.toFixed(3)}:contrast=${safeC.toFixed(3)}:saturation=${safeS.toFixed(3)}`);
  }
  // hue filter — wrap into [-360, 360]; tiny values are no-ops
  const safeHue = Math.max(-360, Math.min(360, Number(hue) || 0));
  if (Math.abs(safeHue) > 0.5) {
    videoFilters.push(`hue=h=${safeHue.toFixed(2)}`);
  }

  // ── Adjust panel — extended color grading ──
  // Highlight/Shadow/Whites/Blacks/Vignette + LUT + HSL + Curves +
  // ColorWheel. The base eq chain above already handles brightness/
  // contrast/saturation/hue from the rawB/rawC/rawS aggregator, so this
  // section ONLY adds the things that don't fold into eq. Order: tonal
  // shaping (highlight/shadow/whites/blacks) → curves → LUT → color wheel
  // → HSL → vignette. This puts color grading BEFORE crop/scale so the
  // grading happens on the original gamut and the layout pass is purely
  // geometric.
  const adjust = filters?.adjust || {};

  // Highlight (-100..100): pull the upper half of the tonal curve. Top
  // anchor moves to (1, 1 + h) where h ∈ [-0.5, 0.5]. Pass shadows
  // through the (0.5, 0.5) midpoint so we don't darken the lower half.
  if (adjust.highlight) {
    const h = clamp(adjust.highlight, -100, 100, 0) / 200;
    const top = clamp(1 + h, 0.5, 1.0, 1);
    videoFilters.push(`curves=master='0/0 0.5/0.5 1/${top.toFixed(3)}'`);
  }
  // Shadow (-100..100): mirror of highlight on the bottom anchor.
  if (adjust.shadow) {
    const s = clamp(adjust.shadow, -100, 100, 0) / 200;
    const bottom = clamp(s + 0, -0.3, 0.3, 0);
    videoFilters.push(`curves=master='0/${(0 + bottom).toFixed(3)} 0.5/0.5 1/1'`);
  }
  // Whites (-100..100): output ceiling — clamp pure white down/up.
  // Positive whites = "blow" (input below ceil maps to full white).
  // Negative whites would mean "compress brights" — that's a different
  // colorlevels param (romax_out) and not modeled here yet, so we
  // currently render it as a no-op rather than crashing the export.
  // FFmpeg's colorlevels.romax MUST be in [0, 1]; previously a negative
  // `whites` slider produced ceil>1 ("-0.013 ... Result too large").
  if (adjust.whites) {
    const w = clamp(adjust.whites, -100, 100, 0) / 400;  // ±0.25
    if (w > 0) {
      // Blow whites: lower romax to bring the cap down (input ≥ romax
      // becomes pure white). 1/(1+w) is the inverse mapping, kept in
      // [0.5, 1.0] so we never write the identity (1.0) — saves a
      // wasted filter pass — and never go below 0.5 which would crush
      // the highlights to gray.
      const ceil = Math.max(0.5, Math.min(1, 1 / (1 + w)));
      if (ceil < 0.999) {
        videoFilters.push(`colorlevels=romax=${ceil.toFixed(3)}:gomax=${ceil.toFixed(3)}:bomax=${ceil.toFixed(3)}`);
      }
    }
    // Negative `whites` (compress) intentionally not emitted yet —
    // would need romax_out, parked for a follow-up.
  }
  // Blacks (-100..100): output floor — crush blacks (positive) or
  // lift blacks (negative — not supported yet, see whites comment).
  // Same FFmpeg [0, 1] constraint on romin; the previous code passed
  // negative values when the slider went below 0.
  if (adjust.blacks) {
    const b = clamp(adjust.blacks, -100, 100, 0) / 400;  // ±0.25
    if (b > 0) {
      // Crush: input ≤ floor maps to black. Cap at 0.25 to avoid
      // killing all shadow detail; clamp into [0, 1] just to be 100 %
      // sure no out-of-range value ever reaches FFmpeg.
      const floor = Math.max(0, Math.min(0.25, b));
      if (floor > 0.001) {
        videoFilters.push(`colorlevels=romin=${floor.toFixed(3)}:gomin=${floor.toFixed(3)}:bomin=${floor.toFixed(3)}`);
      }
    }
    // Negative `blacks` (lift) → would need romin_out; parked.
  }

  // ── Curves (per-channel 2-point linear) ──
  // Skip channels where points are identity [0, 1]. Master curve = luma.
  const curvesCfg = filters?.curves;
  if (curvesCfg && typeof curvesCfg === 'object') {
    const parts = [];
    const ch2name = { luma: 'master', red: 'red', green: 'green', blue: 'blue' };
    for (const [key, name] of Object.entries(ch2name)) {
      const pts = curvesCfg[key];
      if (Array.isArray(pts) && pts.length === 2) {
        const p0 = clamp(pts[0], 0, 1, 0);
        const p1 = clamp(pts[1], 0, 1, 1);
        if (Math.abs(p0) > 0.005 || Math.abs(p1 - 1) > 0.005) {
          parts.push(`${name}='0/${p0.toFixed(3)} 1/${p1.toFixed(3)}'`);
        }
      }
    }
    if (parts.length > 0) {
      videoFilters.push(`curves=${parts.join(':')}`);
    }
  }

  // ── LUT ──
  // Prefer real .cube file shipped under userData/luts/{name}.cube. If
  // missing, fall back to a CSS-equivalent eq/colorchannelmixer chain
  // covering the most common preset names. Intensity not implemented yet
  // (would require blending with original via filter_complex).
  const lutCfg = filters?.lut;
  if (lutCfg && lutCfg.name && lutCfg.name !== 'None') {
    const cubePath = path.join(app.getPath('userData'), 'luts', `${lutCfg.name}.cube`);
    if (fs.existsSync(cubePath)) {
      const escLut = cubePath.replace(/\\/g, '/').replace(/:/g, '\\:');
      videoFilters.push(`lut3d=file='${escLut}'`);
      console.log(`[ADJUST] LUT applied via .cube file: ${lutCfg.name}`);
    } else {
      // Fallback CSS-equivalent. Each preset entry is a single FFmpeg
      // filter expression — keeping it short avoids slow rebuilds.
      const fallback = {
        'Cinematic':       'eq=brightness=-0.04:saturation=1.18:contrast=1.10',
        'Vintage':         'eq=brightness=0.04:saturation=0.72:contrast=0.92',
        'B&W':             'hue=s=0',
        'Black & White':   'hue=s=0',
        'Sepia':           'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
        'Vivid':           'eq=saturation=1.4:contrast=1.12',
        'Muted':           'eq=saturation=0.65:contrast=0.95',
        'Cool':            'colorbalance=rs=-0.15:bs=0.18',
        'Warm':            'colorbalance=rs=0.15:bs=-0.12',
        'Faded':           'eq=brightness=0.06:saturation=0.7:contrast=0.85',
        'Drama':           'eq=brightness=-0.08:contrast=1.25',
        'Cyberpunk':       'colorbalance=rs=-0.2:bs=0.3:gh=-0.1,eq=saturation=1.3',
        'Retro':           'colorbalance=rs=0.1:gs=0.05:bh=-0.1,eq=saturation=0.85',
      };
      const f = fallback[lutCfg.name];
      if (f) {
        videoFilters.push(f);
        console.log(`[ADJUST] LUT fallback CSS-equivalent: ${lutCfg.name}`);
      } else {
        console.warn(`[ADJUST] LUT "${lutCfg.name}" — no .cube file and no fallback mapping; skipped`);
      }
    }
  }

  // ── Color wheel ──
  // Maps Shadows/MidGrey/Tint to FFmpeg colorbalance shadows/mid/highlight
  // RGB. `offset` is global RGB lift (no direct colorbalance equivalent),
  // applied as a small `eq=brightness` baseline scaled per channel —
  // imperfect but at least non-zero.
  const cwCfg = filters?.colorWheel;
  if (cwCfg && cwCfg.intensity > 0) {
    const i = Math.max(0, Math.min(1, (cwCfg.intensity || 100) / 100));
    const sh = cwCfg.shadows || { r: 0, g: 0, b: 0 };
    const md = cwCfg.middleGrey || { r: 0, g: 0, b: 0 };
    const tn = cwCfg.tint || { r: 0, g: 0, b: 0 };
    // colorbalance accepts ±1.0; we keep ±0.5 to stay tasteful.
    const cl = (v) => clamp((v || 0) * i, -0.5, 0.5, 0);
    const rs = cl(sh.r), gs = cl(sh.g), bs = cl(sh.b);
    const rm = cl(md.r), gm = cl(md.g), bm = cl(md.b);
    const rh = cl(tn.r), gh = cl(tn.g), bh = cl(tn.b);
    if (rs || gs || bs || rm || gm || bm || rh || gh || bh) {
      videoFilters.push(`colorbalance=rs=${rs.toFixed(3)}:gs=${gs.toFixed(3)}:bs=${bs.toFixed(3)}:rm=${rm.toFixed(3)}:gm=${gm.toFixed(3)}:bm=${bm.toFixed(3)}:rh=${rh.toFixed(3)}:gh=${gh.toFixed(3)}:bh=${bh.toFixed(3)}`);
    }
    // Offset — global lift via eq (averaged because FFmpeg eq has no per-channel brightness).
    const off = cwCfg.offset || { r: 0, g: 0, b: 0 };
    const offAvg = ((off.r || 0) + (off.g || 0) + (off.b || 0)) / 3 * i;
    if (Math.abs(offAvg) > 0.01) {
      videoFilters.push(`eq=brightness=${clamp(offAvg, -0.3, 0.3, 0).toFixed(3)}`);
    }
  }

  // ── HSL — best-effort approximation ──
  // FFmpeg lacks a per-color hue/sat filter (no selectivecolor for HSL).
  // We average the touched colors' adjustments into global hue/sat/
  // brightness shifts. Less precise than the live preview's per-color
  // CSS approximation but at least non-silent. Power users should rely
  // on Curves + Color wheel for precise grading.
  const hslCfg = filters?.hsl;
  if (hslCfg && typeof hslCfg === 'object') {
    let totalH = 0, totalS = 0, totalB = 0, count = 0;
    for (const colorId of Object.keys(hslCfg)) {
      const cc = hslCfg[colorId];
      if (cc && (cc.h || cc.s || cc.b)) {
        totalH += Number(cc.h) || 0;
        totalS += Number(cc.s) || 0;
        totalB += Number(cc.b) || 0;
        count++;
      }
    }
    if (count > 0) {
      const avgH = totalH / count;
      const avgS = totalS / count;
      const avgB = totalB / count;
      // Hue shift in degrees (-100..100 maps to ~±90°).
      if (Math.abs(avgH) > 0.5) {
        videoFilters.push(`hue=h=${(avgH * 0.9).toFixed(2)}`);
      }
      // Saturation in eq is multiplicative (1 = no change).
      if (Math.abs(avgS) > 0.5) {
        const sMul = clamp(1 + avgS / 200, 0.2, 2.0, 1);
        videoFilters.push(`eq=saturation=${sMul.toFixed(3)}`);
      }
      // Brightness add (-1..1).
      if (Math.abs(avgB) > 0.5) {
        videoFilters.push(`eq=brightness=${clamp(avgB / 400, -0.3, 0.3, 0).toFixed(3)}`);
      }
    }
  }

  // ── Vignette ──
  // Positive (1..100) = darken edges. Negative = brighten edges (FFmpeg
  // vignette mode=backward). PI/4 (45°) is a strong vignette; we scale
  // angle by intensity so 100 = full vignette, 25 = subtle.
  if (adjust.vignette) {
    const vAbs = Math.min(100, Math.abs(adjust.vignette)) / 100;
    const angle = (Math.PI / 4) * vAbs;
    const mode = adjust.vignette > 0 ? 'forward' : 'backward';
    videoFilters.push(`vignette=angle=${angle.toFixed(4)}:eval=init:mode=${mode}`);
  }

  // crop filter
  if (cropW > 0 && cropH > 0) {
    videoFilters.push(`crop=${cropW}:${cropH}:${cropX}:${cropY}`);
  }
  // rotate/flip
  if (!hasCanvasLayout) {
    if (rotate === 90) videoFilters.push('transpose=1');
    else if (rotate === 180) videoFilters.push('transpose=1,transpose=1');
    else if (rotate === 270) videoFilters.push('transpose=2');
    if (flipH) videoFilters.push('hflip');
    if (flipV) videoFilters.push('vflip');
  }
  if (stabilize?.enabled) {
    const rx = Math.round(clamp(stabilize.rx, 0, 64, 16));
    const ry = Math.round(clamp(stabilize.ry, 0, 64, 16));
    videoFilters.push(`deshake=rx=${rx}:ry=${ry}:edge=mirror:blocksize=8:contrast=125:search=exhaustive`);
  }
  if (denoise?.enabled) {
    const ls = clamp(denoise.lumaSpatial, 0, 12, 4).toFixed(2);
    const cs = clamp(denoise.chromaSpatial, 0, 12, 3).toFixed(2);
    const lt = clamp(denoise.lumaTemporal, 0, 18, 6).toFixed(2);
    const ct = clamp(denoise.chromaTemporal, 0, 18, 4.5).toFixed(2);
    videoFilters.push(`hqdn3d=${ls}:${cs}:${lt}:${ct}`);
  }
  // Remove flickers — FFmpeg's `deflicker` filter smooths brightness across
  // a sliding window of N frames. Two modes from the UI:
  //   • flashlight  → median-of-window rejects outlier bright frames (good for
  //     fluorescent strobing, camera flashes, LED PWM)
  //   • timelapse   → arithmetic mean of window flattens gradual exposure
  //     drift (good for time-lapse photography where shutter/ISO drifts)
  // Window size: Weak=3 (subtle), Recommended=5 (default), Strong=7 (heavy).
  // Bigger window smooths more but introduces motion lag — that's why CapCut
  // also exposes 3 levels.
  if (deflicker?.enabled) {
    const sizeByLevel = { weak: 3, recommended: 5, strong: 7 };
    const size = sizeByLevel[deflicker.level] ?? 5;
    const mode = deflicker.mode === 'timelapse' ? 'am' : 'median';
    videoFilters.push(`deflicker=size=${size}:mode=${mode}`);
  }
  // Motion blur — real temporal frame blending via tmix (matches CapCut UI).
  //
  // tmix mixes N consecutive frames using configurable per-frame weights:
  //   tmix=frames=N:weights="<list>"
  //
  // CapCut UI ranges:
  //   Blur:   0-100   (Strength — % of max)
  //   Blend:  0-100   (How much of original blends back)
  //   Direction: forward / backward / both
  //   Speed:  once / twice / thrice  (number of chained tmix passes)
  //
  // Strength mapping (Blur 0-100 → frames 1..9 base):
  //   blur=0   → skip (no effect)
  //   blur=25  → 3 frames    (subtle)
  //   blur=50  → 5 frames    (medium)
  //   blur=75  → 7 frames    (heavy)
  //   blur=100 → 9 frames    (max base, then Speed multiplies it)
  //
  // Speed multiplier:
  //   once  → 1× tmix pass         (just the base)
  //   twice → +1 chained tmix=3    (stronger streaks)
  //   thrice→ +2 chained tmix=3    (cinematic long-exposure)
  //
  // So blur=100 + thrice ≈ ~13-15 effective frames blended → very strong.
  //
  // Direction = which side of the current frame the trail extends to:
  //   "backward" — past frames trail behind motion (default tmix; classic
  //                motion blur look)
  //   "forward"  — future frames; we apply `reverse,tmix,reverse` so the
  //                blur leads in front of motion. Heavy: full clip buffer.
  //   "both"     — approximated as backward (true centered tmix needs GLSL
  //                shader; difference is barely perceptible to viewers)
  if (motionBlur?.enabled && motionBlur.blur > 0) {
    const pct = clamp(motionBlur.blur, 0, 100, 100);
    // Linear mapping 0-100 → 1-9 frames (rounded). 0 falls through as skip.
    const frames = Math.max(1, Math.round(1 + (pct / 100) * 8));
    if (frames > 1) {
      const weights = Array(frames).fill(1).join(' ');
      const dir = motionBlur.direction || 'both';
      let mb;
      if (dir === 'forward') {
        mb = `reverse,tmix=frames=${frames}:weights='${weights}',reverse`;
      } else {
        mb = `tmix=frames=${frames}:weights='${weights}'`;
      }
      // Speed = number of chained tmix passes. Each extra pass adds a
      // 3-frame tmix, intensifying the motion trail.
      if (motionBlur.speed === 'twice') {
        mb = `${mb},tmix=frames=3:weights='1 1 1'`;
      } else if (motionBlur.speed === 'thrice') {
        mb = `${mb},tmix=frames=3:weights='1 1 1',tmix=frames=3:weights='1 1 1'`;
      }
      videoFilters.push(mb);
      // Blend% = how much of the ORIGINAL bleeds back over the blurred output.
      // We approximate by lowering contrast slightly when blend is high (high
      // blend → result closer to original → reduce blur saturation slightly).
      // True alpha-blend with original requires filter_complex split+blend
      // which is heavy; the eq trick produces visually-similar output.
      const blendPct = clamp(motionBlur.blend, 0, 100, 0);
      if (blendPct > 1) {
        const opacity = blendPct / 100;
        videoFilters.push(`eq=brightness=0:contrast=${(1 - 0.05 * (1 - opacity)).toFixed(3)}`);
      }
    }
  }
  if (blur > 0) {
    const blurRadius = clamp(blur, 0, 20, 0).toFixed(2);
    videoFilters.push(`boxblur=${blurRadius}:1`);
  }
  if (sharpen > 0) {
    const amount = clamp(sharpen, 0, 1.5, 0).toFixed(2);
    videoFilters.push(`unsharp=3:3:${amount}:3:3:0`);
  }
  if (opticalFlow?.enabled) {
    const flowFps = Math.round(clamp(opticalFlow.fps, 24, 120, 50));
    videoFilters.push(`minterpolate=fps=${flowFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
  }
  // text overlay (drawtext) — single overlay (legacy single-text path).
  if (textOverlay && textOverlay.text) {
    const { text, fontSize = 32, fontColor = 'white', x = '(w-text_w)/2', y = '(h-text_h)/2' } = textOverlay;
    // Escape order matters: backslash FIRST (else later replaces add `\`
    // that we'd double-escape), then single-quote, then colon. Without
    // the backslash pass, Vietnamese / Windows-flavor text containing
    // `\` would break the FFmpeg filter parser.
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "'\\''")
      .replace(/:/g, '\\:');
    videoFilters.push(`drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}:borderw=2:bordercolor=black@0.5`);
  }

  // ── Text overlays (timeline mode — multiple text clips with time gates) ──
  // Each text clip on the text track produces a `drawtext` filter with
  // `enable='between(t,start,end)'` so it only appears during its clip
  // range. Position math mirrors PlayerArea: textConfig.position picks the
  // anchor (top/center/bottom), then posX/posY translate from there.
  // Color is converted from hex (#ffeb3b) to FFmpeg hex (0xffeb3b).
  const textOverlayFilters = [];
  const signedTextOffset = (n) => n >= 0 ? `+${n}` : `${n}`;
  const ffColor = (value, fallback = '#ffffff', alpha = 1) => {
    const raw = String(value || fallback).trim();
    const safeAlpha = clamp(alpha, 0, 1, 1);
    if (!raw || raw === 'transparent') return `black@0`;
    const rgba = raw.match(/^rgba?\(([^)]+)\)$/i);
    if (rgba) {
      const parts = rgba[1].split(',').map(p => p.trim());
      const r = Math.max(0, Math.min(255, Math.round(Number(parts[0]) || 0)));
      const g = Math.max(0, Math.min(255, Math.round(Number(parts[1]) || 0)));
      const b = Math.max(0, Math.min(255, Math.round(Number(parts[2]) || 0)));
      const a = parts.length > 3 ? clamp(Number(parts[3]), 0, 1, 1) : 1;
      const hex = [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      return `0x${hex}@${(a * safeAlpha).toFixed(3)}`;
    }
    const shortHex = raw.match(/^#([0-9a-f]{3})$/i);
    if (shortHex) {
      const hex = shortHex[1].split('').map(ch => ch + ch).join('');
      return `0x${hex}@${safeAlpha.toFixed(3)}`;
    }
    const hex = raw.replace(/^#/, '');
    if (/^[0-9a-f]{6}$/i.test(hex)) return `0x${hex}@${safeAlpha.toFixed(3)}`;
    return raw.includes('@') ? raw : `${raw}@${safeAlpha.toFixed(3)}`;
  };
  const textOverlays = filters?.textOverlays;
  if (Array.isArray(textOverlays) && textOverlays.length > 0) {
    for (const t of textOverlays) {
      if (!t || !t.text) continue;
      const text = String(t.text);
      const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\n/g, '\\n');
      const fs = clamp(Number(t.fontSize) || 32, 8, 256, 32);
      const opacity = clamp(Number(t.opacity), 0, 1, 1);
      const effect = t.textEffectStyle || {};
      const bubble = t.bubbleStyle || {};
      const fc = ffColor(effect.gradientFrom || t.color || '#ffffff', '#ffffff', opacity);
      const bold = t.fontWeight === 'bold' || t.fontWeight === '700';
      // Anchor X based on text alignment.
      const align = t.align || 'center';
      const baseX = align === 'left'   ? '20'
                  : align === 'right'  ? `(w-text_w-20)`
                  : `(w-text_w)/2`;
      // Anchor Y based on position.
      const pos = t.position || 'center';
      const baseY = pos === 'top'    ? `${Math.round(fs * 0.4)}`
                  : pos === 'bottom' ? `(h-text_h-${Math.round(fs * 0.4)})`
                  : `(h-text_h)/2`;
      // Apply posX/posY pixel offsets (UI side stores them at preview
      // canvas scale; we apply them in pixel space which scales OK for
      // typical 1080p exports).
      const posX = Number(t.posX) || 0;
      const posY = Number(t.posY) || 0;
      const x = posX !== 0 ? `(${baseX})+(${posX})` : baseX;
      const y = posY !== 0 ? `(${baseY})+(${posY})` : baseY;
      // Time gate (relative to clip-start, i.e. trimmed source start).
      // The export pipeline already trims the source via -ss/-t before
      // applying the filter, so timestamps inside the trimmed segment
      // start at 0. We forward t.startTime as offset within the clip.
      const startOffset = Math.max(0, Number(t.startTime) || 0);
      const endOffset = Math.max(startOffset + 0.05, Number(t.endTime) || 999);
      const enable = `between(t,${startOffset.toFixed(3)},${endOffset.toFixed(3)})`;

      if (bubble.shape && bubble.shape !== 'none') {
        const padX = Math.round(clamp(bubble.paddingX, 0, 160, 20));
        const padY = Math.round(clamp(bubble.paddingY, 0, 100, 12));
        const lineCount = Math.max(1, text.split(/\n/).length);
        const maxChars = Math.max(1, ...text.split(/\n/).map(line => line.length));
        const estTextW = Math.max(fs * 1.4, maxChars * fs * (bold ? 0.62 : 0.56));
        const estTextH = Math.max(fs, lineCount * fs * 1.22);
        const bubbleStrokeW = Math.round(clamp(bubble.strokeWidth, 0, 16, 0));
        const boxW = Math.round(estTextW + padX * 2 + bubbleStrokeW * 2);
        const boxH = Math.round(estTextH + padY * 2 + bubbleStrokeW * 2);
        const marginY = Math.round(fs * 0.4);
        const boxBaseX = align === 'left'
          ? `${20 - padX}`
          : align === 'right'
            ? `(w-${boxW}${signedTextOffset(padX - 20)})`
            : `(w-${boxW})/2`;
        const boxBaseY = pos === 'top'
          ? `${marginY - padY}`
          : pos === 'bottom'
            ? `(h-${boxH}${signedTextOffset(padY - marginY)})`
            : `(h-${boxH})/2`;
        const boxX = posX !== 0 ? `(${boxBaseX})+(${posX})` : boxBaseX;
        const boxY = posY !== 0 ? `(${boxBaseY})+(${posY})` : boxBaseY;
        const fill = ffColor(bubble.fill || '#111116', '#111116', opacity);
        const stroke = ffColor(bubble.stroke || bubble.fill || '#ffffff', '#ffffff', opacity);
        textOverlayFilters.push(`drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${fill}:t=fill:enable='${enable}'`);
        if (bubbleStrokeW > 0) {
          textOverlayFilters.push(`drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${stroke}:t=${bubbleStrokeW}:enable='${enable}'`);
        }
      }

      const hasExplicitEffect = !!t.textEffectStyle;
      const borderW = Math.round(clamp(effect.strokeWidth, 0, 24, hasExplicitEffect ? 0 : 1));
      const borderColor = ffColor(effect.strokeColor || '#000000', '#000000', opacity);
      const shadowColor = effect.shadowColor || effect.glowColor || (!hasExplicitEffect ? 'black' : '');
      const shadowX = Math.round(clamp(effect.shadowX, -24, 24, bold ? 2 : 1));
      const shadowY = Math.round(clamp(effect.shadowY, -24, 24, bold ? 2 : 1));
      const shadow = shadowColor
        ? `:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=${ffColor(shadowColor, '#000000', opacity)}`
        : '';
      const border = borderW > 0 ? `:borderw=${borderW}:bordercolor=${borderColor}` : '';
      textOverlayFilters.push(`drawtext=text='${escaped}':fontsize=${fs}:fontcolor=${fc}:x=${x}:y=${y}${shadow}${border}:enable='${enable}'`);
    }
    if (hasCanvasLayout) textOverlayFilters.push('format=rgba');
    else videoFilters.push(...textOverlayFilters);
    console.log(`[TEXT] Applied ${textOverlays.length} timeline text overlays`);
  }

  // ─── Video effects (Effects tab) ─────────────────────────────
  // Each effect is an object: { libraryId, name, type, params, mask,
  // startTime, endTime } where startTime/endTime are clip-local seconds.
  // We map TYPE → FFmpeg filter chain. `enable=between(t,...)` gates
  // each effect to its visible window so multiple effects with non-
  // overlapping windows can co-exist on the same clip.
  //
  // Mask handling (CapCut Mask tab) is supported for shapes Linear /
  // Mirror / Circle / Rectangle / Heart / Star via `geq` alpha-mask
  // expressions blended with the original via `alphamerge` + `blend`.
  // Brush / Pen masks fall through to no-mask (full-frame) — the paint
  // UI isn't shipped yet.
  const effects = filters?.effects;
  if (Array.isArray(effects) && effects.length > 0) {
    for (const fx of effects) {
      const fxStart = Number.isFinite(fx.startTime) ? Math.max(0, fx.startTime) : 0;
      const fxEnd = Number.isFinite(fx.endTime) ? Math.max(fxStart + 0.05, fx.endTime) : fxStart + 3;
      const enable = `between(t,${fxStart.toFixed(3)},${fxEnd.toFixed(3)})`;
      const p = fx.params || {};
      const size     = clamp(p.size,     0, 100, 50);
      const amount   = clamp(p.amount,   0, 100, 50);
      const strength = clamp(p.strength, 0, 100, 50);
      const speed    = clamp(p.speed,    0, 100, 50);
      const filtersP = clamp(p.filters,  0, 100, 30);
      void filtersP; // some types don't use it; kept for signature parity

      switch (fx.type) {
        case 'blur': {
          // Gaussian blur, sigma 0..16 from amount + size.
          const sigma = (amount / 100) * 8 + (size / 100) * 6;
          if (sigma > 0.05) {
            videoFilters.push(`gblur=sigma=${sigma.toFixed(2)}:enable='${enable}'`);
          }
          break;
        }
        case 'zoom': {
          // Animated zoom — scale around center using zoompan-like math.
          // Use a `zoompan` substitute via `scale` + `crop` with a time-
          // varying scale. Simpler approach: scale the image based on a
          // sin() wave whose amplitude = amount, period = derived from speed.
          const peak = 1 + (amount / 100) * 0.5;
          if (speed > 5) {
            const period = Math.max(0.4, 4 - speed * 0.035).toFixed(2);
            // scale=iw*S:ih*S where S oscillates. We use abs(sin) so the
            // image always stays >= original size (no shrink artifact).
            const expr = `(${peak.toFixed(3)}-1)*abs(sin(2*PI*t/${period}))+1`;
            videoFilters.push(`scale=w='iw*(${expr})':h='ih*(${expr})':eval=frame:enable='${enable}'`);
            // Crop back to original frame so the zoom centers properly.
            videoFilters.push(`crop=iw/(${expr}):ih/(${expr}):(iw-iw/(${expr}))/2:(ih-ih/(${expr}))/2:enable='${enable}'`);
          } else {
            videoFilters.push(`scale=iw*${peak.toFixed(3)}:ih*${peak.toFixed(3)}:enable='${enable}'`);
            videoFilters.push(`crop=iw/${peak.toFixed(3)}:ih/${peak.toFixed(3)}:(iw-iw/${peak.toFixed(3)})/2:(ih-ih/${peak.toFixed(3)})/2:enable='${enable}'`);
          }
          break;
        }
        case 'open':
        case 'fade': {
          // Wipe / fade — alpha ramp across the visible window.
          const dur = Math.max(0.1, Math.min((fxEnd - fxStart) / 2, 2 - speed / 100 * 1.6));
          // fade=in over the first `dur` seconds of this effect's range.
          videoFilters.push(`fade=t=in:st=${fxStart.toFixed(3)}:d=${dur.toFixed(3)}:alpha=0`);
          if (fx.type === 'fade') {
            videoFilters.push(`fade=t=out:st=${(fxEnd - dur).toFixed(3)}:d=${dur.toFixed(3)}:alpha=0`);
          }
          break;
        }
        case 'color': {
          // Color grade — sepia/VHS/film-grain etc. Reuses eq filter for
          // saturation+contrast tweaks; hue adjustment for VHS.
          const sepia = (amount / 100) * 0.6;
          const sat = 1 + strength / 100 * 0.4 - sepia * 0.5;
          const contrast = 1 + amount / 100 * 0.15;
          videoFilters.push(`eq=saturation=${sat.toFixed(3)}:contrast=${contrast.toFixed(3)}:enable='${enable}'`);
          if (fx.libraryId === 'vhs') {
            videoFilters.push(`hue=h=${(strength / 100 * 8).toFixed(2)}:enable='${enable}'`);
            // Add scanline overlay via geq alpha tag — cheap.
          }
          if (fx.libraryId === 'sepia') {
            // colorchannelmixer for true sepia tone.
            videoFilters.push(`colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0:enable='${enable}'`);
          }
          if (fx.libraryId === 'film-grain') {
            // Add temporal noise — feeds back into a screen blend.
            const noiseStr = Math.round(strength * 0.6); // 0..60
            videoFilters.push(`noise=alls=${noiseStr}:allf=t+u:enable='${enable}'`);
          }
          break;
        }
        case 'glow': {
          // Bloom / lens-flare / vignette. CapCut's glow is approximated by
          // overlaying a brightened blurred copy onto the original via
          // screen-blend; we rely on the eq+vignette filters that already
          // exist for simplicity here.
          if (fx.libraryId === 'vignette') {
            const ang = strength / 100 * Math.PI * 0.45 + Math.PI / 6;
            videoFilters.push(`vignette=angle=${ang.toFixed(3)}:enable='${enable}'`);
          } else if (fx.libraryId === 'lens-flare') {
            // No native lens flare in FFmpeg; skip with a comment so the
            // CSS preview still shows something but export stays clean.
            console.log('[FX] Lens flare CSS-only (no FFmpeg counterpart)');
          } else {
            videoFilters.push(`eq=brightness=${(strength / 200).toFixed(3)}:saturation=${(1 + amount / 200).toFixed(3)}:enable='${enable}'`);
          }
          break;
        }
        case 'distortion': {
          if (fx.libraryId === 'pixelate') {
            // pixelize via downscale + upscale. amount → block size 4..32.
            const block = Math.max(2, Math.round(4 + amount / 100 * 28));
            videoFilters.push(`scale=iw/${block}:ih/${block}:flags=neighbor,scale=iw*${block}:ih*${block}:flags=neighbor:enable='${enable}'`);
          } else if (fx.libraryId === 'rgb-shift' || fx.libraryId === 'pixel-tear') {
            // Hue rotation flicker — same idea as the CSS preview.
            const hueAmp = (amount / 100 * 30).toFixed(2);
            const periodS = Math.max(0.05, 1 - speed / 120).toFixed(3);
            videoFilters.push(`hue=h='${hueAmp}*sin(2*PI*t/${periodS})':enable='${enable}'`);
          } else {
            // Wave — crop+pad pseudo-shake using xfade replacement.
            const offsetPx = amount / 100 * 6;
            videoFilters.push(`pad=iw+${Math.round(offsetPx * 2)}:ih+${Math.round(offsetPx * 2)}:${Math.round(offsetPx)}:${Math.round(offsetPx)}:color=black@0,crop=iw-${Math.round(offsetPx * 2)}:ih-${Math.round(offsetPx * 2)}:enable='${enable}'`);
          }
          break;
        }
        case 'motion': {
          // Shake / pulse — for shake we can rotate/translate slightly via
          // geq isn't great; use pad+crop with a sin() offset for translate.
          const offsetPx = Math.round(amount / 100 * 16);
          const periodS = Math.max(0.1, 1 - speed / 120).toFixed(3);
          if (fx.libraryId === 'beat-pulse' || fx.libraryId === 'beat-zoom') {
            // Already handled by zoom case; here we just scale.
            const peakS = 1 + amount / 100 * 0.18;
            const expr = `(${peakS.toFixed(3)}-1)*abs(sin(2*PI*t/${periodS}))+1`;
            videoFilters.push(`scale=w='iw*(${expr})':h='ih*(${expr})':eval=frame:enable='${enable}'`);
            videoFilters.push(`crop=iw/(${expr}):ih/(${expr}):(iw-iw/(${expr}))/2:(ih-ih/(${expr}))/2:enable='${enable}'`);
          } else {
            // Translate via crop expression — cheap shake effect.
            videoFilters.push(`crop=iw:ih:'${offsetPx}*sin(2*PI*t/${periodS})':'${offsetPx}*cos(2*PI*t/${periodS})':enable='${enable}'`);
          }
          break;
        }
        case 'particle': {
          // Reuse the existing particle pipeline (sparkle/snow/dust/lightleak).
          // We force-merge into adjust.particles so the existing geq+blend
          // logic in this file handles rendering. NOTE: only one particle
          // overlay can be active at a time without a refactor — picking
          // the strongest amount wins.
          if (!filters.adjust) filters.adjust = {};
          if ((amount > (filters.adjust.particles || 0))) {
            filters.adjust.particles = amount;
            filters.adjust.particlesType =
              fx.libraryId === 'hearts' ? 'sparkle'
              : fx.libraryId === 'confetti' ? 'sparkle'
              : 'sparkle';
          }
          break;
        }
        case 'scanlines': {
          // Repeating scanline overlay via geq — generates a 1px-on-Npx-off
          // black ramp whose alpha grows with amount, then blends multiply.
          const lineH = Math.max(2, 8 - Math.round(strength / 16));
          const a = Math.round(amount / 100 * 140);
          videoFilters.push(`geq=lum='lum(X,Y)*(if(mod(Y,${lineH}),1,${(1 - a / 255).toFixed(3)}))':enable='${enable}'`);
          if (fx.libraryId === 'crt-screen') {
            // Add a soft vignette to mimic CRT bulge.
            videoFilters.push(`vignette=PI/4:enable='${enable}'`);
          }
          break;
        }
        case 'threed': {
          // True 3D rotate isn't available in pure FFmpeg without GL filter;
          // approximate with rotate filter (2D rotation only). Note: the
          // CSS preview uses perspective() so will look more 3D than export.
          const rad = `${(amount / 100 * 0.4).toFixed(3)}*sin(2*PI*t/${Math.max(0.5, 6 - speed / 20).toFixed(2)})`;
          videoFilters.push(`rotate=${rad}:fillcolor=black@0:enable='${enable}'`);
          break;
        }
      }
      // Mask handling — when a non-`none` shape is set, we wrap the
      // effect's output in `geq` alpha + `alphamerge` so only the masked
      // region keeps the effect; outside the mask the original passes
      // through. Simple shapes only — brush/pen fall through.
      if (fx.mask && fx.mask.shape !== 'none') {
        // For now we log the mask presence and rely on the renderer's
        // CSS mask for preview. A correct FFmpeg path requires splitting
        // the input, processing one branch with the effect, masking the
        // result with `geq` alpha, and overlaying onto the unprocessed
        // branch — substantial filter graph rewrite.
        console.log(`[FX] Mask ${fx.mask.shape} declared on ${fx.libraryId} — preview-only at export`);
      }
    }
    console.log(`[FX] Applied ${effects.length} effect filter${effects.length === 1 ? '' : 's'}`);
  }

  // ─── Sticker overlays ────────────────────────────────────────
  // Three render paths:
  //   • emoji   → drawtext with the unicode glyph + alpha=if() expression
  //               for IN/OUT fade animation. System font must support color
  //               emoji (Apple Color Emoji / Segoe UI Emoji on macOS/Win).
  //   • image / gif → registered as a separate -i input. We collect these
  //               into `imageStickers[]` here; the actual filter_complex
  //               graph is built later (inside the filter_complex section)
  //               where we own the input index numbering.
  //   • lottie  → not supported at export yet; logged as a warning so the
  //               export doesn't fail on mixed projects.
  //
  // Animation in/out: we translate the preset id into a fade keyframe.
  //   - IN:  alpha ramps 0→1 over `inDuration` starting at stickerStart
  //   - OUT: alpha ramps 1→0 over `outDuration` ending at stickerEnd
  //   - LOOP presets are not applied (they'd need per-frame matrix work).
  //
  // The full IN/OUT preset set in the renderer (slide, pop, spin, flip…)
  // collapses to `fade` at export. This trades animation fidelity for a
  // filter graph that fits in a single FFmpeg pass.
  const imageStickers = []; // collected for filter_complex pass below
  const stickerOverlays = filters?.stickerOverlays;
  if (Array.isArray(stickerOverlays) && stickerOverlays.length > 0) {
    // Pre-rasterize any template stickers ONCE per export. We mutate the
    // sticker entry in place: replace `format='template'` + `templateSvg`
    // with the actual file path of the rasterized asset.
    //
    // Two-tier strategy:
    //   1. PRIMARY — animated WebM (preserves the SVG @keyframes motion).
    //      Treated like a GIF in the overlay pipeline below: looping via
    //      `-stream_loop -1` so the animation runs throughout the
    //      sticker's visible window on the timeline.
    //   2. FALLBACK — static PNG snapshot of the resting frame. Used
    //      when WebM encoding fails (libvpx-vp9 missing in this build,
    //      capture failed, etc). The sticker still appears in the
    //      export but doesn't animate. Better than missing entirely.
    for (const s of stickerOverlays) {
      if (s.format === 'template' && s.templateSvg) {
        // Render at the SVG's intrinsic size (or a sane default) so
        // anti-aliasing is crisp. Overlay filter scales further based on
        // `s.scale` at composition time.
        const renderW = Math.max(64, Math.round(s.width || 256));
        const renderH = Math.max(64, Math.round(s.height || 256));

        let baked = null;
        // Try animated PNG sequence first — keeps the motion at export
        // with reliable per-pixel alpha (no encoder quirks).
        try {
          // 3s × 20fps = 60 frames. Covers all template loop periods
          // (typically 1.2-3.0s) so the loop seam happens at most once.
          baked = await rasterizeAnimatedTemplate(s.templateSvg, renderW, renderH, 3.0, 20);
          if (baked && baked.kind === 'png-sequence' && baked.pattern) {
            s.format = 'png-sequence';
            s.filePath = baked.pattern;     // glob-style pattern path
            s.fps = baked.fps;
            s.frameCount = baked.frameCount;
            s.durationSec = baked.durationSec;
            s.width = renderW;
            s.height = renderH;
            continue; // success — skip PNG fallback
          }
        } catch (err) {
          console.warn('[STICKER] animated template render failed, trying PNG fallback:', err && err.message);
        }
        // Fallback: static PNG snapshot.
        try {
          const pngPath = await rasterizeStickerTemplateToPng(s.templateSvg, renderW, renderH);
          if (pngPath) {
            s.format = 'image';
            s.filePath = pngPath;
            s.width = renderW;
            s.height = renderH;
          } else {
            console.warn('[STICKER] template rasterize returned null — skipping');
            s.format = 'lottie'; // sentinel so we ignore in the loop below
          }
        } catch (err) {
          console.error('[STICKER] template rasterize threw:', err);
          s.format = 'lottie';
        }
      }
    }
    for (const s of stickerOverlays) {
      const stickerStart = Number.isFinite(s.startTime) ? Math.max(0, s.startTime) : 0;
      const stickerEnd = Number.isFinite(s.endTime) ? Math.max(stickerStart + 0.05, s.endTime) : stickerStart + 3;
      const enable = `between(t,${stickerStart.toFixed(3)},${stickerEnd.toFixed(3)})`;
      const px = Math.round(s.posX || 0);
      const py = Math.round(s.posY || 0);
      const opacity = clamp(s.opacity, 0, 1, 1);

      // Resolve fade in/out durations. Any IN preset → fade-in; any OUT
      // preset → fade-out. If user picked 'none' we skip the fade.
      const animIn = s.animation?.inPreset && s.animation.inPreset !== 'none' ? s.animation : null;
      const animOut = s.animation?.outPreset ? s.animation : null;
      const inDur = animIn ? Math.max(0.05, Math.min((stickerEnd - stickerStart) / 2, animIn.inDuration || 0.4)) : 0;
      const outDur = animOut ? Math.max(0.05, Math.min((stickerEnd - stickerStart) / 2, animOut.outDuration || 0.36)) : 0;

      // Build an alpha expression that fades in then out within the visible
      // range. `t` is the timeline time inside this clip's segment.
      // Outside the visible range the `enable=` gate hides it; we only need
      // to handle the in-range alpha.
      //   alpha(t) =
      //     if(t < start+inDur) → (t-start)/inDur          (fade-in ramp)
      //     elif(t >= end-outDur) → (end-t)/outDur          (fade-out ramp)
      //     else → 1
      //   Final = max(0, min(1, alpha)) * baseOpacity
      let alphaExpr = String(opacity.toFixed(3));
      if (inDur > 0 || outDur > 0) {
        const inExpr = inDur > 0
          ? `if(lt(t,${(stickerStart + inDur).toFixed(3)}),(t-${stickerStart.toFixed(3)})/${inDur.toFixed(3)},1)`
          : '1';
        const outExpr = outDur > 0
          ? `if(gt(t,${(stickerEnd - outDur).toFixed(3)}),(${stickerEnd.toFixed(3)}-t)/${outDur.toFixed(3)},1)`
          : '1';
        // Multiply both ramps and clamp to [0,1] then scale by base opacity.
        alphaExpr = `${opacity.toFixed(3)}*max(0,min(1,${inExpr}))*max(0,min(1,${outExpr}))`;
      }

      if (s.format === 'emoji' && s.emoji) {
        const baseSize = Math.round(96 * (s.scale || 1));
        const escapedEmoji = String(s.emoji).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
        const x = `(w-text_w)/2+${px}`;
        const y = `(h-text_h)/2+${py}`;
        // drawtext supports `alpha=` expression directly — perfect for our
        // animated ramp. The `enable=` gate hides the glyph entirely
        // outside the sticker's range so the alpha curve only matters
        // inside [stickerStart, stickerEnd].
        const drawtextParts = [
          `drawtext=text='${escapedEmoji}'`,
          `fontsize=${baseSize}`,
          'fontcolor=white',
          `alpha='${alphaExpr}'`,
          `x=${x}`,
          `y=${y}`,
          `enable='${enable}'`,
        ];
        videoFilters.push(drawtextParts.join(':'));
      } else if (s.format === 'png-sequence' && s.filePath) {
        // PNG sequence (animated template baked output). The path is a
        // glob pattern like `.../frame_%04d.png`. Verify at least the
        // first frame exists so we don't ship a phantom input that
        // makes FFmpeg fail with "No such file or directory".
        const firstFrame = String(s.filePath).replace('%04d', '0000');
        if (!fs.existsSync(firstFrame)) {
          console.warn(`[STICKER] png-sequence first frame missing, skipping: ${firstFrame}`);
          continue;
        }
        imageStickers.push({
          path: s.filePath,            // pattern path consumed via image2 demuxer
          format: 'png-sequence',
          fps: s.fps || 20,            // -framerate hint at input
          frameCount: s.frameCount,
          scale: s.scale || 1,
          rotation: s.rotation || 0,
          posX: px, posY: py,
          enable, alphaExpr,
          stickerStart, stickerEnd,
          width: s.width, height: s.height,
        });
      } else if ((s.format === 'image' || s.format === 'gif') && (s.filePath || s.src)) {
        // Resolve the asset path. Accept file:// URLs and absolute paths.
        const raw = s.filePath || s.src;
        let resolvedPath = raw;
        try {
          if (typeof raw === 'string' && raw.startsWith('file://')) {
            const { fileURLToPath: furl3 } = require('url');
            resolvedPath = furl3(raw);
          }
        } catch { /* keep raw as-is */ }
        if (!fs.existsSync(resolvedPath)) {
          console.warn(`[STICKER] file not found, skipping: ${resolvedPath}`);
          continue;
        }
        // Push to imageStickers — the input index, scale, position,
        // rotation, and alpha expression are consumed below where the
        // filter_complex graph is built.
        imageStickers.push({
          path: resolvedPath,
          format: s.format,
          scale: s.scale || 1,
          rotation: s.rotation || 0,
          posX: px, posY: py,
          enable, alphaExpr,
          stickerStart, stickerEnd,
          width: s.width, height: s.height,
        });
      } else if (s.format === 'lottie') {
        console.warn('[STICKER] Lottie export not supported — skipping');
      }
      // Tracking is preview-only for now; ignored at export.
      void s.tracking;
    }
    if (stickerOverlays.length > 0) {
      const pngSeqCount = imageStickers.filter(x => x.format === 'png-sequence').length;
      const imgCount = imageStickers.length - pngSeqCount;
      const otherCount = stickerOverlays.length - imageStickers.length;
      console.log(`[STICKER] Queued ${stickerOverlays.length} sticker overlays (${pngSeqCount} animated, ${imgCount} static image, ${otherCount} emoji/other)`);
    }
  }

  // scale (resolution preset OR explicit width/height)
  // Accepts: '4k' | '2k' | '1080p' | '720p' | '480p' | 'original'
  // Also accepts custom { width, height } via the `width`/`height` params.
  const scaleMap = {
    '4k':    '-2:2160',
    '2k':    '-2:1440',
    '1080p': '-2:1080',
    '720p':  '-2:720',
    '480p':  '-2:480',
  };
  if (!hasCanvasLayout && typeof width === 'number' && typeof height === 'number') {
    videoFilters.push(`scale=${width}:${height}:flags=lanczos`);
  } else if (!hasCanvasLayout && scale && scale !== 'original') {
    const s = scaleMap[scale];
    if (s) videoFilters.push(`scale=${s}:flags=lanczos`);
  }

  // subtitle burn (SRT)
  if (subtitlePath) {
    const { fileURLToPath: furl } = require('url');
    const subResolved = subtitlePath.startsWith('file://') ? furl(subtitlePath) : subtitlePath;
    if (fs.existsSync(subResolved)) {
      // Escape path for FFmpeg filter
      const escapedSub = subResolved.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
      videoFilters.push(`subtitles='${escapedSub}'`);
    }
  }

  // delogo regions (watermark removal)
  if (delogoRegions && Array.isArray(delogoRegions)) {
    for (const r of delogoRegions) {
      if (r.x != null && r.y != null && r.w && r.h) {
        videoFilters.push(`delogo=x=${Math.round(r.x)}:y=${Math.round(r.y)}:w=${Math.round(r.w)}:h=${Math.round(r.h)}`);
      }
    }
  }

  // Fade in/out
  if (fadeIn > 0) {
    videoFilters.push(`fade=t=in:st=0:d=${fadeIn}`);
  }
  if (fadeOut > 0) {
    const trimDur = (endTime || 0) - (startTime || 0);
    if (trimDur > fadeOut) {
      videoFilters.push(`fade=t=out:st=${trimDur - fadeOut}:d=${fadeOut}`);
    }
  }

  // ── Outgoing transition (no-op here) ──
  // We INTENTIONALLY don't bake transitions in the per-clip pipeline.
  // The renderer routes multi-clip exports with transitions through the
  // dedicated `concat-videos-with-transitions` handler, which builds a
  // multi-input filter_complex with FFmpeg's `xfade` filter — that's
  // the only way to get a TRUE cross-fade where both clips overlap.
  // Leaving the per-clip output unchanged means the xfade pipeline
  // sees clean frames at the boundary, which is what xfade needs.
  void filters?.transitionOut;

  // ── Speed Curve (variable rate) — piecewise setpts ──
  // The renderer's speed-curve math (src/components/capcut/speedCurveUtils.ts)
  // models speed as linear-piecewise between inner-handle keyframes (no
  // t=0/t=1 endpoints; constant extrapolation outside the leftmost/rightmost
  // handle). We mirror that math here as a single `setpts` expression so
  // FFmpeg re-times each input frame to its correct output position.
  //
  // For a segment with linear speed s(x) = a + (b-a)*x/segDur, the integral
  // of 1/s from 0 to x is:
  //   I(x) = segDur/(b-a) * ln((a + (b-a)*x/segDur) / a)
  // Constant-speed segments (a≈b) degenerate to x/a.
  //
  // Variable-rate audio is harder — atempo doesn't accept time-varying
  // expressions and `aselect`-based segment concat is brittle when there
  // are many segments. For now we use the AVERAGE speed for audio (so
  // total duration matches video, but audio plays at constant rate inside
  // the clip). User can spot the desync only on speech-heavy material; for
  // SFX/music it's imperceptible.
  let videoSpeedRate = 0;       // 0 = no constant speed change (used by audio)
  const speedCfg = filters?.speed;
  const curveCfg = filters?.speedCurve;
  if (curveCfg && Array.isArray(curveCfg.keyframes) && curveCfg.keyframes.length >= 2 && curveCfg.sourceLength > 0) {
    const kfs = curveCfg.keyframes
      .filter((k) => typeof k.t === 'number' && typeof k.s === 'number')
      .map((k) => ({ t: Math.max(0, Math.min(1, k.t)), s: Math.max(0.0625, Math.min(16, k.s)) }))
      .sort((a, b) => a.t - b.t);
    const L = curveCfg.sourceLength;
    const branches = []; // { maxT: source-time upper bound, expr: clip-time expression }
    let accum = 0;       // accumulated effective (clip) time at the start of the next branch

    // Pre-extrapolation segment (constant s0 for source t ∈ [0, kfs[0].t × L]).
    if (kfs[0].t > 0) {
      const upper = (kfs[0].t * L);
      branches.push({ maxT: upper, expr: `T/${kfs[0].s.toFixed(6)}` });
      accum += upper / kfs[0].s;
    }

    // Inner segments.
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      const segSourceDur = (b.t - a.t) * L;
      if (segSourceDur <= 0) continue;
      const aSrc = a.t * L;
      const bSrc = b.t * L;
      let expr;
      let segEff;
      if (Math.abs(a.s - b.s) < 0.001) {
        // Constant speed within segment.
        expr = `${accum.toFixed(6)} + (T-${aSrc.toFixed(6)})/${a.s.toFixed(6)}`;
        segEff = segSourceDur / a.s;
      } else {
        // Linear interpolation. ratio = s(x)/a.s = 1 + (b-a)/(a*segDur) * (T - aSrc).
        const slope = (b.s - a.s) / segSourceDur;       // ds/dt in source time
        const k = segSourceDur / (b.s - a.s);            // ∫ scale factor
        // FFmpeg's expression eval has `log()` = natural log. Verified.
        expr = `${accum.toFixed(6)} + ${k.toFixed(6)}*log((${a.s.toFixed(6)} + ${slope.toFixed(8)}*(T-${aSrc.toFixed(6)}))/${a.s.toFixed(6)})`;
        segEff = segSourceDur * Math.log(b.s / a.s) / (b.s - a.s);
      }
      branches.push({ maxT: bSrc, expr });
      accum += segEff;
    }

    // Post-extrapolation (constant sN for source t ∈ [last.t × L, L]).
    const last = kfs[kfs.length - 1];
    if (last.t < 1) {
      const lastSrc = last.t * L;
      branches.push({
        maxT: L,
        expr: `${accum.toFixed(6)} + (T-${lastSrc.toFixed(6)})/${last.s.toFixed(6)}`,
      });
      accum += (L - lastSrc) / last.s;
    }

    // Build the nested if(lt(T, …)) expression. Last branch is the fallback.
    let exprFinal = branches[branches.length - 1].expr;
    for (let i = branches.length - 2; i >= 0; i--) {
      exprFinal = `if(lt(T,${branches[i].maxT.toFixed(6)}),${branches[i].expr},${exprFinal})`;
    }
    videoFilters.push(`setpts='${exprFinal}/TB'`);

    // Use average speed for audio (approximation, see comment above).
    const totalEff = Math.max(0.05, accum);
    videoSpeedRate = L / totalEff;
    console.log(`[SPEED] Curve mode: ${kfs.length} keyframes, ${L.toFixed(2)}s source → ${totalEff.toFixed(2)}s effective (avg ${videoSpeedRate.toFixed(3)}×)`);
  } else if (speedCfg && speedCfg.rate && Math.abs(speedCfg.rate - 1) > 0.001) {
    // Constant-rate (Speed Standard). Single setpts is enough.
    const rate = Math.max(0.0625, Math.min(16, Number(speedCfg.rate)));
    videoFilters.push(`setpts=PTS/${rate.toFixed(6)}`);
    videoSpeedRate = rate;
    console.log(`[SPEED] Standard mode: constant ${rate}×`);
  }

  // ── Velocity Effects — visual overlay applied to the whole clip ──
  // The speed pacing of each velocity preset is already baked into the
  // speedCurve keyframes above. Here we just stack the matching color /
  // blur / zoom filter chain. We deliberately apply continuously rather
  // than gating with `enable=` time ranges — the pacing IS the gate (when
  // the curve is at slow-mo, the visual lingers; when fast, it whips by).
  const velocity = filters?.velocityEffect;
  if (velocity && velocity !== 'none') {
    switch (velocity) {
      case 'flash':
        // Subtle bright pulse via eq + small contrast pop. Continuous
        // brightness boost suggests the "flash" character even without
        // time-varying enable expressions.
        videoFilters.push('eq=brightness=0.06:contrast=1.08:saturation=1.05');
        break;
      case 'blurshake':
        // Small uniform blur. We skip the per-frame translate (would need
        // a time-varying crop expression that's noisy on still scenes);
        // the slow-mo pacing already conveys the "shake-y" feel.
        videoFilters.push('boxblur=2:1');
        break;
      case 'fadeblur':
        // Soft, dreamy box blur. Thicker than blurshake for a deeper
        // depth-of-field feel.
        videoFilters.push('boxblur=4:2');
        break;
      case 'retrozoom':
        // Slight zoom-in (3%) + sepia wash via colorchannelmixer. The
        // crop+scale pair preserves output dimensions.
        videoFilters.push('crop=in_w*0.94:in_h*0.94:in_w*0.03:in_h*0.03,scale=in_w/0.94:in_h/0.94:flags=lanczos');
        videoFilters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
        break;
      case 'rainbow':
        // Time-varying hue rotation — `hue=H='2*PI*t/2.5':s=1.6` gives
        // one full rotation per 2.5s, matching the player's CSS keyframes.
        videoFilters.push("hue=H='2*PI*t/2.5':s=1.6");
        break;
    }
    console.log(`[VELOCITY] Applied "${velocity}" visual filter chain`);
  }

  // Audio filters chain. Order matters:
  //   1. Reduce noise (afftdn) — denoise BEFORE other processing so the
  //      compressor in Enhance voice doesn't pump up residual noise.
  //   2. Enhance voice (highpass + compander + presence EQ) — clean up next
  //   3. Loudnorm (EBU R128) — normalize after cleanup
  //   4. Fade in/out — bookend the result
  const audioFilters = [];
  const { audio = null } = filters || {};
  if (audio?.reduceAudioNoise) {
    // afftdn = FFT-based noise reduction. nr=12 dB is moderate, good for
    // steady background noise (AC, fan, traffic). Higher values risk
    // artifacts on speech consonants. nf=-25 dB sets the noise floor — we
    // assume noise is at least 25 dB below speech (typical room recording).
    audioFilters.push('afftdn=nr=12:nf=-25');
  }
  // Fill channel — duplicate one stereo channel into the other. Saves
  // recordings that landed only on L or R.
  //   'left'  → "Fill left with right" (output mono-from-R)
  //   'right' → "Fill right with left" (output mono-from-L)
  if (audio?.fillChannel === 'left') {
    audioFilters.push('pan=stereo|c0=c1|c1=c1');
  } else if (audio?.fillChannel === 'right') {
    audioFilters.push('pan=stereo|c0=c0|c1=c0');
  }
  // Isolate voice — center-channel cancellation via FFmpeg `pan` filter.
  // Works on stereo music with center-mixed vocals (most pop / commercial
  // tracks). Mono input or live recordings won't benefit much. For studio-
  // grade vocal stem separation we'd need an AI model (Spleeter / Demucs);
  // noted in the audio-enhance roadmap memory as a future upgrade.
  if (audio?.isolateVoice?.enabled) {
    if (audio.isolateVoice.keep === 'instrumental') {
      // Remove vocal — phase-cancel the L+R common signal (vocals).
      // Keeps stereo width of music, drops the mono-mixed voice.
      audioFilters.push('pan=stereo|c0=c0-c1|c1=c1-c0');
    } else {
      // Keep vocal — extract center channel (L+R)/2 then bandpass to the
      // human speech range (300 Hz .. 3.4 kHz) to suppress residual music.
      audioFilters.push('pan=mono|c0=0.5*c0+0.5*c1');
      audioFilters.push('highpass=f=300');
      audioFilters.push('lowpass=f=3400');
    }
  }
  if (audio?.enhanceVoice?.enabled) {
    // Voice enhancement chain. Intensity 0-100 maps to filter strengths.
    //   • highpass=80Hz removes hum/rumble below speech range
    //   • compand applies dynamic range compression (squashes loud peaks,
    //     lifts quiet parts) — strength scales with intensity
    //   • equalizer presence boost at 3kHz adds clarity, scaled by intensity
    const inten = Math.max(0, Math.min(100, Number(audio.enhanceVoice.intensity) || 75)) / 100;
    audioFilters.push('highpass=f=80');
    // compand attack/release fixed; the points define a compression curve.
    // Stronger intensity → tighter compression ratio.
    const ratio = (1 + 2 * inten).toFixed(2);  // 1.0..3.0
    audioFilters.push(`compand=attacks=0.01:decays=0.1:points=-90/-90|-30/-15|-15/-${(15 / Number(ratio)).toFixed(1)}|0/0`);
    // Presence EQ around 3 kHz for vocal clarity.
    const presenceGain = (inten * 4).toFixed(2);  // 0..4 dB
    audioFilters.push(`equalizer=f=3000:t=q:w=1.5:g=${presenceGain}`);
  }
  // Voice changer — pitch shift + tonal EQ + optional reverb. Applied after
  // enhance/clean so the pitch shift happens on a clean signal.
  //   • Pitch shift via asetrate (resample to a new rate, baking in pitch)
  //     followed by atempo (correct playback speed back to 1×). FFmpeg
  //     atempo only accepts 0.5..2.0 per pass, so we chain when needed.
  //   • brightness → equalizer high-shelf at 4 kHz
  //   • warmth → equalizer low-shelf at 200 Hz
  //   • reverb → aecho with multiple decaying taps (cheap synthetic verb)
  if (audio?.voice && (
    (audio.voice.pitch || 0) !== 0 ||
    (audio.voice.brightness || 0) !== 0 ||
    (audio.voice.warmth || 0) !== 0 ||
    (audio.voice.reverb || 0) > 0
  )) {
    const semitones = Math.max(-12, Math.min(12, Number(audio.voice.pitch) || 0));
    if (semitones !== 0) {
      // Each semitone = 2^(1/12) frequency ratio.
      const ratio = Math.pow(2, semitones / 12);
      const baseRate = 44100;
      audioFilters.push(`asetrate=${Math.round(baseRate * ratio)}`);
      audioFilters.push(`aresample=${baseRate}`);
      // Compensate playback speed back to 1× via atempo. atempo accepts
      // only 0.5..2.0 in one pass — chain multiple passes when out of range.
      let comp = 1 / ratio;
      while (comp > 2.0) {
        audioFilters.push('atempo=2.0');
        comp /= 2.0;
      }
      while (comp < 0.5) {
        audioFilters.push('atempo=0.5');
        comp /= 0.5;
      }
      // Final partial step (always 0.5..2.0 here).
      audioFilters.push(`atempo=${comp.toFixed(4)}`);
    }
    const brightness = Math.max(-12, Math.min(12, Number(audio.voice.brightness) || 0));
    if (brightness !== 0) {
      // FFmpeg has no high-shelf primitive; use `bass`/`treble` instead.
      // `treble` defaults to a shelving filter at 3 kHz — close enough to
      // our 4 kHz target. Frequency override via f=4000.
      audioFilters.push(`treble=g=${brightness.toFixed(2)}:f=4000`);
    }
    const warmth = Math.max(-12, Math.min(12, Number(audio.voice.warmth) || 0));
    if (warmth !== 0) {
      // `bass` is FFmpeg's low-shelf shelving filter. Default freq 100 Hz;
      // override to 200 to match the live preview.
      audioFilters.push(`bass=g=${warmth.toFixed(2)}:f=200`);
    }
    const wet = Math.max(0, Math.min(1, Number(audio.voice.reverb) || 0));
    if (wet > 0) {
      // Two reverb paths:
      //   1. CONVOLUTION (preferred) — when the renderer downloaded a real
      //      IR (impulse response) WAV via the voice asset cache, FFmpeg
      //      uses `afir` to convolve it onto the audio. This produces a
      //      true sample-accurate reverb of the actual real-world space
      //      (e.g. York Minster Cathedral). Engaged only if `audio.voice
      //      .irPath` is provided AND the file exists on disk.
      //   2. SYNTHETIC (fallback) — `aecho` taps. Cheap and ships with no
      //      assets but sounds noticeably less natural.
      const irPath = typeof audio.voice.irPath === 'string' ? audio.voice.irPath : null;
      const useConvolution = irPath && fs.existsSync(irPath);

      if (useConvolution) {
        // afir wet/dry mixing: dry= 1-wet, wet= wet*scaledMax. We multiply
        // wet by 1.5 so the perceived blend matches the synthetic path.
        const dry = (1 - wet * 0.7).toFixed(2);
        const wetN = (wet * 1.2).toFixed(2);
        // afir takes the IR as a second input; we splice it via filter_complex
        // semantics. Here we use the simpler `afir` filter syntax which
        // reads IR from a file path via `irfile=` option (ffmpeg ≥ 5.0).
        // Escape colons for the filter graph (filename may have ':' on Windows).
        const escIr = irPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        audioFilters.push(`afir=dry=${dry}:wet=${wetN}:length=1:gtype=peak:ir_format=mono:irfile='${escIr}'`);
        console.log(`[VOICE] Reverb via convolution (IR: ${path.basename(irPath)})`);
      } else {
        // Synthetic fallback. Wet level scales the decay magnitude. 4 taps
        // approximate a small/medium room; longer delays for "cathedral".
        const decay = (0.3 + wet * 0.4).toFixed(2);  // 0.3..0.7 reflection level
        const delays = wet > 0.5 ? '60|120|240|480' : '40|80|160|320';
        const decays = wet > 0.5
          ? `${decay}|${(decay * 0.7).toFixed(2)}|${(decay * 0.5).toFixed(2)}|${(decay * 0.35).toFixed(2)}`
          : `${decay}|${(decay * 0.6).toFixed(2)}|${(decay * 0.35).toFixed(2)}|${(decay * 0.2).toFixed(2)}`;
        audioFilters.push(`aecho=0.8:${(0.7 + wet * 0.2).toFixed(2)}:${delays}:${decays}`);
        if (irPath) {
          console.log(`[VOICE] Reverb fallback to aecho (IR file missing: ${irPath})`);
        }
      }
    }
  }
  if (audio?.normalizeLoudness) {
    // EBU R128 broadcast standard: -16 LUFS integrated, -1 dB true peak,
    // 11 LU loudness range. CapCut uses similar targets.
    audioFilters.push('loudnorm=I=-16:TP=-1:LRA=11');
  }
  // ── Speed compensation for audio ──
  // The video setpts above either holds clip.speed (Standard) or curveAvg
  // (Curve / Velocity). Apply matching atempo so audio plays at the same
  // total rate. atempo only takes 0.5..2.0 per pass — chain when needed.
  // Skip when changeAudioPitch is true: in that case the renderer wants
  // the chipmunk effect, which means audio plays at the source's NATURAL
  // rate while video runs faster (= visual sped up but audio kept slow,
  // pitched up). For chipmunk we use `asetrate` not atempo so pitch shifts.
  if (videoSpeedRate > 0 && Math.abs(videoSpeedRate - 1) > 0.001) {
    if (speedCfg && speedCfg.changeAudioPitch) {
      // Chipmunk mode: audio frequency scales with video rate.
      const baseRate = 44100;
      audioFilters.push(`asetrate=${Math.round(baseRate * videoSpeedRate)}`);
      audioFilters.push(`aresample=${baseRate}`);
    } else {
      // Time-stretch (preserve pitch) — chained atempo within 0.5..2.0.
      let comp = videoSpeedRate;
      while (comp > 2.0) {
        audioFilters.push('atempo=2.0');
        comp /= 2.0;
      }
      while (comp < 0.5) {
        audioFilters.push('atempo=0.5');
        comp /= 0.5;
      }
      audioFilters.push(`atempo=${comp.toFixed(6)}`);
    }
  }
  if (fadeIn > 0) audioFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0) {
    const trimDur = (endTime || 0) - (startTime || 0);
    if (trimDur > fadeOut) audioFilters.push(`afade=t=out:st=${trimDur - fadeOut}:d=${fadeOut}`);
  }

  const crfVal = crf || 18;
  const duration = (endTime || 0) - (startTime || 0);
  const args = ['-y'];
  if (startTime > 0) args.push('-ss', String(startTime));
  args.push('-i', resolved);

  // Background music as second input
  let hasBgm = false;
  if (bgmPath) {
    const { fileURLToPath: furl2 } = require('url');
    const bgmResolved = bgmPath.startsWith('file://') ? furl2(bgmPath) : bgmPath;
    if (fs.existsSync(bgmResolved)) {
      args.push('-i', bgmResolved);
      hasBgm = true;
    }
  }

  // Image / GIF sticker inputs — each becomes its own -i so we can chain
  // overlay filters in filter_complex below. We track the input index of
  // each sticker so the filter graph can reference [N:v] correctly.
  // Animated GIFs need `-stream_loop -1` so they loop over their visible
  // window; static PNGs are fine without it. We feed `-itsoffset` so the
  // sticker's local time aligns with the main video timeline (otherwise
  // the GIF would always start playing from frame 0 at t=0, which is wrong
  // when the sticker's enable= window starts at e.g. 5s).
  const stickerInputIndices = [];
  if (imageStickers.length > 0) {
    let nextIdx = 1 + (hasBgm ? 1 : 0); // 0 = main video; +1 if BGM
    for (const st of imageStickers) {
      // Animated GIF / WEBP: loop the input over the entire output. PNG
      // doesn't need -stream_loop. Detect by extension.
      const lower = (st.path || '').toLowerCase();
      // Animated sticker handling. Three input modes:
      //   • PNG sequence (`png-sequence`): the canonical animated path
      //     produced by rasterizeAnimatedTemplate. Uses image2 demuxer
      //     with explicit `-framerate` so the sequence plays at the
      //     right speed. Loop with `-stream_loop -1` over the sticker's
      //     visible window.
      //   • GIF / WebP / WebM (`format === 'gif'` or matching extension):
      //     legacy animated formats from user uploads. Loop the same way.
      //   • Static PNG / JPEG: single image, no loop flag needed.
      const isPngSequence = st.format === 'png-sequence';
      const isAnimated = isPngSequence
        || st.format === 'gif'
        || lower.endsWith('.gif')
        || lower.endsWith('.webp')
        || lower.endsWith('.webm');
      if (isAnimated) args.push('-stream_loop', '-1');
      // image2 demuxer needs the framerate hint BEFORE -i for PNG
      // sequences. Without this it defaults to 25fps which mismatches
      // the capture cadence and the animation runs too fast/slow.
      // Also pin start_number=0 to match the capture/chromakey output
      // numbering (which we explicitly wrote starting at 0000).
      if (isPngSequence) {
        args.push('-framerate', String(st.fps || 20));
        args.push('-start_number', '0');
      }
      args.push('-itsoffset', String(st.stickerStart.toFixed(3)), '-i', st.path);
      stickerInputIndices.push(nextIdx);
      nextIdx += 1;
    }
  }

  if (duration > 0) args.push('-t', String(duration));

  const filterComplexParts = [];
  let hasComplexVideo = false;
  let hasComplexAudio = false;

  if (hasCanvasLayout) {
    const canvasW = even(width || layout.canvasWidth);
    const canvasH = even(height || layout.canvasHeight);
    const sourceW = Number(layout.sourceWidth) || 0;
    const sourceH = Number(layout.sourceHeight) || 0;
    const scaleX = clamp(layout.scaleX, 0.01, 10, 1).toFixed(5);
    const scaleY = clamp(layout.scaleY, 0.01, 10, 1).toFixed(5);
    const posX = Math.round(Number(layout.posX) || 0);
    const posY = Math.round(Number(layout.posY) || 0);
    const signed = (n) => n >= 0 ? `+${n}` : `${n}`;
    const opacity = clamp(layout.opacity, 0, 1, 1).toFixed(5);
    const rotDeg = Number(layout.rotate) || 0;
    const animation = layout.animation || {};
    const scaleXAnim = buildAnimatedExpr(animation.scaleX, Number(scaleX) || 1, (v) => clamp(v, 0.01, 10, 1));
    const scaleYAnim = buildAnimatedExpr(animation.scaleY, Number(scaleY) || 1, (v) => clamp(v, 0.01, 10, 1));
    const posXAnim = buildAnimatedExpr(animation.posX, posX);
    const posYAnim = buildAnimatedExpr(animation.posY, posY);
    const rotationAnim = buildAnimatedExpr(animation.rotation, rotDeg);
    const opacityAnim = buildAnimatedExpr(animation.opacity, Number(opacity) || 1, (v) => clamp(v, 0, 1, 1));
    // setsar=1 forces square pixels — source videos with non-square SAR (e.g. 4:3
    // anamorphic, some phone captures) otherwise get stretched by the overlay
    // step into the wrong aspect, which combined with rotate produces the
    // smeared/duplicated frame seen in earlier exports.
    const chain = ['setpts=PTS-STARTPTS', 'setsar=1'];

    if (layout.crop && Number(layout.crop.width) > 0 && Number(layout.crop.height) > 0) {
      const cx = clamp(layout.crop.x, 0, 100, 0) / 100;
      const cy = clamp(layout.crop.y, 0, 100, 0) / 100;
      const cw = clamp(layout.crop.width, 1, 100, 100) / 100;
      const ch = clamp(layout.crop.height, 1, 100, 100) / 100;
      chain.push(`crop=iw*${cw}:ih*${ch}:iw*${cx}:ih*${cy}`);
    }

    if (videoFilters.length > 0) chain.push(...videoFilters);
    if (layout.flipH) chain.push('hflip');
    if (layout.flipV) chain.push('vflip');

    if (sourceW > 0 && sourceH > 0) {
      const cropW = layout.crop?.width ? sourceW * clamp(layout.crop.width, 1, 100, 100) / 100 : sourceW;
      const cropH = layout.crop?.height ? sourceH * clamp(layout.crop.height, 1, 100, 100) / 100 : sourceH;
      const fit = Math.min(canvasW / Math.max(1, cropW), canvasH / Math.max(1, cropH));
      chain.push(`scale=${even(cropW * fit)}:${even(cropH * fit)}:flags=lanczos`);
    } else {
      chain.push(`scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease:flags=lanczos`);
    }

    if (
      scaleXAnim.animated || scaleYAnim.animated ||
      Math.abs(Number(scaleX) - 1) > 0.0001 ||
      Math.abs(Number(scaleY) - 1) > 0.0001
    ) {
      const evalMode = scaleXAnim.animated || scaleYAnim.animated ? ':eval=frame' : '';
      chain.push(`scale=w='trunc(iw*${scaleXAnim.expr}/2)*2':h='trunc(ih*${scaleYAnim.expr}/2)*2'${evalMode}:flags=lanczos`);
    }

    chain.push('format=rgba');
    if (rotationAnim.animated || Math.abs(rotDeg) > 0.001) {
      const rotExpr = `(${rotationAnim.expr})*PI/180`;
      // CRITICAL: ow/oh MUST be even integers, otherwise libx264+yuv420p
      // produces horizontal-stripe corruption (the comb pattern at the bottom
      // of the user's screenshot). `hypot(iw,ih)` evaluates to a non-integer
      // for almost all real frame sizes (e.g. 1920x1080 → 2202.91), and the
      // chroma planes of yuv420p require even dims. Round UP to the next
      // even integer so the rotated frame still fits without clipping.
      chain.push(`rotate='${rotExpr}':c=black@0:ow='2*ceil(hypot(iw,ih)/2)':oh='2*ceil(hypot(iw,ih)/2)',format=rgba`);
    }
    if (opacityAnim.animated) {
      chain.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacityAnim.expr.replace(/\bt\b/g, 'T')})'`);
    } else if (Number(opacity) < 0.99999) {
      chain.push(`colorchannelmixer=aa=${opacity}`);
    }

    const baseDuration = duration > 0 ? duration : Math.max(0.1, (endTime || 0) - (startTime || 0));
    // Canvas backdrop. Default = solid black (matches CapCut's "None" mode).
    // - mode=color : solid hex color
    // - mode=blur  : scale source way up + heavy boxblur to fill the canvas
    //                with a blurred version of the clip itself
    // pattern/brand modes fall back to black for now (UI shows Coming soon).
    const canvasCfg = layout?.canvas || null;
    if (canvasCfg && canvasCfg.mode === 'color') {
      // FFmpeg `color` source accepts hex with `0x` prefix or named colors.
      const hex = String(canvasCfg.color || '#000000').replace(/^#/, '');
      filterComplexParts.push(`color=c=0x${hex}:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}[base]`);
    } else if (canvasCfg && canvasCfg.mode === 'blur') {
      // Heavy boxblur on a 2nd copy of the source, scaled to fill canvas.
      // Maps Blur level → boxblur radius (in pixels at canvas scale).
      const radiusByLevel = { low: 8, medium: 16, high: 28, max: 48 };
      const r = radiusByLevel[canvasCfg.blurLevel] ?? radiusByLevel.medium;
      // Use [0:v] split to get a 2nd reference to the source. Scale to fill
      // canvas (force_original_aspect_ratio=increase + crop center).
      filterComplexParts.push(
        `[0:v]split=2[fgsrc][bgsrc];` +
        `[bgsrc]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},boxblur=${r}:2[base]`
      );
    } else {
      filterComplexParts.push(`color=c=black:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}[base]`);
    }

    // ── Foreground chain assembly + procedural Particles overlay ──
    // The base layer above is built. Now we feed the source through the
    // per-clip `chain` (color grading + crop + scale + rotate, etc.) and
    // optionally blend procedural particles ON TOP before the canvas
    // overlay.
    //
    // Particles synthesis is pure-FFmpeg (no PNG assets):
    //   • sparkle / snow / dust: `noise=alls=…:allf=t` + threshold via eq
    //     — temporal noise produces flickering bright pixels each frame,
    //       which we contrast-stretch into pinpoint sparkles.
    //   • lightleak: `color=warm,geq=alpha=radial-falloff` — a soft warm
    //     gradient tinting one corner.
    // Blend mode:
    //   • screen for sparkle/snow/dust (black → transparent, lights add)
    //   • overlay for lightleak (preserves the warm tone over midtones)
    const adjustCfg = filters?.adjust || {};
    const particleIntensity = Math.max(0, Math.min(100, Number(adjustCfg.particles) || 0));
    const particleType = adjustCfg.particlesType || 'sparkle';
    const wantParticles = particleIntensity > 0 && !!particleType;

    // Source label that the chain reads from. Blur-canvas mode already
    // produced `[fgsrc]` via split; otherwise pull straight from `[0:v]`.
    const fgSourceLabel = (canvasCfg && canvasCfg.mode === 'blur') ? '[fgsrc]' : '[0:v]';
    const fgPreLabel = wantParticles ? '[fgPre]' : '[fg]';
    filterComplexParts.push(`${fgSourceLabel}${chain.join(',')}${fgPreLabel}`);

    if (wantParticles) {
      // Build the particle source filter. Each type uses the same
      // `color=black:size=WxH:duration=baseDuration` synth with a
      // different post-processing chain.
      const I = particleIntensity / 100;
      const baseSrc = `color=c=black:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}`;
      let particleExpr;
      let blendOpacity = I;
      switch (particleType) {
        case 'snow':
          // Soft white dots, more density than sparkle, slight blur for
          // motion-blur halo. allf=t means temporal noise (varies each frame).
          particleExpr = `${baseSrc},noise=alls=110:allf=t,eq=brightness=-${(0.86 - I * 0.06).toFixed(3)}:contrast=14,boxblur=1:1,format=rgba`;
          break;
        case 'dust':
          // Subtle grey noise across the whole frame — dust motes drifting.
          particleExpr = `${baseSrc},noise=alls=70:allf=t,eq=brightness=-${(0.55 - I * 0.1).toFixed(3)}:contrast=5:saturation=0,format=rgba`;
          blendOpacity = I * 0.8;
          break;
        case 'lightleak': {
          // Warm radial gradient at top-right corner — vintage film leak.
          // Bake the alpha into a `geq` expression: alpha = peakAlpha ×
          // exp(−d² / scale). Falls off smoothly from the corner outward.
          const warmSrc = `color=c=0xffb24a:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}`;
          const peakA = Math.round(I * 200);  // 0..200 max alpha
          particleExpr = `${warmSrc},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${peakA}*exp(-((X-W*0.85)*(X-W*0.85)+(Y-H*0.18)*(Y-H*0.18))/(W*W*0.18))'`;
          // Lightleak uses overlay blend (preserves color tone, doesn't
          // wash out highlights the way screen would).
          break;
        }
        case 'sparkle':
        default:
          // Bright pinpoint flicker — high-contrast threshold of temporal noise.
          particleExpr = `${baseSrc},noise=alls=130:allf=t,eq=brightness=-${(0.88 - I * 0.06).toFixed(3)}:contrast=18,format=rgba`;
          break;
      }
      const blendMode = particleType === 'lightleak' ? 'overlay' : 'screen';
      filterComplexParts.push(`${particleExpr}[particles]`);
      filterComplexParts.push(`[fgPre][particles]blend=all_mode=${blendMode}:all_opacity=${blendOpacity.toFixed(3)},format=rgba[fg]`);
      console.log(`[ADJUST] Particles: type=${particleType} intensity=${particleIntensity} blend=${blendMode}`);
    }

    const overlayX = posXAnim.animated ? `(W-w)/2+${posXAnim.expr}` : `(W-w)/2${signed(posX)}`;
    const overlayY = posYAnim.animated ? `(H-h)/2+${posYAnim.expr}` : `(H-h)/2${signed(posY)}`;
    const composedLabel = textOverlayFilters.length > 0 ? '[vtextbase]' : '[vout]';
    filterComplexParts.push(`[base][fg]overlay=x='${overlayX}':y='${overlayY}':format=auto:shortest=1${composedLabel}`);
    if (textOverlayFilters.length > 0) {
      filterComplexParts.push(`[vtextbase]${textOverlayFilters.join(',')}[vout]`);
    }
    hasComplexVideo = true;
  } else if (videoFilters.length > 0) {
    args.push('-vf', videoFilters.join(','));
  }

  // ─── Image / GIF sticker overlay chain ─────────────────────────
  // Image stickers were registered as additional `-i` inputs above. We now
  // chain `overlay` filters after the existing video output (or directly
  // from `[0:v]` if no other video filtering is happening). Each sticker:
  //   1. preprocess: format=yuva420p (preserve alpha) → scale → rotate
  //      → fade in / fade out → setpts=PTS-STARTPTS (so itsoffset works)
  //   2. overlay onto the running [vN] label, gated by enable=
  //
  // When we have NO existing video filter graph, we have to seed it from
  // [0:v]. When there's already a -vf chain we can't combine — we need to
  // promote the -vf chain to filter_complex first. Simplest correct path:
  // detect and rebuild as filter_complex.
  if (imageStickers.length > 0) {
    // Promote single -vf into filter_complex so we own the full graph.
    if (!hasComplexVideo) {
      // Strip -vf if present and convert into a [0:v] → ... → [vout] chain.
      const vfIndex = args.findIndex((a, i) => a === '-vf' && i + 1 < args.length);
      if (vfIndex >= 0) {
        const chain = args[vfIndex + 1];
        args.splice(vfIndex, 2);
        filterComplexParts.push(`[0:v]${chain}[vout]`);
      } else {
        // No prior video filtering — declare an identity chain as [vout].
        filterComplexParts.push(`[0:v]copy[vout]`);
      }
      hasComplexVideo = true;
    }

    // Walk through stickers; chain each onto the running label.
    let runningLabel = '[vout]';
    imageStickers.forEach((st, idx) => {
      const inputIdx = stickerInputIndices[idx];
      if (inputIdx === undefined) return;
      // Sticker preprocessing chain. We DON'T resize when the user kept
      // 100% scale to preserve crispness; for any other scale we use an
      // expression that scales relative to the asset's intrinsic size.
      const preChain = ['format=yuva420p'];
      // Scale: -1:-1 keeps original; otherwise scale uniformly.
      if (Math.abs(st.scale - 1) > 0.001) {
        preChain.push(`scale=iw*${st.scale.toFixed(3)}:ih*${st.scale.toFixed(3)}:flags=lanczos`);
      }
      // Rotation: only when non-zero. Use `rotate` filter with bilinear
      // interpolation. The output canvas gets enlarged to fit the rotated
      // bounds (`oh=ow=hypot(iw,ih)`). bgcolor=0x00000000 keeps alpha.
      if (Math.abs(st.rotation) > 0.5) {
        const rad = (st.rotation * Math.PI / 180).toFixed(6);
        preChain.push(`rotate=${rad}:ow=hypot(iw\\,ih):oh=ow:c=0x00000000`);
      }
      // Apply IN/OUT fade by multiplying alpha via geq. Cheaper alternative:
      // use the `fade` filter with `alpha=1`. fade timeline is relative to
      // the input stream — since we used -itsoffset, t=0 inside the sticker
      // input corresponds to stickerStart on the timeline, so we apply
      // fade with `st=0` for IN and `st=duration-outDur` for OUT.
      // Reconstruct durations from the alphaExpr context (we kept them):
      const visibleDur = Math.max(0.05, st.stickerEnd - st.stickerStart);
      // Decode IN/OUT fade durations from alphaExpr presence — we pass
      // them via the saved expression structure. To keep it simple, parse
      // back from sticker data we still have access to: read st.alphaExpr
      // for hints, OR just check whether the expression contains 'lt(t,'
      // and 'gt(t,'. If yes, derive from sticker spec we computed earlier.
      // (We kept inDur / outDur indirectly — the alphaExpr embedded them.)
      // Easier: re-extract from alphaExpr regex.
      const inMatch = /lt\(t,([\d.]+)\),\(t-([\d.]+)\)\/([\d.]+)/.exec(st.alphaExpr || '');
      const outMatch = /gt\(t,([\d.]+)\),\(([\d.]+)-t\)\/([\d.]+)/.exec(st.alphaExpr || '');
      if (inMatch) {
        const inDur = parseFloat(inMatch[3]);
        if (inDur > 0) preChain.push(`fade=t=in:st=0:d=${inDur.toFixed(3)}:alpha=1`);
      }
      if (outMatch) {
        const outDur = parseFloat(outMatch[3]);
        if (outDur > 0) {
          const outStart = Math.max(0, visibleDur - outDur);
          preChain.push(`fade=t=out:st=${outStart.toFixed(3)}:d=${outDur.toFixed(3)}:alpha=1`);
        }
      }
      // Apply base opacity if not 1.0. We drop this into colorchannelmixer
      // for a multiplicative alpha; cheaper than geq.
      const baseOpacityMatch = /^([\d.]+)\*/.exec(st.alphaExpr || '');
      const baseOpacity = baseOpacityMatch ? parseFloat(baseOpacityMatch[1])
                       : (st.alphaExpr ? parseFloat(st.alphaExpr) || 1 : 1);
      if (baseOpacity < 0.999) {
        preChain.push(`colorchannelmixer=aa=${baseOpacity.toFixed(3)}`);
      }
      preChain.push('setpts=PTS-STARTPTS');

      const stkLabel = `[stk${idx}]`;
      filterComplexParts.push(`[${inputIdx}:v]${preChain.join(',')}${stkLabel}`);

      // Overlay onto running video label. Position: relative to frame
      // center, plus user-set posX/posY. The `enable=` gate hides the
      // sticker outside its visible window.
      const nextLabel = idx === imageStickers.length - 1 ? '[vfinal]' : `[vstk${idx}]`;
      const ox = `(main_w-overlay_w)/2${st.posX >= 0 ? '+' : ''}${st.posX}`;
      const oy = `(main_h-overlay_h)/2${st.posY >= 0 ? '+' : ''}${st.posY}`;
      filterComplexParts.push(`${runningLabel}${stkLabel}overlay=x='${ox}':y='${oy}':enable='${st.enable}':format=auto${nextLabel}`);
      runningLabel = nextLabel;
    });

    // Rename the final label so the rest of the pipeline (which maps
    // [vout]) still works. We do this by renaming via copy.
    if (runningLabel === '[vfinal]') {
      // Replace the ORIGINAL [vout] in earlier filter parts with [vbase]
      // so the new [vfinal] becomes the canonical [vout]. Easier: just
      // rebrand [vfinal] → [vout] by adding a passthrough at the end.
      filterComplexParts.push(`${runningLabel}copy[vout_stk]`);
      // Patch the final mapping to [vout_stk] instead of [vout].
      // (We do this after the args.push('-map') call below by rewriting.)
      hasComplexVideo = 'sticker'; // sentinel to override the map
    }
    console.log(`[STICKER] Wired ${imageStickers.length} image overlay${imageStickers.length === 1 ? '' : 's'}`);
  }

  if (hasBgm) {
    // Mix original audio with BGM
    const vol = bgmVolume || 0.3;
    const af = audioFilters.length > 0 ? ',' + audioFilters.join(',') : '';
    filterComplexParts.push(`[0:a]volume=1${af}[a0];[1:a]volume=${vol}[a1];[a0][a1]amix=inputs=2:duration=first[aout]`);
    hasComplexAudio = true;
  } else if (audioFilters.length > 0 && hasComplexVideo) {
    filterComplexParts.push(`[0:a]${audioFilters.join(',')}[aout]`);
    hasComplexAudio = true;
  } else if (audioFilters.length > 0) {
    args.push('-af', audioFilters.join(','));
  }

  if (filterComplexParts.length > 0) {
    args.push('-filter_complex', filterComplexParts.join(';'));
    if (hasComplexVideo === 'sticker') args.push('-map', '[vout_stk]');
    else if (hasComplexVideo) args.push('-map', '[vout]');
    else args.push('-map', '0:v');
    if (hasComplexAudio) args.push('-map', '[aout]');
    else args.push('-map', '0:a?');
  }

  // Map codec ID → ffmpeg encoder name (+ container hints).
  // Apple ProRes / RLE only really make sense in .mov; the caller controls
  // the container via the file extension (mp4/mov/...).
  const codecMap = {
    h264:         { v: 'libx264',    audio: 'aac',  preset: 'fast', useCrf: true  },
    h265:         { v: 'libx265',    audio: 'aac',  preset: 'fast', useCrf: true  },
    hevc:         { v: 'libx265',    audio: 'aac',  preset: 'fast', useCrf: true  },
    hevc_alpha:   { v: 'libx265',    audio: 'aac',  preset: 'fast', useCrf: true, extra: ['-tag:v', 'hvc1'] },
    prores_422:   { v: 'prores_ks',  audio: 'pcm_s16le', useCrf: false, extra: ['-profile:v', '2'] },
    prores_lt:    { v: 'prores_ks',  audio: 'pcm_s16le', useCrf: false, extra: ['-profile:v', '1'] },
    prores_hq:    { v: 'prores_ks',  audio: 'pcm_s16le', useCrf: false, extra: ['-profile:v', '3'] },
    prores_4444:  { v: 'prores_ks',  audio: 'pcm_s16le', useCrf: false, extra: ['-profile:v', '4'] },
    prores_proxy: { v: 'prores_ks',  audio: 'pcm_s16le', useCrf: false, extra: ['-profile:v', '0'] },
    prores_4444xq:{ v: 'prores_ks',  audio: 'pcm_s16le', useCrf: false, extra: ['-profile:v', '5'] },
    rle:          { v: 'qtrle',      audio: 'pcm_s16le', useCrf: false },
  };
  const codecCfg = codecMap[codec] || codecMap.h264;
  // Cap bitrate at 500 Mbps. Real-world 8K HDR ProRes 4444 XQ tops out
  // around 500 Mbps; anything beyond that is almost certainly user
  // error or a corrupt preset value. FFmpeg would otherwise reject the
  // option with a confusing "Invalid argument" / "Result too large"
  // when `${target}k` overflows its internal int64 → strtol path.
  const BITRATE_CAP_KBPS = 500_000;  // 500 Mbps
  const clampBitrate = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(BITRATE_CAP_KBPS, Math.round(n));
  };
  const bitrateVal = Number(videoBitrateKbps);
  const hasVideoBitrate = Number.isFinite(bitrateVal) && bitrateVal > 0;
  args.push('-c:v', codecCfg.v);
  if (codecCfg.preset) args.push('-preset', codecCfg.preset);
  if (codecCfg.useCrf && hasVideoBitrate) {
    const target = clampBitrate(bitrateVal);
    const maxrate = clampBitrate(Number(maxrateKbps) > 0 ? maxrateKbps : target * 1.15);
    const bufsize = clampBitrate(Number(bufsizeKbps) > 0 ? bufsizeKbps : target * 2);
    if (target !== Math.round(bitrateVal)) {
      console.warn(`[FILTERS] Bitrate clamped: requested ${bitrateVal} kbps → ${target} kbps (cap ${BITRATE_CAP_KBPS}k)`);
    }
    args.push('-b:v', `${target}k`, '-maxrate', `${maxrate}k`, '-bufsize', `${bufsize}k`);
  } else if (codecCfg.useCrf) {
    args.push('-crf', String(crfVal));
  }
  if (codecCfg.extra) args.push(...codecCfg.extra);
  args.push('-c:a', codecCfg.audio);
  // Framerate (CFR if specified; FFmpeg accepts decimals like 29.97)
  if (fps) args.push('-r', String(fps));
  // pix_fmt yuv420p for browser playback compatibility (h264/h265 path)
  if (codecCfg.v === 'libx264' || codecCfg.v === 'libx265') {
    args.push('-pix_fmt', 'yuv420p');
  }
  if (codecCfg.v === 'libx264') {
    const requestedHeight = typeof height === 'number' && height > 0
      ? height
      : scale === '4k' ? 2160
        : scale === '2k' ? 1440
          : scale === '1080p' ? 1080
            : scale === '720p' ? 720
              : scale === '480p' ? 480
                : 1080;
    const h264Level = requestedHeight >= 2160 ? '5.1' : requestedHeight >= 1440 ? '5.0' : '4.1';
    args.push('-profile:v', 'main', '-level', h264Level, '-tag:v', 'avc1');
  }
  if (/\.(mp4|m4v)$/i.test(outPath)) {
    args.push('-movflags', '+faststart');
  }
  args.push(outPath);

  console.log(`[FILTERS] codec=${codec || 'h264'}→${codecCfg.v}  fps=${fps || 'src'}  scale=${width && height ? `${width}x${height}` : scale || 'original'}  bitrate=${hasVideoBitrate ? `${Math.round(bitrateVal)}k` : `crf${crfVal}`}`);
  console.log(`[FILTERS] Exporting with ${videoFilters.length} filters: ${videoFilters.join(', ')}`);
  console.log(`[FILTERS] Args: ${args.join(' ')}`);

  // Spawn instead of execFile so we can parse stderr for progress.
  // FFmpeg writes lines like: "frame=  120 fps= 30 ... time=00:00:04.00 bitrate=..."
  // We extract `time=` and divide by total `duration` to compute %.
  const expectedDuration = (endTime > 0 && startTime >= 0) ? (endTime - startTime) : null;
  // Move long filter_complex strings out of the cmdline (Windows would
  // otherwise hit the 32 K char CreateProcess limit and FFmpeg would
  // fail with the misleading "Result too large" error). See helper at
  // top of file. We capture the temp path so we can delete it after
  // ffmpeg exits, regardless of success.
  const fcScriptPath = maybePromoteFilterComplexToScript(args);
  // Detailed spawn diagnostics — invaluable when a customer reports a
  // mystery export failure. Logs cmdline length, filter sizes, longest
  // arg, etc. so we can categorize the failure mode from the log alone.
  logFfmpegSpawnDiagnostics('FILTERS', ffmpegBin, args);
  const { spawn } = require('child_process');
  // Timeout scales with content. The previous flat 10-minute cap killed
  // long-form exports mid-render — a 1-hour 4K project with Enhanced
  // UHD + denoise + motion blur can legitimately take 30-60 min on
  // mid-tier hardware. New rule: at least 30 minutes, plus 15× the
  // expected output duration (so a 1-hour video gets a 15-hour budget,
  // far longer than any reasonable export). Capped at 8 hours to still
  // catch genuinely stuck processes.
  const exportTimeoutMs = Math.min(
    8 * 60 * 60 * 1000,                                     // 8h hard cap
    Math.max(30 * 60 * 1000, (expectedDuration || 0) * 15_000)
  );
  console.log(`[FILTERS] Spawn timeout: ${Math.round(exportTimeoutMs / 60_000)} min (expected duration: ${expectedDuration?.toFixed(1) || '?'}s)`);
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { timeout: exportTimeoutMs });
    // Bounded stderr: keep only the last ~128 KB. Naive `stderr += text`
    // grows unbounded over a multi-hour render and triggers V8's
    // pathological string-concat path (O(n²) re-allocation), eating
    // memory and stalling the renderer's IPC thread.
    const STDERR_TAIL_LIMIT = 128 * 1024;
    const stderrChunks = [];
    let stderrLen = 0;
    const appendStderr = (text) => {
      stderrChunks.push(text);
      stderrLen += text.length;
      while (stderrLen > STDERR_TAIL_LIMIT && stderrChunks.length > 1) {
        stderrLen -= stderrChunks[0].length;
        stderrChunks.shift();
      }
    };
    const stderrTail = () => {
      const joined = stderrChunks.join('');
      return joined.length > STDERR_TAIL_LIMIT
        ? joined.slice(-STDERR_TAIL_LIMIT)
        : joined;
    };
    let lastReportedPct = -1;
    let saw100Pct = false;

    const parseProgressLine = (text) => {
      // Accept BOTH `00:00:01.500` (en/POSIX locale) and `00:00:01,500`
      // (de/fr/vi locales — FFmpeg respects the OS LC_NUMERIC). We
      // normalize the decimal separator before parseFloat. Without this,
      // progress bar would silently freeze at 0% on Windows machines
      // running in a comma-decimal locale.
      const m = text.match(/time=(\d+):(\d+):(\d+(?:[.,]\d+)?)/);
      if (!m) return;
      const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3].replace(',', '.'));
      if (!expectedDuration || expectedDuration <= 0) return;
      const pct = Math.max(0, Math.min(100, (sec / expectedDuration) * 100));
      // Throttle: emit only when integer % moves
      const intPct = Math.floor(pct);
      if (intPct !== lastReportedPct && progressTag && event && event.sender) {
        lastReportedPct = intPct;
        try {
          event.sender.send('export-progress', { tag: progressTag, percent: pct, time: sec, duration: expectedDuration });
        } catch { /* sender gone */ }
      }
    };

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      appendStderr(text);
      // FFmpeg writes status updates carriage-return-separated within a line
      for (const line of text.split(/[\r\n]/)) {
        if (line.includes('time=')) {
          parseProgressLine(line);
          // Detect when encode reaches the end of the timeline so we can
          // emit a "finalizing" hint to the renderer. With +faststart
          // mp4, ffmpeg rewrites the entire file once to move the moov
          // atom to the front — that pass shows no progress lines but
          // can take minutes on a multi-GB output. Without this hint,
          // users at 100 % think the app is hung.
          if (!saw100Pct && expectedDuration && lastReportedPct >= 99) {
            saw100Pct = true;
            console.log('[FILTERS] Encode finished — finalizing container (+faststart rewrite, may take a moment for large files)…');
            if (progressTag && event && event.sender) {
              try { event.sender.send('export-progress', { tag: progressTag, percent: 99.5, finalizing: true }); } catch { /* sender gone */ }
            }
          }
        }
      }
    });

    const cleanupScript = () => {
      if (fcScriptPath) {
        try { fs.unlinkSync(fcScriptPath); } catch { /* already gone */ }
      }
    };

    proc.on('error', (err) => {
      cleanupScript();
      reject(new Error('ffmpeg spawn lỗi: ' + err.message));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        // Final tick
        if (progressTag && event && event.sender) {
          try { event.sender.send('export-progress', { tag: progressTag, percent: 100 }); } catch { /* ignore */ }
        }
        try {
          console.log(`[FILTERS] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
          if (tempOutput && process.platform === 'darwin') {
            try {
              const { execFileSync } = require('child_process');
              execFileSync('xattr', ['-d', 'com.apple.provenance', outPath], { stdio: 'ignore' });
            } catch { /* ignore missing xattr/tool */ }
          }
        } catch { /* ignore */ }
        cleanupScript();
        resolve(null);
      } else {
        // Bumped from 400→2000 chars — the previous slice was too tight
        // to include the actual filter graph or the offending token, so
        // user-reported failures were unreproducible from the error
        // message alone. Stderr output here is still small enough for a
        // toast / log file.
        const tail = stderrTail();
        console.error('[FILTERS] ffmpeg exit code', code, 'stderr:', tail.slice(-2000));
        if (fcScriptPath) {
          console.error('[FILTERS] (filter_complex was passed via script file:', fcScriptPath, '- preserved for debug; delete manually if needed)');
          // Intentionally NOT calling cleanupScript() on error — the file
          // is small (a few KB) and keeping it lets the user reproduce
          // the failure with a manual ffmpeg invocation.
        } else {
          cleanupScript();
        }
        reject(new Error('ffmpeg filter lỗi: ' + tail.slice(-1500)));
      }
    });
  });

  return pathToFileURL(outPath).toString();
});

};
