'use strict';

/**
 * FFmpeg cut-and-join: concat (plain and xfade transitions), duration probe,
 * video trim, audio trim.
 *
 * Registered by `electron/ipc/media.js`.
 */

module.exports = function registerMediaFfmpegEditIpc(dependencies) {
  const {
    ipcMain,
    path,
    fs,
    os,
    pathToFileURL,
    fileURLToPath,
    getFfmpegBin,
    maybePromoteFilterComplexToScript,
    logFfmpegSpawnDiagnostics,
    getVideoOutputDir,
  } = dependencies;

// ── Concat Videos (ffmpeg) ────────────────────────────────────────────
// ── concat-videos-with-transitions ─────────────────────────────────
// Multi-input xfade chain. Input shape:
//   clips = [
//     { path, duration, transitionToNext: { type, duration } | null },
//     …
//   ]
// Each `transitionToNext` joins this clip to the next via FFmpeg
// `xfade`. The chain accumulates: [0][1]xfade[v01]; [v01][2]xfade[v02]; …
// Audio uses `acrossfade` for matching cross-fade. Clips without a
// transition use `concat=n=2`.
//
// Offset math:
//   xfade `offset` is when the transition STARTS in the running output
//   timeline. After a transition, the output timeline is shorter by
//   one transition duration (because clips overlap). cumulativeDuration
//   tracks the running total minus past transition overlaps.
ipcMain.handle('concat-videos-with-transitions', async (_, {
  clips, outputName, codec, fps, width, height, outputDir,
}) => {
  const { execFile } = require('child_process');
  const os = require('os');
  const { fileURLToPath: furlV } = require('url');

  if (!Array.isArray(clips) || clips.length < 2) {
    throw new Error('concat-videos-with-transitions: at least 2 clips required');
  }

  // Resolve all paths and validate.
  const resolved = clips.map(c => {
    const p = c.path && c.path.startsWith('file://') ? furlV(c.path) : c.path;
    if (!p || !fs.existsSync(p)) throw new Error(`File missing: ${p}`);
    return { ...c, path: p };
  });

  const ffmpegBin = getFfmpegBin();
  const saveDir = outputDir || path.join(getVideoOutputDir(), 'merging');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  const outFilename = (() => {
    const n = outputName || `xfade_${Date.now()}.mp4`;
    return /\.(mp4|mov|mkv|webm|avi)$/i.test(n) ? n : `${n}.mp4`;
  })();
  const outPath = path.isAbsolute(outFilename) ? outFilename : path.join(saveDir, outFilename);

  console.log(`[XFADE] Joining ${resolved.length} clips with ${resolved.filter(c => c.transitionToNext).length} transitions → ${outPath}`);

  // ── Build FFmpeg args ──
  const args = ['-y'];
  resolved.forEach(c => args.push('-i', c.path));

  // Filter chain: cumulative offset.
  const filterParts = [];
  let videoLabel = '[0:v]';
  let audioLabel = '[0:a]';
  let cumulativeDur = resolved[0].duration;

  for (let i = 1; i < resolved.length; i++) {
    const prev = resolved[i - 1];
    const trans = prev.transitionToNext;
    const isLast = i === resolved.length - 1;
    const nextV = isLast ? '[vout]' : `[v${i}]`;
    const nextA = isLast ? '[aout]' : `[a${i}]`;

    if (trans && typeof trans.type === 'string' && trans.duration > 0) {
      const tDur = Math.max(0.05, Math.min(prev.duration / 2, resolved[i].duration / 2, trans.duration));
      const offset = Math.max(0, cumulativeDur - tDur);
      filterParts.push(`${videoLabel}[${i}:v]xfade=transition=${trans.type}:duration=${tDur.toFixed(3)}:offset=${offset.toFixed(3)}${nextV}`);
      // Audio cross-fade matching the visual.
      filterParts.push(`${audioLabel}[${i}:a]acrossfade=d=${tDur.toFixed(3)}:c1=tri:c2=tri${nextA}`);
      cumulativeDur = cumulativeDur + resolved[i].duration - tDur;
    } else {
      // Plain concat for boundaries without a transition.
      filterParts.push(`${videoLabel}[${i}:v]concat=n=2:v=1:a=0${nextV}`);
      filterParts.push(`${audioLabel}[${i}:a]concat=n=2:v=0:a=1${nextA}`);
      cumulativeDur = cumulativeDur + resolved[i].duration;
    }
    videoLabel = nextV;
    audioLabel = nextA;
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '[vout]', '-map', '[aout]');

  // Encoder selection — match concat-videos so output is compatible
  // with whatever the user selected in the export modal.
  const codecMap = {
    h264: 'libx264', hevc: 'libx265', vp9: 'libvpx-vp9', av1: 'libaom-av1',
  };
  args.push('-c:v', codecMap[codec] || 'libx264', '-preset', 'fast', '-crf', '20');
  args.push('-c:a', 'aac', '-b:a', '192k');
  if (fps) args.push('-r', String(fps));
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');

  // Force resolution if specified.
  if (typeof width === 'number' && typeof height === 'number') {
    // Prepend a scale filter to the output stream — wrap [vout] in
    // a scale step.
    const finalScale = `[vout]scale=${width}:${height}:flags=lanczos,setsar=1[vfinal]`;
    args.splice(args.indexOf('-filter_complex') + 1, 1,
      `${filterParts.join(';')};${finalScale}`);
    const mapIdx = args.indexOf('[vout]');
    if (mapIdx >= 0) args[mapIdx] = '[vfinal]';
  }

  args.push(outPath);

  // Same Windows cmdline overflow guard as apply-video-filters — many
  // xfade transitions stacked on a long timeline can produce a multi-KB
  // filter chain that pushes the cmdline past the 32 K limit.
  const fcScriptPath = maybePromoteFilterComplexToScript(args);
  logFfmpegSpawnDiagnostics('XFADE', ffmpegBin, args);

  console.log(`[XFADE] Args: ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    execFile(ffmpegBin, args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[XFADE] failed:', err.message, stderr.slice(-1000));
        if (fcScriptPath) console.error('[XFADE] (filter_complex script preserved for debug:', fcScriptPath, ')');
        reject(new Error(`xfade concat failed: ${err.message}`));
      } else {
        if (fcScriptPath) {
          try { fs.unlinkSync(fcScriptPath); } catch { /* already gone */ }
        }
        resolve();
      }
    });
  });

  console.log(`[XFADE] Done: ${outPath}`);
  return outPath;
});

// filePaths: array of file:// URLs hoặc absolute paths
// Re-encode all clips to consistent format before concat to avoid codec mismatch
ipcMain.handle('concat-videos', async (_, { filePaths, outputName, codec, fps, width, height, outputDir }) => {
  const { execFile } = require('child_process');
  const os = require('os');

  // Resolve file:// → absolute path
  const { fileURLToPath } = require('url');
  const resolvedPaths = filePaths.map(p => {
    try { return p.startsWith('file://') ? fileURLToPath(p) : p; }
    catch { return p; }
  });

  // Kiểm tra tất cả file tồn tại
  for (const fp of resolvedPaths) {
    if (!fs.existsSync(fp)) throw new Error(`File không tồn tại: ${fp}`);
  }

  const ffmpegBin = getFfmpegBin();
  const tmpDir = path.join(os.tmpdir(), 'fxflow-concat-simple');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // Output → user-specified folder if given (from Export modal), otherwise
  // the default "merging" subfolder under the configured output path.
  const saveDir = outputDir || path.join(getVideoOutputDir(), 'merging');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  // Generate M_DD_MM_NNN filename
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const mPrefix = `M_${dd}_${mm}_`;
  let maxSeq = 0;
  try {
    const files = fs.readdirSync(saveDir);
    for (const f of files) {
      if (f.startsWith(mPrefix)) {
        const match = f.match(new RegExp(`^${mPrefix}(\\d+)`));
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxSeq) maxSeq = num;
        }
      }
    }
  } catch { }
  const seq = String(maxSeq + 1).padStart(3, '0');
  const outFilename = (() => {
    const n = outputName || `${mPrefix}${seq}.mp4`;
    return /\.(mp4|mov|mkv|webm|avi)$/i.test(n) ? n : `${n}.mp4`;
  })();
  const outPath = path.isAbsolute(outFilename) ? outFilename : path.join(saveDir, outFilename);

  console.log(`[CONCAT] Joining ${resolvedPaths.length} videos → ${outPath}`);

  // Step 1: Re-encode each clip to a consistent format so they can be
  // concatenated without "codec mismatch" errors. Use the caller's chosen
  // codec/fps/dimensions so the final export actually preserves them
  // (otherwise picking 4K + HEVC + 60fps would still produce 1080p H.264 30fps).
  const codecMap = {
    h264:         { v: 'libx264',   a: 'aac',         crf: true,  preset: 'fast' },
    h265:         { v: 'libx265',   a: 'aac',         crf: true,  preset: 'fast' },
    hevc:         { v: 'libx265',   a: 'aac',         crf: true,  preset: 'fast' },
    hevc_alpha:   { v: 'libx265',   a: 'aac',         crf: true,  preset: 'fast', extra: ['-tag:v', 'hvc1'] },
    prores_422:   { v: 'prores_ks', a: 'pcm_s16le',                extra: ['-profile:v', '2'] },
    prores_lt:    { v: 'prores_ks', a: 'pcm_s16le',                extra: ['-profile:v', '1'] },
    prores_hq:    { v: 'prores_ks', a: 'pcm_s16le',                extra: ['-profile:v', '3'] },
    prores_4444:  { v: 'prores_ks', a: 'pcm_s16le',                extra: ['-profile:v', '4'] },
    prores_proxy: { v: 'prores_ks', a: 'pcm_s16le',                extra: ['-profile:v', '0'] },
    prores_4444xq:{ v: 'prores_ks', a: 'pcm_s16le',                extra: ['-profile:v', '5'] },
    rle:          { v: 'qtrle',     a: 'pcm_s16le' },
  };
  const codecCfg = codecMap[codec] || codecMap.h264;
  const useFps = fps || 30;

  const trimmedPaths = [];
  for (let i = 0; i < resolvedPaths.length; i++) {
    const src = resolvedPaths[i];
    const tmpPath = path.join(tmpDir, `concat_clip_${i}_${Date.now()}.mp4`);
    const args = ['-y', '-i', src];
    // Optional rescale (only if all parts already share the same resolution
    // we can skip this — but adding `scale` is harmless and ensures uniform).
    if (typeof width === 'number' && typeof height === 'number') {
      args.push('-vf', `scale=${width}:${height}:flags=lanczos`);
    }
    args.push('-c:v', codecCfg.v);
    if (codecCfg.preset) args.push('-preset', codecCfg.preset);
    if (codecCfg.crf) args.push('-crf', '18');
    if (codecCfg.extra) args.push(...codecCfg.extra);
    args.push('-c:a', codecCfg.a);
    if (codecCfg.v === 'libx264' || codecCfg.v === 'libx265') {
      args.push('-pix_fmt', 'yuv420p');
    }
    args.push('-r', String(useFps));
    args.push('-ar', '44100', '-ac', '2');
    if (/\.(mp4|m4v)$/i.test(tmpPath)) args.push('-movflags', '+faststart');
    args.push(tmpPath);
    console.log(`[CONCAT] Re-encoding clip ${i + 1}/${resolvedPaths.length}: ${path.basename(src)}`);
    await new Promise((resolve, reject) => {
      execFile(ffmpegBin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
        if (err) {
          console.error(`[CONCAT] Re-encode clip ${i + 1} failed:`, stderr?.slice(-300) || err.message);
          reject(new Error(`Re-encode clip ${i + 1} lỗi: ${(stderr || err.message).slice(-200)}`));
        } else {
          console.log(`[CONCAT] Re-encoded clip ${i + 1}: ${path.basename(tmpPath)}`);
          resolve(null);
        }
      });
    });
    trimmedPaths.push(tmpPath);
  }

  // Step 2: Concat re-encoded clips (now safe to stream copy)
  const listFile = path.join(tmpDir, `concat_list_${Date.now()}.txt`);
  const listContent = trimmedPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listFile, listContent, 'utf-8');

  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
    ];
    if (/\.(mp4|m4v)$/i.test(outPath)) args.push('-movflags', '+faststart');
    args.push(outPath);
    execFile(ffmpegBin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
      // Cleanup temp files
      try { fs.unlinkSync(listFile); } catch { }
      for (const p of trimmedPaths) {
        try { fs.unlinkSync(p); } catch { }
      }
      if (err) {
        console.error('[CONCAT] ffmpeg concat error:', stderr || err.message);
        reject(new Error('ffmpeg nối lỗi: ' + (stderr?.slice(-300) || err.message)));
      } else {
        console.log(`[CONCAT] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
        resolve(null);
      }
    });
  });

  return pathToFileURL(outPath).toString();
});

// ── Get video duration (ffprobe/ffmpeg) ───────────────────────────────
ipcMain.handle('get-video-duration', async (_, { filePath }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const ffmpegBin = getFfmpegBin();

  return new Promise((resolve, reject) => {
    // Use ffmpeg -i to read duration from stream info
    execFile(ffmpegBin, ['-i', resolved, '-f', 'null', '-'], { timeout: 10_000 }, (err, stdout, stderr) => {
      // ffmpeg always exits with error when output is /dev/null, parse stderr
      const all = (stderr || '') + (stdout || '');
      const match = all.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const s = parseFloat(match[3]);
        const duration = h * 3600 + m * 60 + s;
        resolve({ duration });
      } else {
        reject(new Error('Không đọc được duration: ' + all.slice(-200)));
      }
    });
  });
});

// ── Crop video frame (ffmpeg) ────────────────────────────────────────
ipcMain.handle('crop-video', async (_, { filePath, x, y, width, height, outputName }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  const isRemote = /^https?:\/\//i.test(resolved);
  if (!isRemote && !fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const crop = {
    x: Math.floor(Number(x)),
    y: Math.floor(Number(y)),
    width: Math.floor(Number(width)),
    height: Math.floor(Number(height)),
  };
  if (
    !Number.isFinite(crop.x) || !Number.isFinite(crop.y)
    || !Number.isFinite(crop.width) || !Number.isFinite(crop.height)
    || crop.x < 0 || crop.y < 0 || crop.width < 2 || crop.height < 2
    || crop.width > 16384 || crop.height > 16384
  ) {
    throw new Error('Vùng crop video không hợp lệ');
  }

  // libx264/yuv420p requires even crop coordinates and dimensions.
  crop.x -= crop.x % 2;
  crop.y -= crop.y % 2;
  crop.width -= crop.width % 2;
  crop.height -= crop.height % 2;

  const saveDir = path.join(getVideoOutputDir(), 'edited');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
  const requestedName = path.basename(outputName || `crop_${Date.now()}.mp4`);
  const outFilename = /\.(mp4|mov|mkv|webm|avi)$/i.test(requestedName) ? requestedName : `${requestedName}.mp4`;
  const outPath = path.join(saveDir, outFilename);
  const ffmpegBin = getFfmpegBin();

  console.log(`[CROP] ${resolved} → ${outPath} (${crop.width}x${crop.height}+${crop.x}+${crop.y})`);
  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', resolved,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},setsar=1`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outPath,
    ];
    execFile(ffmpegBin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[CROP] ffmpeg error:', stderr || err.message);
        reject(new Error('ffmpeg crop lỗi: ' + (stderr?.slice(-300) || err.message)));
      } else {
        console.log(`[CROP] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
        resolve(null);
      }
    });
  });

  return pathToFileURL(outPath).toString();
});

// ── Trim video (ffmpeg) ───────────────────────────────────────────────
ipcMain.handle('trim-video', async (_, { filePath, startTime, endTime, outputName }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const ffmpegBin = getFfmpegBin();

  const saveDir = path.join(getVideoOutputDir(), 'edited');
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

  const duration = endTime - startTime;
  console.log(`[TRIM] ${resolved} → ${outPath} (${startTime}s - ${endTime}s, ${duration.toFixed(2)}s)`);

  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-ss', String(startTime),
      '-i', resolved,
      '-t', String(duration),
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'fast',
      '-crf', '18',
      outPath,
    ];
    execFile(ffmpegBin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[TRIM] ffmpeg error:', stderr || err.message);
        reject(new Error('ffmpeg trim lỗi: ' + (stderr?.slice(-300) || err.message)));
      } else {
        console.log(`[TRIM] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
        resolve(null);
      }
    });
  });

  return pathToFileURL(outPath).toString();
});

// ── Trim audio (ffmpeg) ───────────────────────────────────────────────
ipcMain.handle('trim-audio', async (_, { filePath, startTime, endTime, outputName }) => {
  const { execFile } = require('child_process');
  const { fileURLToPath } = require('url');
  const resolved = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);

  const ffmpegBin = getFfmpegBin();

  const saveDir = path.join(getVideoOutputDir(), 'audio');
  if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const tPrefix = `TA_${dd}_${mm}_`;
  let maxSeq = 0;
  try {
    const files = fs.readdirSync(saveDir);
    for (const f of files) {
      if (f.startsWith(tPrefix)) {
        const match = f.match(new RegExp(`^${tPrefix}(\\d+)`));
        if (match) { const n = parseInt(match[1], 10); if (n > maxSeq) maxSeq = n; }
      }
    }
  } catch { }
  const seq = String(maxSeq + 1).padStart(3, '0');
  const outFilename = (() => {
    const n = outputName || `${tPrefix}${seq}.mp3`;
    return /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(n) ? n : `${n}.mp3`;
  })();
  const outPath = path.join(saveDir, outFilename);

  const duration = endTime - startTime;
  console.log(`[TRIM-AUDIO] ${resolved} → ${outPath} (${startTime}s - ${endTime}s, ${duration.toFixed(2)}s)`);

  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-ss', String(startTime),
      '-i', resolved,
      '-t', String(duration),
      '-vn',
      '-acodec', 'libmp3lame',
      '-q:a', '2',
      outPath,
    ];
    execFile(ffmpegBin, args, { timeout: 300_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[TRIM-AUDIO] ffmpeg error:', stderr || err.message);
        reject(new Error('ffmpeg trim audio lỗi: ' + (stderr?.slice(-300) || err.message)));
      } else {
        console.log(`[TRIM-AUDIO] Done: ${outPath} (${fs.statSync(outPath).size} bytes)`);
        resolve(null);
      }
    });
  });

  return pathToFileURL(outPath).toString();
});

};
