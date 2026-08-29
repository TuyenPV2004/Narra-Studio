(function injectMainWorld() {
  function _inject() {
    try {
      const code = `
        (function() {
          try {
            const ua = navigator.userAgent || '';
            let plat = 'win32';
            if (/Windows/i.test(ua)) plat = 'win32';
            else if (/Mac/i.test(ua)) plat = 'darwin';
            else if (/Linux/i.test(ua)) plat = 'linux';
            const cm = ua.match(/Chrome\\/(\\d+)/);
            const chromeMajor = cm ? cm[1] : '130';
            const ver = chromeMajor + '.0.0.0';
            let osPart = 'Windows NT 10.0; Win64; x64';
            if (plat === 'darwin') osPart = 'Macintosh; Intel Mac OS X 10_15_7';
            else if (plat === 'linux') osPart = 'X11; Linux x86_64';
            const cleanUA = 'Mozilla/5.0 (' + osPart + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + ver + ' Safari/537.36';
            const platName = plat === 'darwin' ? 'macOS' : (plat === 'linux' ? 'Linux' : 'Windows');
            const proto = Object.getPrototypeOf(navigator);
            try { Object.defineProperty(proto, 'userAgent', { get: () => cleanUA, configurable: true }); } catch (e) {}
            try { Object.defineProperty(proto, 'appVersion', { get: () => cleanUA.replace('Mozilla/', ''), configurable: true }); } catch (e) {}
            try { Object.defineProperty(proto, 'platform', { get: () => plat === 'darwin' ? 'MacIntel' : (plat === 'linux' ? 'Linux x86_64' : 'Win32'), configurable: true }); } catch (e) {}
            const fakeUAD = {
              brands: [
                { brand: 'Chromium', version: chromeMajor },
                { brand: 'Google Chrome', version: chromeMajor },
                { brand: 'Not.A/Brand', version: '8' },
              ],
              mobile: false, platform: platName,
              getHighEntropyValues: () => Promise.resolve({
                architecture: 'x86', bitness: '64', model: '',
                platformVersion: plat === 'win32' ? '15.0.0' : (plat === 'darwin' ? '14.0.0' : ''),
                uaFullVersion: ver,
                fullVersionList: [
                  { brand: 'Chromium', version: ver },
                  { brand: 'Google Chrome', version: ver },
                  { brand: 'Not.A/Brand', version: '8.0.0.0' },
                ],
                platform: platName, mobile: false,
              }),
              toJSON: () => ({ brands: [{ brand: 'Chromium', version: chromeMajor }], mobile: false, platform: platName }),
            };
            try { Object.defineProperty(proto, 'userAgentData', { get: () => fakeUAD, configurable: true }); } catch (e) {}
            try { Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true }); } catch (e) {}
            try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true }); } catch (e) {}
            try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true }); } catch (e) {}
            try {
              window.chrome = window.chrome || {};
              window.chrome.app = window.chrome.app || { isInstalled: false, getDetails: () => null, runningState: () => 'cannot_run' };
              window.chrome.runtime = window.chrome.runtime || {
                OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', UPDATE: 'update', SHARED_MODULE_UPDATE: 'shared_module_update' },
                PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64' },
                connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
                sendMessage: () => {}, id: undefined,
              };
              window.chrome.loadTimes = window.chrome.loadTimes || (() => ({ requestTime: Date.now()/1000, startLoadTime: Date.now()/1000, commitLoadTime: Date.now()/1000, finishDocumentLoadTime: Date.now()/1000, finishLoadTime: Date.now()/1000, firstPaintTime: Date.now()/1000, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' }));
              window.chrome.csi = window.chrome.csi || (() => ({ onloadT: Date.now(), startE: Date.now(), pageT: 0, tran: 15 }));
            } catch (e) {}
            try { delete window.module; delete window.exports; delete window.require; } catch (e) {}
          } catch (e) { console.warn('[anti-detect mainworld] err:', e); }
        })();
      `;
      const s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {}
  }
  if (document.documentElement) _inject();
  else document.addEventListener('readystatechange', _inject, { once: true });
})();

(function patchUA() {
  let plat = 'win32';
  let chromeMajor = '130';
  try { if (typeof process !== 'undefined') { plat = process.platform || plat; chromeMajor = ((process.versions && process.versions.chrome) || '130.0.0.0').split('.')[0]; } } catch (e) {}

  if (typeof process === 'undefined') {
    const ua = navigator.userAgent || '';
    const cm = ua.match(/Chrome\/(\d+)/); if (cm) chromeMajor = cm[1];
    if (/Windows/i.test(ua)) plat = 'win32';
    else if (/Mac/i.test(ua)) plat = 'darwin';
    else if (/Linux/i.test(ua)) plat = 'linux';
  }
  const ver = chromeMajor + '.0.0.0';
  let osPart = 'Windows NT 10.0; Win64; x64';
  if (plat === 'darwin') osPart = 'Macintosh; Intel Mac OS X 10_15_7';
  else if (plat === 'linux') osPart = 'X11; Linux x86_64';
  const cleanUA = 'Mozilla/5.0 (' + osPart + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + ver + ' Safari/537.36';
  const platName = plat === 'darwin' ? 'macOS' : (plat === 'linux' ? 'Linux' : 'Windows');

  const proto = Object.getPrototypeOf(navigator);
  try { Object.defineProperty(proto, 'userAgent', { get: () => cleanUA, configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'userAgent', { get: () => cleanUA, configurable: true }); } catch (e) {}
  try { Object.defineProperty(proto, 'appVersion', { get: () => cleanUA.replace('Mozilla/', ''), configurable: true }); } catch (e) {}
  try { Object.defineProperty(navigator, 'appVersion', { get: () => cleanUA.replace('Mozilla/', ''), configurable: true }); } catch (e) {}

  try {
    const fakeUAD = {
      brands: [
        { brand: 'Chromium', version: chromeMajor },
        { brand: 'Google Chrome', version: chromeMajor },
        { brand: 'Not.A/Brand', version: '8' },
      ],
      mobile: false,
      platform: platName,
      getHighEntropyValues: () => Promise.resolve({
        architecture: 'x86', bitness: '64', model: '',
        platformVersion: plat === 'win32' ? '15.0.0' : (plat === 'darwin' ? '14.0.0' : ''),
        uaFullVersion: ver,
        fullVersionList: [
          { brand: 'Chromium', version: ver },
          { brand: 'Google Chrome', version: ver },
          { brand: 'Not.A/Brand', version: '8.0.0.0' },
        ],
        platform: platName, mobile: false,
      }),
      toJSON: () => ({ brands: [{ brand: 'Chromium', version: chromeMajor }], mobile: false, platform: platName }),
    };
    Object.defineProperty(proto, 'userAgentData', { get: () => fakeUAD, configurable: true });
    Object.defineProperty(navigator, 'userAgentData', { get: () => fakeUAD, configurable: true });
  } catch (e) {}
})();

Object.defineProperty(navigator, 'webdriver', {
  get: () => false,
  configurable: true,
});

if (!window.chrome) {
  window.chrome = {
    runtime: {
      id: undefined,
      connect: () => {},
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onConnect: { addListener: () => {}, removeListener: () => {} },
      lastError: null,
    },
    app: {
      isInstalled: false,
      getDetails: () => null,
      runningState: () => 'cannot_run',
    },
    loadTimes: () => ({
      requestTime: Date.now() / 1000,
      startLoadTime: Date.now() / 1000,
      commitLoadTime: Date.now() / 1000,
      finishDocumentLoadTime: Date.now() / 1000,
      finishLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: false,
      npnNegotiatedProtocol: 'http/1.1',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'http/1.1',
    }),
    csi: () => ({
      startE: Date.now(),
      onloadT: Date.now(),
      pageT: Math.random() * 3000 + 500,
      tran: 15,
    }),
  };
}

const pluginData = [
  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
  { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
];

try {
  const fakePlugins = Object.create(PluginArray.prototype);
  pluginData.forEach((p, i) => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperty(plugin, 'name', { get: () => p.name });
    Object.defineProperty(plugin, 'filename', { get: () => p.filename });
    Object.defineProperty(plugin, 'description', { get: () => p.description });
    Object.defineProperty(plugin, 'length', { get: () => 0 });
    fakePlugins[i] = plugin;
  });
  Object.defineProperty(fakePlugins, 'length', { get: () => pluginData.length });

  Object.defineProperty(navigator, 'plugins', {
    get: () => fakePlugins,
    configurable: true,
  });
} catch (e) {  }

try {
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true,
  });
} catch (e) {  }

if (navigator.permissions && navigator.permissions.query) {
  const originalQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (params) => {
    if (params && params.name === 'notifications') {
      return Promise.resolve({ state: 'prompt', onchange: null });
    }
    return originalQuery(params);
  };
}

try {
  delete window.module;
  delete window.exports;
  delete window.require;
} catch (e) {  }

console.debug('[anti-detect] Fingerprint overrides applied ✅');
