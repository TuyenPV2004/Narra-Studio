'use strict';

const registry = require('../providers/registry');

module.exports = function registerProviderIpc(dependencies) {
  const {
    ipcMain,
    loadSettings,
    saveSettings,
    accountSlots,
    avisProvider,
    getAvisMediaRuntime,
    setupRequestInterception,
    teardownRequestInterception,
    captchaBridge,
    refreshCapturedCookies,
  } = dependencies;
  let veo3CookieRefreshTimer = null;
  let veo3InitialCookieRefreshTimer = null;

  
  const stopVeo3Runtime = () => {
    if (veo3CookieRefreshTimer) clearInterval(veo3CookieRefreshTimer);
    if (veo3InitialCookieRefreshTimer) clearTimeout(veo3InitialCookieRefreshTimer);
    veo3CookieRefreshTimer = null;
    veo3InitialCookieRefreshTimer = null;
    teardownRequestInterception?.();
    captchaBridge?.stop?.();
  };

  const startVeo3Runtime = () => {
    setupRequestInterception?.();
    try { captchaBridge?.start?.(); } catch (error) {
      console.warn('[PROVIDER][VEO3] CAPTCHA bridge start failed:', error?.message || error);
    }
    if (veo3CookieRefreshTimer) clearInterval(veo3CookieRefreshTimer);
    if (veo3InitialCookieRefreshTimer) clearTimeout(veo3InitialCookieRefreshTimer);
    veo3InitialCookieRefreshTimer = setTimeout(() => refreshCapturedCookies?.(), 5000);
    veo3CookieRefreshTimer = setInterval(() => refreshCapturedCookies?.(), 30 * 60 * 1000);
  };

  ipcMain.handle('providers-list', async () => registry.listProviders());

  ipcMain.handle('provider-get-active', async () => {
    return registry.normalizeProviderId(loadSettings().activeProvider);
  });

  ipcMain.handle('provider-set-active', async (_event, { providerId, activate = true } = {}) => {
    const id = registry.normalizeProviderId(providerId);
    // Provider selection is the application-level routing boundary. Keep the
    // AI text route aligned with its media runtime instead of allowing a
    // hidden mixed-provider session after switching from the startup hub.
    saveSettings({
      activeProvider: id,
      aiProvider: id === 'avis' ? 'avis' : 'ollama',
    });
    // Tear down the previous provider before validating/starting the next one.
    // This also guarantees a failed license check cannot leave VEO3 running.
    stopVeo3Runtime();
    if (activate) {
      if (id === 'veo3') startVeo3Runtime();
    }
    return id;
  });

  ipcMain.handle('provider-get-status', async (_event, { providerId } = {}) => {
    const adapter = registry.getProviderAdapter(providerId);
    return adapter.getStatus({ accountSlots, avisProvider, getAvisMediaRuntime });
  });

  ipcMain.handle('provider-get-credential', async (_event, { providerId } = {}) => {
    const id = registry.normalizeProviderId(providerId);
    if (id !== 'avis') return { configured: false, value: '' };
    const runtime = getAvisMediaRuntime();
    return {
      configured: !!runtime?.configured,
      value: String(runtime?.apiKey || ''),
    };
  });

  ipcMain.handle('provider-clear-credential', async (_event, { providerId } = {}) => {
    const id = registry.normalizeProviderId(providerId);
    if (id !== 'avis') {
      throw new Error(`Provider ${id} không hỗ trợ xóa credential bằng API này.`);
    }
    // Keep an explicit disabled marker so an imported key stays disconnected
    // even when a developer environment or legacy secret file contains a
    // fallback AVIS_API_KEY.
    saveSettings({
      avisApiKey: '',
      avisApiKeyDisabled: true,
    });
    return { cleared: true };
  });

  return registry;
};
