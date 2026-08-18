'use strict';

const assert = require('node:assert/strict');
const createProvider = require('../apps/desktop/src/electron/providers/openai-compatible');

let settings = {};
const requests = [];
const provider = createProvider({
  loadSettings: () => settings,
  saveSettings: patch => { settings = { ...settings, ...patch }; },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: value => value.toString('utf8').replace(/^encrypted:/, ''),
  },
  crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
  net: {
    fetch: async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b', owned_by: 'local' }] }),
      };
    },
  },
});

assert.throws(
  () => provider.save({ name: 'Unsafe', baseUrl: 'http://example.com/v1', apiKey: 'secret', model: 'model-a' }),
  /HTTPS/,
);
assert.throws(
  () => provider.save({ name: 'Embedded', baseUrl: 'https://user:pass@example.com/v1', apiKey: 'secret', model: 'model-a' }),
  /credentials/,
);
assert.throws(
  () => provider.save({ name: 'Private', baseUrl: 'https://192.168.1.20/v1', apiKey: 'secret', model: 'model-a' }),
  /private or link-local/,
);
assert.throws(
  () => provider.save({ name: 'Metadata', baseUrl: 'https://169.254.169.254/v1', apiKey: 'secret', model: 'model-a' }),
  /private or link-local/,
);
assert.throws(
  () => provider.save({ name: 'BadPath', baseUrl: 'https://provider.example/v1/models', apiKey: 'secret', model: 'model-a' }),
  /API root/,
);
assert.throws(
  () => provider.save({ name: 'No model', baseUrl: 'https://provider.example/v1', apiKey: 'secret' }),
  /model is required/,
);
assert.throws(
  () => provider.save({ name: 'Wrong protocol', baseUrl: 'https://tts.example/v1', apiKey: 'secret', model: 'voice', protocol: 'narra-tts-v1', capabilities: ['text'] }),
  /at least one provider capability/,
);

const saved = provider.save({
  id: 'local-ai',
  name: 'Local AI',
  baseUrl: 'http://127.0.0.1:11434/v1/',
  apiKey: 'top-secret-key',
  model: 'model-a',
  protocol: 'openai-compatible',
  capabilities: ['text', 'vision'],
});
assert.equal(saved.id, 'local-ai');
assert.equal(saved.baseUrl, 'http://127.0.0.1:11434/v1');
assert.equal(saved.hasApiKey, true);
assert.deepEqual(saved.capabilities, ['text', 'vision']);
assert.equal(saved.protocol, 'openai-compatible');
assert.equal(Object.hasOwn(saved, 'apiKey'), false);
assert.equal(JSON.stringify(settings).includes('top-secret-key'), false);

const list = provider.list();
assert.equal(list.activeId, 'local-ai');
assert.equal(list.profiles.length, 1);
assert.equal(Object.hasOwn(list.profiles[0], 'apiKeyEncrypted'), false);

provider.save({ id: 'local-ai', name: 'Local AI 2', baseUrl: saved.baseUrl, model: 'model-b' });
assert.equal(provider.getActiveRuntime().visionModel, 'model-b');
provider.setActive('local-ai', 'vision');
assert.equal(provider.list().activeByCapability.vision, 'local-ai');

const tts = provider.save({
  id: 'custom-tts',
  name: 'Custom TTS',
  baseUrl: 'https://tts.example/v1',
  apiKey: 'tts-secret',
  model: 'voice-model',
  protocol: 'narra-tts-v1',
  capabilities: ['text-to-speech'],
});
provider.setActive(tts.id, 'text-to-speech');
assert.equal(provider.list().activeByCapability['text-to-speech'], tts.id);
assert.equal(provider.getActiveRuntime('text-to-speech').visionModel, 'voice-model');
assert.equal(provider.getActiveRuntime('text-to-speech').apiBase, 'https://tts.example');
assert.throws(() => provider.setActive(tts.id, 'text'), /does not support/);

const lipSync = provider.save({
  id: 'custom-lip',
  name: 'Custom Lip Sync',
  baseUrl: 'https://sync.example/v1',
  apiKey: 'sync-secret',
  model: 'sync-model',
  protocol: 'sync-v2',
  capabilities: ['lip-sync'],
});
provider.setActive(lipSync.id, 'lip-sync');
assert.equal(provider.list().activeByCapability['lip-sync'], lipSync.id);
assert.equal(provider.getActiveRuntime('lip-sync').apiBase, 'https://sync.example');

provider.models({ id: 'local-ai' }).then(result => {
  assert.deepEqual(result.models.map(model => model.id), ['model-a', 'model-b']);
  assert.equal(requests[0].url, 'http://127.0.0.1:11434/v1/models');
  assert.equal(requests[0].authorization, 'Bearer top-secret-key');
  provider.remove('local-ai');
  provider.remove('custom-tts');
  provider.remove('custom-lip');
  assert.equal(provider.list().profiles.length, 0);
  assert.equal(provider.list().activeByCapability['text-to-speech'], '');
  assert.equal(provider.list().activeByCapability['lip-sync'], '');
  console.log('AI provider profile tests passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
