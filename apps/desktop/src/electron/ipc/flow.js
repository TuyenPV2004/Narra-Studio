'use strict';

const registerFlowDiagnosticsIpc = require('./flow/diagnostics');
const registerFlowSessionIpc = require('./flow/session');

/**
 * Google Flow session and browser-runtime IPC.
 *
 * Handler groups live in `electron/ipc/flow/`:
 *   diagnostics.js CAPTCHA extension and Chrome CDP status
 *   session.js     account slots, auth capture, and login windows
 */
module.exports = function registerFlowIpc(dependencies) {
  const { ipcMain, loadSettings } = dependencies;

  // Get last saved project URL (for auto-redirect on next launch)
  ipcMain.handle('get-last-project-url', () => {
    const s = loadSettings();
    return s.lastProjectUrl || null;
  });

  registerFlowDiagnosticsIpc(dependencies);
  registerFlowSessionIpc(dependencies);
};
