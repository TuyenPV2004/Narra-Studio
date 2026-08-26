'use strict';

const {brand, primaryRgb} = require('./brand');

module.exports = function registerLocalAppLifecycle({app, BrowserWindow, path, runtime, isDev, createWindow, restoreAllSlotSessions}) {
  let splashWindow;
  const closeSplash = () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
  };
  const createSplash = () => {
    splashWindow = new BrowserWindow({
      width: 420,
      height: 280,
      frame: false,
      transparent: true,
      resizable: false,
      center: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {contextIsolation: true, nodeIntegration: false},
    });
    const html = `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:420px;height:280px;display:grid;place-items:center;background:transparent;font-family:Inter,Segoe UI,sans-serif;-webkit-app-region:drag}
      main{position:relative;display:grid;width:360px;height:220px;place-items:center;align-content:center;gap:18px;overflow:hidden;border:1px solid ${brand.theme.border};border-radius:20px;background:linear-gradient(145deg,${brand.theme.background1},${brand.theme.background2});box-shadow:0 24px 64px rgba(54,36,72,.2)}
      main:before{position:absolute;inset:0;background:radial-gradient(ellipse at 50% -10%,rgba(${primaryRgb},.12),transparent 60%);content:""}
      i{z-index:1;display:grid;width:56px;height:56px;place-items:center;border-radius:16px;color:#fff;background:${brand.theme.primary};box-shadow:0 0 32px rgba(${primaryRgb},.22);font-style:normal;font-size:26px}strong{z-index:1;color:${brand.theme.text};font-size:18px;letter-spacing:0}
      span{z-index:1;width:160px;height:3px;overflow:hidden;border-radius:99px;background:${brand.theme.borderSubtle}}span:after{display:block;width:60%;height:100%;border-radius:99px;background:${brand.theme.primary};animation:load 1.3s ease-in-out infinite;content:""}@keyframes load{from{transform:translateX(-120%)}to{transform:translateX(190%)}}
    </style><main><i>◆</i><strong>${brand.displayNameUpper}</strong><span></span></main>`;
    splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  };

  app.whenReady().then(() => {
    if (isDev && process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(path.join(__dirname, '..', '..', 'dist', 'brand', 'narra-mark.svg'));
    }
    if (!isDev) createSplash();
    createWindow();
    if (typeof restoreAllSlotSessions === 'function') {
      restoreAllSlotSessions().catch(err => {
        console.warn('[STARTUP] Session hydration error:', err?.message || err);
      });
    }
    let shown = false;
    const showApp = () => {
      if (shown) return;
      shown = true;
      if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) runtime.mainWindow.show();
      setTimeout(closeSplash, 250);
    };
    runtime.mainWindow.once('ready-to-show', showApp);
    setTimeout(showApp, 8000);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
};
