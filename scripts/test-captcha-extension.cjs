'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const repositoryRoot = path.resolve(__dirname, '..');
const extensionRoot = path.join(repositoryRoot, 'apps', 'desktop', 'captcha-extension');

const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'Narra Captcha Bridge');
assert.equal(manifest.version, '1.3.1');
assert.deepEqual(manifest.permissions, ['scripting']);
assert.deepEqual(manifest.host_permissions, ['https://labs.google/*']);
assert.equal(manifest.background.service_worker, 'background.js');
assert.equal(manifest.background.type, undefined);

const protocolContext = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(extensionRoot, 'protocol.js'), 'utf8'),
  protocolContext,
  {filename: 'protocol.js'},
);
const protocol = protocolContext.NarraCaptchaProtocol;
assert.ok(protocol);
assert.equal(protocol.VERSION, '1.3.1');
assert.deepEqual([...protocol.ALLOWED_ACTIONS], ['IMAGE_GENERATION', 'VIDEO_GENERATION', 'TEST']);
assert.deepEqual(
  {...protocol.validateCaptchaRequest({type: 'captcha_request', id: 7, action: 'IMAGE_GENERATION'})},
  {id: 7, action: 'IMAGE_GENERATION'},
);
assert.throws(
  () => protocol.validateCaptchaRequest({type: 'captcha_request', id: 7, action: 'ARBITRARY'}),
  /Unsupported CAPTCHA action/,
);
assert.throws(
  () => protocol.validateCaptchaRequest({type: 'captcha_request', id: 0, action: 'TEST'}),
  /Invalid CAPTCHA request id/,
);
assert.equal(protocol.parseBridgeMessage('{"type":"ping","t":1}').type, 'ping');
assert.equal(protocol.parseBridgeMessage('not json'), null);
assert.equal(protocol.parseBridgeMessage('[]'), null);
const safeError = protocol.toSafeError(new Error('secret page detail'));
assert.equal(safeError.includes('secret page detail'), false);
assert.equal(safeError.length <= 160, true);

function loadPageTokenContext({scriptUrls, grecaptcha}) {
  const context = vm.createContext({
    URL,
    clearTimeout,
    setTimeout,
    document: {
      querySelectorAll() {
        return scriptUrls.map(src => ({src}));
      },
    },
    grecaptcha,
  });
  vm.runInContext(
    fs.readFileSync(path.join(extensionRoot, 'page-token.js'), 'utf8'),
    context,
    {filename: 'page-token.js'},
  );
  return context.NarraCaptchaPageToken;
}

async function testPageTokenHelper() {
  const executeCalls = [];
  const expectedToken = 'token-value-that-is-longer-than-twenty-characters';
  const helper = loadPageTokenContext({
    scriptUrls: ['https://www.google.com/recaptcha/enterprise.js?render=site-key'],
    grecaptcha: {
      enterprise: {
        ready(callback) { callback(); },
        async execute(siteKey, options) {
          executeCalls.push({siteKey, options});
          return expectedToken;
        },
      },
    },
  });
  assert.equal(await helper.requestToken('TEST'), expectedToken);
  assert.deepEqual(
    executeCalls.map(call => ({siteKey: call.siteKey, action: call.options.action})),
    [{siteKey: 'site-key', action: 'TEST'}],
  );

  const missingRuntimeHelper = loadPageTokenContext({
    scriptUrls: ['https://www.google.com/recaptcha/enterprise.js?render=site-key'],
    grecaptcha: undefined,
  });
  await assert.rejects(
    () => missingRuntimeHelper.requestToken('TEST'),
    /reCAPTCHA runtime unavailable/,
  );

  const missingKeyHelper = loadPageTokenContext({
    scriptUrls: [],
    grecaptcha: {enterprise: {ready() {}, execute() {}}},
  });
  await assert.rejects(
    () => missingKeyHelper.requestToken('TEST'),
    /reCAPTCHA site key unavailable/,
  );
}

function createChromeEvent() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
  };
}

async function testBackgroundWorker() {
  const sockets = [];
  const scriptCalls = [];
  const timers = [];
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(payload) { this.sent.push(JSON.parse(payload)); }
    close() { this.closed = true; }
    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }
  const tabEvents = {
    onActivated: createChromeEvent(),
    onCreated: createChromeEvent(),
    onRemoved: createChromeEvent(),
    onUpdated: createChromeEvent(),
  };
  const projectTab = {
    id: 42,
    active: true,
    url: 'https://labs.google/fx/vi/tools/flow/project/project-id',
  };
  const chrome = {
    tabs: {
      ...tabEvents,
      async query() { return [projectTab]; },
    },
    scripting: {
      async executeScript(options) {
        scriptCalls.push(options);
        if (options.files) return [];
        return [{frameId: 0, result: 'worker-token-that-is-longer-than-twenty-characters'}];
      },
    },
  };
  const context = vm.createContext({
    URL,
    WebSocket: FakeWebSocket,
    chrome,
    clearTimeout() {},
    setTimeout(callback, delay) {
      timers.push({callback, delay});
      return timers.length;
    },
    importScripts(...files) {
      for (const file of files) {
        vm.runInContext(
          fs.readFileSync(path.join(extensionRoot, file), 'utf8'),
          context,
          {filename: file},
        );
      }
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8'),
    context,
    {filename: 'background.js'},
  );

  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://127.0.0.1:17773');
  sockets[0].open();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets[0].sent[0].type, 'hello');
  assert.equal(sockets[0].sent[0].version, '1.3.1');
  assert.equal(sockets[0].sent[1].type, 'status');
  assert.equal(sockets[0].sent[1].labsProjectOpen, true);

  sockets[0].onmessage({data: JSON.stringify({type: 'ping', t: 9})});
  assert.deepEqual(sockets[0].sent.at(-1), {type: 'pong', t: 9});

  sockets[0].onmessage({
    data: JSON.stringify({type: 'captcha_request', id: 11, action: 'TEST'}),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scriptCalls[0].world, 'MAIN');
  assert.deepEqual([...scriptCalls[0].files], ['page-token.js']);
  assert.equal(scriptCalls[1].world, 'MAIN');
  assert.deepEqual([...scriptCalls[1].args], ['TEST']);
  assert.deepEqual(sockets[0].sent.at(-1), {
    type: 'captcha_response',
    id: 11,
    token: 'worker-token-that-is-longer-than-twenty-characters',
  });

  sockets[0].onmessage({
    data: JSON.stringify({type: 'captcha_request', id: 12, action: 'ARBITRARY'}),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sockets[0].sent.at(-1), {
    type: 'captcha_response',
    id: 12,
    error: 'Token request failed',
  });
  assert.equal(scriptCalls.length, 2);

  const firstSocket = sockets[0];
  firstSocket.onclose();
  assert.equal(timers[0].delay, 1000);
  timers[0].callback();
  assert.equal(sockets.length, 2);
  const replacementSocket = sockets[1];
  firstSocket.onerror();
  assert.equal(replacementSocket.closed, undefined);
}

function testExtensionDirectoryResolution() {
  const {findExtensionDirectory} = require('../apps/desktop/src/electron/ipc/flow/extension-directory');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'narra-extension-directory-'));
  const emptyDir = path.join(temporary, 'empty');
  const oldDir = path.join(temporary, 'old');
  const validDir = path.join(temporary, 'valid');
  fs.mkdirSync(emptyDir);
  fs.mkdirSync(oldDir);
  fs.mkdirSync(validDir);
  fs.writeFileSync(path.join(oldDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Narra Captcha Bridge',
    version: '1.2.9',
  }));
  fs.writeFileSync(path.join(validDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Narra Captcha Bridge',
    version: '1.3.1',
  }));
  try {
    assert.equal(findExtensionDirectory({
      fs, path, candidates: [emptyDir], requiredVersion: '1.3.1',
    }), null);
    assert.equal(findExtensionDirectory({
      fs, path, candidates: [oldDir], requiredVersion: '1.3.1',
    }), null);
    assert.equal(findExtensionDirectory({
      fs, path, candidates: [emptyDir, validDir], requiredVersion: '1.3.1',
    }), validDir);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

function testSetupUsesBundledExtension() {
  const setupAsset = fs.readFileSync(
    path.join(
      repositoryRoot,
      'apps', 'desktop', 'src', 'renderer-source', 'pages', 'CaptchaSetup',
      'CaptchaSetupPage.tsx',
    ),
    'utf8',
  );
  assert.equal(setupAsset.includes('captcha-extension.zip'), false);
  assert.equal(setupAsset.includes('endpoints.updatesBase'), false);
  assert.equal(setupAsset.includes('captchaApi.openExtensionFolder()'), true);
  const captchaAdapter = fs.readFileSync(
    path.join(repositoryRoot, 'apps', 'desktop', 'src', 'renderer-source', 'services', 'electron-api', 'captcha.ts'),
    'utf8',
  );
  assert.equal(captchaAdapter.includes("getElectronApi().openExtensionFolder()"), true);
  assert.equal(setupAsset.includes('Download Extension (.zip)'), false);
  assert.equal(setupAsset.includes('Mở thư mục Extension'), true);
  assert.equal(/>\s*Tải Extension\s*</u.test(setupAsset), false);
  assert.equal(/>\s*Mở thư mục\s*</u.test(setupAsset), false);
  assert.equal(/[ÃÂÆÄ]|áº|á»/u.test(setupAsset), false);
}

(async () => {
  await testPageTokenHelper();
  await testBackgroundWorker();
  testExtensionDirectoryResolution();
  testSetupUsesBundledExtension();
  console.log('Captcha extension tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
