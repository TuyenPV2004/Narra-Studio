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

const saved = provider.save({
  id: 'local-ai',
  name: 'Local AI',
  baseUrl: 'http://127.0.0.1:11434/v1/',
  apiKey: 'top-secret-key',
  model: 'model-a',
});
assert.equal(saved.id, 'local-ai');
assert.equal(saved.baseUrl, 'http://127.0.0.1:11434/v1');
assert.equal(saved.hasApiKey, true);
assert.equal(Object.hasOwn(saved, 'apiKey'), false);
assert.equal(JSON.stringify(settings).includes('top-secret-key'), false);

const list = provider.list();
assert.equal(list.activeId, 'local-ai');
assert.equal(list.profiles.length, 1);
assert.equal(Object.hasOwn(list.profiles[0], 'apiKeyEncrypted'), false);

provider.save({ id: 'local-ai', name: 'Local AI 2', baseUrl: saved.baseUrl, model: 'model-b' });
assert.equal(provider.getActiveRuntime().visionModel, 'model-b');

provider.models({ id: 'local-ai' }).then(result => {
  assert.deepEqual(result.models.map(model => model.id), ['model-a', 'model-b']);
  assert.equal(requests[0].url, 'http://127.0.0.1:11434/v1/models');
  assert.equal(requests[0].authorization, 'Bearer top-secret-key');
  provider.remove('local-ai');
  assert.equal(provider.list().profiles.length, 0);
  console.log('AI provider profile tests passed.');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
