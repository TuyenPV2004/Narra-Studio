'use strict';

const registerFlowDiagnosticsIpc = require('./flow/diagnostics');
const registerFlowSessionIpc = require('./flow/session');

module.exports = function registerFlowIpc(dependencies) {
  const { ipcMain, loadSettings } = dependencies;

  ipcMain.handle('get-last-project-url', () => {
    const s = loadSettings();
    return s.lastProjectUrl || null;
  });

  registerFlowDiagnosticsIpc(dependencies);
  registerFlowSessionIpc(dependencies);
};
