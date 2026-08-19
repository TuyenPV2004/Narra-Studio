'use strict';

const net = require('node:net');

const PROFILE_LIMIT = 20;
const MODEL_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 8000;
const CAPABILITIES = ['text', 'vision', 'text-to-speech', 'lip-sync'];
const PROTOCOL_CAPABILITIES = {
  'openai-compatible': ['text', 'vision', 'text-to-speech', 'lip-sync'],
  'narra-tts-v1': ['text-to-speech'],
  'sync-v2': ['lip-sync'],
};

function redactSecret(value, secret) {
  const text = String(value || '');
  return secret ? text.split(secret).join('[redacted]') : text;
}

function isLoopbackHost(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function isUnsafeIpLiteral(hostname) {
  const value = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(value);
  if (family === 4) {
    const octets = value.split('.').map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && b >= 18 && b <= 19);
  }
  if (family === 6) {
    return value === '::' || value === '::1' || value.startsWith('fc')
      || value.startsWith('fd') || value.startsWith('fe8')
      || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
  }
  return false;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Invalid Base URL. Example: https://provider.example/v1');
  }
  if (url.username || url.password) throw new Error('Base URL must not contain credentials.');
  if (!isLoopbackHost(url.hostname) && isUnsafeIpLiteral(url.hostname)) {
    throw new Error('Base URL must not target a private or link-local IP address.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error('Remote providers must use HTTPS; HTTP is allowed only for localhost.');
  }
  if (url.search || url.hash) throw new Error('Base URL must not contain a query or fragment.');
  const pathname = url.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(pathname) || /\/models$/i.test(pathname)) {
    throw new Error('Enter the API root, not /models or /chat/completions.');
  }
  url.pathname = pathname || '/v1';
  return url.toString().replace(/\/$/, '');
}

function normalizeProfileId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id)) {
    throw new Error('Provider ID must contain 3-64 lowercase letters, digits, _ or -.');
  }
  return id;
}

function normalizeModels(payload) {
  const source = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];
  const seen = new Set();
  const models = [];
  for (const item of source) {
    const record = item && typeof item === 'object' ? item : {};
    const id = String(record.id || record.name || record.model || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: String(record.display_name || record.displayName || record.name || id).trim() || id,
      ownedBy: typeof record.owned_by === 'string' ? record.owned_by : undefined,
    });
    if (models.length >= MODEL_LIMIT) break;
  }
  return models;
}

module.exports = function createOpenAiCompatibleProvider({ loadSettings, saveSettings, safeStorage, net, crypto }) {
  const loadProfiles = () => {
    const value = loadSettings().aiProviderProfiles;
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
  };

  const decryptKey = profile => {
    const encoded = String(profile?.apiKeyEncrypted || '');
    if (!encoded) return '';
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('OS encryption is unavailable for API key storage.');
    }
    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      throw new Error('Stored API key could not be decrypted. Enter it again.');
    }
  };

  const encryptKey = key => {
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('API key cannot be stored because OS encryption is unavailable.');
    }
    return safeStorage.encryptString(key).toString('base64');
  };

  const publicProfile = profile => {
    const apiKey = profile.apiKeyEncrypted ? decryptKey(profile) : '';
    return {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model || '',
      protocol: PROTOCOL_CAPABILITIES[profile.protocol] ? profile.protocol : 'openai-compatible',
      capabilities: Array.isArray(profile.capabilities) && profile.capabilities.length
        ? profile.capabilities.filter(value => CAPABILITIES.includes(value))
        : ['text', 'vision'],
      hasApiKey: !!apiKey,
      apiKeyPreview: apiKey ? `••••••${apiKey.slice(-4)}` : '',
    };
  };

  const findProfile = id => loadProfiles().find(profile => profile.id === id);

  const resolveConnection = payload => {
    const stored = payload?.id ? findProfile(normalizeProfileId(payload.id)) : undefined;
    const baseUrl = normalizeBaseUrl(payload?.baseUrl || stored?.baseUrl);
    const apiKey = String(payload?.apiKey || '').trim() || (stored ? decryptKey(stored) : '');
    if (!apiKey) throw new Error('An API key is required to connect the provider.');
    return { baseUrl, apiKey };
  };

  const fetchModels = async payload => {
    const { baseUrl, apiKey } = resolveConnection(payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await net.fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        throw new Error('Kết nối tới Base URL quá hạn (Timeout sau 8s).');
      }
      const message = fetchError?.message || String(fetchError);
      if (message.includes('ERR_NAME_NOT_RESOLVED')) {
        throw new Error('Tên miền không tồn tại hoặc không thể phân giải DNS (ERR_NAME_NOT_RESOLVED).');
      }
      if (message.includes('ERR_CONNECTION_REFUSED')) {
        throw new Error('Máy chủ từ chối kết nối (ERR_CONNECTION_REFUSED).');
      }
      if (message.includes('ERR_INTERNET_DISCONNECTED')) {
        throw new Error('Không có kết nối mạng Internet.');
      }
      throw new Error(`Lỗi kết nối: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const errJson = JSON.parse(text);
        detail = errJson?.error?.message || errJson?.message || text;
      } catch {}
      throw new Error(`Provider phản hồi HTTP ${response.status}: ${redactSecret(detail, apiKey).slice(0, 200)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      throw new Error('Provider trả về dữ liệu không đúng định dạng JSON.');
    }
    const models = normalizeModels(parsed);
    if (!models.length) throw new Error('Provider kết nối được nhưng không tìm thấy model nào.');
    return { connected: true, baseUrl, models };
  };

  return {
    list() {
      const settings = loadSettings();
      const profiles = loadProfiles().map(publicProfile);
      const activeByCapability = {};
      for (const capability of CAPABILITIES) {
        const key = capability === 'text'
          ? settings.activeAiProviderProfileId
          : capability === 'vision'
            ? settings.activeVisionProviderProfileId || settings.activeAiProviderProfileId
            : settings[`active${capability === 'text-to-speech' ? 'Tts' : 'LipSync'}ProviderProfileId`];
        const active = profiles.find(profile => profile.id === key && profile.capabilities.includes(capability));
        activeByCapability[capability] = active?.id || '';
      }
      return { activeId: activeByCapability.text, activeByCapability, profiles };
    },
    save(payload = {}) {
      const profiles = loadProfiles();
      const id = normalizeProfileId(payload.id || `provider-${crypto.randomUUID().slice(0, 8)}`);
      const index = profiles.findIndex(profile => profile.id === id);
      if (index < 0 && profiles.length >= PROFILE_LIMIT) throw new Error(`Maximum ${PROFILE_LIMIT} AI providers reached.`);
      const previous = index >= 0 ? profiles[index] : undefined;
      const name = String(payload.name || previous?.name || '').trim().slice(0, 80);
      if (!name) throw new Error('Provider name is required.');
      const baseUrl = normalizeBaseUrl(payload.baseUrl || previous?.baseUrl);
      const model = String(payload.model || previous?.model || '').trim().slice(0, 200);
      if (!model) throw new Error('Provider model is required.');
      const protocol = PROTOCOL_CAPABILITIES[payload.protocol]
        ? payload.protocol
        : (previous?.protocol || 'openai-compatible');
      const allowedCapabilities = PROTOCOL_CAPABILITIES[protocol];
      const capabilityInput = Array.isArray(payload.capabilities)
        ? payload.capabilities
        : (previous?.capabilities || allowedCapabilities);
      const capabilities = [...new Set(capabilityInput.filter(value => allowedCapabilities.includes(value)))];
      if (!capabilities.length) throw new Error('Select at least one provider capability.');
      const key = String(payload.apiKey || '').trim();
      const profile = {
        id,
        name,
        baseUrl,
        model,
        protocol,
        capabilities,
        apiKeyEncrypted: key ? encryptKey(key) : previous?.apiKeyEncrypted || '',
      };
      if (!profile.apiKeyEncrypted) throw new Error('An API key is required when creating a provider.');
      if (index >= 0) profiles[index] = profile;
      else profiles.push(profile);
      const settings = loadSettings();
      saveSettings({
        aiProviderProfiles: profiles,
        activeAiProviderProfileId: settings.activeAiProviderProfileId || (capabilities.includes('text') ? id : ''),
        aiProvider: 'openai-compatible',
      });
      return publicProfile(profile);
    },
    remove(idValue) {
      const id = normalizeProfileId(idValue);
      const profiles = loadProfiles().filter(profile => profile.id !== id);
      const settings = loadSettings();
      const nextTextProfile = profiles.find(profile => (profile.capabilities || ['text', 'vision']).includes('text'));
      saveSettings({
        aiProviderProfiles: profiles,
        activeAiProviderProfileId: settings.activeAiProviderProfileId === id ? nextTextProfile?.id || '' : settings.activeAiProviderProfileId,
        activeVisionProviderProfileId: settings.activeVisionProviderProfileId === id ? '' : settings.activeVisionProviderProfileId,
        activeTtsProviderProfileId: settings.activeTtsProviderProfileId === id ? '' : settings.activeTtsProviderProfileId,
        activeLipSyncProviderProfileId: settings.activeLipSyncProviderProfileId === id ? '' : settings.activeLipSyncProviderProfileId,
      });
      return { removed: true };
    },
    setActive(idValue, capability = 'text') {
      const id = normalizeProfileId(idValue);
      if (!CAPABILITIES.includes(capability)) throw new Error('Unsupported provider capability.');
      const profile = findProfile(id);
      if (!profile || !(profile.capabilities || ['text', 'vision']).includes(capability)) {
        throw new Error('AI provider does not support this capability.');
      }
      const key = capability === 'text'
        ? 'activeAiProviderProfileId'
        : capability === 'vision'
          ? 'activeVisionProviderProfileId'
          : `active${capability === 'text-to-speech' ? 'Tts' : 'LipSync'}ProviderProfileId`;
      saveSettings({ [key]: id, aiProvider: 'openai-compatible' });
      return publicProfile(profile);
    },
    models: fetchModels,
    async test(payload) {
      const result = await fetchModels(payload);
      return { connected: true, baseUrl: result.baseUrl, modelCount: result.models.length };
    },
    getActiveRuntime(capability = 'text') {
      const settings = loadSettings();
      const profiles = loadProfiles();
      const key = capability === 'text'
        ? settings.activeAiProviderProfileId
        : capability === 'vision'
          ? settings.activeVisionProviderProfileId || settings.activeAiProviderProfileId
          : settings[`active${capability === 'text-to-speech' ? 'Tts' : 'LipSync'}ProviderProfileId`];
      const profile = profiles.find(item => item.id === key && (item.capabilities || ['text', 'vision']).includes(capability));
      if (!profile) return null;
      const apiKey = decryptKey(profile);
      if (!apiKey || !profile.model) return null;
      const normalizedBaseUrl = normalizeBaseUrl(profile.baseUrl);
      const serviceBaseUrl = capability === 'text-to-speech' || capability === 'lip-sync'
        ? normalizedBaseUrl.replace(/\/v1$/i, '')
        : normalizedBaseUrl;
      return {
        apiUrl: `${normalizedBaseUrl}/chat/completions`,
        apiBase: serviceBaseUrl,
        visionModel: profile.model,
        apiKeySet: true,
        apiKeyPreview: `••••••${apiKey.slice(-4)}`,
        apiKey,
        source: `openai-compatible:${profile.id}`,
        format: 'openai',
        capability,
        protocol: profile.protocol || 'openai-compatible',
      };
    },
  };
};

module.exports.normalizeBaseUrl = normalizeBaseUrl;
module.exports.normalizeModels = normalizeModels;
module.exports.isUnsafeIpLiteral = isUnsafeIpLiteral;
