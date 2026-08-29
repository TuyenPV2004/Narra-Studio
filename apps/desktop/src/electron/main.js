const { app, BrowserWindow, ipcMain, session, clipboard, protocol, net, shell, dialog, safeStorage } = require('electron');
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
const veo3ProviderModule = require('./providers/veo3/module');
const createOpenAiCompatibleProvider = require('./providers/openai-compatible');

const createSupportRuntime = require('./runtime/support');
const createAppCore = require('./runtime/app-core');
const createCaptchaRuntime = require('./runtime/captcha');
const registerAppLifecycle = require('./runtime/lifecycle-local');
const registerStorageIpc = require('./ipc/storage');
const registerMediaIpc = require('./ipc/media');
const registerAiIpc = require('./ipc/ai');
const registerSystemIpc = require('./ipc/system');
const registerVoiceIpc = require('./ipc/xtts');
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
  safeStorage,
};
const supportRuntime = createSupportRuntime(baseDependencies);
const appCore = createAppCore({ ...baseDependencies, ...supportRuntime });
const captchaRuntime = createCaptchaRuntime({ ...baseDependencies, ...supportRuntime, ...appCore });
const sharedDependencies = { ...baseDependencies, ...supportRuntime, ...appCore, ...captchaRuntime };
const openAiProvider = createOpenAiCompatibleProvider({
  loadSettings: sharedDependencies.loadSettings,
  saveSettings: sharedDependencies.saveSettings,
  safeStorage,
  net,
  crypto,
});
const providerDependencies = { ...sharedDependencies, openAiProvider };
const { runtime, isDev } = supportRuntime;
const { createWindow, refreshCapturedCookies } = appCore;

let aiRuntime;
const crossDomainDependencies = {
  localPiperTextToSpeech: (...args) => aiRuntime.localPiperTextToSpeech(...args),
};

const generationRuntime = veo3ProviderModule.register({
  sharedDependencies,
  crossDomainDependencies,
});
registerStorageIpc(sharedDependencies);
registerMediaIpc(sharedDependencies);
aiRuntime = registerAiIpc(providerDependencies);
registerProviderIpc({
  ...providerDependencies,
});
registerLocalWorkspaceIpc(sharedDependencies);
registerSystemIpc({ ...sharedDependencies, ...crossDomainDependencies, openAiProvider });
registerVoiceIpc(sharedDependencies);

registerAppLifecycle({
  ...sharedDependencies,
  generationRuntime,
});
