'use strict';

const { spawn } = require('child_process');

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const asText = value => String(value || '').trim();

function extractJson(value) {
  const text = asText(value);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error('AI Provider Analysis không trả JSON hợp lệ.');
  }
}

function runProcess(binary, args, label, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label} quá thời gian.`));
    }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(new Error(`${label}: ${error.message}`));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${label}: ${stderr.slice(-700)}`));
    });
  });
}

async function resolveVideoFile({ source, tempDir, fs, path, net }) {
  if (/^file:\/\//i.test(source)) {
    const { fileURLToPath } = require('url');
    return fileURLToPath(source);
  }
  if (!/^https?:\/\//i.test(source)) return source;
  const response = await net.fetch(source);
  if (!response.ok) throw new Error(`Không tải được video để Analysis (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const filePath = path.join(tempDir, 'source.mp4');
  await fs.promises.writeFile(filePath, bytes);
  return filePath;
}

async function readDuration(ffmpegBin, source) {
  const probe = await runProcess(
    ffmpegBin,
    ['-i', source, '-t', '0.001', '-f', 'null', '-'],
    'Đọc thời lượng video',
    20_000,
  );
  const match = probe.stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/i);
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  throw new Error('Không đọc được thời lượng video.');
}

function buildTimestamps(duration) {
  const count = Math.min(10, Math.max(4, Math.ceil(duration / 2.5)));
  return Array.from({ length: count }, (_, index) => (
    clamp(((index + 0.5) / count) * duration, 0.05, Math.max(0.05, duration - 0.05))
  ));
}

async function extractFrames({ ffmpegBin, source, duration, tempDir, fs, path }) {
  const timestamps = buildTimestamps(duration);
  const frames = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const filePath = path.join(tempDir, `frame-${index}.jpg`);
    await runProcess(ffmpegBin, [
      '-y', '-ss', String(timestamps[index]), '-i', source, '-frames:v', '1',
      '-vf', 'scale=640:-2:force_original_aspect_ratio=decrease', '-q:v', '6', filePath,
    ], `Trích keyframe ${index + 1}`, 30_000);
    const bytes = await fs.promises.readFile(filePath);
    frames.push({
      index,
      timestamp: timestamps[index],
      filePath,
      bytes,
      dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    });
  }
  return frames;
}

function buildPrompt(duration, frames) {
  return [
    'You are a senior film editor and multimodal video analyst.',
    `The attached ${frames.length} frames were sampled in chronological order from a ${duration.toFixed(3)} second video.`,
    `Frame timestamps: ${frames.map(frame => `${frame.index}=${frame.timestamp.toFixed(3)}s`).join(', ')}.`,
    'Group adjacent frames into the smallest accurate set of distinct shots. Cover every frame index exactly once and keep segments chronological.',
    'Analyze only visible evidence. For audio columns, write "Không xác định từ hình ảnh" unless the visuals or supplied source prompt provide strong evidence; never invent dialogue.',
    'Write production descriptions and prompts in Vietnamese. Image and motion generation prompts may use concise professional English when that is more directly usable.',
    'Return ONLY valid JSON with this exact shape:',
    '{"title":"Video Story","shots":[{"startFrame":0,"endFrame":1,"keyframeIndex":0,"screenDescription":"...","narrativeContent":"...","shotType":"...","cameraAngle":"...","cameraMovement":"...","focalLengthAndDepthOfField":"...","light":"...","backgroundMusic":"...","humanVoiceSoundEffects":"...","imageGenerationPrompt":"...","videoMotionPrompt":"..."}]}',
    'Every string field is required. startFrame/endFrame/keyframeIndex must be integer indices from the supplied frames.',
  ].join('\n');
}

function normalizeShots(raw, frames, duration) {
  const source = Array.isArray(raw?.shots) ? raw.shots : [];
  const maxIndex = frames.length - 1;
  const segments = source.map((shot, sourceIndex) => {
    const startFrame = clamp(Math.round(shot?.startFrame), 0, maxIndex);
    const endFrame = clamp(Math.round(shot?.endFrame), startFrame, maxIndex);
    return { shot, sourceIndex, startFrame, endFrame };
  }).sort((a, b) => a.startFrame - b.startFrame || a.sourceIndex - b.sourceIndex);
  if (!segments.length) throw new Error('AI Provider Analysis không tìm thấy phân cảnh.');

  const boundaries = [0];
  for (let index = 1; index < frames.length; index += 1) {
    boundaries.push((frames[index - 1].timestamp + frames[index].timestamp) / 2);
  }
  boundaries.push(duration);

  let nextFrame = 0;
  const normalized = [];
  for (const segment of segments) {
    if (nextFrame > maxIndex) break;
    const startFrame = nextFrame;
    const endFrame = Math.max(startFrame, clamp(segment.endFrame, startFrame, maxIndex));
    const keyframeIndex = clamp(Math.round(segment.shot?.keyframeIndex), startFrame, endFrame);
    const startTime = boundaries[startFrame];
    const endTime = boundaries[endFrame + 1];
    const field = key => asText(segment.shot?.[key]) || 'Không xác định';
    normalized.push({
      id: `shot-${String(normalized.length + 1).padStart(2, '0')}`,
      mirrorNumber: normalized.length + 1,
      startTime,
      endTime,
      duration: Math.max(0, endTime - startTime),
      screenDescription: field('screenDescription'),
      narrativeContent: field('narrativeContent'),
      shotType: field('shotType'),
      cameraAngle: field('cameraAngle'),
      cameraMovement: field('cameraMovement'),
      focalLengthAndDepthOfField: field('focalLengthAndDepthOfField'),
      light: field('light'),
      backgroundMusic: field('backgroundMusic'),
      humanVoiceSoundEffects: field('humanVoiceSoundEffects'),
      imageGenerationPrompt: field('imageGenerationPrompt'),
      videoMotionPrompt: field('videoMotionPrompt'),
      keyframeIndex,
    });
    nextFrame = endFrame + 1;
  }
  if (nextFrame <= maxIndex && normalized.length) {
    const last = normalized[normalized.length - 1];
    last.endTime = duration;
    last.duration = duration - last.startTime;
  }
  return normalized;
}

async function analyzeVideoStory(options) {
  const {
    source, model, runtime, app, fs, path, net, crypto, ffmpegBin,
    cloudflareImagesProvider, cloudflareRuntime,
  } = options;
  if (!runtime?.configured) throw new Error('Cloud AI chưa được cấu hình key.');
  if (!source) throw new Error('Video Analysis cần URL hoặc file nguồn.');
  const tempDir = path.join(app.getPath('temp'), `veo3-video-story-${crypto.randomUUID()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  try {
    const videoFile = await resolveVideoFile({ source, tempDir, fs, path, net });
    const duration = await readDuration(ffmpegBin, videoFile);
    const frames = await extractFrames({ ffmpegBin, source: videoFile, duration, tempDir, fs, path });
    const content = [
      { type: 'text', text: buildPrompt(duration, frames) },
      ...frames.flatMap(frame => ([
        { type: 'text', text: `Frame ${frame.index} · ${frame.timestamp.toFixed(3)}s` },
        { type: 'image_url', image_url: { url: frame.dataUrl, detail: 'high' } },
      ])),
    ];
    const response = await net.fetch(runtime.apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || runtime.model,
        stream: false,
        messages: [{ role: 'user', content }],
        max_tokens: 7000,
      }),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Avis Analysis error ${response.status}: ${responseText.slice(0, 700)}`);
    const payload = JSON.parse(responseText || '{}');
    const raw = extractJson(payload?.choices?.[0]?.message?.content);
    const shots = normalizeShots(raw, frames, duration);
    const requiredFrameIndexes = [...new Set(shots.map(shot => shot.keyframeIndex))];
    const uploadedByIndex = new Map();
    for (const frameIndex of requiredFrameIndexes) {
      const frame = frames[frameIndex];
      const uploaded = await cloudflareImagesProvider.uploadImage(cloudflareRuntime, {
        bytes: frame.bytes,
        fileName: `video-story-${frameIndex}.jpg`,
        mimeType: 'image/jpeg',
      });
      uploadedByIndex.set(frameIndex, uploaded.url);
    }
    return {
      title: asText(raw?.title) || 'Video Story',
      duration,
      model: model || runtime.model,
      analyzedAt: Date.now(),
      shots: shots.map(({ keyframeIndex, ...shot }) => ({
        ...shot,
        keyframeSrc: uploadedByIndex.get(keyframeIndex),
        keyframeTimestamp: frames[keyframeIndex]?.timestamp,
      })),
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { analyzeVideoStory, buildTimestamps, normalizeShots };
