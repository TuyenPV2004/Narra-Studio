'use strict';

const AUDIO_TERMINAL_STATUSES = new Set(['succeeded', 'failed']);
const AUDIO_FORMATS = new Set(['mp3', 'wav', 'ogg_opus', 'pcm']);
const AVIS_EXPLICIT_LANGUAGES = new Set([
  'de', 'en', 'es', 'es-mx', 'fr', 'id', 'it', 'ja', 'ko', 'pt-br', 'zh', 'zh-cn',
]);
const AVIS_LANGUAGE_ALIASES = {
  'de-de': 'de',
  'en-gb': 'en',
  'en-us': 'en',
  'es-es': 'es',
  'fr-fr': 'fr',
  'id-id': 'id',
  'it-it': 'it',
  'ja-jp': 'ja',
  'ko-kr': 'ko',
  'pt-pt': 'pt-br',
  'zh-hans': 'zh-cn',
  'zh-hant': 'zh',
  'zh-tw': 'zh',
};

function normalizeExplicitLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;
  if (AVIS_EXPLICIT_LANGUAGES.has(normalized)) return normalized;
  const alias = AVIS_LANGUAGE_ALIASES[normalized];
  return alias && AVIS_EXPLICIT_LANGUAGES.has(alias) ? alias : null;
}

function normalizeLocalizedText(value, fallback = null) {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeLocalizedText(entry);
      if (normalized) return normalized;
    }
    return fallback;
  }
  if (!value || typeof value !== 'object') return fallback;
  for (const key of ['text', 'name', 'label', 'value', 'language', 'code', 'id']) {
    const normalized = normalizeLocalizedText(value[key]);
    if (normalized) return normalized;
  }
  return fallback;
}

function normalizeLanguage(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return normalizeLocalizedText(
    value.language || value.languageCode || value.code || value.value || value.text,
    '',
  );
}

function normalizeAudioJob(data = {}) {
  const rawStatus = String(data.status || data.state || 'queued').toLowerCase();
  const status = rawStatus === 'succeeded'
    ? 'done'
    : rawStatus === 'failed'
      ? 'error'
      : rawStatus === 'queued'
        ? 'queued'
        : 'processing';
  return {
    generationId: String(data.generationId || data.id || '').trim() || null,
    product: data.product || null,
    status,
    rawStatus,
    audioUrl: data.audioUrl || data.output?.audioUrl || data.url || null,
    durationSeconds: Number.isFinite(Number(data.durationSeconds)) ? Number(data.durationSeconds) : null,
    originalDurationSeconds: Number.isFinite(Number(data.originalDurationSeconds)) ? Number(data.originalDurationSeconds) : null,
    providerUrl: data.providerUrl || null,
    subtitle: data.subtitle || null,
    error: typeof data.error === 'string'
      ? data.error
      : data.error?.message || (Array.isArray(data.errors) ? data.errors[0] : null) || null,
    raw: data,
  };
}

function normalizeVoice(voice = {}) {
  const voiceType = String(voice.voiceType || voice.id || '').trim();
  return {
    voiceType,
    name: normalizeLocalizedText(voice.name, voiceType || null),
    gender: normalizeLocalizedText(voice.gender),
    age: normalizeLocalizedText(voice.age),
    categories: (Array.isArray(voice.categories) ? voice.categories : [])
      .map(category => normalizeLocalizedText(category))
      .filter(Boolean),
    languages: (Array.isArray(voice.languages) ? voice.languages : [])
      .map(normalizeLanguage)
      .filter(Boolean),
    avatar: voice.avatar || null,
    trialUrl: voice.trialUrl || null,
    description: normalizeLocalizedText(voice.description),
    resourceId: voice.resourceId || null,
    capabilities: voice.capabilities || null,
  };
}

async function listVoices(runtime, requestJson, params = {}) {
  const query = new URLSearchParams();
  for (const key of ['gender', 'age', 'category', 'language', 'resourceId']) {
    const value = String(params[key] || '').trim();
    if (value) query.set(key, value);
  }
  const data = await requestJson(runtime, {
    path: `/audio/voices${query.size ? `?${query.toString()}` : ''}`,
    method: 'GET',
  });
  const voices = Array.isArray(data) ? data : (Array.isArray(data.voices) ? data.voices : []);
  return voices.map(normalizeVoice).filter(voice => voice.voiceType);
}

function validateFormat(value, product) {
  const fallback = 'mp3';
  const format = String(value || fallback);
  const allowed = product === 'text-to-speech'
    ? new Set(['mp3', 'ogg_opus', 'pcm'])
    : AUDIO_FORMATS;
  if (!allowed.has(format)) throw new Error(`Avis Audio format không hợp lệ: ${format}.`);
  return format;
}

function compactRates(params, body) {
  for (const key of ['speechRate', 'loudnessRate', 'pitchRate']) {
    if (params[key] != null && Number.isFinite(Number(params[key]))) body[key] = Number(params[key]);
  }
  return body;
}

function buildTextToSpeechBody(params) {
  const text = String(params.text || '').trim();
  const voiceType = String(params.voiceType || '').trim();
  if (!text || text.length > 1000) throw new Error('AI Provider TTS yêu cầu text từ 1 đến 1000 ký tự.');
  if (!voiceType) throw new Error('AI Provider TTS yêu cầu voiceType.');
  const body = {
    voiceType,
    text,
    format: validateFormat(params.format, 'text-to-speech'),
  };
  for (const key of ['sampleRate', 'speechRate', 'loudnessRate', 'pitch', 'silenceDuration']) {
    if (params[key] != null && Number.isFinite(Number(params[key]))) body[key] = Number(params[key]);
  }
  for (const key of ['enableLanguageDetector', 'disableMarkdownFilter', 'disableEmojiFilter']) {
    if (typeof params[key] === 'boolean') body[key] = params[key];
  }
  const explicitLanguage = normalizeExplicitLanguage(params.explicitLanguage);
  if (explicitLanguage) {
    body.explicitLanguage = explicitLanguage;
  } else if (params.explicitLanguage) {
    body.enableLanguageDetector = true;
  }
  if (Array.isArray(params.contextTexts) && params.contextTexts.length) body.contextTexts = params.contextTexts.slice(0, 1);
  return body;
}

function buildReferenceBody(params) {
  const textPrompt = String(params.textPrompt || params.text || '').trim();
  const refs = Array.isArray(params.refs) ? params.refs.slice(0, 3) : [];
  if (!textPrompt || textPrompt.length > 3000) throw new Error('AI Audio Reference yêu cầu textPrompt từ 1 đến 3000 ký tự.');
  if (!refs.length) throw new Error('AI Audio Reference yêu cầu ít nhất một reference.');
  return compactRates(params, {
    model: String(params.model || 'seed-audio-1.0-multilingual'),
    textPrompt,
    refs,
    format: validateFormat(params.format, 'generation-with-reference'),
    ...(params.sampleRate != null ? { sampleRate: Number(params.sampleRate) } : {}),
    ...(typeof params.enableSubtitle === 'boolean' ? { enableSubtitle: params.enableSubtitle } : {}),
  });
}

async function createAudio(runtime, requestJson, params = {}) {
  const product = params.product === 'generation-with-reference'
    ? 'generation-with-reference'
    : 'text-to-speech';
  const body = product === 'generation-with-reference'
    ? buildReferenceBody(params)
    : buildTextToSpeechBody(params);
  const data = await requestJson(runtime, {
    path: `/audio/${product}`,
    body,
    timeoutMs: params.timeoutMs,
  });
  return normalizeAudioJob({ ...data, product: data.product || product });
}

async function pollAudio(runtime, requestJson, generationId) {
  const id = String(generationId || '').trim();
  if (!id) throw new Error('AI Audio generationId là bắt buộc.');
  const data = await requestJson(runtime, {
    path: `/audio/generations/${encodeURIComponent(id)}`,
    method: 'GET',
  });
  return normalizeAudioJob(data);
}

module.exports = {
  AUDIO_TERMINAL_STATUSES,
  normalizeLocalizedText,
  normalizeLanguage,
  normalizeAudioJob,
  normalizeVoice,
  normalizeExplicitLanguage,
  listVoices,
  createAudio,
  pollAudio,
};
