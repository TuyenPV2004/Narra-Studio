'use strict';

const { brand } = require('./brand');

module.exports = function createAppCore(dependencies) {
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
  } = dependencies;

function buildCleanUserAgent() {
  const chromeMajor = (process.versions.chrome || '147.0.0.0').split('.')[0];
  const ver = `${chromeMajor}.0.0.0`;
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

const DEFAULTS = {
  projectId: '8fb1e193-d902-4c02-8a0a-d63aaf035d9f',
  xBrowserValidation: 'mGtxj/IERUi4uQ9hLSvZZF4DQgA=',
  xBrowserChannel: 'stable',
  xBrowserYear: '2026',
  xBrowserCopyright: 'Copyright 2026 Google LLC. All Rights reserved.',
  xClientData: 'CJG2yQEIorbJAQipncoBCMnkygEIk6HLAQiFoM0BGOixzwE=',
  userAgent: buildCleanUserAgent(),
};

function makeEmptySlot(id) {
  return {
    id,
    partition: `persist:slot-${id}`,
    bearerToken: null,
    projectId: null,
    cookies: '',
    email: null,
    displayName: null,
    avatar: null,
    xBrowserValidation: null,
    xBrowserChannel: null,
    xBrowserYear: null,
    xBrowserCopyright: null,
    xClientData: null,
    userAgent: null,
    lastCaptured: null,
    status: 'empty',
  };
}

const accountSlots = Array.from({ length: MAX_SLOTS }, (_, i) => makeEmptySlot(i));

const capturedAuth = accountSlots[0];

let webviewBackgroundTimers = [];
function clearWebviewBackgroundTimers() {
  for (const t of webviewBackgroundTimers) {
    try { clearInterval(t); clearTimeout(t); } catch (_) { }
  }
  webviewBackgroundTimers = [];
}

function getSlot(slotId) {
  const id = (slotId !== undefined && slotId !== null) ? Number(slotId) : 0;
  return accountSlots[id] || accountSlots[0];
}

const slotRequestCounts = {};
function markSlotBusy(slotId) {
  slotRequestCounts[slotId] = (slotRequestCounts[slotId] || 0) + 1;
}
function markSlotFree(slotId) {
  slotRequestCounts[slotId] = Math.max(0, (slotRequestCounts[slotId] || 1) - 1);
}

function pickRandomSlot() {
  const available = accountSlots.filter(s => s.status === 'connected' && s.bearerToken);
  if (!available.length) {
    if (accountSlots[0].bearerToken) return accountSlots[0];
    throw new Error('Không có account nào sẵn sàng. Vui lòng đăng nhập.');
  }

  const idle = available.filter(s => !slotRequestCounts[s.id] || slotRequestCounts[s.id] === 0);
  if (idle.length > 0) {
    return idle[Math.floor(Math.random() * idle.length)];
  }

  available.sort((a, b) => (slotRequestCounts[a.id] || 0) - (slotRequestCounts[b.id] || 0));
  return available[0];
}

const {
  AUTH_COOKIE_NAMES,
  hasAuthenticationCookie,
  classifySessionFetchResult,
  evaluateSlotStatus,
} = require('./flowSessionPolicy');

async function refreshCapturedCookies(slotId = 0) {
  const slot = getSlot(slotId);
  try {
    const ses = session.fromPartition(slot.partition);
    const [googleCookies, labsCookies] = await Promise.all([
      ses.cookies.get({ domain: '.google.com' }),
      ses.cookies.get({ domain: 'labs.google' }),
    ]);
    const all = [...googleCookies, ...labsCookies];
    slot.cookies = all.map(c => c.name + '=' + c.value).join('; ');
    console.log(`[SLOT-${slotId}][COOKIES] Refreshed`, all.length, 'cookies');
  } catch (e) {
    console.warn(`[SLOT-${slotId}][COOKIES] Refresh failed:`, e.message);
  }
}

async function fetchSlotSession(slotId) {
  const slot = getSlot(slotId);
  if (!slot) return { ok: false, kind: 'unauthenticated' };

  if (slot.bearerToken) {
    try {
      const token = slot.bearerToken.replace(/^(Bearer\s+)+/i, 'Bearer ');
      const userinfoResp = await net.fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          'Authorization': token,
          'Accept': 'application/json',
        },
      });
      if (userinfoResp.ok) {
        const data = await userinfoResp.json().catch(() => null);
        if (data && (data.email || data.name)) {
          const user = {
            email: data.email || null,
            name: data.name || data.given_name || (data.email ? data.email.split('@')[0] : null),
            avatar: data.picture || null,
          };
          if (user.email) slot.email = user.email;
          if (user.name) slot.displayName = user.name;
          if (user.avatar) slot.avatar = user.avatar;
          console.log(`[SLOT-${slotId}][PROFILE] ✅ Fetched via googleapis userinfo: email=${user.email}, name=${user.name}`);
          if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
            runtime.mainWindow.webContents.send('slot-session-updated', { slotId, ...user });
          }
          return { ok: true, kind: 'authenticated', user, status: 200 };
        }
      } else if (userinfoResp.status === 401 || userinfoResp.status === 403) {
        console.warn(`[SLOT-${slotId}][PROFILE] Stale Bearer token returned ${userinfoResp.status}, resetting token in memory and falling back to persistent cookie session check...`);
        slot.bearerToken = null;
      }
    } catch (e) {
      console.warn(`[SLOT-${slotId}][PROFILE] OAuth userinfo fetch failed:`, e.message);
    }
  }

  try {
    const ses = session.fromPartition(slot.partition || `persist:slot-${slotId}`);
    const all = await ses.cookies.get({}).catch(() => []);
    if (all.length > 0) {
      const cookieHeader = all.map(c => `${c.name}=${c.value}`).join('; ');
      const cleanUA = buildCleanUserAgent();
      try {
        const resp = await net.fetch('https://labs.google/fx/api/auth/session', {
          headers: {
            'accept': 'application/json',
            'cookie': cookieHeader,
            'user-agent': cleanUA,
            'origin': 'https://labs.google',
            'referer': 'https://labs.google/fx/tools/flow',
          },
        });

        const d = await resp.json().catch(() => null);
        const classified = classifySessionFetchResult({ status: resp.status, data: d });

        if (classified.kind === 'authenticated' && classified.user) {
          const user = classified.user;
          if (user.email) slot.email = user.email;
          if (user.name) slot.displayName = user.name;
          if (user.avatar) slot.avatar = user.avatar;
          console.log(`[SLOT-${slotId}][PROFILE] ✅ Fetched via net.fetch labs session: email=${user.email}, name=${user.name}`);
          if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
            runtime.mainWindow.webContents.send('slot-session-updated', { slotId, ...user });
          }
          return { ok: true, kind: 'authenticated', user, status: resp.status };
        }

        return { ok: false, ...classified };
      } catch (fetchErr) {
        console.warn(`[SLOT-${slotId}][PROFILE] net.fetch request error:`, fetchErr.message);
        return { ok: false, kind: 'network-error', error: fetchErr.message };
      }
    }
  } catch (e) {
    console.warn(`[SLOT-${slotId}][PROFILE] net.fetch failed:`, e.message);
    return { ok: false, kind: 'network-error', error: e.message };
  }

  return { ok: false, kind: 'unauthenticated' };
}

async function clearSlotSessionData(slotId) {
  const slot = getSlot(slotId);
  const ses = session.fromPartition(slot.partition);

  const allCookies = await ses.cookies.get({}).catch(() => []);
  await Promise.all(
    allCookies.map((c) => {
      const url = `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`;
      return ses.cookies.remove(url, c.name).catch(() => {});
    })
  );

  await ses
    .clearStorageData({
      storages: [
        "cookies",
        "localstorage",
        "sessionstorage",
        "indexdb",
        "cachestorage",
        "serviceworkers",
      ],
    })
    .catch(() => {});

  await ses.clearCache().catch(() => {});

  slot.bearerToken = null;
  slot.projectId = null;
  slot.cookies = '';
  slot.email = null;
  slot.displayName = null;
  slot.avatar = null;
  slot.xBrowserValidation = null;
  slot.xBrowserChannel = null;
  slot.xBrowserYear = null;
  slot.xBrowserCopyright = null;
  slot.xClientData = null;
  slot.userAgent = null;
  slot.lastCaptured = null;
  slot.status = 'empty';
}

async function restoreSlotSession(slotId) {
  const slot = getSlot(slotId);
  if (!slot) return { status: 'empty' };

  try {
    const ses = session.fromPartition(slot.partition || `persist:slot-${slotId}`);

    const [googleCookies, labsCookies] = await Promise.all([
      ses.cookies.get({ domain: '.google.com' }).catch(() => []),
      ses.cookies.get({ domain: 'labs.google' }).catch(() => []),
    ]);
    const allCookies = [...googleCookies, ...labsCookies];

    if (!allCookies.length) {
      slot.status = 'empty';
      slot.cookies = '';
      return { status: 'empty' };
    }

    slot.cookies = allCookies.map(c => `${c.name}=${c.value}`).join('; ');
    slot.status = 'restoring';
    const hasAuthCookies = hasAuthenticationCookie(allCookies);

    const sessionRes = await fetchSlotSession(slotId);

    const calculatedStatus = evaluateSlotStatus({
      cookiesCount: allCookies.length,
      hasAuthCookies,
      hasBearerToken: Boolean(slot.bearerToken),
      sessionClassification: sessionRes,
      previousStatus: slot.status === 'restoring' ? 'empty' : slot.status,
    });

    slot.status = calculatedStatus;

    if (sessionRes && sessionRes.user) {
      if (sessionRes.user.email) slot.email = sessionRes.user.email;
      if (sessionRes.user.name) slot.displayName = sessionRes.user.name;
      if (sessionRes.user.avatar) slot.avatar = sessionRes.user.avatar;
      if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
        runtime.mainWindow.webContents.send('slot-session-updated', {
          slotId,
          email: slot.email,
          name: slot.displayName,
          avatar: slot.avatar,
        });
      }
    }

    console.log(`[SLOT-${slotId}][RESTORE] Evaluated status: "${slot.status}" (email: ${slot.email || 'none'})`);
    return {
      status: slot.status,
      email: slot.email,
      displayName: slot.displayName,
      avatar: slot.avatar,
    };
  } catch (err) {
    console.warn(`[SLOT-${slotId}][RESTORE] Check failed:`, err.message);
    slot.status = slot.cookies ? 'error' : 'empty';
    return { status: slot.status, error: err.message };
  }
}

let isRestoringAllSessions = false;
function getIsRestoringSessions() {
  return isRestoringAllSessions;
}

async function restoreAllSlotSessions() {
  if (isRestoringAllSessions) return;
  isRestoringAllSessions = true;
  console.log('[FLOW-SESSION] 🔄 Starting silent session hydration for all slots...');
  try {
    for (let i = 0; i < MAX_SLOTS; i += 1) {
      await restoreSlotSession(i);
    }
    console.log('[FLOW-SESSION] ✅ Completed silent session hydration.');
    if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
      runtime.mainWindow.webContents.send('slot-session-updated', { all: true });
    }
  } finally {
    isRestoringAllSessions = false;
  }
}

async function fetchSlotEmail(slotId) {
  const s = await fetchSlotSession(slotId);
  return s?.email || null;
}

Object.defineProperty(global, 'capturedCookieHeader', {
  get: () => accountSlots[0].cookies,
  set: (v) => { accountSlots[0].cookies = v; },
});

function createWindow() {
  runtime.mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 750,
    title: brand.displayName,
    icon: path.join(__dirname, '..', '..', 'dist', 'brand', 'narra-mark.svg'),
    backgroundColor: '#08080c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,

      backgroundThrottling: true,
      spellcheck: false,
      enableBlinkFeatures: 'CSSContainerQueries',
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    runtime.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    runtime.mainWindow.once('ready-to-show', () => runtime.mainWindow.show());
  } else {
    runtime.mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  runtime.mainWindow.setMenuBarVisibility(false);
  runtime.mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const record = {
      at: new Date().toISOString(),
      reason: details.reason,
      exitCode: details.exitCode,
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
    };
    console.error('[RENDERER-CRASH]', record);
    try {
      fs.appendFileSync(
        path.join(app.getPath('userData'), 'renderer-crashes.ndjson'),
        `${JSON.stringify(record)}\n`,
        'utf8',
      );
    } catch (error) {
      console.warn('[RENDERER-CRASH] Could not persist diagnostics:', error.message);
    }
  });

  runtime.mainWindow.on('closed', clearWebviewBackgroundTimers);
}

function setupRequestInterception() {
  clearWebviewBackgroundTimers();

  for (let slotId = 0; slotId < MAX_SLOTS; slotId++) {
    const slot = accountSlots[slotId];
    const ses = session.fromPartition(slot.partition);

    ses.setPreloads = ses.setPreloads || (() => { });
    const antiDetectScript = path.join(__dirname, 'anti-detect.js');
    if (require('fs').existsSync(antiDetectScript)) {
      ses.setPreloads([antiDetectScript]);
    }

    ses.webRequest.onBeforeSendHeaders(
      {
        urls: [
          'https://aisandbox-pa.googleapis.com/*',
          'https://labs.google/*',

        ]
      },
      (details, callback) => {
        const h = details.requestHeaders;

        const cleanUA = slot.userAgent || DEFAULTS.userAgent;
        h['User-Agent'] = cleanUA;
        h['user-agent'] = cleanUA;

        const authHeader = h['Authorization'] || h['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          slot.bearerToken = authHeader.replace(/^(Bearer\s+)+/i, 'Bearer ');
          slot.lastCaptured = new Date().toISOString();
          slot.status = 'connected';
          refreshCapturedCookies(slotId);
          console.log(`[SLOT-${slotId}][AUTH] ✅ Bearer token captured from:`, new URL(details.url).hostname);

          setTimeout(() => {
            fetchSlotSession(slotId).then(session => {
              if (session) {
                if (session.email) slot.email = session.email;
                if (session.name) slot.displayName = session.name;
                if (session.avatar) slot.avatar = session.avatar;
                console.log(`[SLOT-${slotId}][AUTH] ✅ Session:`, session.email, '/', session.name);
                if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
                  runtime.mainWindow.webContents.send('slot-session-updated', { slotId, ...session });
                }
              }
            }).catch(() => { });
          }, 2000);
        }

        if (details.url.includes('aisandbox-pa.googleapis.com')) {
          if (h['x-browser-validation']) slot.xBrowserValidation = h['x-browser-validation'];
          if (h['x-browser-channel']) slot.xBrowserChannel = h['x-browser-channel'];
          if (h['x-browser-year']) slot.xBrowserYear = h['x-browser-year'];
          if (h['x-browser-copyright']) slot.xBrowserCopyright = h['x-browser-copyright'];
          if (h['x-client-data']) slot.xClientData = h['x-client-data'];
        }

        if (h['User-Agent'] || h['user-agent']) {
          slot.userAgent = h['User-Agent'] || h['user-agent'];
        }

        const m = details.url.match(/projects\/([0-9a-f-]{36})/);
        if (m) {
          slot.projectId = m[1];
          console.log(`[SLOT-${slotId}][AUTH] ✅ ProjectId:`, slot.projectId);
        }

        if (slot.bearerToken && runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
          runtime.mainWindow.webContents.send('auth-captured', {
            hasBearerToken: true,
            projectId: slot.projectId,
            lastCaptured: slot.lastCaptured,
          });
        }

        callback({ cancel: false, requestHeaders: h });
      }
    );
  }

  console.log('[AUTH] Request interception active - monitoring all slot partitions');

  async function autoInjectUploadSpy() {
    try {
      const wv = findFlowWebview();
      if (!wv) return;
      await wv.executeJavaScript(`
        (function() {
          if (window.__uploadSpyActive) return;
          window.__uploadSpyActive = true;
          window.__uploadSpyLogs = [];
          const origFetch = window.fetch;
          window.fetch = async function(...args) {
            const [url, opts] = args;
            const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
            if (urlStr && urlStr.includes('upload-video')) {
              const method = (opts && opts.method) || 'GET';
              const headers = {};
              if (opts && opts.headers) {
                if (opts.headers instanceof Headers) {
                  opts.headers.forEach((v, k) => { headers[k] = v; });
                } else {
                  Object.assign(headers, opts.headers);
                }
              }
              let bodySize = 0;
              let bodyType = 'none';
              if (opts && opts.body) {
                if (opts.body instanceof Blob) { bodySize = opts.body.size; bodyType = 'Blob'; }
                else if (opts.body instanceof ArrayBuffer) { bodySize = opts.body.byteLength; bodyType = 'ArrayBuffer'; }
                else if (opts.body instanceof Uint8Array) { bodySize = opts.body.byteLength; bodyType = 'Uint8Array'; }
                else if (typeof opts.body === 'string') { bodySize = opts.body.length; bodyType = 'string'; }
                else { bodySize = -1; bodyType = typeof opts.body; }
              }
              const entry = {
                ts: new Date().toISOString(),
                method,
                url: urlStr,
                headers,
                bodySize,
                bodyType,
              };
              console.log('[SPY] >>>', method, urlStr.substring(0, 80),
                'cmd=' + (headers['X-Upload-Command'] || headers['x-upload-command'] || '?'),
                'offset=' + (headers['X-Upload-Offset'] || headers['x-upload-offset'] || '?'),
                'bodySize=' + bodySize, 'bodyType=' + bodyType);
              const res = await origFetch.apply(this, args);
              const clone = res.clone();
              let resBody = '';
              try { resBody = await clone.text(); } catch(e) { resBody = '[read error]'; }
              const resHeaders = {};
              res.headers.forEach((v, k) => { resHeaders[k] = v; });
              entry.status = res.status;
              entry.resHeaders = resHeaders;
              entry.resBody = resBody.substring(0, 1000);
              window.__uploadSpyLogs.push(entry);
              if (window.__uploadSpyLogs.length > 50) window.__uploadSpyLogs.splice(0, window.__uploadSpyLogs.length - 50);
              console.log('[SPY] <<<', res.status, resBody.substring(0, 300));
              return res;
            }
            return origFetch.apply(this, args);
          };
          console.log('[SPY] ✅ Auto-injected upload-video fetch interceptor');
        })()
      `);
      console.log('[SPY-UPLOAD] ✅ Auto-injected into webview');
    } catch (e) { console.log('[SPY-UPLOAD] Auto-inject error:', e.message); }
  }

  let spyConsoleAttached = false;
  function attachSpyConsoleListener() {
    if (spyConsoleAttached) return;
    try {
      const wv = findFlowWebview();
      if (!wv) return;
      spyConsoleAttached = true;
      wv.on('console-message', (_, level, message) => {
        if (message.includes('[SPY]')) {
          console.log('[WV-SPY]', message);
        }
      });
      console.log('[SPY-UPLOAD] ✅ Console listener attached to webview');
    } catch (e) { }
  }

  let autoEnterAttempted = false;
  async function tryAutoEnterProject() {
    if (autoEnterAttempted) return;
    try {
      const wv = findFlowWebview();
      if (!wv) return;

      const pageState = await wv.executeJavaScript(`
        (function() {
          var url = window.location.href;
          var hasTextbox = !!document.querySelector('div[contenteditable="true"][role="textbox"]');
          var projectLinks = Array.from(document.querySelectorAll('a[href*="/project/"]'));
          var newProjectBtn = null;
          var buttons = Array.from(document.querySelectorAll('button'));
          for (var i = 0; i < buttons.length; i++) {
            var txt = (buttons[i].textContent || '').trim();
            if (txt.indexOf('New project') !== -1) {
              newProjectBtn = i;
              break;
            }
          }
          return {
            url: url,
            hasTextbox: hasTextbox,
            projectCount: projectLinks.length,
            hasNewProjectBtn: newProjectBtn !== null,
            newProjectBtnIdx: newProjectBtn,
          };
        })()
      `);

      console.log('[AUTO-ENTER] Page state:', JSON.stringify(pageState));

      if (pageState.hasTextbox) {
        console.log('[AUTO-ENTER] Already in a project — saving URL');
        autoEnterAttempted = true;
        if (pageState.url && pageState.url.includes('/project/')) {
          saveSettings({ lastProjectUrl: pageState.url });
          console.log('[AUTO-ENTER] Saved project URL:', pageState.url);

          const m = pageState.url.match(/\/project\/([a-zA-Z0-9_-]+)/);
          if (m && m[1] && !capturedAuth.projectId) {
            capturedAuth.projectId = m[1];
            console.log('[AUTO-ENTER] ✅ Extracted projectId from URL:', capturedAuth.projectId);
            if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
              runtime.mainWindow.webContents.send('auto-entered-project');
            }
          }
        }
        return;
      }

      if (pageState.hasNewProjectBtn) {
        autoEnterAttempted = true;

        if (pageState.projectCount > 0) {
          console.log('[AUTO-ENTER] Clicking first existing project...');
          const projectUrl = await wv.executeJavaScript(`
            (function() {
              var links = document.querySelectorAll('a[href*="/project/"]');
              if (links.length > 0) {
                var href = links[0].href;
                links[0].click();
                return href;
              }
              return null;
            })()
          `);
          if (projectUrl) {
            saveSettings({ lastProjectUrl: projectUrl });
            console.log('[AUTO-ENTER] Saved project URL:', projectUrl);

            const m = projectUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (m && m[1]) {
              capturedAuth.projectId = m[1];
              console.log('[AUTO-ENTER] ✅ Extracted projectId:', capturedAuth.projectId);
            }
          }
        } else {
          console.log('[AUTO-ENTER] No projects found, clicking New project...');
          await wv.executeJavaScript(`
            (function() {
              var buttons = Array.from(document.querySelectorAll('button'));
              for (var i = 0; i < buttons.length; i++) {
                if ((buttons[i].textContent || '').trim().indexOf('New project') !== -1) {
                  buttons[i].click();
                  return true;
                }
              }
              return false;
            })()
          `);

          setTimeout(async () => {
            try {
              const url = await wv.executeJavaScript('window.location.href');
              if (url && url.includes('/project/')) {
                saveSettings({ lastProjectUrl: url });
                console.log('[AUTO-ENTER] Saved new project URL:', url);

                const m = url.match(/\/project\/([a-zA-Z0-9_-]+)/);
                if (m && m[1]) {
                  capturedAuth.projectId = m[1];
                  console.log('[AUTO-ENTER] ✅ Extracted projectId from new project:', capturedAuth.projectId);
                  if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
                    runtime.mainWindow.webContents.send('auto-entered-project');
                  }
                }
              }
            } catch (e) { }
          }, 5000);
        }

        if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
          runtime.mainWindow.webContents.send('auto-entered-project');
        }
      }
    } catch (e) { console.log('[AUTO-ENTER] Error:', e.message); }
  }
}

function teardownRequestInterception() {
  clearWebviewBackgroundTimers();
  for (let slotId = 0; slotId < MAX_SLOTS; slotId++) {
    try {
      session.fromPartition(accountSlots[slotId].partition).webRequest.onBeforeSendHeaders(null);
    } catch (error) {
      console.warn(`[SLOT-${slotId}][AUTH] Failed to remove request interception:`, error?.message || error);
    }
  }
}

function getPlatformChHint() {
  switch (process.platform) {
    case 'darwin': return '"macOS"';
    case 'win32': return '"Windows"';
    case 'linux': return '"Linux"';
    default: return '"Unknown"';
  }
}

function getChromeMajorVersion() {
  return (process.versions.chrome || '147.0.0.0').split('.')[0];
}

function buildHeaders(slotId = 0) {
  const slot = getSlot(slotId);
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'authorization': slot.bearerToken,
    'content-type': 'text/plain;charset=UTF-8',
    'origin': 'https://labs.google',
    'priority': 'u=1, i',
    'referer': 'https://labs.google/fx/tools/flow',
    'sec-ch-ua': `"Google Chrome";v="${getChromeMajorVersion()}", "Not.A/Brand";v="8", "Chromium";v="${getChromeMajorVersion()}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': getPlatformChHint(),
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': slot.userAgent || DEFAULTS.userAgent,
    'x-browser-channel': slot.xBrowserChannel || DEFAULTS.xBrowserChannel,
    'x-browser-copyright': slot.xBrowserCopyright || DEFAULTS.xBrowserCopyright,
    'x-browser-validation': slot.xBrowserValidation || DEFAULTS.xBrowserValidation,
    'x-browser-year': slot.xBrowserYear || DEFAULTS.xBrowserYear,
    'x-client-data': slot.xClientData || DEFAULTS.xClientData,
    ...(slot.cookies ? { 'cookie': slot.cookies } : {}),
  };
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const DRYRUN_FLAG_FILE = path.join(os.tmpdir(), 'veo3-dryrun.on');
const DRYRUN_CAPTURE_FILE = path.join(os.tmpdir(), 'veo3-dryrun.jsonl');
function isDryRunActive() {
  try { return fs.existsSync(DRYRUN_FLAG_FILE); } catch { return false; }
}

function makeApiRequest(url, body, slotId = 0) {
  if (isDryRunActive()) {
    try {
      fs.appendFileSync(DRYRUN_CAPTURE_FILE, JSON.stringify({ ts: Date.now(), url, slotId, body }) + '\n');
      console.log(`[DRYRUN] captured payload → ${url}`);
    } catch (e) {
      console.error('[DRYRUN] capture write failed:', e.message);
    }
    return Promise.resolve({ status: 200, data: { __dryRun: true, media: [], workflows: [], requests: [] } });
  }

  markSlotBusy(slotId);
  return new Promise((resolve, reject) => {
    const slot = getSlot(slotId);
    const bodyStr = JSON.stringify(body);
    const urlObj = new URL(url);
    const headers = buildHeaders(slotId);

    console.log(`[SLOT-${slotId}][API] POST`, url);
    console.log(`[SLOT-${slotId}][API] Auth:`, slot.bearerToken ? slot.bearerToken.substring(0, 30) + '...' : 'NONE');

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(bodyStr) },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`[SLOT-${slotId}][API] Response:`, res.statusCode, data.substring(0, 200));
        markSlotFree(slotId);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        } else {
          reject(new Error(`API ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });

    req.on('error', err => { markSlotFree(slotId); reject(err); });
    req.setTimeout(180000, () => { markSlotFree(slotId); req.destroy(); reject(new Error('Request timeout 180s')); });
    req.write(bodyStr);
    req.end();
  });
}

const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

let activeWebviewSlot = 0;
function setActiveWebviewSlot(slotId) { activeWebviewSlot = slotId; }

function findFlowWebview(slotId = null) {
  const { webContents } = require('electron');
  const all = webContents.getAllWebContents();
  const targetSlot = slotId !== null ? slotId : activeWebviewSlot;
  const targetPartition = `persist:slot-${targetSlot}`;

  const byPartition = all.find(wc => {
    try { return wc.getType() === 'webview' && wc.session?.storagePath?.includes(`slot-${targetSlot}`); }
    catch { return false; }
  });
  if (byPartition) return byPartition;

  if (slotId !== null) return null;

  return all.find(wc => {
    try {
      const url = wc.getURL();
      return wc.getType() === 'webview' && url.includes('labs.google');
    } catch { return false; }
  });
}

  return {
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
    restoreSlotSession,
    restoreAllSlotSessions,
    getIsRestoringSessions,
    clearSlotSessionData,
    fetchSlotEmail,
    createWindow,
    setupRequestInterception,
    teardownRequestInterception,
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
  };
};
