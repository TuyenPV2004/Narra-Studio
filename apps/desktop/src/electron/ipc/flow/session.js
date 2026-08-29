'use strict';

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
    getSlot,
    pickRandomSlot,
    refreshCapturedCookies,
    fetchSlotSession,
    restoreSlotSession,
    restoreAllSlotSessions,
    getIsRestoringSessions,
    findFlowWebview,
  } = dependencies;

  const IPC_DIR = path.join(__dirname, '..');

ipcMain.handle('copy-to-clipboard', (_, text) => { clipboard.writeText(text); return true; });

ipcMain.handle('get-auth-info', (_, { slotId } = {}) => {
  if (typeof slotId === 'number') {
    const slot = getSlot(slotId);
    return {
      hasBearerToken: !!slot.bearerToken,
      bearerPreview: slot.bearerToken ? slot.bearerToken.substring(0, 25) + '...' : null,
      projectId: slot.projectId || null,
      lastCaptured: slot.lastCaptured || null,
    };
  }
  const anyConnected = accountSlots.some(s => !!s.bearerToken);
  const activeSlot = accountSlots.find(s => !!s.bearerToken) || accountSlots[0];
  return {
    hasBearerToken: anyConnected,
    bearerPreview: activeSlot?.bearerToken ? activeSlot.bearerToken.substring(0, 25) + '...' : null,
    projectId: activeSlot?.projectId || null,
    lastCaptured: activeSlot?.lastCaptured || null,
  };
});

ipcMain.handle('get-all-slots', async () => {
  for (const slot of accountSlots) {
    if (slot.status === 'empty' && typeof restoreSlotSession === 'function') {
      try {
        const ses = session.fromPartition(slot.partition);
        const [googleCookies, labsCookies] = await Promise.all([
          ses.cookies.get({ domain: '.google.com' }).catch(() => []),
          ses.cookies.get({ domain: 'labs.google' }).catch(() => []),
        ]);
        if (googleCookies.length > 0 || labsCookies.length > 0) {
          await restoreSlotSession(slot.id).catch(() => {});
        }
      } catch {}
    } else if (slot.status === 'connected' && !slot.email) {
      fetchSlotSession(slot.id).catch(() => {});
    }
  }

  return accountSlots.map(slot => ({
    id: slot.id,
    status: slot.status,
    hasBearerToken: !!slot.bearerToken,
    hasSession: slot.status === 'authenticated' || slot.status === 'connected',
    projectId: slot.projectId || null,
    lastCaptured: slot.lastCaptured || null,
    partition: slot.partition,
    email: slot.email || null,
    displayName: slot.displayName || null,
    avatar: slot.avatar || null,
  }));
});

ipcMain.handle('create-flow-project', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  const ses = session.fromPartition(slot.partition);
  const cleanUA = slot.userAgent || DEFAULTS.userAgent;
  ses.setUserAgent(cleanUA);
  const tempWin = new BrowserWindow({
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
  const wv = tempWin.webContents;

  try {
    const previousProjectId = String(
      (typeof wv.getURL === 'function' ? wv.getURL() : '').match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1]
        || slot.projectId
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
      if (!clicked) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    let projectId = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const currentUrl = typeof wv.getURL === 'function' ? wv.getURL() : '';
      const matched = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1];
      if (matched && matched !== previousProjectId) {
        projectId = matched;
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

ipcMain.handle('get-flow-project-initial-data', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  const projectCandidates = [slot.projectId]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  if (!projectCandidates.length) throw new Error(`Slot ${slot.id} chưa có Google Flow project nào. Vui lòng mở phiên Flow cho slot này trước.`);
  let data = null;
  let projectId = projectCandidates[0];

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
    } catch {}
  }

  if (!data) {
    throw new Error('Không tải được Google Flow Init từ phiên tài khoản hiện tại. Hãy đồng bộ lại slot hoặc tạo project mới.');
  }

  if (!data) throw new Error('projectInitialData response không hợp lệ');
  projectId = String(data.projectId || projectId);
  slot.projectId = projectId;
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

ipcMain.handle('set-manual-auth', (_, { bearerToken, projectId, slotId = 0 }) => {
  const slot = getSlot(slotId);
  if (bearerToken) {
    slot.bearerToken = bearerToken.startsWith('Bearer ') ? bearerToken : 'Bearer ' + bearerToken;
  }
  if (projectId) slot.projectId = projectId;
  slot.lastCaptured = new Date().toISOString();
  console.log(`[SLOT-${slot.id}][AUTH] Manual auth set. Bearer:`, !!slot.bearerToken, 'ProjectId:', slot.projectId);
  return true;
});

ipcMain.handle('sync-session', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  try {
    await refreshCapturedCookies(slot.id);

    const cookieCount = String(slot.cookies || '').split(';').filter(Boolean).length;
    console.log(`[SLOT-${slot.id}][SYNC] Session synced: cookies=${cookieCount}, token=${!!slot.bearerToken}`);
    return {
      success: true,
      hasBearerToken: !!slot.bearerToken,
      cookieCount,
      projectId: slot.projectId || null,
      lastCaptured: slot.lastCaptured || null,
    };
  } catch (err) {
    console.error(`[SLOT-${slot.id}][SYNC] Session sync failed:`, err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('logout-slot', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  try {
    const ses = session.fromPartition(slot.partition);

    const allCookies = await ses.cookies.get({});
    await Promise.all(allCookies.map(c => {
      const url = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
      return ses.cookies.remove(url, c.name).catch(() => {});
    }));

    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
    }).catch(() => {});

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

ipcMain.handle('open-flow-session', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  const flowWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    title: `Google Flow — Slot ${slotId + 1}`,
    backgroundColor: '#202124',
    webPreferences: {
      partition: slot.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  flowWindow.setMenuBarVisibility(false);
  flowWindow.webContents.setUserAgent(slot.userAgent || DEFAULTS.userAgent);
  const targetUrl = slot.projectId
    ? `https://labs.google/fx/tools/flow/project/${encodeURIComponent(slot.projectId)}`
    : 'https://labs.google/fx/tools/flow';
  await flowWindow.loadURL(targetUrl);
  return { success: true, slotId, partition: slot.partition };
});

ipcMain.handle('open-incognito-login', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  const ses = session.fromPartition(slot.partition);

  const chromeVersion = process.versions.chrome || '130.0.0.0';
  const cleanUA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

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

  const antiDetectScript = path.join(IPC_DIR, 'anti-detect.js');
  if (require('fs').existsSync(antiDetectScript)) {
    ses.setPreloads([antiDetectScript]);
  }

  const loginWin = new BrowserWindow({
    width: 1100,
    height: 800,
    title: `Đăng nhập Google — Slot ${slotId + 1}`,
    backgroundColor: '#202124',
    webPreferences: {
      partition: slot.partition,
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
    },
  });

  loginWin.setMenuBarVisibility(false);

  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://aisandbox-pa.googleapis.com/*', 'https://*.googleapis.com/*'] },
    (details, callback) => {
      const h = details.requestHeaders;
      h['User-Agent'] = cleanUA;
      h['user-agent'] = cleanUA;

      const authHeader = h['Authorization'] || h['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        slot.bearerToken = authHeader.replace(/^(Bearer\s+)+/i, 'Bearer ');
        slot.lastCaptured = new Date().toISOString();
        slot.status = 'connected';
        slot.userAgent = cleanUA;
        console.log(`[SLOT-${slotId}][LOGIN] ✅ Bearer token captured!`);

        refreshCapturedCookies(slotId);

        setTimeout(() => {
          fetchSlotSession(slotId).then(s => {
            if (s && s.user) {
              if (s.user.email) slot.email = s.user.email;
              if (s.user.name) slot.displayName = s.user.name;
              if (s.user.avatar) slot.avatar = s.user.avatar;
              if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
                runtime.mainWindow.webContents.send('slot-session-updated', { slotId, ...s.user });
              }
            }
          }).catch(() => {});
        }, 1000);

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
    refreshCapturedCookies(slotId);
    console.log(`[SLOT-${slotId}][LOGIN] Login window closed, session persisted in ${slot.partition}`);
  });

  console.log(`[SLOT-${slotId}][LOGIN] Opened login window for ${slot.partition}`);
  return { success: true, slotId };
});

ipcMain.handle('pick-random-slot', () => {
  try {
    const slot = pickRandomSlot();
    return { slotId: slot.id, projectId: slot.projectId };
  } catch (err) {
    return { slotId: 0, projectId: accountSlots[0].projectId, fallback: true };
  }
});

ipcMain.handle('sync-slot-session', async (_, { slotId = 0 } = {}) => {
  try {
    const slot = getSlot(slotId);
    if (typeof restoreSlotSession === 'function') {
      await restoreSlotSession(slotId);
    } else {
      await refreshCapturedCookies(slotId);
      await fetchSlotSession(slotId).catch(() => {});
    }

    const cookieCount = (slot.cookies || '').split(';').filter(Boolean).length;
    console.log(`[SLOT-${slotId}][SYNC] Session synced: status=${slot.status}, cookies=${cookieCount}, token=${!!slot.bearerToken}, email=${slot.email}`);
    return {
      success: true,
      slotId,
      status: slot.status,
      hasBearerToken: !!slot.bearerToken,
      hasSession: slot.status === 'authenticated' || slot.status === 'connected',
      cookieCount,
      projectId: slot.projectId || null,
      email: slot.email || null,
      displayName: slot.displayName || null,
      avatar: slot.avatar || null,
      lastCaptured: slot.lastCaptured || null,
    };
  } catch (err) {
    console.error(`[SLOT-${slotId}][SYNC] Failed:`, err.message);
    return { success: false, slotId, error: err.message };
  }
});

ipcMain.handle('open-login-window', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);

  const loginWin = new BrowserWindow({
    width: 950,
    height: 700,
    title: `Đăng nhập Google — Slot ${slotId + 1}`,
    webPreferences: {
      partition: slot.partition,
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    resizable: true,
  });

  const cleanLoginUA = DEFAULTS.userAgent;
  loginWin.webContents.setUserAgent(cleanLoginUA);

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

  let hasNavigatedToAuth = false;

  loginWin.webContents.on('did-navigate', async (event, url) => {
    console.log(`[SLOT-${slotId}][LOGIN-WIN] Navigated:`, url);

    if (url.includes('accounts.google.com') || url.includes('myaccount.google.com')) {
      hasNavigatedToAuth = true;
      console.log(`[SLOT-${slotId}][LOGIN-WIN] → Google login page detected`);
    }

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

ipcMain.handle('auto-enter-project', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  try {
    const wv = findFlowWebview(slot.id);
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

        const m = pageState.url.match(/\/project\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !slot.projectId) {
          slot.projectId = m[1];
          console.log(`[SLOT-${slot.id}][AUTO-ENTER-IPC] ✅ Extracted projectId from URL:`, slot.projectId);
          if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
            runtime.mainWindow.webContents.send('auto-entered-project', { slotId: slot.id, projectId: slot.projectId });
          }
        }
      }
      return { success: true, action: 'already-in-project', projectId: slot.projectId };
    }

    if (pageState.hasNewProjectBtn) {
      if (pageState.projectCount > 0) {
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
            slot.projectId = m[1];
            console.log(`[SLOT-${slot.id}][AUTO-ENTER-IPC] ✅ Extracted projectId:`, slot.projectId);
          }
        }
        if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
          runtime.mainWindow.webContents.send('auto-entered-project', { slotId: slot.id, projectId: slot.projectId });
        }
        return { success: true, action: 'entered-existing', projectId: slot.projectId };
      } else {
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
                slot.projectId = m[1];
                console.log(`[SLOT-${slot.id}][AUTO-ENTER-IPC] ✅ Extracted projectId from new project:`, slot.projectId);
                if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
                  runtime.mainWindow.webContents.send('auto-entered-project', { slotId: slot.id, projectId: slot.projectId });
                }
              }
            }
          } catch (e) { }
        }, 5000);
        if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) {
          runtime.mainWindow.webContents.send('auto-entered-project', { slotId: slot.id });
        }
        return { success: true, action: 'created-new' };
      }
    }
    return { success: false, reason: 'page not ready' };
  } catch (e) {
    return { success: false, reason: e.message };
  }
});

ipcMain.handle('extract-auth-from-webview', async (_, { slotId = 0 } = {}) => {
  const slot = getSlot(slotId);
  return {
    hasBearerToken: !!slot.bearerToken,
    projectId: slot.projectId || null,
  };
});
};
