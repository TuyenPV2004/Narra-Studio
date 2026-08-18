'use strict';

const { brand } = require('./brand');

module.exports = function createCaptchaRuntime(dependencies) {
  const {
    app,
    BrowserWindow,
    ipcMain,
    session,
    clipboard,
    protocol,
    net,
    shell,
    dialog,
    path,
    https,
    http,
    fs,
    os,
    crypto,
    pathToFileURL,
    fileURLToPath,
    captchaBridge,
    runtime,
    getFfmpegBin,
    maybePromoteFilterComplexToScript,
    logFfmpegSpawnDiagnostics,
    truncatePreview,
    SESSION_PARTITION,
    MAX_SLOTS,
    isDev,
    SETTINGS_FILE,
    loadSettings,
    saveSettings,
    getVideoOutputDir,
    getImageOutputDir,
    getNextFilename,
    buildCleanUserAgent,
    DEFAULTS,
    accountSlots,
    capturedAuth,
    getSlot,
    slotRequestCounts,
    markSlotBusy,
    markSlotFree,
    pickRandomSlot,
    refreshCapturedCookies,
    fetchSlotSession,
    clearSlotSessionData,
    fetchSlotEmail,
    createWindow,
    setupRequestInterception,
    getPlatformChHint,
    getChromeMajorVersion,
    buildHeaders,
    generateUUID,
    DRYRUN_FLAG_FILE,
    DRYRUN_CAPTURE_FILE,
    isDryRunActive,
    makeApiRequest,
    RECAPTCHA_SITE_KEY,
    findFlowWebview,
    setActiveWebviewSlot,
  } = dependencies;

// ── Persistent Real Chrome for Captcha ───────────────────────────────
// Mo Google Chrome THAT 1 lan khi app start, giu nguyen suot session.
// Inject warning overlay de user khong dong.
// Moi lan can captcha chi execute grecaptcha trong Chrome da chay san.

let chromeProc = null;   // Chrome process handle
let chromeCdp = null;    // Active CDP client
let chromeReady = false; // True khi labs.google da load
function getChromeRuntime() { return { chromeProc, chromeCdp, chromeReady }; }

function findChromePath() {
  const home = os.homedir();
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const paths = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Windows
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    path.join(programFilesX86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/brave-browser',
    '/usr/bin/microsoft-edge',
  ];
  return paths.find(p => { try { fs.accessSync(p); return true; } catch (e) { return false; } }) || null;
}

function httpGetJson(port, urlPath) {
  const http = require('http');
  return new Promise((res, rej) => {
    const req = http.get('http://127.0.0.1:' + port + urlPath, (resp) => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.setTimeout(3000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

async function createCdpClient(wsUrl) {
  const net = require('net');
  const crypto = require('crypto');
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl);
    const sock = net.connect(+url.port || 9222, '127.0.0.1');
    const wsKey = crypto.randomBytes(16).toString('base64');
    sock.once('connect', () => {
      sock.write(
        'GET ' + url.pathname + ' HTTP/1.1\r\nHost: 127.0.0.1:' + url.port + '\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + wsKey + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    const pending = {};
    let cmdId = 0, buf = Buffer.alloc(0), upgraded = false;
    function parseFrames() {
      while (buf.length >= 2) {
        let offset = 2, len = buf[1] & 0x7F;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); offset = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
        if (buf.length < offset + len) return;
        const payload = buf.slice(offset, offset + len).toString();
        buf = buf.slice(offset + len);
        try {
          const msg = JSON.parse(payload);
          if (msg.id && pending[msg.id]) {
            const cb = pending[msg.id]; clearTimeout(cb.timer); delete pending[msg.id];
            if (msg.error) cb.rej(new Error(msg.error.message || JSON.stringify(msg.error)));
            else cb.res(msg.result);
          }
        } catch (e) { }
      }
    }
    sock.on('data', (data) => {
      if (!upgraded) {
        const str = data.toString();
        // Chrome returns "101 WebSocket Protocol Handshake" (not "101 Switching Protocols")
        if (str.includes('101')) {
          upgraded = true;
          // Find end of HTTP headers (\r\n\r\n or \r\r\n\r\r\n in Chrome)
          let hEnd = data.indexOf('\r\n\r\n');
          if (hEnd === -1) hEnd = data.indexOf('\r\r\n\r\r\n');
          if (hEnd !== -1) {
            // Skip past the header terminator
            const skip = data.indexOf('\r\n\r\n') !== -1 ? 4 : 7;
            buf = data.slice(hEnd + skip);
            if (buf.length > 0) parseFrames();
          }
        }
        return;
      }
      buf = Buffer.concat([buf, data]); parseFrames();
    });
    sock.on('error', reject);
    sock.on('close', () => Object.values(pending).forEach(cb => { clearTimeout(cb.timer); cb.rej(new Error('CDP closed')); }));
    function send(method, params) {
      params = params || {};
      const id = ++cmdId;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => { delete pending[id]; rej(new Error('CDP timeout: ' + method)); }, 35000);
        pending[id] = { res, rej, timer };
        const body = JSON.stringify({ id, method, params });
        const bodyBuf = Buffer.from(body);
        const mask = crypto.randomBytes(4);
        const masked = Buffer.alloc(bodyBuf.length);
        for (let i = 0; i < bodyBuf.length; i++) masked[i] = bodyBuf[i] ^ mask[i % 4];
        let hdr;
        if (bodyBuf.length < 126) hdr = Buffer.from([0x81, 0x80 | bodyBuf.length, mask[0], mask[1], mask[2], mask[3]]);
        else { hdr = Buffer.alloc(8); hdr[0] = 0x81; hdr[1] = 0xFE; hdr.writeUInt16BE(bodyBuf.length, 2); mask.copy(hdr, 4); }
        sock.write(Buffer.concat([hdr, masked]));
      });
    }
    const upCheck = setInterval(() => {
      if (upgraded) { clearInterval(upCheck); resolve({ send, close: () => sock.destroy() }); }
    }, 50);
    setTimeout(() => { clearInterval(upCheck); if (!upgraded) reject(new Error('WS upgrade timeout')); }, 12000);
  });
}

async function injectChromeWarningOverlay() {
  if (!chromeCdp) return;
  try {
    await getChromeRuntime().chromeCdp.send('Runtime.evaluate', {
      expression: `(function() {
        if (document.getElementById('veo3-warn')) return;
        var appName = ${JSON.stringify(brand.displayName)};
        var el = document.createElement('div');
        el.id = 'veo3-warn';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
          'background:linear-gradient(90deg,#0f0c29,#302b63);color:#fff;' +
          'font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;' +
          'padding:10px 16px;display:flex;align-items:center;gap:10px;' +
          'box-shadow:0 2px 12px rgba(0,0,0,0.6);border-bottom:2px solid #6c63ff';
        el.innerHTML = '<span style="font-size:18px">🔐</span>' +
          '<span><b style="color:${brand.theme.primary}">' + appName + '</b> dang dung cua so nay de tao hinh — ' +
          '<b style="color:#f87171">KHONG DUOC DONG!</b></span>' +
          '<span style="margin-left:auto;background:#6c63ff;padding:3px 10px;border-radius:20px;font-size:11px">DANG HOAT DONG</span>';
        document.documentElement.insertBefore(el, document.documentElement.firstChild);
        window.onbeforeunload = function() { return appName + ' dang su dung cua so nay!'; };
      })()`,
      returnByValue: false,
    });
    console.log('[CHROME-CDP] Warning overlay injected');
  } catch (e) { console.warn('[CHROME-CDP] Overlay warn:', e.message); }
}

async function startPersistentChrome() {
  const { spawn } = require('child_process');
  const os = require('os');
  const chromePath = findChromePath();
  if (!chromePath) {
    console.warn('[CHROME-CDP] Chrome not found on this system');
    return;
  }
  const debugPort = 19773;
  const tmpDir = path.join(app.getPath('userData'), 'captcha-chrome');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) { }

  console.log('[CHROME-CDP] Starting persistent Chrome:', chromePath.split('/').pop());
  chromeProc = spawn(chromePath, [
    '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + tmpDir,
    '--no-first-run', '--no-default-browser-check',
    'https://labs.google/fx/tools/flow',
  ], { detached: false, stdio: 'ignore' });

  chromeProc.on('error', (e) => { console.error('[CHROME-CDP] Error:', e.message); chromeProc = null; chromeCdp = null; chromeReady = false; });
  chromeProc.on('exit', () => { console.warn('[CHROME-CDP] Chrome exited'); chromeProc = null; chromeCdp = null; chromeReady = false; });

  await new Promise(r => setTimeout(r, 3500));
  let tabs = null;
  for (let i = 0; i < 15; i++) {
    try { tabs = await httpGetJson(debugPort, '/json'); if (tabs && tabs.length > 0) break; } catch (e) { }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!tabs || tabs.length === 0) { console.error('[CHROME-CDP] Cannot connect to Chrome'); return; }

  const tab = tabs.find(t => t.type === 'page') || tabs[0];
  chromeCdp = await createCdpClient(tab.webSocketDebuggerUrl);
  // Note: NOT calling Runtime.enable — it's the #1 reCAPTCHA detection signal.
  // Runtime.evaluate works without it; we just lose console/context events.
  await getChromeRuntime().chromeCdp.send('Page.enable');

  // Stealth: patch navigator + chrome runtime before any page script runs
  // Matches puppeteer-extra-plugin-stealth evasions (chrome.app, chrome.csi,
  // chrome.loadTimes, chrome.runtime with PlatformOs, navigator.permissions,
  // navigator.webdriver, plugins, languages, WebGL, iframe.contentWindow).
  const stealthScript = `
    (function() {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const arr = [
              { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            ];
            arr.item = (i) => arr[i];
            arr.namedItem = (n) => arr.find(p => p.name === n);
            arr.refresh = () => {};
            return arr;
          },
          configurable: true,
        });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'mimeTypes', {
          get: () => {
            const arr = [{ type: 'application/pdf', suffixes: 'pdf', description: '' }];
            arr.item = (i) => arr[i];
            arr.namedItem = (n) => arr.find(m => m.type === n);
            return arr;
          },
          configurable: true,
        });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
      } catch (e) {}
      // window.chrome with all sub-objects
      window.chrome = window.chrome || {};
      window.chrome.app = window.chrome.app || {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function() { return null; },
        getIsInstalled: function() { return false; },
        installState: function() { return 'not_installed'; },
        runningState: function() { return 'cannot_run'; },
      };
      window.chrome.csi = window.chrome.csi || function() {
        return { onloadT: Date.now(), startE: Date.now(), pageT: 0, tran: 15 };
      };
      window.chrome.loadTimes = window.chrome.loadTimes || function() {
        return {
          requestTime: Date.now() / 1000 - 100,
          startLoadTime: Date.now() / 1000 - 99,
          commitLoadTime: Date.now() / 1000 - 98,
          finishDocumentLoadTime: Date.now() / 1000 - 97,
          finishLoadTime: Date.now() / 1000 - 96,
          firstPaintTime: Date.now() / 1000 - 95,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
      // chrome.runtime — the critical one for reCAPTCHA
      window.chrome.runtime = window.chrome.runtime || {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect: function() { return { onMessage: { addListener: function() {} }, postMessage: function() {}, disconnect: function() {} }; },
        sendMessage: function() {},
        getManifest: function() { return undefined; },
        id: undefined,
      };
      // navigator.permissions consistency
      try {
        const origPerm = navigator.permissions && navigator.permissions.query;
        if (origPerm) {
          navigator.permissions.query = (p) => p && p.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origPerm.call(navigator.permissions, p);
        }
      } catch (e) {}
      // WebGL vendor/renderer spoof
      try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(p) {
          if (p === 37445) return 'Google Inc. (Intel)';
          if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return getParameter.call(this, p);
        };
      } catch (e) {}
      // iframe.contentWindow — patch HTMLIFrameElement.prototype.contentWindow
      try {
        const iframe = HTMLIFrameElement.prototype;
        const orig = Object.getOwnPropertyDescriptor(iframe, 'contentWindow');
        if (orig && orig.get) {
          Object.defineProperty(iframe, 'contentWindow', {
            get: function() {
              const w = orig.get.call(this);
              if (w) {
                try {
                  if (w.chrome === undefined || !w.chrome.runtime) w.chrome = window.chrome;
                } catch (e) {}
              }
              return w;
            },
            configurable: true,
          });
        }
      } catch (e) {}
      // Notification permission consistency
      try {
        if (window.Notification && Notification.permission === 'denied') {
          Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
        }
      } catch (e) {}
    })();
  `;
  try {
    await getChromeRuntime().chromeCdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stealthScript });
    await getChromeRuntime().chromeCdp.send('Runtime.evaluate', { expression: stealthScript });
    console.log('[CHROME-CDP] Stealth patches installed');
  } catch (e) {
    console.warn('[CHROME-CDP] Stealth patch failed:', e.message);
  }

  // Wait for labs.google
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await getChromeRuntime().chromeCdp.send('Runtime.evaluate', {
        expression: '({ onLabs: location.href.includes("labs.google"), state: document.readyState })',
        returnByValue: true,
      });
      const v = r && r.result && r.result.value;
      if (v && v.onLabs && (v.state === 'complete' || v.state === 'interactive')) {
        chromeReady = true;
        console.log('[CHROME-CDP] labs.google ready!');
        break;
      }
      if (i % 5 === 0) console.log('[CHROME-CDP] Waiting for labs.google... #' + i);
    } catch (e) { }
  }


  await injectChromeWarningOverlay();
}

async function getCaptchaFromChrome(captchaAction = 'IMAGE_GENERATION') {
  // Ensure Chrome is running
  if (!chromeCdp || !chromeReady) {
    console.log('[CHROME-CDP] Not ready, starting...');
    await startPersistentChrome();
    if (!chromeCdp) throw new Error('Cannot start Chrome');
  }

  // Verify still on labs.google
  try {
    const r = await getChromeRuntime().chromeCdp.send('Runtime.evaluate', {
      expression: '({ onLabs: location.href.includes("labs.google"), state: document.readyState })',
      returnByValue: true,
    });
    const v = r && r.result && r.result.value;
    if (!v || !v.onLabs) {
      console.log('[CHROME-CDP] Navigating back to labs.google...');
      await getChromeRuntime().chromeCdp.send('Page.navigate', { url: 'https://labs.google/fx/tools/flow' });
      await new Promise(r => setTimeout(r, 4000));
      await injectChromeWarningOverlay();
    }
  } catch (e) {
    console.warn('[CHROME-CDP] CDP error, restarting:', e.message);
    if (chromeProc) { try { chromeProc.kill(); } catch (e2) { } }
    chromeProc = null; chromeCdp = null; chromeReady = false;
    await startPersistentChrome();
    if (!chromeCdp) throw new Error('Cannot restart Chrome');
  }

  // Execute captcha in persistent Chrome
  console.log('[CHROME-CDP] Generating captcha in persistent Chrome, action:', captchaAction);
  const rcKey = RECAPTCHA_SITE_KEY;
  const rcAction = captchaAction || 'IMAGE_GENERATION';
  const result = await getChromeRuntime().chromeCdp.send('Runtime.evaluate', {
    expression: `(async function() {
      try {
        if (!window.grecaptcha || !window.grecaptcha.enterprise) {
          await new Promise(function(res, rej) {
            var ex = document.querySelector('script[src*="recaptcha/enterprise"]');
            if (ex) {
              var c = setInterval(function() { if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(c); res(); } }, 100);
              setTimeout(function() { clearInterval(c); rej(new Error('init timeout')); }, 12000);
            } else {
              var s = document.createElement('script');
              s.src = 'https://www.google.com/recaptcha/enterprise.js?render=` + rcKey + `';
              s.onload = function() { var c = setInterval(function() { if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(c); res(); } }, 100); setTimeout(function() { clearInterval(c); rej(new Error('load timeout')); }, 12000); };
              s.onerror = function() { rej(new Error('script error')); };
              document.head.appendChild(s);
            }
          });
        }
        return await new Promise(function(resolve, reject) {
          grecaptcha.enterprise.ready(async function() {
            try { var t = await grecaptcha.enterprise.execute('` + rcKey + `', { action: '` + rcAction + `' }); resolve(t); }
            catch(e) { reject(e.message || String(e)); }
          });
          setTimeout(function() { reject('timeout 25s'); }, 25000);
        });
      } catch(err) { return 'ERR:' + (err.message || String(err)); }
    })()`,
    returnByValue: true, awaitPromise: true, timeout: 30000,
  });

  const val = result && result.result && result.result.value;
  if (val && typeof val === 'string' && !val.startsWith('ERR:') && val.length > 100) {
    console.log('[CHROME-CDP] Token from persistent Chrome, len:', val.length);
    return val;
  }
  if (val && typeof val === 'string' && val.startsWith('ERR:')) throw new Error(val);
  if (result && result.exceptionDetails) throw new Error('Chrome exception: ' + result.exceptionDetails.text);
  throw new Error('No token from Chrome');
}


// ── Make API request via Chrome CDP ──────────────────────────────────
// Thuc hien captcha + fetch() hoan toan trong Chrome that.
// Tat ca di qua Chrome's network stack voi real browser cookies/TLS:
//   - captcha generate trong Chrome (real user-initiated browser context)
//   - fetch() chay trong Chrome → credentials: 'include' (tu dong gui cookies)
//   - Khong co Node.js HTTPS — response tra ve tu Chrome
async function makeApiRequestViaChrome(url, body) {
  if (!chromeCdp || !chromeReady) {
    console.log('[CHROME-API] Chrome not ready, starting...');
    await startPersistentChrome();
    if (!chromeCdp) throw new Error('Chrome not available');
  }

  console.log('[CHROME-API] Executing full request in Chrome...');
  const rcKey = RECAPTCHA_SITE_KEY;
  const urlStr = JSON.stringify(url);

  // Build headers (without cookie — Chrome handles cookies via credentials:include)
  const headers = buildHeaders();
  delete headers['cookie']; // Chrome gi tu dong qua credentials
  const headersJson = JSON.stringify(headers);
  const bodyJson = JSON.stringify(body);

  const result = await getChromeRuntime().chromeCdp.send('Runtime.evaluate', {
    expression: `(async function() {
      try {
        // === Step 1: Get captcha token in Chrome (real browser context) ===
        if (!window.grecaptcha || !window.grecaptcha.enterprise) {
          await new Promise(function(res, rej) {
            var ex = document.querySelector('script[src*="recaptcha/enterprise"]');
            if (ex) {
              var c = setInterval(function() { if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(c); res(); } }, 150);
              setTimeout(function() { clearInterval(c); rej(new Error('init timeout')); }, 15000);
            } else {
              var s = document.createElement('script');
              s.src = 'https://www.google.com/recaptcha/enterprise.js?render=` + rcKey + `';
              s.onload = function() {
                var c = setInterval(function() { if (window.grecaptcha && window.grecaptcha.enterprise) { clearInterval(c); res(); } }, 150);
                setTimeout(function() { clearInterval(c); rej(new Error('load timeout')); }, 15000);
              };
              s.onerror = function() { rej(new Error('script error')); };
              document.head.appendChild(s);
            }
          });
        }

        var captchaToken = await new Promise(function(resolve, reject) {
          grecaptcha.enterprise.ready(async function() {
            try {
              var t = await grecaptcha.enterprise.execute('` + rcKey + `', { action: 'IMAGE_GENERATION' });
              resolve(t);
            } catch(e) { reject(e.message || String(e)); }
          });
          setTimeout(function() { reject('captcha timeout 25s'); }, 25000);
        });

        // === Step 2: Inject captcha token into body ===
        var body = ` + bodyJson + `;
        var rcCtx = { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' };
        if (body.clientContext) body.clientContext.recaptchaContext = rcCtx;
        if (Array.isArray(body.requests)) {
          body.requests.forEach(function(req) {
            if (req.clientContext) req.clientContext.recaptchaContext = rcCtx;
          });
        }

        // === Step 3: Fetch from Chrome (credentials:include auto-sends cookies) ===
        var resp = await fetch(` + urlStr + `, {
          method: 'POST',
          headers: ` + headersJson + `,
          body: JSON.stringify(body),
          credentials: 'include',
        });

        var text = await resp.text();
        var data;
        try { data = JSON.parse(text); } catch(e) { data = text; }
        return { status: resp.status, ok: resp.ok, data: data, error: null, captchaLen: captchaToken.length };
      } catch(err) {
        return { status: 0, ok: false, data: null, error: err.message || String(err), captchaLen: 0 };
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
    timeout: 60000,
  });

  const val = result && result.result && result.result.value;
  if (!val) {
    if (result && result.exceptionDetails) throw new Error('Chrome exception: ' + result.exceptionDetails.text);
    throw new Error('No response from Chrome');
  }

  console.log('[CHROME-API] Response status:', val.status, val.ok ? 'OK' : 'FAIL', '| captcha len:', val.captchaLen);

  if (val.error) throw new Error('Chrome API error: ' + val.error);
  if (!val.ok) {
    const errMsg = typeof val.data === 'string' ? val.data : JSON.stringify(val.data);
    throw new Error('API ' + val.status + ': ' + errMsg.substring(0, 500));
  }

  return { status: val.status, data: val.data };
}


// Reload the slot's flowWebview to reset reCAPTCHA session state.
// Mirrors the user's manual F5 workflow: must F5 on a project URL specifically.
async function reloadFlowWebviewForSlot(slotId) {
  const wv = findFlowWebview(slotId);
  if (!wv) return false;
  try {
    const curUrl = wv.getURL ? wv.getURL() : null;
    const settings = loadSettings();
    const targetUrl = (curUrl && curUrl.includes('/project/')) ? curUrl : settings.lastProjectUrl;
    if (targetUrl && targetUrl.includes('/project/')) {
      // Navigate to project URL (matches user's manual F5-on-project-URL workflow).
      // Use loadURL instead of reload — ensures we land on the project page even
      // if current URL drifted to /flow home or an error page.
      console.log(`[RELOAD-SLOT-${slotId}] Navigating to project URL: ${targetUrl}`);
      if (typeof wv.loadURL === 'function') await wv.loadURL(targetUrl);
      else await wv.executeJavaScript(`location.href = ${JSON.stringify(targetUrl)}`);
    } else {
      // No saved project URL — plain reload
      if (typeof wv.reload === 'function') wv.reload();
      else await wv.executeJavaScript('location.reload()');
    }
    // Wait for prompt textbox to be ready (max 25s)
    const start = Date.now();
    while (Date.now() - start < 25000) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const ready = await wv.executeJavaScript(`!!(document.querySelector('[contenteditable="true"]') || document.querySelector('textarea'))`);
        if (ready) {
          const url = wv.getURL ? wv.getURL() : '?';
          console.log(`[RELOAD-SLOT-${slotId}] Webview ready (url=${url})`);
          // Extra dwell time — reCAPTCHA needs ~1-2s after load to settle
          await new Promise(r => setTimeout(r, 1500));
          return true;
        }
      } catch (e) {}
    }
    console.warn(`[RELOAD-SLOT-${slotId}] Webview reload timed out`);
    return false;
  } catch (e) {
    console.warn(`[RELOAD-SLOT-${slotId}] Reload error:`, e.message);
    return false;
  }
}

// Reload the Chrome-CDP labs.google tab to reset its reCAPTCHA session state.
async function reloadChromeCdpLabs() {
  if (!chromeCdp || !chromeReady) return false;
  try {
    await getChromeRuntime().chromeCdp.send('Page.reload', { ignoreCache: false });
    chromeReady = false;
    // Wait for labs.google to load again (max 12s)
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const r = await getChromeRuntime().chromeCdp.send('Runtime.evaluate', {
          expression: '({ onLabs: location.href.includes("labs.google"), state: document.readyState })',
          returnByValue: true,
        });
        const v = r && r.result && r.result.value;
        if (v && v.onLabs && (v.state === 'complete' || v.state === 'interactive')) {
          chromeReady = true;
          console.log('[CHROME-CDP] Reload complete, labs.google ready');
          return true;
        }
      } catch (e) {}
    }
    console.warn('[CHROME-CDP] Reload timed out');
    return false;
  } catch (e) {
    console.warn('[CHROME-CDP] Reload error:', e.message);
    return false;
  }
}

async function _doApiRequestViaWebviewOnce(url, body, slotId, captchaAction) {
  // Extract existing frontend token (if any) for fallback. Discard placeholders
  // sent by the renderer when it expects the extension to provide the real token.
  let frontendToken = null;
  if (body.clientContext?.recaptchaContext?.token) {
    frontendToken = body.clientContext.recaptchaContext.token;
  } else if (Array.isArray(body.requests) && body.requests[0]?.clientContext?.recaptchaContext?.token) {
    frontendToken = body.requests[0].clientContext.recaptchaContext.token;
  }
  if (frontendToken && frontendToken.startsWith('EXTENSION_PLACEHOLDER_')) {
    frontendToken = null;
  }

  let captchaToken = null;

  // Strategy 0: User's real Chrome via extension (HIGHEST trust — same as
  // manual browsing). When the extension is connected, treat it as the ONLY
  // captcha source — retry on transient failure but DO NOT fall back to
  // Chrome-CDP. Falling back would spawn a visible Chrome window which is
  // confusing UX when the user has already set up the extension. If the
  // extension is genuinely broken (closed tab, signed out), surface the
  // error so the user can fix it.
  const extConnected = captchaBridge.isExtensionConnected();
  if (extConnected) {
    let extErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        captchaToken = await captchaBridge.getTokenFromExtension(captchaAction);
        if (captchaToken) {
          console.log('[CAPTCHA] Real-Chrome extension OK, len:', captchaToken.length, 'action:', captchaAction, attempt > 0 ? `(retry #${attempt})` : '');
          break;
        }
      } catch (e) {
        extErr = e;
        console.warn(`[CAPTCHA] Extension attempt ${attempt + 1} failed:`, e.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (!captchaToken) {
      console.warn('[CAPTCHA] Extension token request failed, falling back to other strategies:', extErr?.message || 'Token request failed');
    }
  }

  // Strategy 1: Persistent real Chrome via CDP — only when extension is NOT
  // connected at all (user hasn't installed the extension yet).
  if (!captchaToken && !extConnected) {
    try {
      captchaToken = await getCaptchaFromChrome(captchaAction);
      if (captchaToken) console.log('[CAPTCHA] Chrome CDP OK, len:', captchaToken.length, 'action:', captchaAction);
    } catch (e) {
      console.warn('[CAPTCHA] Chrome failed:', e.message);
    }
  }

  // Strategy 2: Use frontend token if Chrome CDP unavailable
  if (!captchaToken && frontendToken && frontendToken.length > 20) {
    captchaToken = frontendToken;
    console.log(`[CAPTCHA] Using frontend token (len: ${frontendToken.length})`);
  }

  // Strategy 3: Main webview fallback
  if (!captchaToken) {
    const wv = findFlowWebview(slotId);
    if (wv) {
      try {
        console.log('[CAPTCHA] Fallback: main webview (slot', slotId, '), action:', captchaAction);
        await wv.executeJavaScript('window.__rcKey = ' + JSON.stringify(RECAPTCHA_SITE_KEY) + '; window.__rcAction = ' + JSON.stringify(captchaAction) + ';');
        captchaToken = await wv.executeJavaScript(`
          (async function() {
            try {
              if (!window.grecaptcha || !window.grecaptcha.enterprise) return null;
              return await new Promise(function(resolve, reject) {
                grecaptcha.enterprise.ready(async function() {
                  try { var t = await grecaptcha.enterprise.execute(window.__rcKey, { action: window.__rcAction || 'IMAGE_GENERATION' }); resolve(t); }
                  catch(e) { reject(e.message || String(e)); }
                });
                setTimeout(function() { reject('timeout'); }, 15000);
              });
            } catch(err) { return null; }
          })()
        `);
        if (captchaToken) console.log('[CAPTCHA] Main webview OK, len:', captchaToken.length);
      } catch (e) { console.error('[CAPTCHA] Webview failed:', e.message); }
    }
  }

  if (!captchaToken) throw new Error('Cannot get captcha token from any source');

  const bodyWithToken = JSON.parse(JSON.stringify(body));
  const recaptchaCtx = { token: captchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' };
  if (bodyWithToken.clientContext) bodyWithToken.clientContext.recaptchaContext = recaptchaCtx;
  if (Array.isArray(bodyWithToken.requests)) {
    bodyWithToken.requests.forEach(function (req) {
      if (req.clientContext) req.clientContext.recaptchaContext = recaptchaCtx;
    });
  }

  console.log('[API] Sending with captcha token (slot', slotId, ')...');
  return makeApiRequest(url, bodyWithToken, slotId);
}

async function makeApiRequestViaWebview(url, body, slotId = 0, captchaAction = 'IMAGE_GENERATION') {
  console.log('[API] Request:', url.substring(0, 80));
  // DRY-RUN: skip real captcha acquisition (no extension/webview needed).
  // Inject a dummy token exactly where the real one would go, then let
  // makeApiRequest capture the (faithful) payload and short-circuit.
  if (isDryRunActive()) {
    const bodyWithToken = JSON.parse(JSON.stringify(body));
    const recaptchaCtx = { token: 'DRYRUN_DUMMY_TOKEN', applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' };
    if (bodyWithToken.clientContext) bodyWithToken.clientContext.recaptchaContext = recaptchaCtx;
    if (Array.isArray(bodyWithToken.requests)) {
      bodyWithToken.requests.forEach(function (req) {
        if (req.clientContext) req.clientContext.recaptchaContext = recaptchaCtx;
      });
    }
    return makeApiRequest(url, bodyWithToken, slotId);
  }
  try {
    return await _doApiRequestViaWebviewOnce(url, body, slotId, captchaAction);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    // Mirror user's manual F5 workflow: reload webview + Chrome-CDP labs page,
    // then retry once. Targeted at reCAPTCHA UNUSUAL_ACTIVITY which resets after
    // page reload (reCAPTCHA session state is per page lifecycle).
    if (msg.includes('UNUSUAL_ACTIVITY') || msg.includes('reCAPTCHA evaluation failed')) {
      console.log('[API] UNUSUAL_ACTIVITY detected — reloading webview + Chrome-CDP, then retrying once...');
      await Promise.all([
        reloadFlowWebviewForSlot(slotId),
        reloadChromeCdpLabs(),
      ]);
      return await _doApiRequestViaWebviewOnce(url, body, slotId, captchaAction);
    }
    throw e;
  }
}



  return {
    findChromePath,
    httpGetJson,
    createCdpClient,
    injectChromeWarningOverlay,
    startPersistentChrome,
    getCaptchaFromChrome,
    makeApiRequestViaChrome,
    reloadFlowWebviewForSlot,
    reloadChromeCdpLabs,
    makeApiRequestViaWebview,
    getChromeRuntime,
  };
};
