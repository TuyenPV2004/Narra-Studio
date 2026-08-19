'use strict';

/**
 * Account slots and auth: captured bearer tokens, session sync, slot switching,
 * incognito/login windows, and project auto-entry.
 *
 * Registered by `electron/ipc/flow.js`.
 */

module.exports = function registerFlowSessionIpc(dependencies) {
  const {
    app,
    BrowserWindow,
    ipcMain,
    session,
    clipboard,
    path,
    https,
    http,
    fs,
    runtime,
    loadSettings,
    saveSettings,
    DEFAULTS,
    accountSlots,
    capturedAuth,
    getSlot,
    pickRandomSlot,
    refreshCapturedCookies,
    fetchSlotSession,
    findFlowWebview,
    setActiveWebviewSlot,
  } = dependencies;

  // __dirname was electron/ipc before this group moved into flow/;
  // resolve against that directory so packaged paths stay identical.
  const IPC_DIR = path.join(__dirname, '..');

ipcMain.handle('copy-to-clipboard', (_, text) => { clipboard.writeText(text); return true; });

ipcMain.handle('get-auth-info', () => {
  // Check ANY slot has bearer token — not just slot 0
  const anyConnected = accountSlots.some(s => !!s.bearerToken);
  // Use first connected slot for preview info, fallback to slot 0
  const activeSlot = accountSlots.find(s => !!s.bearerToken) || capturedAuth;
  return {
    hasBearerToken: anyConnected,
    bearerPreview: activeSlot.bearerToken ? activeSlot.bearerToken.substring(0, 25) + '...' : null,
    projectId: activeSlot.projectId,
    lastCaptured: activeSlot.lastCaptured,
  };
});

ipcMain.handle('create-flow-project', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  let wv = findFlowWebview(slot.id);
  let tempWin = null;

  if (!wv || wv.isDestroyed()) {
    const ses = session.fromPartition(slot.partition);
    const cleanUA = slot.userAgent || DEFAULTS.userAgent;
    ses.setUserAgent(cleanUA);

    tempWin = new BrowserWindow({
      width: 1100,
      height: 750,
      show: false,
      title: `Google Flow — Slot ${slot.id + 1}`,
      backgroundColor: '#202124',
      webPreferences: {
        partition: slot.partition,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    tempWin.webContents.setUserAgent(cleanUA);
    wv = tempWin.webContents;
  }

  try {
    const previousProjectId = String(
      (typeof wv.getURL === 'function' ? wv.getURL() : '').match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1]
        || slot.projectId
        || capturedAuth.projectId
        || '',
    );
    await wv.loadURL('https://labs.google/fx/tools/flow');

    let clicked = false;
    for (let attempt = 0; attempt < 30 && !clicked; attempt += 1) {
      clicked = await wv.executeJavaScript(`
        (() => {
          const controls = Array.from(document.querySelectorAll('button, [role="button"], a'));
          const control = controls.find(item => {
            const text = (item.textContent || '').trim().toLowerCase();
            return text.includes('new project') || text.includes('tạo project') || text.includes('dự án mới') || text.includes('create project') || text.includes('new');
          });
          if (!control) return false;
          control.click();
          return true;
        })()
      `, true).catch(() => false);
      if (!clicked) await new Promise(resolve => setTimeout(resolve, 600));
    }

    let projectId = '';
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const currentUrl = typeof wv.getURL === 'function' ? wv.getURL() : '';
      const candidate = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1] || '';
      if (candidate && candidate !== previousProjectId) {
        projectId = candidate;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!projectId) {
      const domProjectId = await wv.executeJavaScript(`
        (() => {
          const m = window.location.href.match(/\\/project\\/([a-zA-Z0-9_-]+)/);
          if (m) return m[1];
          const projectLink = document.querySelector('a[href*="/project/"]');
          if (projectLink) {
            const match = projectLink.getAttribute('href').match(/\\/project\\/([a-zA-Z0-9_-]+)/);
            if (match) return match[1];
          }
          return null;
        })()
      `).catch(() => null);
      if (domProjectId) {
        projectId = domProjectId;
      }
    }

    if (!projectId) {
      if (tempWin && !tempWin.isDestroyed()) {
        tempWin.show();
        tempWin.focus();
      }
      throw new Error('Google Flow chưa trả về project ID mới. Hãy tạo một dự án trong Google Flow.');
    }

    slot.projectId = projectId;
    capturedAuth.projectId = projectId;
    saveSettings({ lastProjectUrl: `https://labs.google/fx/tools/flow/project/${projectId}` });
    if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
      runtime.mainWindow.webContents.send('flow-project-changed', { projectId, slotId: slot.id });
      runtime.mainWindow.webContents.send('auto-entered-project');
    }
    return { success: true, projectId };
  } finally {
    if (tempWin && !tempWin.isDestroyed()) {
      tempWin.close();
    }
  }
});

// Read the current Flow project's preset/custom Voice references through the
// authenticated WebView session. Cookies and bearer tokens never cross into
// the renderer; only the normalized public catalog is returned.
ipcMain.handle('get-flow-project-initial-data', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  let wv = findFlowWebview(slot.id);
  const currentWebviewUrl = wv && !wv.isDestroyed() ? wv.getURL() : '';
  const currentProjectId = currentWebviewUrl.match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1] || '';
  const savedProjectId = String((loadSettings().lastProjectUrl || '').match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1] || '');
  const projectCandidates = [
    currentProjectId,
    capturedAuth.projectId,
    slot.projectId,
    savedProjectId,
    DEFAULTS.projectId,
  ].map(value => String(value || '').trim()).filter((value, index, values) => value && values.indexOf(value) === index);
  if (!projectCandidates.length) throw new Error('Chưa xác định được Google Flow project.');
  let data = null;
  let projectId = projectCandidates[0];

  // Canvas unmounts the visible Google Flow WebView. session.fetch keeps using
  // the same authenticated persist:slot partition, so pricing/voices remain
  // available from every Flow node instead of depending on the login page.
  const slotSession = session.fromPartition(slot.partition);
  for (const candidate of projectCandidates) {
    try {
      const input = encodeURIComponent(JSON.stringify({ json: { projectId: candidate } }));
      const directUrl = `https://labs.google/fx/api/trpc/flow.projectInitialData?input=${input}`;
      const response = await slotSession.fetch(directUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          referer: `https://labs.google/fx/tools/flow/project/${candidate}`,
        },
      });
      if (response.ok) {
        const payload = await response.json();
        data = payload && payload.result && payload.result.data && payload.result.data.json;
        if (data) {
          projectId = candidate;
          break;
        }
      }
    } catch {
      // Try the next known project identity, then the mounted WebView fallback.
    }
  }

  if (!data) {
    if (!wv || wv.isDestroyed()) wv = findFlowWebview(slot.id);
    if (!wv || wv.isDestroyed()) {
      throw new Error('Không tải được Google Flow Init từ phiên tài khoản hiện tại.');
    }
    const webviewUrl = wv.getURL();
    const mountedProjectId = webviewUrl.match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1] || '';
    const webviewCandidates = [mountedProjectId, ...projectCandidates]
      .filter((value, index, values) => value && values.indexOf(value) === index);
    const fetchInitialDataInWebview = candidates => wv.executeJavaScript(`
      (async (candidates) => {
        const statuses = [];
        for (const candidate of candidates) {
          const input = encodeURIComponent(JSON.stringify({ json: { projectId: candidate } }));
          const response = await fetch('https://labs.google/fx/api/trpc/flow.projectInitialData?input=' + input, {
            credentials: 'include',
            headers: { 'accept': '*/*', 'content-type': 'application/json' }
          });
          statuses.push(candidate + ':' + response.status);
          if (!response.ok) continue;
          const payload = await response.json();
          const value = payload && payload.result && payload.result.data && payload.result.data.json;
          if (value) return { value, projectId: candidate, statuses };
        }
        return { value: null, projectId: '', statuses };
      })(${JSON.stringify(candidates)})
    `, true);
    let webviewResult = await fetchInitialDataInWebview(webviewCandidates);

    // Never accept a project merely because Flow redirected to its URL. A stale
    // tile can still exist while projectInitialData returns 400.
    if (!webviewResult?.value) {
      const rejected = new Set(webviewCandidates);
      const rejectedProjectIds = [...rejected];
      await wv.loadURL('https://labs.google/fx/tools/flow');
      let visibleProjectIds = [];
      for (let attempt = 0; attempt < 30 && visibleProjectIds.length === 0; attempt += 1) {
        visibleProjectIds = await wv.executeJavaScript(`
          (() => Array.from(document.querySelectorAll('a[href*="/project/"]'))
            .map(link => (link.href.match(/\\/project\\/([a-zA-Z0-9_-]+)/) || [])[1] || '')
            .filter(Boolean))
        `, true).catch(() => []);
        visibleProjectIds = [...new Set(visibleProjectIds)].filter(candidate => !rejectedProjectIds.includes(candidate));
        if (visibleProjectIds.length === 0) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (visibleProjectIds.length > 0) {
        webviewResult = await fetchInitialDataInWebview(visibleProjectIds);
        if (webviewResult?.value) {
          await wv.loadURL(`https://labs.google/fx/tools/flow/project/${webviewResult.projectId}`);
        }
      }
    }
    if (!webviewResult?.value) {
      throw new Error('Project Flow hiện tại không còn hợp lệ. Hãy bấm “Tạo project” ở thẻ tài khoản.');
    }
    projectId = webviewResult.projectId || mountedProjectId;
    data = webviewResult.value;
  }

  if (!data) throw new Error('projectInitialData response không hợp lệ');
  projectId = String(data.projectId || projectId);
  slot.projectId = projectId;
  capturedAuth.projectId = projectId;
  saveSettings({ lastProjectUrl: `https://labs.google/fx/tools/flow/project/${projectId}` });
  const external = (((data.projectContents || {}).externalReferenceMedia) || []);
  const voices = external
    .filter(entry => entry && entry.mediaType === 'AUDIO' && entry.mediaId)
    .map(entry => {
      const generated = (((entry || {}).media || {}).audio || {}).generatedAudio || {};
      const voiceConfig = Array.isArray(generated.voiceConfigs) ? generated.voiceConfigs[0] : null;
      const isPreset = Boolean(generated.isPresetAudioSample);
      const mediaId = String(entry.mediaId);
      return {
        mediaId,
        name: String(entry.workflowDisplayName || generated.name || (voiceConfig && voiceConfig.speaker) || mediaId),
        description: String(generated.description || generated.voicePerformance || ''),
        sampleUrl: String(generated.audioSamplePath || (
          isPreset ? '' : `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}`
        )),
        baseVoice: String((voiceConfig && voiceConfig.voice) || generated.name || ''),
        custom: !isPreset,
      };
    });
  console.log(`[SLOT-${slot.id}][FLOW-INIT] project=${projectId} voices=${voices.length}`);
  const omniFamily = (((data.modelConfig || {}).videoModelFamilies) || [])
    .find(family => family && family.id === 'abra');
  const omniUsages = omniFamily && Array.isArray(omniFamily.usages)
    ? omniFamily.usages.map(usage => ({
        key: usage.key,
        maxImageInputs: usage.maxImageInputs,
        maxAudioReferences: usage.inputSpec && usage.inputSpec.maxAudioReferences,
        maxInputV2vVideoDuration: usage.inputSpec && usage.inputSpec.maxInputV2vVideoDuration,
        videoLengthSeconds: usage.videoLengthSeconds,
      }))
    : [];
  const serviceTier = String(((data.userData || {}).serviceTier) || '');
  const modelPricing = [
    ...((((data.modelConfig || {}).imageModelFamilies) || []).flatMap(family => (
      (family.usages || []).map(usage => ({
        kind: 'image',
        familyId: String(family.id || ''),
        familyName: String(family.displayName || ''),
        usageKey: String(usage.key || ''),
        cost: (((usage.creditMapping || {})[serviceTier] || {}).cost) ?? 'UNAVAILABLE',
        maxImageInputs: usage.maxImageInputs ?? ((usage.inputSpec || {}).maxImageInputs),
        maxVideoInputs: usage.maxVideoInputs ?? ((usage.inputSpec || {}).maxVideoInputs),
        maxAudioReferences: (usage.inputSpec || {}).maxAudioReferences,
        maxInputV2vVideoDuration: (usage.inputSpec || {}).maxInputV2vVideoDuration,
        requirements: usage.requirements || [],
        supportedAspectRatios: usage.supportedAspectRatios || [],
      }))
    ))),
    ...((((data.modelConfig || {}).videoModelFamilies) || []).flatMap(family => (
      (family.usages || []).map(usage => ({
        kind: 'video',
        familyId: String(family.id || ''),
        familyName: String(family.displayName || ''),
        usageKey: String(usage.key || ''),
        cost: (((usage.creditMapping || {})[serviceTier] || {}).cost) ?? 'UNAVAILABLE',
        maxImageInputs: usage.maxImageInputs ?? ((usage.inputSpec || {}).maxImageInputs),
        maxVideoInputs: usage.maxVideoInputs ?? ((usage.inputSpec || {}).maxVideoInputs),
        maxAudioReferences: (usage.inputSpec || {}).maxAudioReferences,
        maxInputV2vVideoDuration: (usage.inputSpec || {}).maxInputV2vVideoDuration,
        videoLengthSeconds: usage.videoLengthSeconds,
        requirements: usage.requirements || [],
        supportedAspectRatios: usage.supportedAspectRatios || [],
      }))
    ))),
  ];

  return {
    projectId,
    projectName: String(data.projectName || ''),
    serviceTier,
    voices,
    omniUsages,
    modelPricing,
  };
});

ipcMain.handle('set-manual-auth', (_, { bearerToken, projectId }) => {
  if (bearerToken) {
    capturedAuth.bearerToken = bearerToken.startsWith('Bearer ') ? bearerToken : 'Bearer ' + bearerToken;
  }
  if (projectId) capturedAuth.projectId = projectId;
  capturedAuth.lastCaptured = new Date().toISOString();
  console.log('[AUTH] Manual auth set. Bearer:', !!capturedAuth.bearerToken, 'ProjectId:', capturedAuth.projectId);
  return true;
});

// ── IPC: Force sync cookies + token từ webview session ────────────────
ipcMain.handle('sync-session', async () => {
  try {
    // 1. Refresh cookies từ Electron session
    await refreshCapturedCookies();

    // 2. Lấy Bearer token mới từ webview bằng cách trigger 1 lightweight API call
    const wv = findFlowWebview();
    if (wv) {
      // Inject JS để trigger API call → interceptor sẽ capture Bearer token mới
      await wv.executeJavaScript(`
        (async () => {
          try {
            const r = await fetch('https://labs.google/fx/api/trpc/user.getCredits', {
              credentials: 'include',
              headers: { 'content-type': 'application/json' }
            });
            console.log('[SYNC] Token refresh triggered, status:', r.status);
          } catch(e) { console.warn('[SYNC] Token trigger failed:', e.message); }
        })();
      `).catch(() => { });
    }

    // 3. Đợi ngắn để interceptor kịp capture token mới
    await new Promise(r => setTimeout(r, 1500));

    const cookieCount = String(accountSlots[0].cookies || '').split(';').filter(Boolean).length;
    console.log(`[SYNC] Session synced: cookies=${cookieCount}, token=${!!capturedAuth.bearerToken}`);
    return {
      success: true,
      hasBearerToken: !!capturedAuth.bearerToken,
      cookieCount,
      projectId: capturedAuth.projectId,
      lastCaptured: capturedAuth.lastCaptured,
    };
  } catch (err) {
    console.error('[SYNC] Session sync failed:', err.message);
    return { success: false, error: err.message };
  }
});

// ── IPC: Get all slots status ─────────────────────────────────────────
ipcMain.handle('get-all-slots', () => {
  accountSlots.forEach(slot => {
    if (slot.status === 'connected' && !slot.email) {
      fetchSlotSession(slot.id).catch(() => {});
    }
  });
  return accountSlots.map(slot => ({
    id: slot.id,
    status: slot.status,
    hasBearerToken: !!slot.bearerToken,
    projectId: slot.projectId,
    lastCaptured: slot.lastCaptured,
    partition: slot.partition,
    email: slot.email || null,
    displayName: slot.displayName || null,
    avatar: slot.avatar || null,
  }));
});

// ── IPC: Logout a specific slot ───────────────────────────────────────
// Xóa toàn bộ cookies + storage của partition → lần sau reload sẽ không auto-login
ipcMain.handle('logout-slot', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  try {
    const ses = session.fromPartition(slot.partition);

    // Xóa toàn bộ cookies (google.com + labs.google + tất cả domain)
    const allCookies = await ses.cookies.get({});
    await Promise.all(allCookies.map(c => {
      const url = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
      return ses.cookies.remove(url, c.name).catch(() => {});
    }));

    // Xóa storage data (localStorage, sessionStorage, IndexedDB, cache...)
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
    }).catch(() => {});

    await ses.clearCache().catch(() => {});

    // Reset in-memory slot state
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

    // Nếu đang hiển thị webview của slot này → reload về trang chính
    try {
      const wv = findFlowWebview(slotId);
      if (wv) wv.loadURL('https://labs.google/fx/tools/flow');
    } catch (e) {}

    // Notify renderer để cập nhật UI ngay
    if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
      runtime.mainWindow.webContents.send('slot-logged-out', { slotId });
    }

    console.log(`[SLOT-${slotId}][LOGOUT] ✅ Cleared cookies + storage + memory state`);
    return { success: true, slotId };
  } catch (err) {
    console.error(`[SLOT-${slotId}][LOGOUT] Failed:`, err.message);
    return { success: false, error: err.message };
  }
});

// ── IPC: Switch WebView partition to a specific slot ──────────────────
ipcMain.handle('switch-webview-slot', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  setActiveWebviewSlot(slotId); // track for findFlowWebview
  if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
    runtime.mainWindow.webContents.send('webview-switch-slot', {
      slotId,
      partition: slot.partition,
    });
  }
  console.log(`[SLOT] Switched active webview slot to ${slotId}`);
  return { slotId, partition: slot.partition };
});

// ── IPC: Open real Chromium incognito window for login ──────────────
// Dùng partition tạm (non-persist) → ẩn danh thật, login xong copy cookies sang slot chính (persist)
ipcMain.handle('open-incognito-login', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);

  // Partition tạm — non-persist = ẩn danh thật (tự xóa khi đóng window)
  const incogPartition = `incognito-${slotId}-${Date.now()}`;
  const ses = session.fromPartition(incogPartition);

  // Clean UA — remove Electron/app name
  const chromeVersion = process.versions.chrome || '130.0.0.0';
  const cleanUA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

  // Override sec-ch-ua headers tại session level → Google thấy Chrome thật
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://accounts.google.com/*', 'https://*.google.com/*', 'https://labs.google/*'] },
    (details, callback) => {
      const h = details.requestHeaders;
      h['User-Agent'] = cleanUA;
      h['user-agent'] = cleanUA;
      h['sec-ch-ua'] = `"Chromium";v="${chromeVersion.split('.')[0]}", "Google Chrome";v="${chromeVersion.split('.')[0]}", "Not-A.Brand";v="99"`;
      h['sec-ch-ua-mobile'] = '?0';
      h['sec-ch-ua-platform'] = '"macOS"';
      callback({ cancel: false, requestHeaders: h });
    }
  );

  // Inject anti-detect script
  const antiDetectScript = path.join(IPC_DIR, 'anti-detect.js');
  if (require('fs').existsSync(antiDetectScript)) {
    ses.setPreloads([antiDetectScript]);
  }

  const loginWin = new BrowserWindow({
    width: 1100,
    height: 800,
    title: `Đăng nhập Google (Ẩn danh) — Slot ${slotId + 1}`,
    backgroundColor: '#202124',
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
    },
  });

  loginWin.setMenuBarVisibility(false);

  // Hàm copy cookies từ session ẩn danh → slot chính (persist)
  async function copyCookiesToSlot() {
    try {
      const slotSes = session.fromPartition(slot.partition);
      // Xóa cookies cũ của slot trước
      const oldCookies = await slotSes.cookies.get({}).catch(() => []);
      await Promise.all((oldCookies || []).map(c => {
        const url = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
        return slotSes.cookies.remove(url, c.name).catch(() => {});
      }));
      // Copy cookies mới từ incognito session
      const newCookies = await ses.cookies.get({}).catch(() => []);
      let copied = 0;
      for (const c of (newCookies || [])) {
        try {
          await slotSes.cookies.set({
            url: `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite || 'unspecified',
            expirationDate: c.expirationDate,
          });
          copied++;
        } catch {}
      }
      console.log(`[SLOT-${slotId}][INCOGNITO] Copied ${copied}/${newCookies.length} cookies to ${slot.partition}`);
    } catch (err) {
      console.error(`[SLOT-${slotId}][INCOGNITO] Cookie copy failed:`, err.message);
    }
  }

  // Intercept auth token từ cửa sổ login
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://aisandbox-pa.googleapis.com/*', 'https://*.googleapis.com/*'] },
    (details, callback) => {
      const h = details.requestHeaders;
      h['User-Agent'] = cleanUA;
      h['user-agent'] = cleanUA;

      const authHeader = h['Authorization'] || h['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        // Collapse any accidental "Bearer Bearer ..." into a single prefix.
        slot.bearerToken = authHeader.replace(/^(Bearer\s+)+/i, 'Bearer ');
        slot.lastCaptured = new Date().toISOString();
        slot.status = 'connected';
        slot.userAgent = cleanUA;
        console.log(`[SLOT-${slotId}][INCOGNITO] ✅ Bearer token captured!`);

        // Copy cookies từ incognito → slot chính (persist)
        copyCookiesToSlot().then(() => {
          refreshCapturedCookies(slotId);
        });

        // Fetch session info (email, avatar)
        setTimeout(() => {
          fetchSlotSession(slotId).then(s => {
            if (s) {
              if (s.email) slot.email = s.email;
              if (s.name) slot.displayName = s.name;
              if (s.avatar) slot.avatar = s.avatar;
              if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
                runtime.mainWindow.webContents.send('slot-session-updated', { slotId, ...s });
              }
            }
          }).catch(() => {});
        }, 2000);

        // Notify UI
        if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
          runtime.mainWindow.webContents.send('auth-captured', {
            hasBearerToken: true,
            projectId: slot.projectId,
            lastCaptured: slot.lastCaptured,
          });
        }

        if (h['x-browser-validation']) slot.xBrowserValidation = h['x-browser-validation'];
        if (h['x-browser-channel']) slot.xBrowserChannel = h['x-browser-channel'];
        if (h['x-browser-year']) slot.xBrowserYear = h['x-browser-year'];
        if (h['x-browser-copyright']) slot.xBrowserCopyright = h['x-browser-copyright'];
        if (h['x-client-data']) slot.xClientData = h['x-client-data'];
      }

      const m = details.url.match(/projects\/([0-9a-f-]{36})/);
      if (m) {
        slot.projectId = m[1];
        if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
          runtime.mainWindow.webContents.send('auth-captured', {
            hasBearerToken: !!slot.bearerToken,
            projectId: slot.projectId,
            lastCaptured: slot.lastCaptured,
          });
        }
      }

      callback({ cancel: false, requestHeaders: h });
    }
  );

  loginWin.loadURL('https://labs.google/fx/tools/flow');

  // Auto-close khi user đã vào project (có token + projectId)
  const checkInterval = setInterval(() => {
    if (slot.bearerToken && slot.projectId) {
      clearInterval(checkInterval);
      setTimeout(() => {
        if (loginWin && !loginWin.isDestroyed()) {
          loginWin.close();
        }
      }, 3000);
    }
  }, 2000);

  loginWin.on('closed', () => {
    clearInterval(checkInterval);
    // Cleanup: xóa session tạm
    ses.clearStorageData().catch(() => {});
    console.log(`[SLOT-${slotId}][INCOGNITO] Login window closed, temp session cleaned`);
  });

  console.log(`[SLOT-${slotId}][INCOGNITO] Opened incognito login (partition: ${incogPartition})`);
  return { success: true, slotId };
});

// ── IPC: Pick random available slot ──────────────────────────────────
ipcMain.handle('pick-random-slot', () => {
  try {
    const slot = pickRandomSlot();
    return { slotId: slot.id, projectId: slot.projectId };
  } catch (err) {
    return { slotId: 0, projectId: accountSlots[0].projectId, fallback: true };
  }
});

// ── IPC: Sync session for a specific slot ────────────────────────────
ipcMain.handle('sync-slot-session', async (_, { slotId = 0 } = {}) => {
  try {
    const slot = getSlot(slotId);
    await refreshCapturedCookies(slotId);
    await fetchSlotSession(slotId).catch(() => {});

    // Trigger fetch qua webview sinh đúng partition (slot 0 dùng flowWebview chính)
    const wv = findFlowWebview();
    if (wv && slotId === 0) {
      await wv.executeJavaScript(`
        fetch('https://labs.google/fx/api/trpc/user.getCredits', { credentials: 'include' }).catch(()=>{});
      `).catch(() => { });
      await new Promise(r => setTimeout(r, 1500));
    }

    const cookieCount = slot.cookies.split(';').filter(Boolean).length;
    console.log(`[SLOT-${slotId}][SYNC] Session synced: cookies=${cookieCount}, token=${!!slot.bearerToken}, email=${slot.email}`);
    return {
      success: true,
      slotId,
      hasBearerToken: !!slot.bearerToken,
      cookieCount,
      projectId: slot.projectId,
      email: slot.email || null,
      displayName: slot.displayName || null,
      avatar: slot.avatar || null,
      lastCaptured: slot.lastCaptured,
    };
  } catch (err) {
    console.error(`[SLOT-${slotId}][SYNC] Failed:`, err.message);
    return { success: false, slotId, error: err.message };
  }
});

// ── IPC: Mở cửa sổ đăng nhập tự động (popup BrowserWindow) ──────────────
// Dùng BrowserWindow thật thay vì webview tag → Google không chặn
// Sau khi login xong, cửa sổ tự đóng và cookies được sync về slot
ipcMain.handle('open-login-window', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);

  const loginWin = new BrowserWindow({
    width: 950,
    height: 700,
    title: `Đăng nhập Google — Slot ${slotId + 1}`,
    webPreferences: {
      partition: slot.partition,  // dùng đúng session của slot
      nodeIntegration: false,
      contextIsolation: true,
      // KHÔNG inject anti-detect.js vào login window — gây Google block
    },
    autoHideMenuBar: true,
    resizable: true,
  });

  // Override User-Agent: xóa chuỗi "Electron/xx" khỏi UA trước khi load bất kỳ trang nào
  // → Google dùng UA để detect embedded WebView và block login nếu thấy "Electron"
  const cleanLoginUA = DEFAULTS.userAgent;
  loginWin.webContents.setUserAgent(cleanLoginUA);

  // XÓA preload khỏi session trước khi mở trang Google login + set clean UA
  const ses = session.fromPartition(slot.partition);
  ses.setUserAgent(cleanLoginUA);
  const antiDetectScript = path.join(IPC_DIR, 'anti-detect.js');
  ses.setPreloads([]);

  loginWin.on('closed', () => {
    if (require('fs').existsSync(antiDetectScript)) {
      ses.setPreloads([antiDetectScript]);
    }
    console.log(`[SLOT-${slotId}][LOGIN-WIN] Closed — preload restored`);
  });

  loginWin.loadURL('https://labs.google/fx/tools/flow');

  // Monitor: khi user login xong và navigate về labs.google → capture & đóng cửa sổ
  let hasNavigatedToAuth = false; // phải đi qua accounts.google trước

  loginWin.webContents.on('did-navigate', async (event, url) => {
    console.log(`[SLOT-${slotId}][LOGIN-WIN] Navigated:`, url);

    // Ghi nhận khi redirect sang trang login Google
    if (url.includes('accounts.google.com') || url.includes('myaccount.google.com')) {
      hasNavigatedToAuth = true;
      console.log(`[SLOT-${slotId}][LOGIN-WIN] → Google login page detected`);
    }

    // Chỉ capture khi ĐÃ qua accounts.google (login thật) rồi mới về labs.google
    if (url.startsWith('https://labs.google') && hasNavigatedToAuth) {
      console.log(`[SLOT-${slotId}][LOGIN-WIN] ✅ Login confirmed! Syncing cookies...`);

      await new Promise(r => setTimeout(r, 2000));
      await refreshCapturedCookies(slotId);

      if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
        runtime.mainWindow.webContents.send('slot-login-done', { slotId });
      }

      setTimeout(() => {
        if (!loginWin.isDestroyed()) loginWin.close();
      }, 1500);
    }
  });

  loginWin.on('closed', () => {
    console.log(`[SLOT-${slotId}][LOGIN-WIN] Closed`);
  });

  return { success: true, slotId };
});

// ── IPC: Trigger auto-enter project on demand (e.g. after account switch) ──
ipcMain.handle('auto-enter-project', async () => {
  try {
    const wv = findFlowWebview();
    if (!wv) return { success: false, reason: 'webview not found' };

    const pageState = await wv.executeJavaScript(`
      (function() {
        var url = window.location.href;
        var hasTextbox = !!document.querySelector('div[contenteditable="true"][role="textbox"]');
        var projectLinks = Array.from(document.querySelectorAll('a[href*="/project/"]'));
        var newProjectBtn = null;
        var buttons = Array.from(document.querySelectorAll('button'));
        for (var i = 0; i < buttons.length; i++) {
          var txt = (buttons[i].textContent || '').trim();
          if (txt.indexOf('New project') !== -1) { newProjectBtn = i; break; }
        }
        return { url, hasTextbox, projectCount: projectLinks.length, hasNewProjectBtn: newProjectBtn !== null, newProjectBtnIdx: newProjectBtn };
      })()
    `);

    if (pageState.hasTextbox) {
      if (pageState.url && pageState.url.includes('/project/')) {
        saveSettings({ lastProjectUrl: pageState.url });
        // Extract và set projectId nếu chưa có
        const m = pageState.url.match(/\/project\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !capturedAuth.projectId) {
          capturedAuth.projectId = m[1];
          console.log('[AUTO-ENTER-IPC] ✅ Extracted projectId from URL:', capturedAuth.projectId);
          if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) runtime.mainWindow.webContents.send('auto-entered-project');
        }
      }
      return { success: true, action: 'already-in-project', projectId: capturedAuth.projectId };
    }

    if (pageState.hasNewProjectBtn) {
      if (pageState.projectCount > 0) {
        // Click first existing project
        const projectUrl = await wv.executeJavaScript(`
          (function() {
            var links = document.querySelectorAll('a[href*="/project/"]');
            if (links.length > 0) { var href = links[0].href; links[0].click(); return href; }
            return null;
          })()
        `);
        if (projectUrl) {
          saveSettings({ lastProjectUrl: projectUrl });
          const m = projectUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
          if (m && m[1]) {
            capturedAuth.projectId = m[1];
            console.log('[AUTO-ENTER-IPC] ✅ Extracted projectId:', capturedAuth.projectId);
          }
        }
        if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) runtime.mainWindow.webContents.send('auto-entered-project');
        return { success: true, action: 'entered-existing', projectId: capturedAuth.projectId };
      } else {
        // Click "New project"
        await wv.executeJavaScript(`
          (function() {
            var buttons = Array.from(document.querySelectorAll('button'));
            for (var i = 0; i < buttons.length; i++) {
              if ((buttons[i].textContent || '').trim().indexOf('New project') !== -1) {
                buttons[i].click(); return true;
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
              const m = url.match(/\/project\/([a-zA-Z0-9_-]+)/);
              if (m && m[1]) {
                capturedAuth.projectId = m[1];
                console.log('[AUTO-ENTER-IPC] ✅ Extracted projectId from new project:', capturedAuth.projectId);
                if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) runtime.mainWindow.webContents.send('auto-entered-project');
              }
            }
          } catch (e) { }
        }, 5000);
        if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) runtime.mainWindow.webContents.send('auto-entered-project');
        return { success: true, action: 'created-new' };
      }
    }
    return { success: false, reason: 'page not ready' };
  } catch (e) {
    return { success: false, reason: e.message };
  }
});


ipcMain.handle('extract-auth-from-webview', async () => {
  return {
    hasBearerToken: !!capturedAuth.bearerToken,
    projectId: capturedAuth.projectId,
  };
});

};
