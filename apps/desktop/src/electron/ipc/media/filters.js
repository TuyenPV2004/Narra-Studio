'use strict';

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

async function rasterizeStickerTemplateToPng(svgMarkup, width, height) {
  const fs = require('fs');
  const path = require('path');

  const tmpDir = path.join(app.getPath('userData'), 'sticker-template-cache');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {  }
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outPath = path.join(tmpDir, `tpl-${stamp}.png`);

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
  try { win.setBackgroundColor('#00000000'); } catch {  }
  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);
    try { win.webContents.setBackgroundColor && win.webContents.setBackgroundColor('#00000000'); } catch {  }

    await new Promise(r => setTimeout(r, 200));
    const img = await win.webContents.capturePage();
    const png = img.toPNG();

    const rawPath = outPath + '.raw.png';
    fs.writeFileSync(rawPath, png);
    const { spawn } = require('child_process');
    await new Promise((resolve, reject) => {
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
    try { fs.unlinkSync(rawPath); } catch {  }
    console.log(`[STICKER] Rasterized template SVG → ${outPath}`);
    return outPath;
  } catch (err) {
    console.error('[STICKER] rasterize failed:', err);
    return null;
  } finally {
    try { win.destroy(); } catch {  }
  }
}

async function rasterizeAnimatedTemplate(svgMarkup, width, height, durationSec = 3.0, fps = 20) {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');

  const cacheDir = path.join(app.getPath('userData'), 'sticker-template-cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const framesDir = path.join(cacheDir, `frames-${stamp}`);
  try { fs.mkdirSync(framesDir, { recursive: true }); } catch {  }

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

  try { win.setBackgroundColor('#00000000'); } catch {  }

  let frameCount = 0;
  let alphaVerified = false;
  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);

    try { win.webContents.setBackgroundColor && win.webContents.setBackgroundColor('#00000000'); } catch {  }

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

      const wait = Math.max(0, frameInterval - (Date.now() - t0));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
  } catch (err) {
    console.error('[STICKER] animated capture session failed:', err);
  } finally {
    try { win.destroy(); } catch {  }
  }

  if (frameCount === 0) {
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {  }
    return null;
  }

  const ffmpegBin = getFfmpegBin();
  const processedDir = path.join(cacheDir, `frames-keyed-${stamp}`);
  try { fs.mkdirSync(processedDir, { recursive: true }); } catch {  }

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

    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {  }
    console.log(`[STICKER] Animated template → ${processedDir} (${frameCount} frames @ ${fps}fps, PNG sequence)`);

    return {
      kind: 'png-sequence',
      pattern: path.join(processedDir, 'frame_%04d.png'),
      fps,
      frameCount,
      durationSec: frameCount / fps,
    };
  } catch (err) {
    console.error('[STICKER] chromakey pass failed:', err.message);
    try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {  }
    try { fs.rmSync(processedDir, { recursive: true, force: true }); } catch {  }
    return null;
  }
}

ipcMain.handle('apply-video-filters', async (event, {
  filePath, startTime, endTime, filters, outputName, scale, crf,
  videoBitrateKbps, maxrateKbps, bufsizeKbps,
  subtitlePath, bgmPath, bgmVolume, fadeIn, fadeOut, delogoRegions,

  width, height, codec, fps,
  tempOutput,

  progressTag,

  outputDir,
}) => {
  const { execFile } = require('child_process');

  try {
    const fsx = require('fs');
    const pathx = require('path');
    const cacheRoot = pathx.join(app.getPath('userData'), 'sticker-template-cache');
    if (fsx.existsSync(cacheRoot)) {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const entry of fsx.readdirSync(cacheRoot)) {
        const p = pathx.join(cacheRoot, entry);
        try {
          const stat = fsx.statSync(p);
          if (stat.mtimeMs < cutoff) fsx.rmSync(p, { recursive: true, force: true });
        } catch {  }
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
    textOverlay = null,
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

  const safeB = Math.max(-1, Math.min(1, Number(brightness) || 0));
  const safeC = Math.max(0, Math.min(2, Number(contrast) || 1));
  const safeS = Math.max(0, Math.min(3, Number(saturation) || 1));
  if (Math.abs(safeB) > 0.005 || Math.abs(safeC - 1) > 0.005 || Math.abs(safeS - 1) > 0.005) {
    videoFilters.push(`eq=brightness=${safeB.toFixed(3)}:contrast=${safeC.toFixed(3)}:saturation=${safeS.toFixed(3)}`);
  }

  const safeHue = Math.max(-360, Math.min(360, Number(hue) || 0));
  if (Math.abs(safeHue) > 0.5) {
    videoFilters.push(`hue=h=${safeHue.toFixed(2)}`);
  }

  const adjust = filters?.adjust || {};

  if (adjust.highlight) {
    const h = clamp(adjust.highlight, -100, 100, 0) / 200;
    const top = clamp(1 + h, 0.5, 1.0, 1);
    videoFilters.push(`curves=master='0/0 0.5/0.5 1/${top.toFixed(3)}'`);
  }

  if (adjust.shadow) {
    const s = clamp(adjust.shadow, -100, 100, 0) / 200;
    const bottom = clamp(s + 0, -0.3, 0.3, 0);
    videoFilters.push(`curves=master='0/${(0 + bottom).toFixed(3)} 0.5/0.5 1/1'`);
  }

  if (adjust.whites) {
    const w = clamp(adjust.whites, -100, 100, 0) / 400;
    if (w > 0) {
      const ceil = Math.max(0.5, Math.min(1, 1 / (1 + w)));
      if (ceil < 0.999) {
        videoFilters.push(`colorlevels=romax=${ceil.toFixed(3)}:gomax=${ceil.toFixed(3)}:bomax=${ceil.toFixed(3)}`);
      }
    }
  }

  if (adjust.blacks) {
    const b = clamp(adjust.blacks, -100, 100, 0) / 400;
    if (b > 0) {
      const floor = Math.max(0, Math.min(0.25, b));
      if (floor > 0.001) {
        videoFilters.push(`colorlevels=romin=${floor.toFixed(3)}:gomin=${floor.toFixed(3)}:bomin=${floor.toFixed(3)}`);
      }
    }
  }

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

  const lutCfg = filters?.lut;
  if (lutCfg && lutCfg.name && lutCfg.name !== 'None') {
    const cubePath = path.join(app.getPath('userData'), 'luts', `${lutCfg.name}.cube`);
    if (fs.existsSync(cubePath)) {
      const escLut = cubePath.replace(/\\/g, '/').replace(/:/g, '\\:');
      videoFilters.push(`lut3d=file='${escLut}'`);
      console.log(`[ADJUST] LUT applied via .cube file: ${lutCfg.name}`);
    } else {
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

  const cwCfg = filters?.colorWheel;
  if (cwCfg && cwCfg.intensity > 0) {
    const i = Math.max(0, Math.min(1, (cwCfg.intensity || 100) / 100));
    const sh = cwCfg.shadows || { r: 0, g: 0, b: 0 };
    const md = cwCfg.middleGrey || { r: 0, g: 0, b: 0 };
    const tn = cwCfg.tint || { r: 0, g: 0, b: 0 };

    const cl = (v) => clamp((v || 0) * i, -0.5, 0.5, 0);
    const rs = cl(sh.r), gs = cl(sh.g), bs = cl(sh.b);
    const rm = cl(md.r), gm = cl(md.g), bm = cl(md.b);
    const rh = cl(tn.r), gh = cl(tn.g), bh = cl(tn.b);
    if (rs || gs || bs || rm || gm || bm || rh || gh || bh) {
      videoFilters.push(`colorbalance=rs=${rs.toFixed(3)}:gs=${gs.toFixed(3)}:bs=${bs.toFixed(3)}:rm=${rm.toFixed(3)}:gm=${gm.toFixed(3)}:bm=${bm.toFixed(3)}:rh=${rh.toFixed(3)}:gh=${gh.toFixed(3)}:bh=${bh.toFixed(3)}`);
    }

    const off = cwCfg.offset || { r: 0, g: 0, b: 0 };
    const offAvg = ((off.r || 0) + (off.g || 0) + (off.b || 0)) / 3 * i;
    if (Math.abs(offAvg) > 0.01) {
      videoFilters.push(`eq=brightness=${clamp(offAvg, -0.3, 0.3, 0).toFixed(3)}`);
    }
  }

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

      if (Math.abs(avgH) > 0.5) {
        videoFilters.push(`hue=h=${(avgH * 0.9).toFixed(2)}`);
      }

      if (Math.abs(avgS) > 0.5) {
        const sMul = clamp(1 + avgS / 200, 0.2, 2.0, 1);
        videoFilters.push(`eq=saturation=${sMul.toFixed(3)}`);
      }

      if (Math.abs(avgB) > 0.5) {
        videoFilters.push(`eq=brightness=${clamp(avgB / 400, -0.3, 0.3, 0).toFixed(3)}`);
      }
    }
  }

  if (adjust.vignette) {
    const vAbs = Math.min(100, Math.abs(adjust.vignette)) / 100;
    const angle = (Math.PI / 4) * vAbs;
    const mode = adjust.vignette > 0 ? 'forward' : 'backward';
    videoFilters.push(`vignette=angle=${angle.toFixed(4)}:eval=init:mode=${mode}`);
  }

  if (cropW > 0 && cropH > 0) {
    videoFilters.push(`crop=${cropW}:${cropH}:${cropX}:${cropY}`);
  }

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

  if (deflicker?.enabled) {
    const sizeByLevel = { weak: 3, recommended: 5, strong: 7 };
    const size = sizeByLevel[deflicker.level] ?? 5;
    const mode = deflicker.mode === 'timelapse' ? 'am' : 'median';
    videoFilters.push(`deflicker=size=${size}:mode=${mode}`);
  }

  if (motionBlur?.enabled && motionBlur.blur > 0) {
    const pct = clamp(motionBlur.blur, 0, 100, 100);

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

      if (motionBlur.speed === 'twice') {
        mb = `${mb},tmix=frames=3:weights='1 1 1'`;
      } else if (motionBlur.speed === 'thrice') {
        mb = `${mb},tmix=frames=3:weights='1 1 1',tmix=frames=3:weights='1 1 1'`;
      }
      videoFilters.push(mb);

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

  if (textOverlay && textOverlay.text) {
    const { text, fontSize = 32, fontColor = 'white', x = '(w-text_w)/2', y = '(h-text_h)/2' } = textOverlay;

    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "'\\''")
      .replace(/:/g, '\\:');
    videoFilters.push(`drawtext=text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${x}:y=${y}:borderw=2:bordercolor=black@0.5`);
  }

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

      const align = t.align || 'center';
      const baseX = align === 'left'   ? '20'
                  : align === 'right'  ? `(w-text_w-20)`
                  : `(w-text_w)/2`;

      const pos = t.position || 'center';
      const baseY = pos === 'top'    ? `${Math.round(fs * 0.4)}`
                  : pos === 'bottom' ? `(h-text_h-${Math.round(fs * 0.4)})`
                  : `(h-text_h)/2`;

      const posX = Number(t.posX) || 0;
      const posY = Number(t.posY) || 0;
      const x = posX !== 0 ? `(${baseX})+(${posX})` : baseX;
      const y = posY !== 0 ? `(${baseY})+(${posY})` : baseY;

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
      void filtersP;

      switch (fx.type) {
        case 'blur': {
          const sigma = (amount / 100) * 8 + (size / 100) * 6;
          if (sigma > 0.05) {
            videoFilters.push(`gblur=sigma=${sigma.toFixed(2)}:enable='${enable}'`);
          }
          break;
        }
        case 'zoom': {
          const peak = 1 + (amount / 100) * 0.5;
          if (speed > 5) {
            const period = Math.max(0.4, 4 - speed * 0.035).toFixed(2);

            const expr = `(${peak.toFixed(3)}-1)*abs(sin(2*PI*t/${period}))+1`;
            videoFilters.push(`scale=w='iw*(${expr})':h='ih*(${expr})':eval=frame:enable='${enable}'`);

            videoFilters.push(`crop=iw/(${expr}):ih/(${expr}):(iw-iw/(${expr}))/2:(ih-ih/(${expr}))/2:enable='${enable}'`);
          } else {
            videoFilters.push(`scale=iw*${peak.toFixed(3)}:ih*${peak.toFixed(3)}:enable='${enable}'`);
            videoFilters.push(`crop=iw/${peak.toFixed(3)}:ih/${peak.toFixed(3)}:(iw-iw/${peak.toFixed(3)})/2:(ih-ih/${peak.toFixed(3)})/2:enable='${enable}'`);
          }
          break;
        }
        case 'open':
        case 'fade': {
          const dur = Math.max(0.1, Math.min((fxEnd - fxStart) / 2, 2 - speed / 100 * 1.6));

          videoFilters.push(`fade=t=in:st=${fxStart.toFixed(3)}:d=${dur.toFixed(3)}:alpha=0`);
          if (fx.type === 'fade') {
            videoFilters.push(`fade=t=out:st=${(fxEnd - dur).toFixed(3)}:d=${dur.toFixed(3)}:alpha=0`);
          }
          break;
        }
        case 'color': {
          const sepia = (amount / 100) * 0.6;
          const sat = 1 + strength / 100 * 0.4 - sepia * 0.5;
          const contrast = 1 + amount / 100 * 0.15;
          videoFilters.push(`eq=saturation=${sat.toFixed(3)}:contrast=${contrast.toFixed(3)}:enable='${enable}'`);
          if (fx.libraryId === 'vhs') {
            videoFilters.push(`hue=h=${(strength / 100 * 8).toFixed(2)}:enable='${enable}'`);
          }
          if (fx.libraryId === 'sepia') {
            videoFilters.push(`colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0:enable='${enable}'`);
          }
          if (fx.libraryId === 'film-grain') {
            const noiseStr = Math.round(strength * 0.6);
            videoFilters.push(`noise=alls=${noiseStr}:allf=t+u:enable='${enable}'`);
          }
          break;
        }
        case 'glow': {
          if (fx.libraryId === 'vignette') {
            const ang = strength / 100 * Math.PI * 0.45 + Math.PI / 6;
            videoFilters.push(`vignette=angle=${ang.toFixed(3)}:enable='${enable}'`);
          } else if (fx.libraryId === 'lens-flare') {
            console.log('[FX] Lens flare CSS-only (no FFmpeg counterpart)');
          } else {
            videoFilters.push(`eq=brightness=${(strength / 200).toFixed(3)}:saturation=${(1 + amount / 200).toFixed(3)}:enable='${enable}'`);
          }
          break;
        }
        case 'distortion': {
          if (fx.libraryId === 'pixelate') {
            const block = Math.max(2, Math.round(4 + amount / 100 * 28));
            videoFilters.push(`scale=iw/${block}:ih/${block}:flags=neighbor,scale=iw*${block}:ih*${block}:flags=neighbor:enable='${enable}'`);
          } else if (fx.libraryId === 'rgb-shift' || fx.libraryId === 'pixel-tear') {
            const hueAmp = (amount / 100 * 30).toFixed(2);
            const periodS = Math.max(0.05, 1 - speed / 120).toFixed(3);
            videoFilters.push(`hue=h='${hueAmp}*sin(2*PI*t/${periodS})':enable='${enable}'`);
          } else {
            const offsetPx = amount / 100 * 6;
            videoFilters.push(`pad=iw+${Math.round(offsetPx * 2)}:ih+${Math.round(offsetPx * 2)}:${Math.round(offsetPx)}:${Math.round(offsetPx)}:color=black@0,crop=iw-${Math.round(offsetPx * 2)}:ih-${Math.round(offsetPx * 2)}:enable='${enable}'`);
          }
          break;
        }
        case 'motion': {
          const offsetPx = Math.round(amount / 100 * 16);
          const periodS = Math.max(0.1, 1 - speed / 120).toFixed(3);
          if (fx.libraryId === 'beat-pulse' || fx.libraryId === 'beat-zoom') {
            const peakS = 1 + amount / 100 * 0.18;
            const expr = `(${peakS.toFixed(3)}-1)*abs(sin(2*PI*t/${periodS}))+1`;
            videoFilters.push(`scale=w='iw*(${expr})':h='ih*(${expr})':eval=frame:enable='${enable}'`);
            videoFilters.push(`crop=iw/(${expr}):ih/(${expr}):(iw-iw/(${expr}))/2:(ih-ih/(${expr}))/2:enable='${enable}'`);
          } else {
            videoFilters.push(`crop=iw:ih:'${offsetPx}*sin(2*PI*t/${periodS})':'${offsetPx}*cos(2*PI*t/${periodS})':enable='${enable}'`);
          }
          break;
        }
        case 'particle': {
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
          const lineH = Math.max(2, 8 - Math.round(strength / 16));
          const a = Math.round(amount / 100 * 140);
          videoFilters.push(`geq=lum='lum(X,Y)*(if(mod(Y,${lineH}),1,${(1 - a / 255).toFixed(3)}))':enable='${enable}'`);
          if (fx.libraryId === 'crt-screen') {
            videoFilters.push(`vignette=PI/4:enable='${enable}'`);
          }
          break;
        }
        case 'threed': {
          const rad = `${(amount / 100 * 0.4).toFixed(3)}*sin(2*PI*t/${Math.max(0.5, 6 - speed / 20).toFixed(2)})`;
          videoFilters.push(`rotate=${rad}:fillcolor=black@0:enable='${enable}'`);
          break;
        }
      }

      if (fx.mask && fx.mask.shape !== 'none') {
        console.log(`[FX] Mask ${fx.mask.shape} declared on ${fx.libraryId} — preview-only at export`);
      }
    }
    console.log(`[FX] Applied ${effects.length} effect filter${effects.length === 1 ? '' : 's'}`);
  }

  const imageStickers = [];
  const stickerOverlays = filters?.stickerOverlays;
  if (Array.isArray(stickerOverlays) && stickerOverlays.length > 0) {
    for (const s of stickerOverlays) {
      if (s.format === 'template' && s.templateSvg) {
        const renderW = Math.max(64, Math.round(s.width || 256));
        const renderH = Math.max(64, Math.round(s.height || 256));

        let baked = null;

        try {
          baked = await rasterizeAnimatedTemplate(s.templateSvg, renderW, renderH, 3.0, 20);
          if (baked && baked.kind === 'png-sequence' && baked.pattern) {
            s.format = 'png-sequence';
            s.filePath = baked.pattern;
            s.fps = baked.fps;
            s.frameCount = baked.frameCount;
            s.durationSec = baked.durationSec;
            s.width = renderW;
            s.height = renderH;
            continue;
          }
        } catch (err) {
          console.warn('[STICKER] animated template render failed, trying PNG fallback:', err && err.message);
        }

        try {
          const pngPath = await rasterizeStickerTemplateToPng(s.templateSvg, renderW, renderH);
          if (pngPath) {
            s.format = 'image';
            s.filePath = pngPath;
            s.width = renderW;
            s.height = renderH;
          } else {
            console.warn('[STICKER] template rasterize returned null — skipping');
            s.format = 'lottie';
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

      const animIn = s.animation?.inPreset && s.animation.inPreset !== 'none' ? s.animation : null;
      const animOut = s.animation?.outPreset ? s.animation : null;
      const inDur = animIn ? Math.max(0.05, Math.min((stickerEnd - stickerStart) / 2, animIn.inDuration || 0.4)) : 0;
      const outDur = animOut ? Math.max(0.05, Math.min((stickerEnd - stickerStart) / 2, animOut.outDuration || 0.36)) : 0;

      let alphaExpr = String(opacity.toFixed(3));
      if (inDur > 0 || outDur > 0) {
        const inExpr = inDur > 0
          ? `if(lt(t,${(stickerStart + inDur).toFixed(3)}),(t-${stickerStart.toFixed(3)})/${inDur.toFixed(3)},1)`
          : '1';
        const outExpr = outDur > 0
          ? `if(gt(t,${(stickerEnd - outDur).toFixed(3)}),(${stickerEnd.toFixed(3)}-t)/${outDur.toFixed(3)},1)`
          : '1';

        alphaExpr = `${opacity.toFixed(3)}*max(0,min(1,${inExpr}))*max(0,min(1,${outExpr}))`;
      }

      if (s.format === 'emoji' && s.emoji) {
        const baseSize = Math.round(96 * (s.scale || 1));
        const escapedEmoji = String(s.emoji).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
        const x = `(w-text_w)/2+${px}`;
        const y = `(h-text_h)/2+${py}`;

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
        const firstFrame = String(s.filePath).replace('%04d', '0000');
        if (!fs.existsSync(firstFrame)) {
          console.warn(`[STICKER] png-sequence first frame missing, skipping: ${firstFrame}`);
          continue;
        }
        imageStickers.push({
          path: s.filePath,
          format: 'png-sequence',
          fps: s.fps || 20,
          frameCount: s.frameCount,
          scale: s.scale || 1,
          rotation: s.rotation || 0,
          posX: px, posY: py,
          enable, alphaExpr,
          stickerStart, stickerEnd,
          width: s.width, height: s.height,
        });
      } else if ((s.format === 'image' || s.format === 'gif') && (s.filePath || s.src)) {
        const raw = s.filePath || s.src;
        let resolvedPath = raw;
        try {
          if (typeof raw === 'string' && raw.startsWith('file://')) {
            const { fileURLToPath: furl3 } = require('url');
            resolvedPath = furl3(raw);
          }
        } catch {  }
        if (!fs.existsSync(resolvedPath)) {
          console.warn(`[STICKER] file not found, skipping: ${resolvedPath}`);
          continue;
        }

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

      void s.tracking;
    }
    if (stickerOverlays.length > 0) {
      const pngSeqCount = imageStickers.filter(x => x.format === 'png-sequence').length;
      const imgCount = imageStickers.length - pngSeqCount;
      const otherCount = stickerOverlays.length - imageStickers.length;
      console.log(`[STICKER] Queued ${stickerOverlays.length} sticker overlays (${pngSeqCount} animated, ${imgCount} static image, ${otherCount} emoji/other)`);
    }
  }

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

  if (subtitlePath) {
    const { fileURLToPath: furl } = require('url');
    const subResolved = subtitlePath.startsWith('file://') ? furl(subtitlePath) : subtitlePath;
    if (fs.existsSync(subResolved)) {
      const escapedSub = subResolved.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
      videoFilters.push(`subtitles='${escapedSub}'`);
    }
  }

  if (delogoRegions && Array.isArray(delogoRegions)) {
    for (const r of delogoRegions) {
      if (r.x != null && r.y != null && r.w && r.h) {
        videoFilters.push(`delogo=x=${Math.round(r.x)}:y=${Math.round(r.y)}:w=${Math.round(r.w)}:h=${Math.round(r.h)}`);
      }
    }
  }

  if (fadeIn > 0) {
    videoFilters.push(`fade=t=in:st=0:d=${fadeIn}`);
  }
  if (fadeOut > 0) {
    const trimDur = (endTime || 0) - (startTime || 0);
    if (trimDur > fadeOut) {
      videoFilters.push(`fade=t=out:st=${trimDur - fadeOut}:d=${fadeOut}`);
    }
  }

  void filters?.transitionOut;

  let videoSpeedRate = 0;
  const speedCfg = filters?.speed;
  const curveCfg = filters?.speedCurve;
  if (curveCfg && Array.isArray(curveCfg.keyframes) && curveCfg.keyframes.length >= 2 && curveCfg.sourceLength > 0) {
    const kfs = curveCfg.keyframes
      .filter((k) => typeof k.t === 'number' && typeof k.s === 'number')
      .map((k) => ({ t: Math.max(0, Math.min(1, k.t)), s: Math.max(0.0625, Math.min(16, k.s)) }))
      .sort((a, b) => a.t - b.t);
    const L = curveCfg.sourceLength;
    const branches = [];
    let accum = 0;

    if (kfs[0].t > 0) {
      const upper = (kfs[0].t * L);
      branches.push({ maxT: upper, expr: `T/${kfs[0].s.toFixed(6)}` });
      accum += upper / kfs[0].s;
    }

    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i], b = kfs[i + 1];
      const segSourceDur = (b.t - a.t) * L;
      if (segSourceDur <= 0) continue;
      const aSrc = a.t * L;
      const bSrc = b.t * L;
      let expr;
      let segEff;
      if (Math.abs(a.s - b.s) < 0.001) {
        expr = `${accum.toFixed(6)} + (T-${aSrc.toFixed(6)})/${a.s.toFixed(6)}`;
        segEff = segSourceDur / a.s;
      } else {
        const slope = (b.s - a.s) / segSourceDur;
        const k = segSourceDur / (b.s - a.s);

        expr = `${accum.toFixed(6)} + ${k.toFixed(6)}*log((${a.s.toFixed(6)} + ${slope.toFixed(8)}*(T-${aSrc.toFixed(6)}))/${a.s.toFixed(6)})`;
        segEff = segSourceDur * Math.log(b.s / a.s) / (b.s - a.s);
      }
      branches.push({ maxT: bSrc, expr });
      accum += segEff;
    }

    const last = kfs[kfs.length - 1];
    if (last.t < 1) {
      const lastSrc = last.t * L;
      branches.push({
        maxT: L,
        expr: `${accum.toFixed(6)} + (T-${lastSrc.toFixed(6)})/${last.s.toFixed(6)}`,
      });
      accum += (L - lastSrc) / last.s;
    }

    let exprFinal = branches[branches.length - 1].expr;
    for (let i = branches.length - 2; i >= 0; i--) {
      exprFinal = `if(lt(T,${branches[i].maxT.toFixed(6)}),${branches[i].expr},${exprFinal})`;
    }
    videoFilters.push(`setpts='${exprFinal}/TB'`);

    const totalEff = Math.max(0.05, accum);
    videoSpeedRate = L / totalEff;
    console.log(`[SPEED] Curve mode: ${kfs.length} keyframes, ${L.toFixed(2)}s source → ${totalEff.toFixed(2)}s effective (avg ${videoSpeedRate.toFixed(3)}×)`);
  } else if (speedCfg && speedCfg.rate && Math.abs(speedCfg.rate - 1) > 0.001) {
    const rate = Math.max(0.0625, Math.min(16, Number(speedCfg.rate)));
    videoFilters.push(`setpts=PTS/${rate.toFixed(6)}`);
    videoSpeedRate = rate;
    console.log(`[SPEED] Standard mode: constant ${rate}×`);
  }

  const velocity = filters?.velocityEffect;
  if (velocity && velocity !== 'none') {
    switch (velocity) {
      case 'flash':

        videoFilters.push('eq=brightness=0.06:contrast=1.08:saturation=1.05');
        break;
      case 'blurshake':

        videoFilters.push('boxblur=2:1');
        break;
      case 'fadeblur':

        videoFilters.push('boxblur=4:2');
        break;
      case 'retrozoom':

        videoFilters.push('crop=in_w*0.94:in_h*0.94:in_w*0.03:in_h*0.03,scale=in_w/0.94:in_h/0.94:flags=lanczos');
        videoFilters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
        break;
      case 'rainbow':

        videoFilters.push("hue=H='2*PI*t/2.5':s=1.6");
        break;
    }
    console.log(`[VELOCITY] Applied "${velocity}" visual filter chain`);
  }

  const audioFilters = [];
  const { audio = null } = filters || {};
  if (audio?.reduceAudioNoise) {
    audioFilters.push('afftdn=nr=12:nf=-25');
  }

  if (audio?.fillChannel === 'left') {
    audioFilters.push('pan=stereo|c0=c1|c1=c1');
  } else if (audio?.fillChannel === 'right') {
    audioFilters.push('pan=stereo|c0=c0|c1=c0');
  }

  if (audio?.isolateVoice?.enabled) {
    if (audio.isolateVoice.keep === 'instrumental') {
      audioFilters.push('pan=stereo|c0=c0-c1|c1=c1-c0');
    } else {
      audioFilters.push('pan=mono|c0=0.5*c0+0.5*c1');
      audioFilters.push('highpass=f=300');
      audioFilters.push('lowpass=f=3400');
    }
  }
  if (audio?.enhanceVoice?.enabled) {
    const inten = Math.max(0, Math.min(100, Number(audio.enhanceVoice.intensity) || 75)) / 100;
    audioFilters.push('highpass=f=80');

    const ratio = (1 + 2 * inten).toFixed(2);
    audioFilters.push(`compand=attacks=0.01:decays=0.1:points=-90/-90|-30/-15|-15/-${(15 / Number(ratio)).toFixed(1)}|0/0`);

    const presenceGain = (inten * 4).toFixed(2);
    audioFilters.push(`equalizer=f=3000:t=q:w=1.5:g=${presenceGain}`);
  }

  if (audio?.voice && (
    (audio.voice.pitch || 0) !== 0 ||
    (audio.voice.brightness || 0) !== 0 ||
    (audio.voice.warmth || 0) !== 0 ||
    (audio.voice.reverb || 0) > 0
  )) {
    const semitones = Math.max(-12, Math.min(12, Number(audio.voice.pitch) || 0));
    if (semitones !== 0) {
      const ratio = Math.pow(2, semitones / 12);
      const baseRate = 44100;
      audioFilters.push(`asetrate=${Math.round(baseRate * ratio)}`);
      audioFilters.push(`aresample=${baseRate}`);

      let comp = 1 / ratio;
      while (comp > 2.0) {
        audioFilters.push('atempo=2.0');
        comp /= 2.0;
      }
      while (comp < 0.5) {
        audioFilters.push('atempo=0.5');
        comp /= 0.5;
      }

      audioFilters.push(`atempo=${comp.toFixed(4)}`);
    }
    const brightness = Math.max(-12, Math.min(12, Number(audio.voice.brightness) || 0));
    if (brightness !== 0) {
      audioFilters.push(`treble=g=${brightness.toFixed(2)}:f=4000`);
    }
    const warmth = Math.max(-12, Math.min(12, Number(audio.voice.warmth) || 0));
    if (warmth !== 0) {
      audioFilters.push(`bass=g=${warmth.toFixed(2)}:f=200`);
    }
    const wet = Math.max(0, Math.min(1, Number(audio.voice.reverb) || 0));
    if (wet > 0) {
      const irPath = typeof audio.voice.irPath === 'string' ? audio.voice.irPath : null;
      const useConvolution = irPath && fs.existsSync(irPath);

      if (useConvolution) {
        const dry = (1 - wet * 0.7).toFixed(2);
        const wetN = (wet * 1.2).toFixed(2);

        const escIr = irPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        audioFilters.push(`afir=dry=${dry}:wet=${wetN}:length=1:gtype=peak:ir_format=mono:irfile='${escIr}'`);
        console.log(`[VOICE] Reverb via convolution (IR: ${path.basename(irPath)})`);
      } else {
        const decay = (0.3 + wet * 0.4).toFixed(2);
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
    audioFilters.push('loudnorm=I=-16:TP=-1:LRA=11');
  }

  if (videoSpeedRate > 0 && Math.abs(videoSpeedRate - 1) > 0.001) {
    if (speedCfg && speedCfg.changeAudioPitch) {
      const baseRate = 44100;
      audioFilters.push(`asetrate=${Math.round(baseRate * videoSpeedRate)}`);
      audioFilters.push(`aresample=${baseRate}`);
    } else {
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

  let hasBgm = false;
  if (bgmPath) {
    const { fileURLToPath: furl2 } = require('url');
    const bgmResolved = bgmPath.startsWith('file://') ? furl2(bgmPath) : bgmPath;
    if (fs.existsSync(bgmResolved)) {
      args.push('-i', bgmResolved);
      hasBgm = true;
    }
  }

  const stickerInputIndices = [];
  if (imageStickers.length > 0) {
    let nextIdx = 1 + (hasBgm ? 1 : 0);
    for (const st of imageStickers) {
      const lower = (st.path || '').toLowerCase();

      const isPngSequence = st.format === 'png-sequence';
      const isAnimated = isPngSequence
        || st.format === 'gif'
        || lower.endsWith('.gif')
        || lower.endsWith('.webp')
        || lower.endsWith('.webm');
      if (isAnimated) args.push('-stream_loop', '-1');

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

      chain.push(`rotate='${rotExpr}':c=black@0:ow='2*ceil(hypot(iw,ih)/2)':oh='2*ceil(hypot(iw,ih)/2)',format=rgba`);
    }
    if (opacityAnim.animated) {
      chain.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacityAnim.expr.replace(/\bt\b/g, 'T')})'`);
    } else if (Number(opacity) < 0.99999) {
      chain.push(`colorchannelmixer=aa=${opacity}`);
    }

    const baseDuration = duration > 0 ? duration : Math.max(0.1, (endTime || 0) - (startTime || 0));

    const canvasCfg = layout?.canvas || null;
    if (canvasCfg && canvasCfg.mode === 'color') {
      const hex = String(canvasCfg.color || '#000000').replace(/^#/, '');
      filterComplexParts.push(`color=c=0x${hex}:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}[base]`);
    } else if (canvasCfg && canvasCfg.mode === 'blur') {
      const radiusByLevel = { low: 8, medium: 16, high: 28, max: 48 };
      const r = radiusByLevel[canvasCfg.blurLevel] ?? radiusByLevel.medium;

      filterComplexParts.push(
        `[0:v]split=2[fgsrc][bgsrc];` +
        `[bgsrc]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},boxblur=${r}:2[base]`
      );
    } else {
      filterComplexParts.push(`color=c=black:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}[base]`);
    }

    const adjustCfg = filters?.adjust || {};
    const particleIntensity = Math.max(0, Math.min(100, Number(adjustCfg.particles) || 0));
    const particleType = adjustCfg.particlesType || 'sparkle';
    const wantParticles = particleIntensity > 0 && !!particleType;

    const fgSourceLabel = (canvasCfg && canvasCfg.mode === 'blur') ? '[fgsrc]' : '[0:v]';
    const fgPreLabel = wantParticles ? '[fgPre]' : '[fg]';
    filterComplexParts.push(`${fgSourceLabel}${chain.join(',')}${fgPreLabel}`);

    if (wantParticles) {
      const I = particleIntensity / 100;
      const baseSrc = `color=c=black:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}`;
      let particleExpr;
      let blendOpacity = I;
      switch (particleType) {
        case 'snow':

          particleExpr = `${baseSrc},noise=alls=110:allf=t,eq=brightness=-${(0.86 - I * 0.06).toFixed(3)}:contrast=14,boxblur=1:1,format=rgba`;
          break;
        case 'dust':

          particleExpr = `${baseSrc},noise=alls=70:allf=t,eq=brightness=-${(0.55 - I * 0.1).toFixed(3)}:contrast=5:saturation=0,format=rgba`;
          blendOpacity = I * 0.8;
          break;
        case 'lightleak': {
          const warmSrc = `color=c=0xffb24a:s=${canvasW}x${canvasH}:r=${fps || 30}:d=${baseDuration}`;
          const peakA = Math.round(I * 200);
          particleExpr = `${warmSrc},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${peakA}*exp(-((X-W*0.85)*(X-W*0.85)+(Y-H*0.18)*(Y-H*0.18))/(W*W*0.18))'`;

          break;
        }
        case 'sparkle':
        default:

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

  if (imageStickers.length > 0) {
    if (!hasComplexVideo) {
      const vfIndex = args.findIndex((a, i) => a === '-vf' && i + 1 < args.length);
      if (vfIndex >= 0) {
        const chain = args[vfIndex + 1];
        args.splice(vfIndex, 2);
        filterComplexParts.push(`[0:v]${chain}[vout]`);
      } else {
        filterComplexParts.push(`[0:v]copy[vout]`);
      }
      hasComplexVideo = true;
    }

    let runningLabel = '[vout]';
    imageStickers.forEach((st, idx) => {
      const inputIdx = stickerInputIndices[idx];
      if (inputIdx === undefined) return;

      const preChain = ['format=yuva420p'];

      if (Math.abs(st.scale - 1) > 0.001) {
        preChain.push(`scale=iw*${st.scale.toFixed(3)}:ih*${st.scale.toFixed(3)}:flags=lanczos`);
      }

      if (Math.abs(st.rotation) > 0.5) {
        const rad = (st.rotation * Math.PI / 180).toFixed(6);
        preChain.push(`rotate=${rad}:ow=hypot(iw\\,ih):oh=ow:c=0x00000000`);
      }

      const visibleDur = Math.max(0.05, st.stickerEnd - st.stickerStart);

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

      const baseOpacityMatch = /^([\d.]+)\*/.exec(st.alphaExpr || '');
      const baseOpacity = baseOpacityMatch ? parseFloat(baseOpacityMatch[1])
                       : (st.alphaExpr ? parseFloat(st.alphaExpr) || 1 : 1);
      if (baseOpacity < 0.999) {
        preChain.push(`colorchannelmixer=aa=${baseOpacity.toFixed(3)}`);
      }
      preChain.push('setpts=PTS-STARTPTS');

      const stkLabel = `[stk${idx}]`;
      filterComplexParts.push(`[${inputIdx}:v]${preChain.join(',')}${stkLabel}`);

      const nextLabel = idx === imageStickers.length - 1 ? '[vfinal]' : `[vstk${idx}]`;
      const ox = `(main_w-overlay_w)/2${st.posX >= 0 ? '+' : ''}${st.posX}`;
      const oy = `(main_h-overlay_h)/2${st.posY >= 0 ? '+' : ''}${st.posY}`;
      filterComplexParts.push(`${runningLabel}${stkLabel}overlay=x='${ox}':y='${oy}':enable='${st.enable}':format=auto${nextLabel}`);
      runningLabel = nextLabel;
    });

    if (runningLabel === '[vfinal]') {
      filterComplexParts.push(`${runningLabel}copy[vout_stk]`);

      hasComplexVideo = 'sticker';
    }
    console.log(`[STICKER] Wired ${imageStickers.length} image overlay${imageStickers.length === 1 ? '' : 's'}`);
  }

  if (hasBgm) {
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

  const BITRATE_CAP_KBPS = 500_000;
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

  if (fps) args.push('-r', String(fps));

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

  const expectedDuration = (endTime > 0 && startTime >= 0) ? (endTime - startTime) : null;

  const fcScriptPath = maybePromoteFilterComplexToScript(args);

  logFfmpegSpawnDiagnostics('FILTERS', ffmpegBin, args);
  const { spawn } = require('child_process');

  const exportTimeoutMs = Math.min(
    8 * 60 * 60 * 1000,
    Math.max(30 * 60 * 1000, (expectedDuration || 0) * 15_000)
  );
  console.log(`[FILTERS] Spawn timeout: ${Math.round(exportTimeoutMs / 60_000)} min (expected duration: ${expectedDuration?.toFixed(1) || '?'}s)`);
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { timeout: exportTimeoutMs });

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
      const m = text.match(/time=(\d+):(\d+):(\d+(?:[.,]\d+)?)/);
      if (!m) return;
      const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3].replace(',', '.'));
      if (!expectedDuration || expectedDuration <= 0) return;
      const pct = Math.max(0, Math.min(100, (sec / expectedDuration) * 100));

      const intPct = Math.floor(pct);
      if (intPct !== lastReportedPct && progressTag && event && event.sender) {
        lastReportedPct = intPct;
        try {
          event.sender.send('export-progress', { tag: progressTag, percent: pct, time: sec, duration: expectedDuration });
        } catch {  }
      }
    };

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      appendStderr(text);

      for (const line of text.split(/[\r\n]/)) {
        if (line.includes('time=')) {
          parseProgressLine(line);

          if (!saw100Pct && expectedDuration && lastReportedPct >= 99) {
            saw100Pct = true;
            console.log('[FILTERS] Encode finished — finalizing container (+faststart rewrite, may take a moment for large files)…');
            if (progressTag && event && event.sender) {
              try { event.sender.send('export-progress', { tag: progressTag, percent: 99.5, finalizing: true }); } catch {  }
            }
          }
        }
      }
    });

    const cleanupScript = () => {
      if (fcScriptPath) {
        try { fs.unlinkSync(fcScriptPath); } catch {  }
      }
    };

    proc.on('error', (err) => {
      cleanupScript();
      reject(new Error('ffmpeg spawn lỗi: ' + err.message));
    });
    proc.on('close', (code) => {
      if (code === 0) {
        if (progressTag && event && event.sender) {
          try { event.sender.send('export-progress', { tag: progressTag, percent: 100 }); } catch {  }
        }
        try {
          console.log(`[FILTERS] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
          if (tempOutput && process.platform === 'darwin') {
            try {
              const { execFileSync } = require('child_process');
              execFileSync('xattr', ['-d', 'com.apple.provenance', outPath], { stdio: 'ignore' });
            } catch {  }
          }
        } catch {  }
        cleanupScript();
        resolve(null);
      } else {
        const tail = stderrTail();
        console.error('[FILTERS] ffmpeg exit code', code, 'stderr:', tail.slice(-2000));
        if (fcScriptPath) {
          console.error('[FILTERS] (filter_complex was passed via script file:', fcScriptPath, '- preserved for debug; delete manually if needed)');
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
