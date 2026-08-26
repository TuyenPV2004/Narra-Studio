'use strict';

const {findExtensionDirectory} = require('./extension-directory');

/**
 * CAPTCHA bridge and browser-runtime diagnostics.
 *
 * Registered by `electron/ipc/flow.js`.
 */

module.exports = function registerFlowDiagnosticsIpc(dependencies) {
  const {
    app,
    ipcMain,
    shell,
    dialog,
    path,
    fs,
    captchaBridge,
    findFlowWebview,
    getChromeRuntime,
  } = dependencies;

  // __dirname was electron/ipc before this group moved into flow/;
  // resolve against that directory so packaged paths stay identical.
  const IPC_DIR = path.join(__dirname, '..');
  const REQUIRED_EXTENSION_VERSION = '1.3.1';

  function versionAtLeast(actual, required) {
    const actualParts = String(actual || '').split('.').map(part => Number.parseInt(part, 10) || 0);
    const requiredParts = String(required || '').split('.').map(part => Number.parseInt(part, 10) || 0);
    for (let index = 0; index < Math.max(actualParts.length, requiredParts.length); index += 1) {
      const difference = (actualParts[index] || 0) - (requiredParts[index] || 0);
      if (difference !== 0) return difference > 0;
    }
    return true;
  }

function getExtensionDirectory() {
  const candidates = [
    path.join(app.getAppPath(), 'captcha-extension'),
    path.join(process.resourcesPath || '', 'captcha-extension'),
    path.join(IPC_DIR, '..', '..', 'captcha-extension'),
    path.join(IPC_DIR, '..', 'captcha-extension'),
  ];
  return findExtensionDirectory({
    fs,
    path,
    candidates,
    requiredVersion: REQUIRED_EXTENSION_VERSION,
  });
}

async function getCaptchaRuntimeStatus() {
  const extensionConnected = captchaBridge.isExtensionConnected();
  const extensionStatus = captchaBridge.getExtensionStatus?.() || {};
  const extensionCompatible = extensionConnected
    && versionAtLeast(extensionStatus.version, REQUIRED_EXTENSION_VERSION);
  const extensionFilesAvailable = !!getExtensionDirectory();
  let chromeCdpReady = false;
  let chromeCdpUrl = null;

  if (getChromeRuntime().chromeCdp && getChromeRuntime().chromeReady) {
    try {
      const r = await Promise.race([
        getChromeRuntime().chromeCdp.send('Runtime.evaluate', {
          expression: '({ href: location.href, readyState: document.readyState, hasRecaptcha: !!(window.grecaptcha && window.grecaptcha.enterprise) })',
          returnByValue: true,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('captcha status timeout')), 1500)),
      ]);
      const v = r && r.result && r.result.value;
      chromeCdpReady = !!(v && typeof v.href === 'string' && v.href.includes('labs.google'));
      chromeCdpUrl = v && v.href ? v.href : null;
    } catch (e) {
      chromeCdpReady = false;
    }
  }

  const source = extensionConnected
    ? 'extension'
    : chromeCdpReady
      ? 'chrome-cdp'
      : 'none';
  const labsProjectOpen = !!(extensionCompatible && extensionStatus.labsProjectOpen);
  const tokenVerified = !!(extensionCompatible && extensionStatus.lastTokenAt);
  const setupReady = !!(extensionCompatible && labsProjectOpen && tokenVerified);

  return {
    // Backward compatible: this remains the real extension WebSocket state.
    connected: extensionConnected,
    extensionConnected,
    extensionFilesAvailable,
    extensionVersion: extensionStatus.version || null,
    extensionCompatible,
    requiredExtensionVersion: REQUIRED_EXTENSION_VERSION,
    labsTabOpen: !!extensionStatus.labsTabOpen,
    labsProjectOpen,
    labsTabUrl: extensionStatus.labsTabUrl || null,
    tokenVerified,
    tokenVerifiedAt: tokenVerified ? extensionStatus.lastTokenAt : null,
    tokenError: extensionConnected ? extensionStatus.lastTokenError || null : null,
    // Setup is strict: a compatible extension, a currently open project, and
    // a token verified on that project must all remain true.
    setupReady,
    chromeCdpReady,
    ready: source !== 'none',
    source,
    port: captchaBridge.PORT,
    chromeDebugPort: 19773,
    chromeCdpUrl,
  };
}

ipcMain.handle('get-captcha-bridge-status', async () => getCaptchaRuntimeStatus());

ipcMain.handle('test-captcha-extension', async () => {
  if (!captchaBridge.isExtensionConnected()) {
    return { ok: false, error: 'Captcha extension is not connected' };
  }
  const status = captchaBridge.getExtensionStatus?.() || {};
  if (!versionAtLeast(status.version, REQUIRED_EXTENSION_VERSION)) {
    return { ok: false, error: `Captcha extension ${REQUIRED_EXTENSION_VERSION} or newer is required` };
  }
  if (!status.labsProjectOpen) {
    return { ok: false, error: 'Open a Google Flow project before testing the connection' };
  }
  try {
    const token = await captchaBridge.getTokenFromExtension('TEST');
    return { ok: typeof token === 'string' && token.length > 20 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('open-extension-folder', async () => {
  const dir = getExtensionDirectory();
  if (!dir) return { ok: false, error: 'extension folder not found' };
  shell.showItemInFolder(path.join(dir, 'manifest.json'));
  return { ok: true, path: dir };
});

// Reload WebView rồi chờ prompt textbox sẵn sàng (max 30s)
ipcMain.handle('reload-and-wait-webview', async () => {
  const wv = findFlowWebview();
  if (!wv) return { ok: false, error: 'WebView not found' };
  try {
    wv.reload();
    console.log('[PAGE-GEN] WebView reloading...');
    // Poll until contenteditable prompt textbox appears (max 30s)
    const maxWait = 30000;
    const pollInterval = 1000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));
      try {
        const ready = await wv.executeJavaScript(`
          !!(document.querySelector('[contenteditable="true"][data-slate-editor]') ||
             document.querySelector('[role="textbox"]'))
        `);
        if (ready) {
          console.log('[PAGE-GEN] WebView ready after', Date.now() - start, 'ms');
          return { ok: true, ms: Date.now() - start };
        }
      } catch (e) { /* page still loading, ignore */ }
    }
    console.log('[PAGE-GEN] WebView reload timeout (30s)');
    return { ok: false, error: 'timeout' };
  } catch (e) {
    console.log('[PAGE-GEN] WebView reload error:', e.message);
    return { ok: false, error: e.message };
  }
});

// Diagnostic: discover page DOM structure
ipcMain.handle('diagnose-webview', async () => {
  const wv = findFlowWebview();
  if (!wv) return { error: 'WebView not found' };

  const result = await wv.executeJavaScript(`
    (function() {
      var textareas = Array.from(document.querySelectorAll('textarea')).map(function(t) {
        return { tag: 'textarea', id: t.id, className: (t.className||'').substring(0,80), placeholder: t.placeholder, ariaLabel: t.getAttribute('aria-label'), rect: t.getBoundingClientRect() };
      });
      var inputs = Array.from(document.querySelectorAll('input[type="text"],input:not([type])')).map(function(i) {
        return { tag: 'input', id: i.id, className: (i.className||'').substring(0,80), placeholder: i.placeholder, ariaLabel: i.getAttribute('aria-label') };
      });
      var buttons = Array.from(document.querySelectorAll('button')).map(function(b) {
        return { tag: 'button', text: (b.textContent||'').trim().substring(0,50), id: b.id, className: (b.className||'').substring(0,80), ariaLabel: b.getAttribute('aria-label'), disabled: b.disabled };
      });
      // Also find contentEditable divs (some apps use these as inputs)
      var editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(function(e) {
        return { tag: e.tagName, id: e.id, className: (e.className||'').substring(0,80), text: (e.textContent||'').substring(0,50), ariaLabel: e.getAttribute('aria-label') };
      });
      // Find reCAPTCHA scripts
      var recaptchaScripts = Array.from(document.querySelectorAll('script[src*="recaptcha"]')).map(function(s) { return s.src; });

      return { textareas: textareas, inputs: inputs.slice(0,10), buttons: buttons.slice(0,30), editables: editables, recaptchaScripts: recaptchaScripts, url: window.location.href };
    })()
  `);

  console.log('[DIAGNOSE] Page URL:', result.url);
  console.log('[DIAGNOSE] Textareas:', JSON.stringify(result.textareas, null, 2));
  console.log('[DIAGNOSE] Inputs:', JSON.stringify(result.inputs?.slice(0, 5), null, 2));
  console.log('[DIAGNOSE] Editables:', JSON.stringify(result.editables, null, 2));
  console.log('[DIAGNOSE] RecaptchaScripts:', JSON.stringify(result.recaptchaScripts, null, 2));
  console.log('[DIAGNOSE] Buttons:', JSON.stringify(result.buttons?.slice(0, 15), null, 2));

  return result;
});

// ── DEBUG: Test slot selector + click (no image upload) ─────────────
ipcMain.handle('debug-slot-click', async (_, { slot }) => {
  const wv = findFlowWebview();
  if (!wv) return { error: 'WebView not found' };
  const label = slot === 'end' ? 'Kết thúc' : 'Bắt đầu';

  const result = await wv.executeJavaScript(`
    (function() {
      var label = '` + label.replace(/'/g, "\\'") + `';
      var stateKey = label.indexOf('\u1EAFt') !== -1 ? 'START' : 'END';
      var log = [];

      // --- dump tất cả aria-haspopup="dialog" elements để debug ---
      var allPopups = Array.from(document.querySelectorAll('[aria-haspopup="dialog"]'));
      log.push('Total [aria-haspopup=dialog]: ' + allPopups.length);
      allPopups.forEach(function(el, idx) {
        var r = el.getBoundingClientRect();
        var ownText = Array.from(el.childNodes)
          .filter(function(n){ return n.nodeType === 3; })
          .map(function(n){ return n.textContent.trim(); }).join('');
        log.push('  [' + idx + '] tag=' + el.tagName + ' class=' + el.className.substring(0,60)
          + ' ownText="' + ownText + '" fullText="' + (el.textContent||'').trim().substring(0,60)
          + '" data-scroll-state="' + (el.getAttribute('data-scroll-state')||'none')
          + '" data-state="' + (el.getAttribute('data-state')||'none')
          + '" rect=' + JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}));
      });

      // --- thử tìm bằng selector mới ---
      var found = null;
      // Primary: data-scroll-state
      var byState = document.querySelector('[data-scroll-state="' + stateKey + '"][aria-haspopup="dialog"]');
      if (byState) { found = byState; log.push('Found via data-scroll-state'); }

      // Secondary: jekiem + own text
      if (!found) {
        var candidates = Array.from(document.querySelectorAll('.jekiem[aria-haspopup="dialog"], div[aria-haspopup="dialog"], button[aria-haspopup="dialog"]'));
        log.push('jekiem/div/button candidates: ' + candidates.length);
        for (var i = 0; i < candidates.length; i++) {
          var ownText = Array.from(candidates[i].childNodes)
            .filter(function(n){ return n.nodeType === 3; })
            .map(function(n){ return n.textContent.trim(); }).join('');
          if (!ownText) ownText = (candidates[i].textContent || '').trim();
          log.push('  candidate[' + i + '] ownText="' + ownText + '" match=' + (ownText === label));
          if (ownText === label) { found = candidates[i]; log.push('Found via ownText match'); break; }
        }
      }

      if (!found) return { clicked: false, log: log, reason: 'Element not found' };
      var r = found.getBoundingClientRect();
      log.push('Found el rect: ' + JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}));
      if (r.width <= 0) return { clicked: false, log: log, reason: 'Element hidden (width=0)' };

      // Click it
      found.focus();
      found.click();
      log.push('Clicked! data-state after click: ' + (found.getAttribute('data-state')||'?'));
      return { clicked: true, log: log };
    })()
  `);

  console.log('[DEBUG-SLOT] Label:', label);
  console.log('[DEBUG-SLOT] Result:', JSON.stringify(result, null, 2));
  return result;
});

// ── DEBUG: Dump full DOM info for Start/End slot area ────────────────
ipcMain.handle('debug-startend-dom', async () => {
  const wv = findFlowWebview();
  if (!wv) return { error: 'WebView not found' };
  const result = await wv.executeJavaScript(`
    (function() {
      var log = [];
      // 1. swap_horiz button
      var swapBtns = Array.from(document.querySelectorAll('button')).filter(function(b){
        var ic = b.querySelector('i');
        return ic && (ic.textContent||'').trim() === 'swap_horiz';
      });
      log.push('swap_horiz buttons: ' + swapBtns.length);
      swapBtns.forEach(function(b,i){
        var r = b.getBoundingClientRect();
        log.push('  swapBtn[' + i + '] rect=' + JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}));
      });

      // 2. button[data-card-open] — all
      var cardBtns = Array.from(document.querySelectorAll('button[data-card-open]'));
      log.push('button[data-card-open] total: ' + cardBtns.length);
      cardBtns.forEach(function(b,i){
        var r = b.getBoundingClientRect();
        var hasImg = !!b.querySelector('img');
        var imgSrc = b.querySelector('img') ? b.querySelector('img').src.substring(0,80) : 'none';
        log.push('  card[' + i + '] data-card-open="' + b.getAttribute('data-card-open')
          + '" data-state="' + (b.getAttribute('data-state')||'?')
          + '" visible=' + (r.width>0&&r.height>0)
          + ' hasImg=' + hasImg + ' imgSrc=' + imgSrc
          + ' rect=' + JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}));
        // dump cancel/close icons near card
        var par = b.parentElement || b;
        var icons = Array.from(par.querySelectorAll('i'));
        icons.forEach(function(ic){ log.push('    icon: "' + (ic.textContent||'').trim() + '"'); });
      });

      // 3. Visible button[data-card-open] only
      var visCards = cardBtns.filter(function(b){ var r=b.getBoundingClientRect(); return r.width>0&&r.height>0; });
      log.push('Visible card buttons: ' + visCards.length);

      // 4. aria-haspopup=dialog
      var popups = Array.from(document.querySelectorAll('[aria-haspopup="dialog"]'));
      log.push('[aria-haspopup=dialog] total: ' + popups.length);
      popups.forEach(function(el,i){
        var r = el.getBoundingClientRect();
        var ownText = Array.from(el.childNodes).filter(function(n){return n.nodeType===3;}).map(function(n){return n.textContent.trim();}).join('');
        log.push('  popup[' + i + '] tag=' + el.tagName + ' ownText="' + ownText + '" scroll-state="' + (el.getAttribute('data-scroll-state')||'-') + '" visible=' + (r.width>0));
      });

      // 5. data-scroll-state
      var scrollStates = Array.from(document.querySelectorAll('[data-scroll-state]'));
      log.push('[data-scroll-state] total: ' + scrollStates.length);
      scrollStates.forEach(function(el,i){
        var r = el.getBoundingClientRect();
        log.push('  scrollState[' + i + '] val="' + el.getAttribute('data-scroll-state') + '" tag=' + el.tagName + ' visible=' + (r.width>0));
      });

      return { log: log };
    })()
  `);
  console.log('[DEBUG-STARTEND-DOM]', JSON.stringify(result, null, 2));
  return result;
});

// ── DEBUG: Test upload button click inside open picker ───────────────
ipcMain.handle('debug-upload-click', async () => {
  const wv = findFlowWebview();
  if (!wv) return { error: 'WebView not found' };

  const result = await wv.executeJavaScript(`
    (function() {
      var log = [];
      // Dump all open dialogs/popovers
      var dialogs = Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]'));
      log.push('Open dialogs: ' + dialogs.length);

      // Check sc-f4c85962-10 exists and its rect
      var uploadRow = document.querySelector('.sc-f4c85962-10');
      if (uploadRow) {
        var r = uploadRow.getBoundingClientRect();
        log.push('sc-f4c85962-10 found, rect: ' + JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}));
        log.push('  text: ' + (uploadRow.textContent||'').trim().substring(0,60));
        // Count file inputs before click
        var inputsBefore = document.querySelectorAll('input[type="file"]').length;
        log.push('  file inputs BEFORE click: ' + inputsBefore);
        // Try clicking the icon child (sc-f4c85962-11) first
        var iconChild = uploadRow.querySelector('.sc-f4c85962-11');
        if (iconChild) {
          var cx = r.x + r.width/2, cy = r.y + r.height/2;
          iconChild.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
          iconChild.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:cx, clientY:cy}));
          iconChild.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:cx, clientY:cy}));
          iconChild.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx, clientY:cy}));
          iconChild.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:cx, clientY:cy}));
          log.push('  clicked iconChild (sc-f4c85962-11)');
        } else {
          var cx = r.x + r.width/2, cy = r.y + r.height/2;
          uploadRow.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
          uploadRow.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:cx, clientY:cy}));
          uploadRow.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:cx, clientY:cy}));
          uploadRow.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx, clientY:cy}));
          uploadRow.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:cx, clientY:cy}));
          log.push('  clicked uploadRow directly');
        }
        // Check file inputs after click
        setTimeout(function() {}, 300);
        var inputsAfter = document.querySelectorAll('input[type="file"]').length;
        log.push('  file inputs AFTER click (sync): ' + inputsAfter);
      } else {
        log.push('sc-f4c85962-10 NOT FOUND');
        // Dump all classes in open dialog
        if (dialogs.length > 0) {
          var els = Array.from(dialogs[0].querySelectorAll('[class]'));
          els.slice(0,20).forEach(function(el) {
            var r = el.getBoundingClientRect();
            if (r.width > 0) log.push('  ' + el.tagName + ' class=' + el.className.substring(0,60) + ' text=' + (el.textContent||'').trim().substring(0,30));
          });
        }
      }
      return { log: log };
    })()
  `);
  console.log('[DEBUG-UPLOAD] Result:', JSON.stringify(result, null, 2));
  return result;
});

};
