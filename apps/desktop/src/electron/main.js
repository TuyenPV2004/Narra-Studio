const { app, BrowserWindow, ipcMain, session, clipboard, protocol, net, shell, dialog } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');

for (const envFile of [path.join(process.cwd(), '.env'), path.join(path.dirname(process.execPath), '.env')]) {
  try {
    if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
  } catch (error) {
    console.warn('[ENV] Cannot load local environment file:', error.message);
  }
}

app.setName('Narra Studio');

const captchaBridge = require('./captcha-bridge');
const avisProviderModule = require('./providers/avis/module');
const avisProvider = avisProviderModule.provider;
const veo3ProviderModule = require('./providers/veo3/module');
const cloudflareImagesProvider = require('./providers/cloudflare-images');
const cloudflareR2Provider = require('./providers/cloudflare-r2');

// ── Runtime composition ─────────────────────────────────────────────────
const createSupportRuntime = require('./runtime/support');
const createAppCore = require('./runtime/app-core');
const createCaptchaRuntime = require('./runtime/captcha');
const registerAppLifecycle = require('./runtime/lifecycle-local');
const registerStorageIpc = require('./ipc/storage');
const registerMediaIpc = require('./ipc/media');
const registerAiIpc = require('./ipc/ai');
const registerSystemIpc = require('./ipc/system');
const registerProviderIpc = require('./ipc/providers');
const registerLocalWorkspaceIpc = require('./ipc/collaboration-local');

const baseDependencies = {
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
  avisProvider,
  cloudflareImagesProvider,
  cloudflareR2Provider,
};
const supportRuntime = createSupportRuntime(baseDependencies);
const appCore = createAppCore({ ...baseDependencies, ...supportRuntime });
const captchaRuntime = createCaptchaRuntime({ ...baseDependencies, ...supportRuntime, ...appCore });
const sharedDependencies = { ...baseDependencies, ...supportRuntime, ...appCore, ...captchaRuntime };
const { runtime, isDev } = supportRuntime;
const { createWindow, refreshCapturedCookies } = appCore;

let aiRuntime;
const crossDomainDependencies = {
  getAvisMediaRuntime: (...args) => aiRuntime.getAvisMediaRuntime(...args),
  localPiperTextToSpeech: (...args) => aiRuntime.localPiperTextToSpeech(...args),
};

const generationRuntime = veo3ProviderModule.register({
  sharedDependencies,
  crossDomainDependencies,
});
registerStorageIpc(sharedDependencies);
registerMediaIpc(sharedDependencies);
aiRuntime = registerAiIpc(sharedDependencies);
registerProviderIpc({
  ...sharedDependencies,
  getAvisMediaRuntime: (...args) => aiRuntime.getAvisMediaRuntime(...args),
});
registerLocalWorkspaceIpc(sharedDependencies);
registerSystemIpc({ ...sharedDependencies, ...crossDomainDependencies });


registerAppLifecycle({
  ...sharedDependencies,
  generationRuntime,
});
