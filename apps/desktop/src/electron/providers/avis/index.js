// electron/providers/avis/index.js
// ─────────────────────────────────────────────────────────────────────────

const kycProvider = require('./kyc');
const audioProvider = require('./audio');
// Avis provider — IMAGE + VIDEO generation via the **Native Avis API**
// (`/api/v1`). This is a pure-logic module: it never reads the secret file,
// never touches Electron globals, and never hardcodes a key. The caller
// (electron/main.js) injects the runtime `{ apiBase, apiKey, fetchImpl }` from
// getAvisMediaRuntime(); the key stays in .secrets/avis.json and is never
// committed.
//
// WHY NATIVE (not the OpenAI-compat layer):
//   The compatibility layer `/api/openai/v1/videos` accepts `input_reference`
//   but the gateway IGNORES it — image-to-video output only follows the text
//   prompt (verified 2026-07-14 with a frame-comparison test). Real
//   image-to-video / first-last-frame REQUIRES the Native API, which takes an
//   ordered `content[]` array where each image part carries a `role`
//   (firstFrame / lastFrame / referenceImage). So this module targets:
//
//   GET  /api/v1/ai/models                       → discover valid model ids
//   POST /api/v1/image/generations/async         → create image task
//   GET  /api/v1/image/generations/async/:id     → poll image task
//   POST /api/v1/video/generations               → create video task
//   GET  /api/v1/video/tasks/:taskId             → poll video task
//
// Auth: `Authorization: Bearer <key>` (X-Api-Key also accepted upstream).
// ─────────────────────────────────────────────────────────────────────────

// Defaults: the user picks per-generation in the AI Agent config composer;
// these are the fallbacks. Model ids follow the NEW native docs (no date
// suffix). IMAGE default = seedream-4-0 (BytePlus family, flexible sizes).
// VIDEO default = seedance-1-0-pro — the flagship the native docs showcase for
// first/last-frame image-to-video.
const DEFAULT_IMAGE_MODEL = 'seedream-4-0';
const DEFAULT_VIDEO_MODEL = 'seedance-1-0-pro';
const DEFAULT_IMAGE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_IMAGE_POLL_INTERVAL_MS = 2500;
const DEFAULT_HTTP_TIMEOUT_MS = 60000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Model catalogs for UI dropdowns. These mirror the native-API model ids from
// the official docs. The authoritative live list is `GET /api/v1/ai/models`
// (see listModels()) — these static lists are the offline fallback.
const IMAGE_MODELS = [
  'seedream-4-0',
  'seedream-4-5',
  'seedream-5-0',
];

// VIDEO — native models. seedance-1-0-pro supports first/last-frame I2V;
// the dreamina-seedance-2-0 series adds synced audio + KYC identity flows.
const VIDEO_MODELS = [
  'seedance-1-0-pro',
  'happyhorse-1-1',
  'dreamina-seedance-2-0',
  'dreamina-seedance-2-0-fast',
  'dreamina-seedance-2-0-mini',
  'veo-3-1',
];

// Legacy: normalize an apiBase to the OpenAI-compat ".../api/openai/v1" root.
// Kept for backward compatibility with any caller that still imports it; the
// native endpoints below use nativeRoot() instead.
function apiRoot(apiBase) {
  let raw = String(apiBase || '').trim().replace(/\/+$/, '');
  raw = raw.replace(/\/chat\/completions$/, '');
  if (/\/api\/openai\/v1$/.test(raw)) return raw;
  if (/\/api\/openai$/.test(raw)) return `${raw}/v1`;
  if (/\/v1$/.test(raw)) return raw;
  return `${raw}/api/openai/v1`;
}

// Normalize any apiBase (compat url like ".../api/openai/v1/chat/completions",
// a bare host, or an already-native ".../api/v1") into the Native API root
// ".../api/v1" that all native sub-routes hang off of.
function nativeRoot(apiBase) {
  let raw = String(apiBase || '').trim().replace(/\/+$/, '');
  if (/\/api\/v1$/.test(raw)) return raw;
  raw = raw.replace(/\/chat\/completions$/, '');
  // strip a compatibility-layer prefix (openai/anthropic/gemini + optional /v1)
  raw = raw.replace(/\/api\/(openai|anthropic|gemini)(\/v1(beta)?)?$/, '');
  raw = raw.replace(/\/+$/, '');
  return `${raw}/api/v1`;
}

// Normalize any apiBase into the Account/Compat API root ".../api/compat/v1".
// Account data (balance, usage history) lives under this base — DISTINCT from
// the native ".../api/v1" generation root. We strip whatever known suffix the
// configured base carries (compat chat url, native root, or a bare host) down
// to the host, then append the canonical compat prefix.
function compatRoot(apiBase) {
  let raw = String(apiBase || '').trim().replace(/\/+$/, '');
  if (/\/api\/compat\/v1$/.test(raw)) return raw;
  raw = raw.replace(/\/chat\/completions$/, '');
  raw = raw.replace(/\/api\/(openai|anthropic|gemini)(\/v1(beta)?)?$/, '');
  raw = raw.replace(/\/api\/v1$/, '');
  raw = raw.replace(/\/+$/, '');
  return `${raw}/api/compat/v1`;
}

function assertRuntime(runtime) {
  if (!runtime || !runtime.apiKey) {
    throw new Error('AI Provider: missing API key (configure it in AI Agent settings).');
  }
  if (typeof runtime.fetchImpl !== 'function') {
    throw new Error('AI Provider: missing fetchImpl (electron net.fetch).');
  }
}

// Single JSON request helper against the Native API, with timeout + rich error
// messages so callers can distinguish 403 ToS gating (needs plan upgrade) from
// 400 validation / 4xx / 5xx failures.
async function avisJson(runtime, { path: subPath, method = 'POST', body, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, root, signal: externalSignal }) {
  assertRuntime(runtime);
  if (externalSignal?.aborted) throw new Error('AVIS_REQUEST_CANCELLED');
  const base = root || nativeRoot(runtime.apiBase);
  const url = `${base}${subPath}`;
  const controller = new AbortController();
  const abortFromOwner = () => controller.abort();
  externalSignal?.addEventListener?.('abort', abortFromOwner, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await runtime.fetchImpl(url, {
      method,
      headers: {
        'Authorization': `Bearer ${runtime.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (externalSignal?.aborted) throw new Error('AVIS_REQUEST_CANCELLED');
    if (err && err.name === 'AbortError') throw new Error(`AI Provider ${method} ${subPath} timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw new Error(`AI Provider ${method} ${subPath} network error: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromOwner);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    // Surface the EXACT Avis error text. Avis' shape is
    //   { errors: ["..."], status, success:false }  (errors = array of STRINGS)
    // NestJS ValidationPipe may instead send { message: [...]|string, error }.
    // Handle those, then OpenAI-style { error:{ message } }, then raw body.
    const firstErr = Array.isArray(data?.errors) ? data.errors[0] : null;
    const nestMsg = Array.isArray(data?.message) ? data.message.join('; ') : (typeof data?.message === 'string' ? data.message : null);
    const msg =
      (typeof firstErr === 'string' ? firstErr : firstErr?.message) ||
      data?.error?.message ||
      (typeof data?.error === 'string' ? data.error : null) ||
      nestMsg ||
      text?.slice(0, 400) ||
      `HTTP ${res.status}`;
    const err = new Error(`Avis ${method} ${subPath} failed (${res.status}): ${msg}`);
    err.status = res.status;
    err.avisMessage = msg;                 // exact upstream text for the UI
    err.avisErrors = Array.isArray(data?.errors) ? data.errors : undefined;
    err.body = data || text;
    if (res.status === 403 && /terms of service/i.test(msg)) {
      err.tosGated = true;
      err.message += ' [modality not enabled on this key/plan]';
    } else if (res.status === 400 && /pricing (not configured|config invalid)/i.test(msg)) {
      err.pricingUnconfigured = true;      // Avis billing gap, not a bad request
    }
    throw err;
  }
  // Native API wraps every success payload in an envelope:
  //   { success:true, status:200, timestamp, data:<actual payload> }
  // Unwrap so callers see the real task / images[] / models[] directly.
  if (data && typeof data === 'object' && data.success === true && 'data' in data) {
    return data.data ?? {};
  }
  return data ?? {};
}

// ── content-part builders ──────────────────────────────────────────────────
// Turn an image value (http(s) url, data URL, or raw base64) into a native
// content part. Video parts may carry a `role`; image-gen parts omit it.
function toImagePart(value, role) {
  const v = String(value || '').trim();
  if (!v) return null;
  const part = /^https?:\/\//i.test(v)
    ? { type: 'imageUrl', url: v }
    // data URL keeps its own mime; raw base64 must declare a mediaType.
    : { type: 'imageBase64', data: v, ...(/^data:/i.test(v) ? {} : { mediaType: 'image/png' }) };
  if (role) part.role = role;
  return part;
}

function toVideoPart(value) {
  const url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return { type: 'videoUrl', url };
}

function toAudioPart(value) {
  const audio = String(value || '').trim();
  if (!audio) return null;
  if (/^https?:\/\//i.test(audio)) {
    return { type: 'audioUrl', url: audio, role: 'referenceAudio' };
  }
  const dataUrl = audio.match(/^data:([^;,]+);base64,/i);
  if (!dataUrl) return null;
  return { type: 'audioBase64', data: audio, mediaType: dataUrl[1] };
}

// Build the ordered content[] for video from a variety of caller inputs.
// Priority: explicit params.content (passthrough) > structured frame params >
// legacy single inputReference. `inputReference` defaults to role 'firstFrame'
// (animate this image) — override via params.inputReferenceRole.
function buildVideoContent(params) {
  if (Array.isArray(params.content) && params.content.length) return params.content;
  const prompt = String(params.prompt || '').trim();
  const content = [];
  const hasKycInputs = Array.isArray(params.kycInputs) && params.kycInputs.length > 0;
  if (prompt) content.push({ type: 'text', text: prompt });

  const pushImg = (val, role) => { const p = toImagePart(val, role); if (p) content.push(p); };

  // KYC Seedance requests use identity-bound asset parts exclusively. Sending
  // the original URL beside the matching assetId makes Avis count it as another
  // input (for example, one video becomes both videoUrl + kycVideoAssetId).
  if (!hasKycInputs && params.firstFrame) pushImg(params.firstFrame, 'firstFrame');
  if (!hasKycInputs && params.lastFrame) pushImg(params.lastFrame, 'lastFrame');
  if (!hasKycInputs && params.referenceImage) pushImg(params.referenceImage, 'referenceImage');
  if (!hasKycInputs && params.inputVideo) {
    const videoPart = toVideoPart(params.inputVideo);
    if (videoPart) content.push(videoPart);
  }
  if (!hasKycInputs && params.audioReference) {
    const audioPart = toAudioPart(params.audioReference);
    if (audioPart) content.push(audioPart);
  }
  if (!hasKycInputs && Array.isArray(params.images)) {
    for (const img of params.images) {
      if (!img) continue;
      if (typeof img === 'string') pushImg(img, 'referenceImage');
      else pushImg(img.url || img.data || img.value, img.role || 'referenceImage');
    }
  }
  if (Array.isArray(params.kycInputs)) {
    const partType = {
      Image: 'kycImageAssetId',
      Video: 'kycVideoAssetId',
      Audio: 'kycAudioAssetId',
    };
    for (const input of params.kycInputs) {
      const assetId = String(input?.assetId || '').trim();
      const type = partType[input?.assetType];
      if (assetId && type) content.push({ type, assetId });
    }
  }
  // legacy single image-to-video reference → firstFrame by default
  if (!hasKycInputs && params.inputReference && !params.firstFrame && !params.lastFrame && !params.referenceImage && !Array.isArray(params.images)) {
    pushImg(params.inputReference, params.inputReferenceRole || 'firstFrame');
  }
  return content;
}

// ── IMAGE ────────────────────────────────────────────────────────────────
// POST /api/v1/image/generations/async → { generationId, status }
// GET  /api/v1/image/generations/async/:generationId
//   → { status, images:[{url,downloadUrl,b64,assetId}], usage }
// params: { prompt, model?, n?, size?, quality?, responseFormat?,
//           images?/inputReference?, watermark?, guidanceScale?, outputFormat?, extra? }
function normalizeAvisImageSize(model, size) {
  const requested = String(size || '').trim().toLowerCase();
  if (model === 'qwen-image-2-0') {
    const allowed = new Set(['2688x1536', '1536x2688', '2048x2048', '2368x1728', '1728x2368']);
    if (allowed.has(requested)) return requested;
    const match = requested.match(/^(\d+)x(\d+)$/);
    if (!match) return '2048x2048';
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (Math.abs(width - height) / Math.max(width, height) < 0.08) return '2048x2048';
    if (width > height) return width / height >= 1.5 ? '2688x1536' : '2368x1728';
    return height / width >= 1.5 ? '1536x2688' : '1728x2368';
  }
  if (model === 'gpt-image-2') {
    if (requested === 'auto') return requested;
    const match = requested.match(/^(\d+)x(\d+)$/);
    if (!match) return '1024x1024';
    const width = Number(match[1]);
    const height = Number(match[2]);
    const pixels = width * height;
    const longestEdge = Math.max(width, height);
    const aspect = longestEdge / Math.min(width, height);
    const valid = width % 16 === 0
      && height % 16 === 0
      && longestEdge <= 3840
      && aspect <= 3
      && pixels >= 655_360
      && pixels <= 8_294_400;
    return valid ? requested : '1024x1024';
  }
  if (model !== 'gpt-image-1') return requested || '1024x1024';
  const allowed = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
  if (allowed.has(requested)) return requested;
  const match = requested.match(/^(\d+)x(\d+)$/);
  if (!match) return 'auto';
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width > height * 1.1) return '1536x1024';
  if (height > width * 1.1) return '1024x1536';
  return '1024x1024';
}

async function generateImage(runtime, params = {}, signal) {
  if (signal?.aborted) throw new Error('AVIS_REQUEST_CANCELLED');
  const prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('AI Provider generateImage: prompt is required.');
  const model = params.model || runtime.imageModel || DEFAULT_IMAGE_MODEL;
  const requestedQuality = String(params.quality || '').trim().toLowerCase();
  // Backward compatibility for AI Agent canvases saved before the unified
  // image settings panel switched from the UI label "standard" to the Avis
  // API value "medium".
  const quality = requestedQuality === 'standard' ? 'medium' : requestedQuality;
  const safeQuality = ['auto', 'high', 'medium', 'low'].includes(quality) ? quality : '';

  const content = [{ type: 'text', text: prompt }];
  // optional reference images for image editing / multi-image compositing
  const refs = [];
  if (params.inputReference) refs.push(params.inputReference);
  if (Array.isArray(params.images)) refs.push(...params.images);
  for (const r of refs) {
    const part = typeof r === 'string' ? toImagePart(r) : toImagePart(r?.url || r?.data || r?.value);
    if (part) content.push(part);
  }

  const body = {
    model,
    content,
    size: normalizeAvisImageSize(model, params.size),
    numberOfImages: Math.max(1, Math.min(15, Number(params.numberOfImages ?? params.n) || 1)),
    // avisMedia.ts requests 'b64_json' so the image renders without a 2nd fetch.
    ...(params.responseFormat ? { responseFormat: params.responseFormat } : {}),
    ...(safeQuality ? { quality: safeQuality } : {}),
    ...(params.outputFormat ? { outputFormat: params.outputFormat } : {}),
    ...(params.background ? { background: params.background } : {}),
    ...(Number.isInteger(params.outputCompression) ? { outputCompression: params.outputCompression } : {}),
    ...(params.optimizePromptOptions && typeof params.optimizePromptOptions === 'object' ? { optimizePromptOptions: params.optimizePromptOptions } : {}),
    ...(Number.isInteger(params.maxTokens) && params.maxTokens > 0 ? { maxTokens: params.maxTokens } : {}),
    ...(typeof params.guidanceScale === 'number' ? { guidanceScale: params.guidanceScale } : {}),
    watermark: params.watermark === true,
    ...(params.providerId ? { providerId: params.providerId } : {}),
    ...(params.extra && typeof params.extra === 'object' ? params.extra : {}),
  };
  const submitted = await avisJson(runtime, {
    path: '/image/generations/async',
    body,
    timeoutMs: Math.min(Number(params.requestTimeoutMs) || DEFAULT_HTTP_TIMEOUT_MS, DEFAULT_IMAGE_TIMEOUT_MS),
    signal,
  });
  const submittedJob = unwrapImageJob(submitted);
  const generationId = String(
    submittedJob.generationId
    || submittedJob.generation_id
    || submittedJob.taskId
    || submittedJob.task_id
    || submittedJob.jobId
    || submittedJob.id
    || '',
  ).trim();
  const submittedImages = normalizeImageItems(submittedJob);
  if (submittedImages.length) {
    return { model: body.model, images: submittedImages, generationId: generationId || null, raw: submitted };
  }
  if (!generationId) throw new Error('AI Provider POST /image/generations/async không trả generationId.');

  const pollIntervalMs = Math.max(250, Number(params.pollIntervalMs) || DEFAULT_IMAGE_POLL_INTERVAL_MS);
  const pollTimeoutMs = Math.max(10000, Number(params.timeoutMs) || DEFAULT_IMAGE_TIMEOUT_MS);
  const startedAt = Date.now();
  let last = submittedJob;
  let transientFailures = 0;
  while (Date.now() - startedAt < pollTimeoutMs) {
    if (signal?.aborted) throw new Error('AVIS_REQUEST_CANCELLED');
    await new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener?.('abort', abort);
      const abort = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('AVIS_REQUEST_CANCELLED'));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, pollIntervalMs);
      signal?.addEventListener?.('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    try {
      const polled = await avisJson(runtime, {
        path: `/image/generations/async/${encodeURIComponent(generationId)}`,
        method: 'GET',
        timeoutMs: Math.min(Number(params.requestTimeoutMs) || DEFAULT_HTTP_TIMEOUT_MS, pollTimeoutMs),
        signal,
      });
      transientFailures = 0;
      last = unwrapImageJob(polled);
      const images = normalizeImageItems(last);
      const rawStatus = String(last.status || last.state || last.phase || '').toLowerCase();
      if (images.length && (!rawStatus || ['succeeded', 'completed', 'complete', 'success', 'done', 'finished'].includes(rawStatus))) {
        return {
          model: body.model,
          images,
          generationId,
          raw: { async: true, generationId, submitted, final: polled },
        };
      }
      if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(rawStatus)) {
        throw new Error(`AI Provider image async ${generationId} failed: ${imageJobError(last)}`);
      }
    } catch (error) {
      if (signal?.aborted || String(error?.message || '') === 'AVIS_REQUEST_CANCELLED') throw error;
      if (/AI Provider image async .* failed:/.test(String(error?.message || ''))) throw error;
      const retryable = [429, 502, 503, 504].includes(Number(error?.status))
        || /network error|timed out/i.test(String(error?.message || ''));
      transientFailures += 1;
      if (!retryable || transientFailures >= 5) throw error;
    }
  }
  const lastStatus = String(last?.status || last?.state || 'processing');
  throw new Error(`AI Provider image async ${generationId} timed out after ${Math.round(pollTimeoutMs / 1000)}s (status: ${lastStatus}).`);
}

function unwrapImageJob(value) {
  if (!value || typeof value !== 'object') return {};
  if (value.generation && typeof value.generation === 'object') return value.generation;
  if (value.task && typeof value.task === 'object') return value.task;
  if (value.result && typeof value.result === 'object' && !Array.isArray(value.result)) return value.result;
  return value;
}

function normalizeImageItems(value) {
  const arrayItems = [
    value?.images,
    value?.output?.images,
    value?.result?.images,
    value?.data,
    value?.output,
  ].find(Array.isArray) || [];
  const flatCandidates = [
    value,
    value?.data,
    value?.output,
    value?.result,
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  const items = arrayItems.length ? arrayItems : flatCandidates;
  return items.map((item) => ({
    b64: item?.b64 || item?.b64_json || null,
    url: item?.url
      || item?.downloadUrl
      || item?.download_url
      || item?.sourceUrl
      || item?.source_url
      || item?.storageUrl
      || item?.storage_url
      || item?.publicUrl
      || item?.public_url
      || null,
    revisedPrompt: item?.revisedPrompt || item?.revised_prompt || null,
    assetId: item?.assetId || item?.asset_id || null,
  })).filter((item) => item.b64 || item.url);
}

function isExpiredAwsSignedUrl(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    const get = (key) => {
      for (const [candidate, entry] of url.searchParams.entries()) {
        if (candidate.toLowerCase() === key) return entry;
      }
      return null;
    };
    const amzDate = get('x-amz-date');
    const amzExpires = Number(get('x-amz-expires'));
    const match = amzDate?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (match && Number.isFinite(amzExpires)) {
      const signedAt = Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6]),
      );
      return signedAt + amzExpires * 1000 <= now + 30_000;
    }
    const expires = Number(get('expires'));
    return Number.isFinite(expires) && expires > 0 && expires * 1000 <= now + 30_000;
  } catch {
    return false;
  }
}

const generationHistoryIndexCache = new Map();

async function findGenerationInHistory(runtime, generationId) {
  const cacheKey = `${runtime.apiBase || ''}\n${runtime.apiKey || ''}`;
  const cached = generationHistoryIndexCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.byId.get(generationId) || null;

  const byId = new Map();
  let offset = 0;
  let total = Infinity;
  // Manual recovery is rare, but accounts can have hundreds of generations.
  // Page through a bounded history once and share the index across concurrent
  // Canvas refreshes instead of issuing one full scan per node.
  while (offset < total && offset < 2000) {
    const page = await listGenerations(runtime, { offset, limit: 100 });
    total = page.total;
    for (const row of page.results) {
      const id = String(row?.id || row?.generationId || '').trim();
      if (id) byId.set(id, row);
    }
    if (!page.results.length) break;
    offset += page.results.length;
  }
  generationHistoryIndexCache.set(cacheKey, {
    byId,
    expiresAt: Date.now() + 30_000,
  });
  return byId.get(generationId) || null;
}

function normalizeImageJob(data, generationId) {
  const value = unwrapImageJob(data);
  const root = data && typeof data === 'object' ? data : {};
  const rawStatus = String(
    value.status
    || value.state
    || value.phase
    || root.status
    || root.state
    || root.phase
    || '',
  ).toLowerCase();
  let status = 'processing';
  if (['succeeded', 'completed', 'complete', 'success', 'done', 'finished'].includes(rawStatus)) status = 'done';
  else if (['failed', 'error', 'cancelled', 'canceled', 'rejected'].includes(rawStatus)) status = 'error';
  else if (['queued', 'pending'].includes(rawStatus)) status = 'queued';
  const images = normalizeImageItems(value);
  return {
    generationId: String(
      value.generationId
      || value.generation_id
      || root.generationId
      || root.generation_id
      || generationId
      || '',
    ).trim() || null,
    status,
    rawStatus,
    images: images.length ? images : normalizeImageItems(root),
    error: status === 'error' ? imageJobError(value) || imageJobError(root) : null,
    raw: data,
  };
}

// GET /api/v1/image/generations/async/:generationId → refresh signed outputs
// for an already-billed Image generation. This never creates a new job.
async function pollImage(runtime, generationId) {
  const id = String(generationId || '').trim();
  if (!id) throw new Error('AI Provider pollImage: generationId is required.');
  const data = await avisJson(runtime, {
    path: `/image/generations/async/${encodeURIComponent(id)}`,
    method: 'GET',
    timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  });
  const direct = normalizeImageJob(data, id);
  const needsFreshOutput = direct.status === 'done'
    && (!direct.images.length || direct.images.some((image) => isExpiredAwsSignedUrl(image.url)));
  if (!needsFreshOutput) return direct;

  try {
    // The async detail endpoint can replay the original, already-expired R2
    // signature. Native generation history signs its output URLs on each read,
    // so use the matching row as the read-only refresh source.
    const historyGeneration = await findGenerationInHistory(runtime, id);
    const refreshed = historyGeneration ? normalizeImageJob(historyGeneration, id) : null;
    if (refreshed?.images.length) {
      return {
        ...direct,
        images: refreshed.images,
        raw: {
          detail: data,
          refreshedGeneration: historyGeneration,
        },
      };
    }
  } catch {
    // Preserve the direct provider response. The renderer will reject an
    // expired output explicitly instead of turning a transient history error
    // into a false provider-task failure.
  }
  return direct;
}

function imageJobError(value) {
  const first = Array.isArray(value?.errors) ? value.errors[0] : null;
  return (
    (typeof first === 'string' ? first : first?.message)
    || value?.error?.message
    || (typeof value?.error === 'string' ? value.error : null)
    || value?.message
    || 'provider trả trạng thái failed'
  );
}

// ── VIDEO (async task) ──────────────────────────────────────────────────────
// POST /api/v1/video/generations → VideoTask { taskId, status, videoUrl, ... }
// params: { prompt, model?, duration?/seconds?, resolution?, ratio?,
//           inputReference?/firstFrame?/lastFrame?/referenceImage?/images?/content?,
//           inputVideo?/audioReference?,
//           generateAudio?, seed?, watermark?, extra? }
async function createVideo(runtime, params = {}) {
  const model = params.model || runtime.videoModel || DEFAULT_VIDEO_MODEL;
  const kycInputs = kycProvider.validateVideoInputs(model, params.kycInputs);
  const content = buildVideoContent({ ...params, kycInputs });
  if (!content.length) throw new Error('AI Provider createVideo: content is required (prompt and/or image parts).');

  // duration is an integer number of seconds (native). Accept `seconds` alias.
  const durationRaw = params.duration != null ? params.duration : params.seconds;
  const duration = durationRaw != null ? Math.round(Number(durationRaw)) : undefined;

  const body = {
    model,
    content,
    ...(duration && duration > 0 ? { duration } : {}),
    ...(params.resolution ? { resolution: params.resolution } : {}),
    ...(params.ratio ? { ratio: params.ratio } : {}),
    ...(typeof params.generateAudio === 'boolean' ? { generateAudio: params.generateAudio } : {}),
    ...(params.seed != null && Number(params.seed) >= -1 ? { seed: Math.round(Number(params.seed)) } : {}),
    watermark: params.watermark === true,
    ...(typeof params.cameraFixed === 'boolean' ? { cameraFixed: params.cameraFixed } : {}),
    ...(params.providerId ? { providerId: params.providerId } : {}),
    ...(params.extra && typeof params.extra === 'object' ? params.extra : {}),
  };
  const data = await avisJson(runtime, { path: '/video/generations', body, timeoutMs: params.timeoutMs || DEFAULT_HTTP_TIMEOUT_MS });
  return normalizeVideoJob(data);
}

// GET /api/v1/video/tasks/:taskId → poll status
async function pollVideo(runtime, jobId) {
  const id = String(jobId || '').trim();
  if (!id) throw new Error('AI Provider pollVideo: jobId (taskId) is required.');
  const data = await avisJson(runtime, { path: `/video/tasks/${encodeURIComponent(id)}`, method: 'GET', timeoutMs: DEFAULT_HTTP_TIMEOUT_MS });
  return normalizeVideoJob(data);
}

// GET /api/v1/ai/models → discover live, user-facing model ids.
// opts: { input?: 'text'|'image'|'video'..., output?: 'text'|'image'|'video'... }
async function listModels(runtime, opts = {}) {
  const qs = [];
  if (opts.input) qs.push(`inputModalities=${encodeURIComponent(opts.input)}`);
  if (opts.output) qs.push(`outputModalities=${encodeURIComponent(opts.output)}`);
  const path = `/ai/models${qs.length ? `?${qs.join('&')}` : ''}`;
  const data = await avisJson(runtime, { path, method: 'GET', timeoutMs: DEFAULT_HTTP_TIMEOUT_MS });
  const items = Array.isArray(data) ? data : (Array.isArray(data.models) ? data.models : (Array.isArray(data.data) ? data.data : []));
  return items.map((m) => ({
    modelId: m.modelId || m.id || null,
    name: m.name || null,
    inputModalities: m.inputModalities || null,
    outputModalities: m.outputModalities || null,
    providerIds: m.providerIds || null,
    // capabilities drives the renderer catalog (ratios, sizes, durations,
    // resolutions, input roles). isActive lets the UI grey out dead models.
    capabilities: m.capabilities || null,
    isActive: m.isActive !== false,
    logoUrl: m.logoUrl || m.logo || null,
    description: m.description || null,
  })).filter((m) => m.modelId);
}

async function getKycStatus(runtime) {
  return kycProvider.getKycStatus(runtime, avisJson);
}

async function createKycAsset(runtime, params = {}) {
  return kycProvider.createKycAsset(runtime, avisJson, params);
}

async function getKycAsset(runtime, assetId) {
  return kycProvider.getKycAsset(runtime, avisJson, assetId);
}

async function listAudioVoices(runtime, params = {}) {
  return audioProvider.listVoices(runtime, avisJson, params);
}

async function createAudio(runtime, params = {}) {
  return audioProvider.createAudio(runtime, avisJson, params);
}

async function pollAudio(runtime, generationId) {
  return audioProvider.pollAudio(runtime, avisJson, generationId);
}

// ── ACCOUNT (compat API — read-only, 0 credits) ─────────────────────────────
// GET /api/compat/v1/balance → { creditBalance:<number USD credits> }
async function getBalance(runtime) {
  const data = await avisJson(runtime, {
    path: '/balance',
    method: 'GET',
    root: compatRoot(runtime.apiBase),
    timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  });
  const credits = Number(data?.creditBalance);
  return { creditBalance: Number.isFinite(credits) ? credits : null, raw: data };
}

// Normalize one usage/generation record into the flat shape the history UI
// expects. `modality` is forced for native media rows (they carry no modality
// field), and inferred from the compat feed for text rows.
function normalizeUsageRecord(r, forcedModality) {
  return {
    id: r?.id || r?.taskId || null,
    modality: forcedModality || r?.modality || null,
    model: r?.model || null,
    status: r?.status || null,
    usdCost: typeof r?.usdCost === 'number' ? r.usdCost : null,
    durationMs: typeof r?.durationMs === 'number' ? r.durationMs : null,
    createdAt: r?.createdAt || null,
    usage: r?.usage && typeof r.usage === 'object' ? r.usage : null,
  };
}

// GET /api/v1/{image,video}/generations?offset=&limit= → native media history.
// These generations are recorded ONLY under the native root — the compat
// /usage feed is text/LLM-only — so we fetch them separately and merge. Failure
// is non-fatal: a broken sub-feed just contributes no rows.
async function getNativeGenerations(runtime, kind, offset, limit) {
  const path = kind === 'video' ? '/video/generations' : '/image/generations';
  try {
    const data = await avisJson(runtime, {
      path: `${path}?offset=${offset}&limit=${limit}`,
      method: 'GET',
      root: nativeRoot(runtime.apiBase),
      timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
    });
    const rows = Array.isArray(data?.results) ? data.results : [];
    return {
      results: rows.map((r) => normalizeUsageRecord(r, kind)),
      total: Number(data?.total) || rows.length,
    };
  } catch {
    return { results: [], total: 0 };
  }
}

// Unified usage history. Merges THREE independent Avis feeds into one
// time-sorted list so the widget shows text, image AND video activity:
//   • GET /api/compat/v1/usage        → text / LLM calls (modality: 'text')
//   • GET /api/v1/image/generations   → image generations (tagged 'image')
//   • GET /api/v1/video/generations   → video generations (tagged 'video')
// Each feed is read-only and costs 0 credits. Returns the flat record shape
// { id, modality, model, status, usdCost, durationMs, createdAt, usage }.
async function getUsage(runtime, opts = {}) {
  const offset = Math.max(0, Number(opts.offset) || 0);
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20));
  // Fetch enough from each feed to cover the requested window before merging.
  const fetchN = Math.min(100, offset + limit);

  const textPromise = avisJson(runtime, {
    path: `/usage?offset=0&limit=${fetchN}`,
    method: 'GET',
    root: compatRoot(runtime.apiBase),
    timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  })
    .then((data) => {
      const rows = Array.isArray(data?.results) ? data.results : [];
      return { results: rows.map((r) => normalizeUsageRecord(r)), total: Number(data?.total) || rows.length };
    })
    .catch(() => ({ results: [], total: 0 }));

  const [text, image, video] = await Promise.all([
    textPromise,
    getNativeGenerations(runtime, 'image', 0, fetchN),
    getNativeGenerations(runtime, 'video', 0, fetchN),
  ]);

  const merged = [...text.results, ...image.results, ...video.results]
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

  return {
    results: merged.slice(offset, offset + limit),
    total: text.total + image.total + video.total,
    offset,
    limit,
  };
}

// Native unified generation history. Unlike the compact account usage feed,
// this endpoint retains the full input/output payload needed by Media Library:
// image/video URLs, thumbnails, prompt parts, dimensions and storage status.
async function listGenerations(runtime, opts = {}) {
  const offset = Math.max(0, Number(opts.offset) || 0);
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40));
  const data = await avisJson(runtime, {
    path: `/generations?offset=${offset}&limit=${limit}`,
    method: 'GET',
    root: nativeRoot(runtime.apiBase),
    timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  return {
    results,
    total: Number(data?.total) || results.length,
    offset: Number(data?.offset) || offset,
    limit: Number(data?.limit) || limit,
  };
}

// Map a native VideoTask → a stable shape the queue can rely on.
// Native statuses: queued | running | succeeded | failed | cancelled.
function normalizeVideoJob(data) {
  const rawStatus = String(data.status || data.state || '').toLowerCase();
  let status = 'processing';
  if (['succeeded', 'completed', 'success'].includes(rawStatus)) status = 'done';
  else if (['failed', 'error', 'cancelled', 'canceled'].includes(rawStatus)) status = 'error';
  else if (['queued', 'pending'].includes(rawStatus)) status = 'queued';
  else if (['running', 'processing', 'in_progress'].includes(rawStatus)) status = 'processing';

  // Native completed asset: `videoUrl` (proxy/archived) or `downloadUrl`
  // (presigned R2, expires). Fall back to legacy compat shapes for safety.
  // NOTE: videoUrl/downloadUrl may require the Bearer key to download — the
  // AI Agent's download path (main.js) must fetch with auth, not the renderer.
  const url = data.videoUrl
    || data.downloadUrl
    || data.url
    || data.output?.url
    || (Array.isArray(data.unsigned_urls) ? data.unsigned_urls[0] : null)
    || (Array.isArray(data.signed_urls) ? data.signed_urls[0] : null)
    || (Array.isArray(data.data) ? data.data[0]?.url : null)
    || null;
  const b64 = Array.isArray(data.data) ? (data.data[0]?.b64_json || data.data[0]?.b64 || null) : null;
  const resolvedUrl = url || (b64 ? `data:video/mp4;base64,${b64}` : null);
  const thumbnailUrl = data.thumbnailUrl
    || data.thumbnail_url
    || data.posterUrl
    || data.poster_url
    || data.coverUrl
    || data.cover_url
    || data.output?.thumbnailUrl
    || data.output?.posterUrl
    || null;

  const urls = [];
  if (data.videoUrl) urls.push(data.videoUrl);
  if (data.downloadUrl && data.downloadUrl !== data.videoUrl) urls.push(data.downloadUrl);
  if (!urls.length && Array.isArray(data.unsigned_urls)) urls.push(...data.unsigned_urls);
  if (!urls.length && Array.isArray(data.signed_urls)) urls.push(...data.signed_urls);
  if (!urls.length && url) urls.push(url);

  return {
    jobId: data.taskId || data.id || data.job_id || null,
    status,
    rawStatus,
    progress: typeof data.progress === 'number' ? data.progress : null,
    url: resolvedUrl,
    thumbnailUrl,
    downloadUrl: data.downloadUrl || null,
    b64,
    urls,
    assetId: data.assetId || null,
    generationId: data.generationId || null,
    cost: typeof data.usage?.usdCost === 'number' ? data.usage.usdCost
      : (typeof data.usage?.cost === 'number' ? data.usage.cost : null),
    pollingUrl: data.polling_url || null,
    // Exact upstream error text for a failed task.
    error:
      (Array.isArray(data.errors)
        ? (typeof data.errors[0] === 'string' ? data.errors[0] : data.errors[0]?.message)
        : null) ||
      data.error?.message ||
      (typeof data.error === 'string' ? data.error : null) ||
      null,
    raw: data,
  };
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  VIDEO_MODELS,
  apiRoot,
  nativeRoot,
  compatRoot,
  generateImage,
  pollImage,
  createVideo,
  pollVideo,
  listModels,
  getKycStatus,
  createKycAsset,
  getKycAsset,
  listAudioVoices,
  createAudio,
  pollAudio,
  getBalance,
  getUsage,
  listGenerations,
  normalizeVideoJob,
};
