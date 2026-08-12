'use strict';

const registerFlowDiagnosticsIpc = require('./flow/diagnostics');
const registerFlowWebviewUploadIpc = require('./flow/webview-upload');
const registerFlowPageGenerationIpc = require('./flow/page-generation');
const registerFlowSelectorsIpc = require('./flow/selectors');
const registerFlowSessionIpc = require('./flow/session');

/**
 * Flow (Google Labs) webview automation IPC.
 *
 * Handler groups live in `electron/ipc/flow/`:
 *   diagnostics.js     CAPTCHA bridge status, webview reload/probe, debug-* inspectors
 *   webview-upload.js  start/end frame and reference image uploads
 *   page-generation.js generate-via-page (drives the page's own UI)
 *   selectors.js       model / quantity / aspect sync into the page UI
 *   session.js         account slots, auth capture, login windows
 *   page-gen-lock.js   the mutex page-generation.js and selectors.js share
 */
module.exports = function registerFlowIpc(dependencies) {
  const { ipcMain, loadSettings } = dependencies;

  // Get last saved project URL (for auto-redirect on next launch)
  ipcMain.handle('get-last-project-url', () => {
    const s = loadSettings();
    return s.lastProjectUrl || null;
  });

  registerFlowDiagnosticsIpc(dependencies);
  registerFlowWebviewUploadIpc(dependencies);
  registerFlowPageGenerationIpc(dependencies);
  registerFlowSelectorsIpc(dependencies);
  registerFlowSessionIpc(dependencies);
};
