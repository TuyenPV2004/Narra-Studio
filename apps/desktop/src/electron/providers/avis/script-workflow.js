'use strict';

const RETRYABLE_STATUS = new Set([502, 503, 504]);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function extractJson(value) {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error('Cloud AI Script không trả JSON hợp lệ.');
  }
}

// Merged confirm-camera generations run 60-90s server-side. A non-streamed request
// holds the connection with zero bytes for that long, so the Cloudflare edge in front
// of Avis returns a 504 before the origin finishes. Streaming keeps bytes flowing, so
// the gateway never times out; we reassemble the delta chunks back into one JSON body.
// Counts finished shot objects inside a partially-streamed JSON body. The confirm-camera
// schema emits one "id":"shot-NN" per shot, so a regex tally is a cheap live progress proxy
// without needing to parse the (still incomplete) JSON on every chunk.
function countStreamShots(content) {
  const matches = content.match(/"id"\s*:\s*"shot-\d+/g);
  return matches ? matches.length : 0;
}

async function readStreamedContent(response, controller, onProgress) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    // Fallback for fetch impls without a web-stream body: read the buffered SSE text.
    const raw = await response.text();
    return parseSseContent(raw);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let lastEmitChars = 0;
  let lastEmitShots = 0;
  const emit = () => {
    if (typeof onProgress !== 'function') return;
    const shots = countStreamShots(content);
    // Throttle: surface a delta only after ~800 new chars or when another shot completes,
    // so the renderer log stays readable (capped anyway) and IPC traffic stays light.
    if (content.length - lastEmitChars < 800 && shots <= lastEmitShots) return;
    lastEmitChars = content.length;
    lastEmitShots = shots;
    try { onProgress({ chars: content.length, shots }); } catch { /* progress is best-effort */ }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const delta = extractSseDelta(line);
        if (delta) content += delta;
      }
      emit();
    }
  } finally {
    controller.abort();
  }
  const tail = extractSseDelta(buffer);
  if (tail) content += tail;
  if (typeof onProgress === 'function') {
    try { onProgress({ chars: content.length, shots: countStreamShots(content) }); } catch { /* best-effort */ }
  }
  return content;
}

function extractSseDelta(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return '';
  try {
    const json = JSON.parse(data);
    return json?.choices?.[0]?.delta?.content || '';
  } catch {
    return '';
  }
}

function parseSseContent(raw) {
  let content = '';
  for (const line of String(raw || '').split('\n')) {
    const delta = extractSseDelta(line);
    if (delta) content += delta;
  }
  return content;
}

async function requestJson(runtime, label, prompt, maxTokens, onProgress, externalSignal) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (externalSignal?.aborted) throw new Error('SCRIPT_STAGE_CANCELLED');
    if (typeof onProgress === 'function' && attempt > 1) {
      try { onProgress({ chars: 0, shots: 0, attempt }); } catch { /* best-effort */ }
    }
    const controller = new AbortController();
    const abortFromOwner = () => controller.abort();
    externalSignal?.addEventListener?.('abort', abortFromOwner, { once: true });
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await runtime.fetchImpl(runtime.apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: runtime.model,
          stream: true,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const raw = await response.text();
        const error = new Error(`Avis Script ${label} error ${response.status}: ${raw.slice(0, 700)}`);
        error.status = response.status;
        throw error;
      }
      const content = await readStreamedContent(response, controller, onProgress);
      return { data: extractJson(content), attempt, raw: null };
    } catch (error) {
      lastError = error;
      if (externalSignal?.aborted) throw new Error('SCRIPT_STAGE_CANCELLED');
      const retryable = error?.name === 'AbortError' || RETRYABLE_STATUS.has(Number(error?.status));
      if (!retryable || attempt === 3) throw error;
      await sleep(1500 * attempt);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener?.('abort', abortFromOwner);
    }
  }
  throw lastError;
}

function confirmCameraPrompt(script) {
  return [
    'You are a senior film director, storyboard editor and production-design supervisor.',
    'Read the entire supplied script before segmenting it. Turn every meaningful beat, scene change, action, dialogue turn and transition into camera-ready production shots.',
    'Create as many shots as the story needs, from 6 to 24. Never omit a scene merely to hit a fixed shot count.',
    'Honor an explicit requested duration from the script. Otherwise choose realistic 3-15 second shots and calculate the total duration from their exact sum.',
    'Keep character identity and chronology continuous. Do not invent unrelated plot events.',
    'Every shot must fully populate screenDescription, shotType, lightingAtmosphere, dialogueNarration, soundEffects and cameraMovement. Use an empty dialogue only when the shot is intentionally silent.',
    'In the SAME response, also derive the smallest reusable set of continuity assets needed across the shots.',
    'Return at most 8 assets. Cover every recurring named character and location first, then every essential story prop or continuity wardrobe that changes the meaning of a shot.',
    'Each asset needs a stable kebab-case id, a full identity description, and a standalone generationPrompt for a clean reference sheet matching visualStyle. Never generate image URLs; set every asset status to "missing".',
    'Map every shot to its assets: every shot must appear exactly once in shotAssetRefs, asset IDs must exist in assets, and each asset requiredByShots must agree with that reverse mapping.',
    'Whenever a descriptive shot field names a continuity asset, write it as @Asset Name using the exact assets[].name. Never expose technical "(asset: id)" tokens in prose.',
    'Return JSON only with this exact shape:',
    '{"version":"1.0","title":"...","logline":"...","visualStyle":"global visual language, palette, medium and continuity rules","language":"vi","totalDurationSeconds":72,"workflow":{"currentStep":1,"steps":[{"id":"confirm-camera","status":"ready","completed":0,"total":16},{"id":"prepare-assets","status":"ready","completed":0,"total":6},{"id":"synthesize-prompts","status":"pending","completed":0,"total":16}]},"shots":[{"id":"shot-01","mirrorNumber":1,"durationSeconds":8,"screenDescription":"...","shotType":"...","lightingAtmosphere":"...","dialogueNarration":"...","soundEffects":"...","cameraMovement":"...","finalPrompt":"","assetRefs":[]}],"assets":[{"id":"stable-kebab-id","type":"character|location|prop|wardrobe","name":"...","description":"complete identity, appearance, materials, colors and continuity details","generationPrompt":"standalone image-generation prompt for a clean reference sheet matching visualStyle","requiredByShots":["shot-01"],"status":"missing"}],"shotAssetRefs":[{"shotId":"shot-01","assetIds":["stable-kebab-id"]}]}',
    'The confirm-camera and synthesize-prompts step totals must equal the actual shots.length; the prepare-assets step total must equal assets.length. totalDurationSeconds must exactly equal the sum of durationSeconds.',
    'Write every descriptive field in the same language as the script.',
    '',
    `SOURCE SCRIPT:\n${script}`,
  ].join('\n');
}

function prepareAssetsPrompt(project) {
  return [
    'You are a film continuity and production-design supervisor.',
    'From the confirmed shots below, choose the smallest reusable set of assets needed for visual continuity.',
    'Return at most 8 assets. Cover every recurring named character and location first, then every essential story prop or continuity wardrobe that changes the meaning of a shot.',
    'Return JSON only with shape:',
    '{"assets":[{"id":"stable-kebab-id","type":"character|location|prop|wardrobe","name":"...","description":"complete identity, appearance, materials, colors and continuity details","generationPrompt":"standalone image-generation prompt for a clean reference sheet matching visualStyle","requiredByShots":["shot-01"],"status":"missing"}],"shotAssetRefs":[{"shotId":"shot-01","assetIds":["stable-kebab-id"]}]}',
    'Every supplied shot must appear exactly once in shotAssetRefs. Asset IDs must exist in assets and requiredByShots must agree with the reverse mapping.',
    'Use the project language. Do not generate image URLs.',
    '',
    JSON.stringify({
      title: project.title,
      logline: project.logline,
      visualStyle: project.visualStyle,
      language: project.language,
      shots: project.shots,
    }),
  ].join('\n');
}

function synthesizePromptsPrompt(project, shots, synthesisMode = 'intelligent') {
  const modeInstruction = synthesisMode === 'automatic'
    ? 'Automatic splicing mode: compose the confirmed shot fields directly and faithfully. Do not reinterpret, add new plot events, or change asset identities.'
    : 'Intelligent synthesis mode: improve clarity, cinematic specificity and continuity while preserving every confirmed story fact and asset identity.';
  return [
    'You are a senior video prompt engineer.',
    modeInstruction,
    'Create three coordinated prompt fields for each supplied confirmed shot.',
    'storyboardPrompt describes the still-frame composition, subject and asset identity, environment, lighting and visual style.',
    'storyboardPrompt must not contain camera movement, temporal beats, dialogue delivery or sound instructions.',
    'videoMotionPrompt describes temporal action, performance, camera movement, dialogue, sound and duration without repeating unnecessary still-image detail.',
    'videoMotionPrompt must not repeat the storyboardPrompt prose; mention visual identities only as short continuity references needed to animate the shot.',
    'storyboardPrompt and videoMotionPrompt MUST be materially different. Never copy finalPrompt into both fields.',
    'Mention every reused continuity asset as @Asset Name using the exact assets[].name; never write technical "(asset: id)" tokens.',
    'finalPrompt combines both into one self-contained production prompt suitable for video generation.',
    'Preserve the confirmed duration, scene action, camera, lighting, dialogue, sound and reusable asset identities.',
    'Every finalPrompt must obey the global visualStyle (visual language, palette, medium and continuity rules) so all shots stay visually consistent.',
    'Return JSON only with shape:',
    '{"shots":[{"id":"shot-01","storyboardPrompt":"complete still-frame prompt","videoMotionPrompt":"complete motion prompt","finalPrompt":"complete combined production prompt"}]}',
    'Return exactly the supplied shot IDs and no extra shots. Use the project language.',
    '',
    JSON.stringify({
      title: project.title,
      logline: project.logline,
      visualStyle: project.visualStyle,
      language: project.language,
      assets: project.assets,
      shots,
    }),
  ].join('\n');
}

async function generateScriptStage(runtime, params = {}, onProgress, signal) {
  const stage = String(params.stage || '');
  if (!runtime.apiUrl || !runtime.apiKey || !runtime.fetchImpl) throw new Error('Cloud AI Script runtime chưa cấu hình.');
  if (stage === 'confirm-camera') {
    const script = String(params.script || '').trim();
    if (!script) throw new Error('Script nguồn đang trống.');
    const result = await requestJson(runtime, stage, confirmCameraPrompt(script), 12000, onProgress, signal);
    return { stage, data: result.data, model: runtime.model, attempts: result.attempt };
  }
  const project = params.project && typeof params.project === 'object' ? params.project : null;
  if (!project) throw new Error('Không tìm thấy Script project.');
  if (stage === 'prepare-assets') {
    const result = await requestJson(runtime, stage, prepareAssetsPrompt(project), 3000, onProgress, signal);
    return { stage, data: result.data, model: runtime.model, attempts: result.attempt };
  }
  if (stage === 'synthesize-prompts') {
    const shots = Array.isArray(params.shots) ? params.shots.slice(0, 4) : [];
    if (!shots.length) throw new Error('Không có shot để tổng hợp prompt.');
    const result = await requestJson(
      runtime,
      stage,
      synthesizePromptsPrompt(project, shots, params.synthesisMode),
      6500,
      onProgress,
      signal,
    );
    return { stage, data: result.data, model: runtime.model, attempts: result.attempt };
  }
  throw new Error(`Script stage không hỗ trợ: ${stage || '(trống)'}`);
}

module.exports = { extractJson, generateScriptStage };
