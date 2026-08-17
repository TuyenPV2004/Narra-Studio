'use strict';

const registry = require('../providers/registry');

module.exports = function registerProviderIpc(dependencies) {
  const {
    ipcMain,
    loadSettings,
    saveSettings,
    accountSlots,
    setupRequestInterception,
    teardownRequestInterception,
    captchaBridge,
    refreshCapturedCookies,
    openAiProvider,
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

  ipcMain.handle('ai-provider-profile-list', async () => openAiProvider.list());
  ipcMain.handle('ai-provider-profile-save', async (_event, payload) => openAiProvider.save(payload));
  ipcMain.handle('ai-provider-profile-delete', async (_event, { id } = {}) => openAiProvider.remove(id));
  ipcMain.handle('ai-provider-profile-set-active', async (_event, { id, capability = 'text' } = {}) => openAiProvider.setActive(id, capability));
  ipcMain.handle('ai-provider-profile-test', async (_event, payload) => openAiProvider.test(payload));
  ipcMain.handle('ai-provider-profile-models', async (_event, payload) => openAiProvider.models(payload));

  ipcMain.handle('provider-get-active', async () => {
    return registry.normalizeProviderId(loadSettings().activeProvider);
  });

  ipcMain.handle('provider-set-active', async (_event, { providerId, activate = true } = {}) => {
    const id = registry.normalizeProviderId(providerId);
    saveSettings({ activeProvider: id });
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
    return adapter.getStatus({ accountSlots });
  });

  ipcMain.handle('provider-get-credential', async (_event, { providerId } = {}) => {
    registry.normalizeProviderId(providerId);
    return { configured: false, value: '' };
  });

  return registry;
};
