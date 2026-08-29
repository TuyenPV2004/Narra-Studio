'use strict';

const { withPageGenLock } = require('./page-gen-lock');

module.exports = function registerFlowPageGenerationIpc(dependencies) {
  const {
    ipcMain,
    clipboard,
    dialog,
    path,
    https,
    http,
    fs,
    os,
    pathToFileURL,
    fileURLToPath,
    loadSettings,
    findFlowWebview,
  } = dependencies;

ipcMain.handle('generate-via-page', async (_, { prompt, type, quality, aspect, videoMode, startFilePath, endFilePath, mediaId, endMediaId, startName, endName, startThumb, endThumb, charSyncFilePaths, referenceFilePaths, referenceImageUrls }) => {
  return withPageGenLock(async () => {
    const wv = findFlowWebview();
    if (!wv) throw new Error('WebView not found — hãy đăng nhập và mở 1 project trong WebView');

    const genType = type || 'image';
    const genQuality = quality || 'fast';
    const genAspect = aspect || 'landscape';
    const genMode = videoMode || 'text';
    console.log('[PAGE-GEN] Starting page-based generation (' + genType + ', ' + genQuality + ', ' + genAspect + ', mode=' + genMode + ') for:', prompt.substring(0, 50));
    console.log('[PAGE-GEN] Params: startFilePath=' + (startFilePath || 'EMPTY') + ' mediaId=' + (mediaId || 'EMPTY') + ' startName=' + (startName || 'EMPTY') + ' startThumb=' + (startThumb || 'EMPTY').substring(0, 60));

    const wvUrl = wv.getURL();
    console.log('[PAGE-GEN] WebView URL:', wvUrl);

    if (!wvUrl.includes('/project/')) {
      const lastUrl = loadSettings().lastProjectUrl;
      if (!lastUrl || !lastUrl.includes('/project/')) {
        throw new Error('WebView chưa mở project. Hãy vào tab WebView và mở 1 project trước.');
      }
      console.log('[PAGE-GEN] WebView not in project — navigating to:', lastUrl);
      await wv.loadURL(lastUrl);

      const navStart = Date.now();
      let navReady = false;
      while (Date.now() - navStart < 30000) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const ready = await wv.executeJavaScript(`!!(document.querySelector('[contenteditable="true"]') || document.querySelector('textarea'))`);
          if (ready) { navReady = true; break; }
        } catch (e) {  }
      }
      if (!navReady) throw new Error('WebView navigate vào project timeout (30s) — thử lại sau.');
      console.log('[PAGE-GEN] WebView navigated to project, ready after', Date.now() - navStart, 'ms');
    }

    const FIND_SLOT_SNIPPET = `
    function findSlotByLabel(label) {
      var candidates = Array.from(document.querySelectorAll('[aria-haspopup="dialog"]'));
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var ownText = Array.from(el.childNodes)
          .filter(function(n){ return n.nodeType === 3; })
          .map(function(n){ return n.textContent.trim(); })
          .join('');
        if (ownText === label) {
          var r = el.getBoundingClientRect();
          if (r.width > 0) return el;
        }
      }
      return null;
    }
  `;
    const findSlotEl = (label) => `
    (function() {
      ${FIND_SLOT_SNIPPET}
      return findSlotByLabel('` + label.replace(/'/g, "\\'") + `');
    })()
  `;

    const clearSlot = async (slotLabel) => {
      const label = slotLabel;
      const cleared = await wv.executeJavaScript(`
      (function() {
        var isStart = '` + label.replace(/'/g, "\\'") + `'.indexOf('\u1EAFt') !== -1;

        var swapBtn = null;
        var allBtns = Array.from(document.querySelectorAll('button'));
        for (var s = 0; s < allBtns.length; s++) {
          var ic = allBtns[s].querySelector('i');
          if (ic && (ic.textContent || '').trim() === 'swap_horiz') { swapBtn = allBtns[s]; break; }
        }
        if (swapBtn) {
          var slotIdx = isStart ? 0 : 1;
          var cardBtns = Array.from(document.querySelectorAll('button[data-card-open]')).filter(function(b) {
            var r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0;
          });
          var targetCard = cardBtns[slotIdx];
          if (targetCard) {
            var hasImg = targetCard.querySelector('img');
            if (!hasImg) return { cleared: false, reason: 'slot-empty-new-ui' };
            var cardParent = targetCard.parentElement || targetCard;
            var cancelBtns = Array.from(cardParent.querySelectorAll('button'));
            for (var c = 0; c < cancelBtns.length; c++) {
              var ci = cancelBtns[c].querySelector('i');
              if (ci) {
                var ct = (ci.textContent || '').trim();
                if (ct === 'cancel' || ct === 'close' || ct === 'delete') {
                  cancelBtns[c].click();
                  return { cleared: true, via: 'new-ui-cancel-' + ct, slotIdx: slotIdx };
                }
              }
            }
          }
        }

        ${FIND_SLOT_SNIPPET}
        var slotEl = findSlotByLabel('` + label.replace(/'/g, "\\'") + `');
        if (!slotEl) return { cleared: false, reason: 'slot-not-found' };
        var container = slotEl.parentElement || slotEl;
        var siblings = Array.from(container.parentElement ? container.parentElement.querySelectorAll('button') : []);
        for (var j = 0; j < siblings.length; j++) {
          var st = (siblings[j].textContent || '').trim();
          var aria = (siblings[j].getAttribute('aria-label') || '').toLowerCase();
          if (st === 'close' || st === 'clear' || st === 'delete' || st === 'remove' ||
              st === 'x' || st === '×' || aria.includes('remove') || aria.includes('clear') ||
              aria.includes('delete') || aria.includes('xóa') || aria.includes('close')) {
            siblings[j].click();
            return { cleared: true, via: 'button-' + st };
          }
        }
        var allBtns2 = Array.from(document.querySelectorAll('button'));
        for (var k = 0; k < allBtns2.length; k++) {
          var ic2 = allBtns2[k].querySelector('i');
          if (ic2) {
            var iconText = (ic2.textContent || '').trim();
            if (iconText === 'close' || iconText === 'cancel' || iconText === 'delete') {
              var br = allBtns2[k].getBoundingClientRect();
              if (br.width > 0 && br.width < 50) {
                allBtns2[k].click();
                return { cleared: true, via: 'icon-' + iconText };
              }
            }
          }
        }
        return { cleared: false, slotText: (slotEl.textContent||'').trim().substring(0,40) };
      })()
    `);
      console.log('[PAGE-GEN] clearSlot "' + slotLabel + '":', JSON.stringify(cleared));
      if (cleared.cleared) await new Promise(r => setTimeout(r, 500));
    };

    const uploadSlot = async (slotLabel, filePath) => {
      if (!filePath || !fs.existsSync(filePath)) {
        console.log('[PAGE-GEN] Skip upload slot "' + slotLabel + '": no file at ' + filePath);
        return;
      }
      const fileName = path.basename(filePath);
      const fileBuffer = fs.readFileSync(filePath);
      const base64 = fileBuffer.toString('base64');
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      console.log('[PAGE-GEN] uploadSlot "' + slotLabel + '":', fileName);

      const label = slotLabel;
      const slotClicked = await wv.executeJavaScript(`
      (function() {
        var label = '` + label.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + `';
        var isStart = label.indexOf('\u1EAFt') !== -1;
        var stateKey = isStart ? 'START' : 'END';

        var swapBtn = null;
        var allPageBtns = Array.from(document.querySelectorAll('button'));
        for (var s = 0; s < allPageBtns.length; s++) {
          var ic = allPageBtns[s].querySelector('i');
          if (ic && (ic.textContent || '').trim() === 'swap_horiz') { swapBtn = allPageBtns[s]; break; }
        }
        if (swapBtn) {
          var slotIdx = isStart ? 0 : 1;
          var cardBtns = Array.from(document.querySelectorAll('button[data-card-open]')).filter(function(b) {
            var r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0;
          });
          var el = cardBtns[slotIdx];
          if (el) {
            var r = el.getBoundingClientRect();
            el.focus(); el.click();
            return { found: true, text: 'new-ui-card-' + slotIdx, stateKey: stateKey, newUI: true };
          }
          var slotDivs = Array.from(document.querySelectorAll('[aria-haspopup="dialog"]')).filter(function(b) {
            var r = b.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;
            var icons = Array.from(b.querySelectorAll('i'));
            if (icons.some(function(ic){ return (ic.textContent||'').trim() === 'add_2'; })) return false;
            return true;
          });
          var slotDiv = null;
          for (var d = 0; d < slotDivs.length; d++) {
            var ownTxt = Array.from(slotDivs[d].childNodes).filter(function(n){ return n.nodeType===3; }).map(function(n){ return n.textContent.trim(); }).join('');
            if (!ownTxt) ownTxt = (slotDivs[d].textContent||'').trim();
            if (ownTxt === label) { slotDiv = slotDivs[d]; break; }
          }
          if (!slotDiv) slotDiv = slotDivs[slotIdx];
          if (slotDiv) { slotDiv.focus(); slotDiv.click(); return { found: true, text: 'new-ui-div-' + slotIdx, stateKey: stateKey, newUI: true }; }
          return { found: false, reason: 'new-ui-no-card-at-idx-' + slotIdx };
        }

        var el = document.querySelector('[data-scroll-state="' + stateKey + '"][aria-haspopup="dialog"]');
        if (!el) {
          var candidates = Array.from(document.querySelectorAll('.jekiem[aria-haspopup="dialog"], div[aria-haspopup="dialog"], button[aria-haspopup="dialog"]'));
          for (var i = 0; i < candidates.length; i++) {
            var ownText = Array.from(candidates[i].childNodes)
              .filter(function(n){ return n.nodeType === 3; })
              .map(function(n){ return n.textContent.trim(); })
              .join('');
            if (!ownText) ownText = (candidates[i].textContent || '').trim();
            if (ownText === label) { el = candidates[i]; break; }
          }
        }
        if (!el) return { found: false };
        var r = el.getBoundingClientRect();
        if (r.width <= 0) return { found: false, reason: 'hidden' };
        el.focus(); el.click();
        return { found: true, text: (el.textContent || '').trim().substring(0, 40), stateKey: stateKey };
      })()
    `);
      console.log('[PAGE-GEN] Slot click:', JSON.stringify(slotClicked));
      if (!slotClicked.found) { console.log('[PAGE-GEN] Slot not found'); return; }
      await new Promise(r => setTimeout(r, 1000));

      await wv.executeJavaScript(`
      (function() {
        if (!window.__fileInputClickPatched) {
          window.__fileInputClickPatched = true;
          var _origClick = HTMLInputElement.prototype.click;
          HTMLInputElement.prototype.click = function() {
            if (this.type === 'file') { return; }
            return _origClick.apply(this, arguments);
          };
        }
        Array.from(document.querySelectorAll('input[type="file"]')).forEach(function(fi) {
          if (!fi.__clickBlocked) {
            fi.__clickBlocked = true;
            fi.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); return false; }, true);
          }
        });
      })()
    `);

      const uploadBtnClicked = await wv.executeJavaScript(`
      (function() {
        var byClass = document.querySelector('.sc-f4c85962-10');
        if (byClass) {
          var r = byClass.getBoundingClientRect();
          if (r.width > 0) { byClass.click(); return { found: true, method: 'class', text: (byClass.textContent||'').trim().substring(0,40) }; }
        }
        var all = Array.from(document.querySelectorAll('div, button, span'));
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].textContent || '').trim();
          var r = all[i].getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (t.indexOf('T\u1EA3i h\u00ECnh \u1EA3nh l\u00EAn') !== -1 || t.indexOf('Upload image') !== -1 || t === 'uploadUpload image') {
            all[i].click(); return { found: true, method: 'text', text: t.substring(0,40) };
          }
        }
        var dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-radix-popper-content-wrapper]'));
        var root = dialogs.length > 0 ? dialogs[dialogs.length - 1] : null;
        if (root) {
          var icons = Array.from(root.querySelectorAll('i, span'));
          for (var j = 0; j < icons.length; j++) {
            if ((icons[j].textContent||'').trim() === 'upload') {
              var uploadRow = icons[j].closest('div') || icons[j].parentElement;
              if (uploadRow) { uploadRow.click(); return { found: true, method: 'icon', text: 'upload icon' }; }
            }
          }
        }
        return { found: false };
      })()
    `);
      console.log('[PAGE-GEN] Upload button:', JSON.stringify(uploadBtnClicked));
      await new Promise(r => setTimeout(r, 500));

      const b64 = base64;
      const fn = fileName.replace(/'/g, "\\'");
      const mt = mimeType;
      const injected = await wv.executeJavaScript(`
      (async function() {
        var base64 = '` + b64 + `';
        var fileName = '` + fn + `';
        var mimeType = '` + mt + `';
        var byteChars = atob(base64);
        var byteArray = new Uint8Array(byteChars.length);
        for (var i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        var file = new File([new Blob([byteArray], {type: mimeType})], fileName, {type: mimeType, lastModified: Date.now()});
        var fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        if (fileInputs.length === 0) return { success: false, error: 'No file input' };
        var fi = fileInputs[fileInputs.length - 1];
        var dt = new DataTransfer(); dt.items.add(file);
        fi.files = dt.files;
        fi.dispatchEvent(new Event('change', { bubbles: true }));
        fi.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, fileName: fileName };
      })()
    `);
      console.log('[PAGE-GEN] File inject:', JSON.stringify(injected));
      if (!injected?.success) { console.log('[PAGE-GEN] Inject failed:', injected?.error); return; }

      console.log('[PAGE-GEN] Polling for thumbnail in picker...');
      let imgReady = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        const checkImg = await wv.executeJavaScript(`
        (function() {
          var popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
          var root = popovers.length > 0 ? popovers[popovers.length - 1] : document;
          var imgs = Array.from(root.querySelectorAll('img'));
          var visible = imgs.filter(function(img) {
            var r = img.getBoundingClientRect();
            return r.width >= 30 && r.height >= 30;
          });
          return { count: visible.length, open: popovers.length > 0 };
        })()
      `);
        console.log('[PAGE-GEN] Poll ' + (attempt + 1) + ': imgs=' + checkImg.count + ' open=' + checkImg.open);
        if (checkImg.count > 0) { imgReady = true; break; }
        if (!checkImg.open) { console.log('[PAGE-GEN] Picker closed unexpectedly'); break; }
      }
      console.log('[PAGE-GEN] img ready:', imgReady);

      const escapedName = fn;
      const selectResult = await wv.executeJavaScript(`
      (function() {
        var target = '` + escapedName + `';
        var debug = [];
        var popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        var root = popovers.length > 0 ? popovers[popovers.length - 1] : document;
        debug.push('Popovers: ' + popovers.length);

        var allImgs = Array.from(root.querySelectorAll('img'));
        debug.push('Imgs in picker: ' + allImgs.length);

        var found = false;

        var items = Array.from(root.querySelectorAll('div, button, li, a, span'));
        for (var i = 0; i < items.length; i++) {
          var el = items[i]; var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0 || r.height > 150 || r.height < 25) continue;
          var txt = (el.textContent || '').trim();
          if (txt.indexOf(target) !== -1 && txt.length < target.length + 30) {
            var cx = r.x+r.width/2, cy = r.y+r.height/2;
            el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new MouseEvent('mousedown',    {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new PointerEvent('pointerup',  {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new MouseEvent('mouseup',      {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new MouseEvent('click',        {bubbles:true, clientX:cx, clientY:cy}));
            found = true; debug.push('Name match: ' + txt.substring(0,40)); break;
          }
        }

        if (!found) {
          var imgs = Array.from(root.querySelectorAll('img'));
          for (var j = 0; j < imgs.length; j++) {
            var ir = imgs[j].getBoundingClientRect();
            if (ir.width >= 30 && ir.height >= 30) {
              var row = imgs[j].closest('li') || imgs[j].closest('[role="listitem"]') ||
                        imgs[j].closest('div[class]') || imgs[j].parentElement;
              if (!row) continue;
              var rr = row.getBoundingClientRect();
              if (rr.width <= 0 || rr.height <= 0) continue;
              var cx = rr.x+rr.width/2, cy = rr.y+rr.height/2;
              row.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
              row.dispatchEvent(new MouseEvent('mousedown',    {bubbles:true, clientX:cx, clientY:cy}));
              row.dispatchEvent(new PointerEvent('pointerup',  {bubbles:true, clientX:cx, clientY:cy}));
              row.dispatchEvent(new MouseEvent('mouseup',      {bubbles:true, clientX:cx, clientY:cy}));
              row.dispatchEvent(new MouseEvent('click',        {bubbles:true, clientX:cx, clientY:cy}));
              found = true;
              debug.push('First-thumb: src=' + imgs[j].src.substring(imgs[j].src.lastIndexOf('/')+1, imgs[j].src.lastIndexOf('/')+40));
              break;
            }
          }
        }

        if (!found) debug.push('NO selection made');
        return { success: found, debug: debug };
      })()
    `);
      console.log('[PAGE-GEN] Select result:', JSON.stringify(selectResult));
      await new Promise(r => setTimeout(r, 2000));
      console.log('[PAGE-GEN] uploadSlot done for "' + slotLabel + '"');
    };

    const selectSlotFromLibrary = async (slotLabel, mediaName) => {
      if (!mediaName) { console.log('[PAGE-GEN] Skip library slot "' + slotLabel + '": no name'); return; }
      const label = slotLabel;
      console.log('[PAGE-GEN] selectFromLibrary "' + slotLabel + '" name:', mediaName);

      const slotClicked = await wv.executeJavaScript(`
      (function() {
        var label = '` + label.replace(/'/g, "\\'") + `';
        var isStart = label.indexOf('\u1EAFt') !== -1;
        var stateKey = isStart ? 'START' : 'END';

        var swapBtn = null;
        var allPageBtns = Array.from(document.querySelectorAll('button'));
        for (var s = 0; s < allPageBtns.length; s++) {
          var ic = allPageBtns[s].querySelector('i');
          if (ic && (ic.textContent || '').trim() === 'swap_horiz') { swapBtn = allPageBtns[s]; break; }
        }
        if (swapBtn) {
          var slotIdx = isStart ? 0 : 1;
          var cardBtns = Array.from(document.querySelectorAll('button[data-card-open]')).filter(function(b) {
            var r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0;
          });
          var el = cardBtns[slotIdx];
          if (el) {
            el.focus(); el.click();
            return { found: true, text: 'new-ui-card-' + slotIdx, stateKey: stateKey, newUI: true };
          }
          var slotDivs = Array.from(document.querySelectorAll('[aria-haspopup="dialog"]')).filter(function(b) {
            var r = b.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;
            var icons = Array.from(b.querySelectorAll('i'));
            if (icons.some(function(ic){ return (ic.textContent||'').trim() === 'add_2'; })) return false;
            return true;
          });
          var slotDiv = null;
          for (var d = 0; d < slotDivs.length; d++) {
            var ownTxt = Array.from(slotDivs[d].childNodes).filter(function(n){ return n.nodeType===3; }).map(function(n){ return n.textContent.trim(); }).join('');
            if (!ownTxt) ownTxt = (slotDivs[d].textContent||'').trim();
            if (ownTxt === label) { slotDiv = slotDivs[d]; break; }
          }
          if (!slotDiv) slotDiv = slotDivs[slotIdx];
          if (slotDiv) { slotDiv.focus(); slotDiv.click(); return { found: true, text: 'new-ui-div-' + slotIdx, stateKey: stateKey, newUI: true }; }
          return { found: false, reason: 'new-ui-no-card-at-idx-' + slotIdx };
        }

        var el = document.querySelector('[data-scroll-state="' + stateKey + '"][aria-haspopup="dialog"]');
        if (!el) {
          var candidates = Array.from(document.querySelectorAll('.jekiem[aria-haspopup="dialog"], div[aria-haspopup="dialog"], button[aria-haspopup="dialog"]'));
          for (var i = 0; i < candidates.length; i++) {
            var ownText = Array.from(candidates[i].childNodes)
              .filter(function(n){ return n.nodeType === 3; })
              .map(function(n){ return n.textContent.trim(); })
              .join('');
            if (!ownText) ownText = (candidates[i].textContent || '').trim();
            if (ownText === label) { el = candidates[i]; break; }
          }
        }
        if (!el) return { found: false };
        var r = el.getBoundingClientRect();
        if (r.width <= 0) return { found: false, reason: 'hidden' };
        el.focus(); el.click();
        return { found: true, text: (el.textContent||'').trim().substring(0,40), stateKey: stateKey };
      })()
    `);
      console.log('[PAGE-GEN] Library slot click:', JSON.stringify(slotClicked));
      if (!slotClicked.found) return;
      await new Promise(r => setTimeout(r, 1200));

      const escapedName = mediaName.replace(/'/g, "\\'");
      const baseName = mediaName.replace(/\.[^.]+$/, '');
      const searchTerm = baseName;

      const searchTyped = await wv.executeJavaScript(`
      (function() {
        var term = '` + searchTerm.replace(/'/g, "\\'") + `';
        var inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])'));
        var found = false;
        for (var i = 0; i < inputs.length; i++) {
          var r = inputs[i].getBoundingClientRect();
          if (r.width > 100 && r.height > 0) {
            inputs[i].focus();
            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(inputs[i], term);
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
            found = true;
            return { found: true, typed: term, placeholder: inputs[i].placeholder };
          }
        }
        return { found: false };
      })()
    `);
      console.log('[PAGE-GEN] Search typed:', JSON.stringify(searchTyped));

      await new Promise(r => setTimeout(r, 1800));

      const selectResult = await wv.executeJavaScript(`
      (function() {
        var target = '` + escapedName + `';
        var baseName = '` + baseName.replace(/'/g, "\\'") + `';
        var debug = [];
        var popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        var root = popovers.length > 0 ? popovers[popovers.length - 1] : document;
        debug.push('Popovers: ' + popovers.length);

        var allVisible = Array.from(root.querySelectorAll('div, span, p')).filter(function(el) {
          var r = el.getBoundingClientRect();
          return r.width > 20 && r.height > 10 && r.height < 120 && el.children.length <= 2;
        }).map(function(el) { return (el.textContent||'').trim().substring(0,50); })
          .filter(function(t){ return t.length > 1; }).slice(0, 15);
        debug.push('Texts: ' + JSON.stringify(allVisible));

        var found = false;
        var items = Array.from(root.querySelectorAll('div, button, li, a, span'));
        for (var i = 0; i < items.length; i++) {
          var el = items[i]; var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0 || r.height > 200 || r.height < 15) continue;
          var txt = (el.textContent || '').trim();
          var isMatch = (txt === target) ||
                        (txt.indexOf(target) !== -1 && txt.length < target.length + 40) ||
                        (baseName.length > 3 && txt.indexOf(baseName) !== -1 && txt.length < baseName.length + 40);
          if (isMatch) {
            var cx = r.x+r.width/2, cy = r.y+r.height/2;
            el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new MouseEvent('mousedown',    {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new PointerEvent('pointerup',  {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new MouseEvent('mouseup',      {bubbles:true, clientX:cx, clientY:cy}));
            el.dispatchEvent(new MouseEvent('click',        {bubbles:true, clientX:cx, clientY:cy}));
            found = true; debug.push('Matched: "' + txt.substring(0,60) + '"'); break;
          }
        }
        if (!found) {
          var imgs = Array.from(root.querySelectorAll('img'));
          for (var j = 0; j < imgs.length; j++) {
            var alt = (imgs[j].alt || imgs[j].title || '').trim();
            if (alt && (alt.indexOf(target) !== -1 || alt.indexOf(baseName) !== -1)) {
              var row = imgs[j].closest('div[class], li') || imgs[j].parentElement;
              if (row) { row.click(); found = true; debug.push('Img alt: ' + alt); break; }
            }
          }
        }
        if (!found) debug.push('NO MATCH for: "' + target + '"');
        return { success: found, debug: debug };
      })()
    `);
      console.log('[PAGE-GEN] Library select:', JSON.stringify(selectResult));
      const didSelect = selectResult?.success || false;

      if (!didSelect) {
        console.log('[PAGE-GEN] selectFromLibrary: not found — closing picker with Escape');
        await wv.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
        await new Promise(r => setTimeout(r, 600));
      } else {
        await new Promise(r => setTimeout(r, 1500));
      }

      console.log('[PAGE-GEN] selectFromLibrary done for "' + slotLabel + '"');
      return didSelect;
    };

    const downloadThumbToTemp = async (thumbUrl, name) => {
      if (!thumbUrl) return null;
      try {
        if (thumbUrl.startsWith('file://')) {
          const localPath = decodeURIComponent(thumbUrl.replace(/^file:\/\//, ''));
          if (fs.existsSync(localPath)) {
            console.log('[PAGE-GEN] Using local thumb file:', localPath);
            return localPath;
          }
          console.log('[PAGE-GEN] Local thumb file not found:', localPath);
          return null;
        }

        const tmpDir = require('os').tmpdir();
        const ext = thumbUrl.includes('.webp') ? '.webp' : thumbUrl.includes('.png') ? '.png' : '.jpg';
        const tmpPath = path.join(tmpDir, 'veo3_slot_' + Date.now() + ext);
        const resp = await fetch(thumbUrl);
        if (!resp.ok) { console.log('[PAGE-GEN] Thumb download failed:', resp.status); return null; }
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(tmpPath, buf);
        console.log('[PAGE-GEN] Downloaded thumb to:', tmpPath, '(' + buf.length + 'b)');
        return tmpPath;
      } catch (e) {
        console.log('[PAGE-GEN] downloadThumb error:', e.message);
        return null;
      }
    };

    let _csRefFilePaths = [];
    if (genType === 'video' && genMode === 'charsync') {
      const refThumbs = (startThumb || '').split('|||').filter(Boolean);
      const refFilePaths = Array.isArray(charSyncFilePaths) ? charSyncFilePaths : [];
      console.log('[PAGE-GEN] CharSync: preparing', refThumbs.length, 'thumbs +', refFilePaths.length, 'filePaths...');
      const tmpDir = require('os').tmpdir();
      const maxRef = Math.max(refThumbs.length, refFilePaths.length);
      for (let ri = 0; ri < Math.min(maxRef, 3); ri++) {
        const thumb = refThumbs[ri] || '';
        const fp = refFilePaths[ri] || '';
        try {
          if (thumb.startsWith('data:')) {
            const ext = thumb.includes('image/png') ? '.png' : thumb.includes('image/webp') ? '.webp' : '.jpg';
            const tmpPath = path.join(tmpDir, 'veo3_cs_ref_' + ri + '_' + Date.now() + ext);
            const b64 = thumb.split(',')[1];
            if (b64) {
              fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
              _csRefFilePaths.push(tmpPath);
              console.log('[PAGE-GEN] CharSync: ref[' + ri + '] base64 → ' + tmpPath);
            } else { _csRefFilePaths.push(null); }
          } else if (thumb.startsWith('file://')) {
            const lp = decodeURIComponent(thumb.replace(/^file:\/\//, ''));
            const exists = fs.existsSync(lp);
            console.log('[PAGE-GEN] CharSync: ref[' + ri + '] file:// → ' + lp + ' exists=' + exists);
            if (exists) {
              _csRefFilePaths.push(lp);
            } else if (fp && fs.existsSync(fp)) {
              console.log('[PAGE-GEN] CharSync: ref[' + ri + '] fallback to filePath: ' + fp);
              _csRefFilePaths.push(fp);
            } else {
              console.log('[PAGE-GEN] CharSync: ref[' + ri + '] file not found, skip');
              _csRefFilePaths.push(null);
            }
          } else if (thumb.startsWith('http://') || thumb.startsWith('https://')) {
            const tmpPath = path.join(tmpDir, 'veo3_cs_ref_' + ri + '_' + Date.now() + '.jpg');
            console.log('[PAGE-GEN] CharSync: ref[' + ri + '] downloading URL → ' + tmpPath);
            try {
              await new Promise((resolve, reject) => {
                const proto = thumb.startsWith('https://') ? require('https') : require('http');
                const file = fs.createWriteStream(tmpPath);
                proto.get(thumb, (res) => {
                  res.pipe(file);
                  file.on('finish', () => { file.close(); resolve(); });
                }).on('error', (err) => { fs.unlink(tmpPath, () => { }); reject(err); });
              });
              _csRefFilePaths.push(tmpPath);
              console.log('[PAGE-GEN] CharSync: ref[' + ri + '] downloaded OK');
            } catch (dlErr) {
              console.log('[PAGE-GEN] CharSync: ref[' + ri + '] download failed:', dlErr.message);
              if (fp && fs.existsSync(fp)) { _csRefFilePaths.push(fp); }
              else { _csRefFilePaths.push(null); }
            }
          } else if (fp && fs.existsSync(fp)) {
            console.log('[PAGE-GEN] CharSync: ref[' + ri + '] from filePath: ' + fp);
            _csRefFilePaths.push(fp);
          } else {
            console.log('[PAGE-GEN] CharSync: ref[' + ri + '] no valid source (thumb=' + thumb.substring(0, 30) + ' fp=' + fp + ')');
            _csRefFilePaths.push(null);
          }
        } catch (e) {
          console.log('[PAGE-GEN] CharSync prep error[' + ri + ']:', e.message);
          _csRefFilePaths.push(null);
        }
      }
      console.log('[PAGE-GEN] CharSync: ready =', _csRefFilePaths.filter(Boolean).length, 'files');
    }

    {
      const tabTarget = genType === 'video' ? 'Video' : 'nh';
      console.log('[PAGE-GEN] Switching to ' + genType + ' mode...');

      const configPos = await wv.executeJavaScript(`
      (function() {
        var btns = Array.from(document.querySelectorAll('button'));
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').trim();
          if ((t.includes('Banana') || t.includes('Veo') || t.includes('crop_')) && t.includes('x')) {
            var rect = btns[i].getBoundingClientRect();
            btns[i].focus();
            btns[i].click();
            return { found: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), text: t.substring(0, 60), id: btns[i].id || '' };
          }
        }
        return { found: false };
      })()
    `);
      console.log('[PAGE-GEN] Config button:', JSON.stringify(configPos));

      if (configPos.found) {
        await new Promise(r => setTimeout(r, 200));
        wv.sendInputEvent({ type: 'mouseDown', x: configPos.x, y: configPos.y, button: 'left', clickCount: 1 });
        await new Promise(r => setTimeout(r, 50));
        wv.sendInputEvent({ type: 'mouseUp', x: configPos.x, y: configPos.y, button: 'left', clickCount: 1 });

        let tabSwitched = false;
        for (let attempt = 0; attempt < 5 && !tabSwitched; attempt++) {
          await new Promise(r => setTimeout(r, 500));
          const tabResult = await wv.executeJavaScript(`
          (function() {
            var tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
            var allTexts = tabs.map(function(t) { return (t.textContent || '').trim() });
            for (var i = 0; i < tabs.length; i++) {
              var t = (tabs[i].textContent || '').trim();
              if (t.includes('${tabTarget}')) {
                if (tabs[i].getAttribute('data-state') === 'active') {
                  return { ok: true, alreadyActive: true, allTabs: allTexts };
                }
                var rect = tabs[i].getBoundingClientRect();
                var cx = rect.left + rect.width / 2;
                var cy = rect.top + rect.height / 2;
                var evtOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
                tabs[i].dispatchEvent(new PointerEvent('pointerdown', evtOpts));
                tabs[i].dispatchEvent(new MouseEvent('mousedown', evtOpts));
                tabs[i].dispatchEvent(new PointerEvent('pointerup', evtOpts));
                tabs[i].dispatchEvent(new MouseEvent('mouseup', evtOpts));
                tabs[i].dispatchEvent(new MouseEvent('click', evtOpts));
                return { ok: true, clicked: true, text: t, allTabs: allTexts };
              }
            }
            return { ok: false, allTabs: allTexts };
          })()
        `);
          console.log('[PAGE-GEN] Video tab attempt #' + (attempt + 1) + ':', JSON.stringify(tabResult));
          tabSwitched = tabResult.ok;
        }

        if (genType === 'video') {
          await new Promise(r => setTimeout(r, 200));
          const subTabTarget = genMode === 'charsync' ? 'Thành phần' : 'Khung hình';
          const subTabResult = await wv.executeJavaScript(`
        (function() {
          var tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
          for (var i = 0; i < tabs.length; i++) {
            var t = (tabs[i].textContent || '').trim();
            if (t.includes('${subTabTarget}')) {
              if (tabs[i].getAttribute('data-state') === 'active') {
                return { ok: true, alreadyActive: true, text: t };
              }
              var rect = tabs[i].getBoundingClientRect();
              var cx = rect.left + rect.width / 2;
              var cy = rect.top + rect.height / 2;
              var evtOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
              tabs[i].dispatchEvent(new PointerEvent('pointerdown', evtOpts));
              tabs[i].dispatchEvent(new MouseEvent('mousedown', evtOpts));
              tabs[i].dispatchEvent(new PointerEvent('pointerup', evtOpts));
              tabs[i].dispatchEvent(new MouseEvent('mouseup', evtOpts));
              tabs[i].dispatchEvent(new MouseEvent('click', evtOpts));
              return { ok: true, clicked: true, text: t };
            }
          }
          return { ok: false, tried: '${subTabTarget}' };
        })()
      `);
          console.log('[PAGE-GEN] Sub-tab (' + subTabTarget + '):', JSON.stringify(subTabResult));
          await new Promise(r => setTimeout(r, 200));

          await new Promise(r => setTimeout(r, 200));
          const aspectMap = {
            'portrait': '9:16',
            'landscape': '16:9',
            'square': '1:1',
            'IMAGE_ASPECT_RATIO_LANDSCAPE': '16:9',
            'IMAGE_ASPECT_RATIO_PORTRAIT': '9:16',
            'IMAGE_ASPECT_RATIO_SQUARE': '1:1',
            'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE': '4:3',
            'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR': '3:4',
            'IMAGE_ASPECT_RATIO_FOUR_THREE': '4:3',
            'IMAGE_ASPECT_RATIO_THREE_FOUR': '3:4',
            '16:9': '16:9',
            '9:16': '9:16',
            '1:1': '1:1',
            '4:3': '4:3',
            '3:4': '3:4',
          };
          const aspectTarget = aspectMap[genAspect] || '16:9';
          const aspectResult = await wv.executeJavaScript(`
        (function() {
          var tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
          for (var i = 0; i < tabs.length; i++) {
            var t = (tabs[i].textContent || '').trim();
            if (t.includes('${aspectTarget}')) {
              if (tabs[i].getAttribute('data-state') === 'active') {
                return { ok: true, alreadyActive: true, text: t };
              }
              tabs[i].focus();
              tabs[i].click();
              return { ok: true, clicked: true, text: t };
            }
          }
          return { ok: false };
        })()
      `);
          console.log('[PAGE-GEN] Aspect ' + aspectTarget + ':', JSON.stringify(aspectResult));

          await new Promise(r => setTimeout(r, 300));
          const qtyResult = await wv.executeJavaScript(`
        (function() {
          var btns = Array.from(document.querySelectorAll('button'));
          for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].textContent || '').trim();
            if (t === 'x1') {
              var rect = btns[i].getBoundingClientRect();
              if (rect.width === 0) continue;
              var cx = rect.left + rect.width / 2;
              var cy = rect.top + rect.height / 2;
              var evtOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
              btns[i].dispatchEvent(new PointerEvent('pointerdown', evtOpts));
              btns[i].dispatchEvent(new MouseEvent('mousedown', evtOpts));
              btns[i].dispatchEvent(new PointerEvent('pointerup', evtOpts));
              btns[i].dispatchEvent(new MouseEvent('mouseup', evtOpts));
              btns[i].dispatchEvent(new MouseEvent('click', evtOpts));
              return { ok: true, text: t };
            }
          }
          return { ok: false };
        })()
      `);
          console.log('[PAGE-GEN] Quantity x1:', JSON.stringify(qtyResult));

          await new Promise(r => setTimeout(r, 300));
          const speedMap = { fast: 'FAST_ONLY', relaxed: 'LOWER', quality: 'Quality' };
          const targetSpeed = speedMap[genQuality] || 'Fast';

          const modelDropPos = await wv.executeJavaScript(`
        (function() {
          var els = document.querySelectorAll('div, button');
          for (var i = 0; i < els.length; i++) {
            var t = (els[i].textContent || '').trim();
            var rect = els[i].getBoundingClientRect();
            if (rect.width > 150 && rect.width < 400 && rect.height > 20 && rect.height < 60 &&
                (t.includes('Veo') || t.includes('Banana')) &&
                (t.includes('Fast') || t.includes('Quality') || t.includes('Relaxed'))) {
              var children = els[i].querySelectorAll('div, button');
              var isLeaf = true;
              for (var j = 0; j < children.length; j++) {
                var ct = (children[j].textContent || '').trim();
                if (ct === t && children[j] !== els[i]) { isLeaf = false; break; }
              }
              if (!isLeaf) continue;
              return { found: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), text: t };
            }
          }
          return { found: false };
        })()
      `);
          console.log('[PAGE-GEN] Model dropdown pos:', JSON.stringify(modelDropPos));

          if (modelDropPos.found) {
            wv.sendInputEvent({ type: 'mouseDown', x: modelDropPos.x, y: modelDropPos.y, button: 'left', clickCount: 1 });
            wv.sendInputEvent({ type: 'mouseUp', x: modelDropPos.x, y: modelDropPos.y, button: 'left', clickCount: 1 });
            await new Promise(r => setTimeout(r, 600));

            const speedPos = await wv.executeJavaScript(`
          (function() {
            var targetSpeed = '${targetSpeed}';
            var items = Array.from(document.querySelectorAll('div[role="option"], div[role="menuitem"], div[data-radix-collection-item]'));
            var allTexts = items.map(function(el) { return (el.textContent || '').trim() });
            for (var i = 0; i < items.length; i++) {
              var t = (items[i].textContent || '').trim();
              var match = false;
              if (targetSpeed === 'FAST_ONLY') match = t.includes('Fast') && !t.includes('Lower');
              else if (targetSpeed === 'LOWER') match = t.includes('Lower');
              else match = t.includes(targetSpeed);
              if (match) {
                var rect = items[i].getBoundingClientRect();
                return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), text: t, allItems: allTexts };
              }
            }
            return { ok: false, allItems: allTexts };
          })()
        `);
            console.log('[PAGE-GEN] Speed select (' + targetSpeed + '):', JSON.stringify(speedPos));
            if (speedPos.ok) {
              wv.sendInputEvent({ type: 'mouseDown', x: speedPos.x, y: speedPos.y, button: 'left', clickCount: 1 });
              wv.sendInputEvent({ type: 'mouseUp', x: speedPos.x, y: speedPos.y, button: 'left', clickCount: 1 });
              await new Promise(r => setTimeout(r, 300));
            }
          }
        }

        await new Promise(r => setTimeout(r, 400));
        wv.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        wv.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await new Promise(r => setTimeout(r, 500));
        console.log('[PAGE-GEN] Popover closed, proceeding to fill prompt...');
      }

      {
        await new Promise(r => setTimeout(r, 300));
        const fallbackTabResult = await wv.executeJavaScript(`
        (function() {
          var tabTarget = '${tabTarget}';
          var tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
          for (var i = 0; i < tabs.length; i++) {
            var t = (tabs[i].textContent || '').trim();
            if (t.includes(tabTarget)) {
              if (tabs[i].getAttribute('data-state') === 'active') {
                return { ok: true, alreadyActive: true };
              }
              var rect = tabs[i].getBoundingClientRect();
              var cx = rect.left + rect.width / 2;
              var cy = rect.top + rect.height / 2;
              var evtOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
              tabs[i].dispatchEvent(new PointerEvent('pointerdown', evtOpts));
              tabs[i].dispatchEvent(new MouseEvent('mousedown', evtOpts));
              tabs[i].dispatchEvent(new PointerEvent('pointerup', evtOpts));
              tabs[i].dispatchEvent(new MouseEvent('mouseup', evtOpts));
              tabs[i].dispatchEvent(new MouseEvent('click', evtOpts));
              tabs[i].focus();
              tabs[i].click();
              return { ok: true, clicked: true, text: t };
            }
          }
          return { ok: false };
        })()
      `);
        console.log('[PAGE-GEN] Tab fallback switch (' + '${tabTarget}' + '):', JSON.stringify(fallbackTabResult));
        if (fallbackTabResult.ok && fallbackTabResult.clicked) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }

    if (genType === 'video' && genMode === 'charsync' && _csRefFilePaths.filter(Boolean).length > 0) {
      console.log('[PAGE-GEN] CharSync: attaching', _csRefFilePaths.filter(Boolean).length, 'ref images to prompt area...');
      await new Promise(r => setTimeout(r, 600));

      const csCleared = await wv.executeJavaScript(`
      (function() {
        var removed = 0;
        for (var attempt = 0; attempt < 6; attempt++) {
          var btns = Array.from(document.querySelectorAll('button'));
          var found = false;
          for (var i = 0; i < btns.length; i++) {
            var btn = btns[i];
            var r = btn.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            if (r.width > 40 || r.height > 40) continue;
            var icons = Array.from(btn.querySelectorAll('i, span'));
            var iconText = icons.map(function(ic){ return (ic.textContent||'').trim().toLowerCase(); }).join(' ');
            if (iconText.indexOf('close') !== -1 || iconText.indexOf('cancel') !== -1 || iconText.indexOf('delete') !== -1 || iconText.indexOf('remove') !== -1) {
              var parentText = (btn.closest('div') ? btn.closest('div').textContent : '').substring(0,100);
              if (parentText.indexOf('Bắt đầu') !== -1 || parentText.indexOf('Kết thúc') !== -1) continue;
              btn.click(); removed++; found = true; break;
            }
          }
          if (!found) break;
        }
        return { removed: removed };
      })()
    `);
      console.log('[PAGE-GEN] CharSync: cleared old prompt images =', JSON.stringify(csCleared));
      if (csCleared.removed > 0) await new Promise(r => setTimeout(r, 800));

      const csFileDataList = [];
      for (let ri = 0; ri < _csRefFilePaths.length; ri++) {
        const refPath = _csRefFilePaths[ri];
        if (!refPath || !fs.existsSync(refPath)) { console.log('[PAGE-GEN] CharSync: skip ref[' + ri + '] — no file'); continue; }
        const csFileName = path.basename(refPath);
        const csFileBuffer = fs.readFileSync(refPath);
        const csBase64 = csFileBuffer.toString('base64');
        const csExt = path.extname(refPath).toLowerCase();
        const csMime = csExt === '.png' ? 'image/png' : csExt === '.webp' ? 'image/webp' : 'image/jpeg';
        console.log('[PAGE-GEN] CharSync: prepared ref[' + ri + '] =', csFileName, '(' + csFileBuffer.length + 'b)');
        csFileDataList.push({ base64: csBase64, fileName: csFileName, mime: csMime });
      }
      const csTotalFiles = csFileDataList.length;
      console.log('[PAGE-GEN] CharSync: total valid files =', csTotalFiles);

      if (csTotalFiles > 0) {
        const csAddClicked = await wv.executeJavaScript(`
        (function() {
          var btns = Array.from(document.querySelectorAll('button'));
          for (var i = 0; i < btns.length; i++) {
            var btn = btns[i];
            var r = btn.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            if (btn.getAttribute('aria-haspopup') !== 'dialog') continue;
            var icons = Array.from(btn.querySelectorAll('i'));
            var hasAdd2 = icons.some(function(ic){ return (ic.textContent||'').trim() === 'add_2'; });
            if (!hasAdd2) continue;
            btn.focus(); btn.click();
            return { found: true, text: (btn.textContent||'').trim().substring(0,40) };
          }
          return { found: false };
        })()
      `);
        console.log('[PAGE-GEN] CharSync add_2 click:', JSON.stringify(csAddClicked));

        if (!csAddClicked.found) {
          console.log('[PAGE-GEN] CharSync: add_2 not found — skip all refs');
        } else {
          let csPickerOpen = false;
          for (let pw = 0; pw < 8; pw++) {
            await new Promise(r => setTimeout(r, 500));
            const csPickerCheck = await wv.executeJavaScript(`
            (function() {
              var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
              var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
              return { open: dialogs.length > 0 || poppers.length > 0 };
            })()
          `);
            if (csPickerCheck.open) { csPickerOpen = true; break; }
          }
          console.log('[PAGE-GEN] CharSync picker open:', csPickerOpen);

          if (!csPickerOpen) {
            console.log('[PAGE-GEN] CharSync: picker did not open — skip all refs');
          } else {
            await wv.executeJavaScript(`
            (function() {
              if (!window.__fileInputClickPatched) {
                window.__fileInputClickPatched = true;
                var _origClick = HTMLInputElement.prototype.click;
                HTMLInputElement.prototype.click = function() {
                  if (this.type === 'file') return;
                  return _origClick.apply(this, arguments);
                };
              }
              var inputs = Array.from(document.querySelectorAll('input[type="file"]'));
              inputs.forEach(function(fi) {
                if (!fi.__clickBlocked) {
                  fi.__clickBlocked = true;
                  fi.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); return false; }, true);
                }
              });
            })()
          `);

            const csUploadBtn = await wv.executeJavaScript(`
            (function() {
              var byClass = document.querySelector('.sc-f4c85962-10');
              if (byClass) {
                var r = byClass.getBoundingClientRect();
                if (r.width > 0) { byClass.click(); return { found: true, method: 'class', text: (byClass.textContent||'').trim().substring(0,40) }; }
              }
              var all = Array.from(document.querySelectorAll('div, button, span'));
              for (var i = 0; i < all.length; i++) {
                var t = (all[i].textContent || '').trim();
                var r = all[i].getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;
                if (t.indexOf('T\u1EA3i h\u00ECnh \u1EA3nh l\u00EAn') !== -1 || t.indexOf('Upload image') !== -1 || t === 'uploadUpload image') {
                  all[i].click(); return { found: true, method: 'text', text: t.substring(0,40) };
                }
              }
              var dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-radix-popper-content-wrapper]'));
              var root = dialogs.length > 0 ? dialogs[dialogs.length-1] : null;
              if (root) {
                var icons = Array.from(root.querySelectorAll('i, span'));
                for (var j = 0; j < icons.length; j++) {
                  if ((icons[j].textContent||'').trim() === 'upload') {
                    var uploadRow = icons[j].closest('div') || icons[j].parentElement;
                    if (uploadRow) { uploadRow.click(); return { found: true, method: 'icon', text: 'upload icon' }; }
                  }
                }
              }
              return { found: false };
            })()
          `);
            console.log('[PAGE-GEN] CharSync upload btn:', JSON.stringify(csUploadBtn));
            await new Promise(r => setTimeout(r, 800));

            let csFileInputReady = false;
            for (let fw = 0; fw < 6; fw++) {
              const fiCheck = await wv.executeJavaScript(`
              (function() {
                var inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                inputs.forEach(function(fi) {
                  if (!fi.__clickBlocked) {
                    fi.__clickBlocked = true;
                    fi.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); }, true);
                  }
                });
                return { count: inputs.length };
              })()
            `);
              if (fiCheck.count > 0) { csFileInputReady = true; break; }
              await new Promise(r => setTimeout(r, 400));
            }
            console.log('[PAGE-GEN] CharSync file input ready:', csFileInputReady);

            const csBaseline = await wv.executeJavaScript(`
            (function() {
              var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
              var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
              var pickerEl = dialogs.length > 0 ? dialogs[dialogs.length-1]
                           : poppers.length > 0  ? poppers[poppers.length-1]
                           : null;
              var allImgs = Array.from(document.querySelectorAll('img')).filter(function(img) {
                var r = img.getBoundingClientRect();
                if (r.width < 20 || r.height < 20) return false;
                if ((img.src||'').indexOf('placeholder') !== -1) return false;
                if (pickerEl && pickerEl.contains(img)) return false;
                return true;
              });
              return { count: allImgs.length };
            })()
          `);
            const csPromptThumbsBefore = csBaseline.count || 0;
            console.log('[PAGE-GEN] CharSync baseline prompt thumbs =', csPromptThumbsBefore);

            const csFilesJson = JSON.stringify(csFileDataList.map(f => ({ b64: f.base64, name: f.fileName, mime: f.mime })));
            const csAllInjected = await wv.executeJavaScript(`
            (async function() {
              var filesData = ${csFilesJson};
              var dt = new DataTransfer();
              for (var i = 0; i < filesData.length; i++) {
                var fd = filesData[i];
                var byteChars = atob(fd.b64);
                var byteArray = new Uint8Array(byteChars.length);
                for (var j = 0; j < byteChars.length; j++) byteArray[j] = byteChars.charCodeAt(j);
                var file = new File([new Blob([byteArray], {type: fd.mime})], fd.name, {type: fd.mime, lastModified: Date.now() + i});
                dt.items.add(file);
              }
              var fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
              if (fileInputs.length === 0) return { success: false, error: 'No file input found', count: 0 };
              var fi = fileInputs[fileInputs.length - 1];
              fi.files = dt.files;
              fi.dispatchEvent(new Event('change', { bubbles: true }));
              fi.dispatchEvent(new Event('input',  { bubbles: true }));
              return { success: true, injected: filesData.length, inputCount: fileInputs.length };
            })()
          `);
            console.log('[PAGE-GEN] CharSync multi-inject:', JSON.stringify(csAllInjected));

            if (!csAllInjected?.success) {
              console.log('[PAGE-GEN] CharSync multi-inject failed:', csAllInjected?.error);
            } else {
              const csNeedThumbCount = csPromptThumbsBefore + csTotalFiles;
              console.log('[PAGE-GEN] CharSync polling for all', csTotalFiles, 'thumbnails in prompt bar (need total >=', csNeedThumbCount, ')...');
              let csAllAttached = false;
              for (let attempt = 0; attempt < 20; attempt++) {
                await new Promise(r => setTimeout(r, 1500));
                const csCheck = await wv.executeJavaScript(`
                (function() {
                  var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
                  var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
                  var pickerEl = dialogs.length > 0 ? dialogs[dialogs.length-1]
                               : poppers.length > 0  ? poppers[poppers.length-1]
                               : null;
                  var isPickerOpen = dialogs.length > 0 || poppers.length > 0;
                  var promptThumbs = Array.from(document.querySelectorAll('img')).filter(function(img) {
                    var r = img.getBoundingClientRect();
                    if (r.width < 20 || r.height < 20) return false;
                    if ((img.src||'').indexOf('placeholder') !== -1) return false;
                    if (pickerEl && pickerEl.contains(img)) return false;
                    return true;
                  }).length;
                  return { pickerOpen: isPickerOpen, promptThumbs: promptThumbs };
                })()
              `);
                console.log('[PAGE-GEN] CharSync poll #' + (attempt + 1) + ': pickerOpen=' + csCheck.pickerOpen + ' promptThumbs=' + csCheck.promptThumbs + ' (need>=' + csNeedThumbCount + ')');
                if (csCheck.promptThumbs >= csNeedThumbCount) {
                  csAllAttached = true;
                  console.log('[PAGE-GEN] CharSync: all', csTotalFiles, 'thumbnails confirmed in prompt bar!');
                  break;
                }

                if (!csCheck.pickerOpen && attempt >= 2) {
                  await new Promise(r => setTimeout(r, 2000));
                  const csFinalCheck = await wv.executeJavaScript(`
                  (function() {
                    var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
                    var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
                    var pickerEl = dialogs.length > 0 ? dialogs[dialogs.length-1]
                                 : poppers.length > 0  ? poppers[poppers.length-1]
                                 : null;
                    var thumbs = Array.from(document.querySelectorAll('img')).filter(function(img) {
                      var r = img.getBoundingClientRect();
                      if (r.width < 20 || r.height < 20) return false;
                      if ((img.src||'').indexOf('placeholder') !== -1) return false;
                      if (pickerEl && pickerEl.contains(img)) return false;
                      return true;
                    }).length;
                    return { promptThumbs: thumbs };
                  })()
                `);
                  console.log('[PAGE-GEN] CharSync final check: promptThumbs=', csFinalCheck.promptThumbs);
                  if (csFinalCheck.promptThumbs >= csNeedThumbCount) {
                    csAllAttached = true;
                    console.log('[PAGE-GEN] CharSync: all', csTotalFiles, 'thumbnails confirmed (final check)!');
                  }
                  break;
                }
              }
              if (!csAllAttached) {
                console.log('[PAGE-GEN] CharSync WARNING: not all thumbnails confirmed — proceeding anyway');
              }
            }

            const csPickerStillOpen = await wv.executeJavaScript(`
            (function() {
              var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
              var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
              return { open: dialogs.length > 0 || poppers.length > 0 };
            })()
          `);
            if (csPickerStillOpen.open) {
              console.log('[PAGE-GEN] CharSync: picker still open — sending Escape');
              await wv.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
              await new Promise(r => setTimeout(r, 800));
            }
          }
        }
      }

      for (const p of _csRefFilePaths) { if (p) { try { fs.unlinkSync(p); } catch (e) { } } }
      console.log('[PAGE-GEN] CharSync: all refs attached, waiting 2s...');
      await new Promise(r => setTimeout(r, 2000));
    }

    if (genType === 'video' && (genMode === 'image' || genMode === 'startend')) {
      await clearSlot('Bắt đầu');
      if (genMode === 'startend') await clearSlot('Kết thúc');

      if (startFilePath && fs.existsSync(startFilePath)) {
        await uploadSlot('Bắt đầu', startFilePath);
      } else if (mediaId && startName) {
        const found = await selectSlotFromLibrary('Bắt đầu', startName);
        if (!found && startThumb) {
          console.log('[PAGE-GEN] Library select failed — downloading thumb to upload instead');
          const tmpPath = await downloadThumbToTemp(startThumb, startName);
          if (tmpPath) await uploadSlot('Bắt đầu', tmpPath);
        }
      }

      if (genMode === 'startend') {
        if (endFilePath && fs.existsSync(endFilePath)) {
          await uploadSlot('Kết thúc', endFilePath);
        } else if (endMediaId && endName) {
          const found = await selectSlotFromLibrary('Kết thúc', endName);
          if (!found && endThumb) {
            console.log('[PAGE-GEN] End library select failed — downloading thumb to upload');
            const tmpPath = await downloadThumbToTemp(endThumb, endName);
            if (tmpPath) await uploadSlot('Kết thúc', tmpPath);
          }
        }
      }

      console.log('[PAGE-GEN] Waiting 2s for WebView to process image attachment...');
      await new Promise(r => setTimeout(r, 2000));
    }

    let imgRefAttached = false;
    if (genType === 'image') {
      const _rawRefPaths = Array.isArray(referenceFilePaths) ? referenceFilePaths : [];
      const _rawRefUrls = Array.isArray(referenceImageUrls) ? referenceImageUrls : [];
      console.log('[PAGE-GEN] Image refs: raw paths =', JSON.stringify(_rawRefPaths.map(p => (p || '').substring(0, 60))));
      console.log('[PAGE-GEN] Image refs: raw urls  =', JSON.stringify(_rawRefUrls.map(u => (u || '').substring(0, 60))));
      const tmpDirRef = require('os').tmpdir();
      const resolvedRefPaths = [];
      for (let ri = 0; ri < Math.max(_rawRefPaths.length, _rawRefUrls.length); ri++) {
        const rawP = _rawRefPaths[ri] || '';
        const rawU = _rawRefUrls[ri] || '';
        try {
          if (rawP && !rawP.startsWith('http') && !rawP.startsWith('data:') && !rawP.startsWith('/fx/') && !rawP.startsWith('file://') && fs.existsSync(rawP)) {
            console.log('[PAGE-GEN] Image refs[' + ri + ']: local file OK → ' + rawP.substring(0, 60));
            resolvedRefPaths.push(rawP);
            continue;
          }

          const fileUrlSrc = rawP.startsWith('file://') ? rawP : rawU.startsWith('file://') ? rawU : null;
          if (fileUrlSrc) {
            const localPath = require('url').fileURLToPath(fileUrlSrc);
            if (fs.existsSync(localPath)) {
              console.log('[PAGE-GEN] Image refs[' + ri + ']: file:// → ' + localPath.substring(0, 60));
              resolvedRefPaths.push(localPath);
            } else { console.log('[PAGE-GEN] Image refs[' + ri + ']: file:// path not found: ' + localPath); }
            continue;
          }

          const dataSrc = rawP.startsWith('data:') ? rawP : rawU.startsWith('data:') ? rawU : null;
          if (dataSrc) {
            const ext2 = dataSrc.includes('image/png') ? '.png' : dataSrc.includes('image/webp') ? '.webp' : '.jpg';
            const tmpPath2 = path.join(tmpDirRef, 'veo3_imgref_' + ri + '_' + Date.now() + ext2);
            const b64 = dataSrc.split(',')[1];
            if (b64) { fs.writeFileSync(tmpPath2, Buffer.from(b64, 'base64')); resolvedRefPaths.push(tmpPath2); console.log('[PAGE-GEN] Image refs[' + ri + ']: data: → ' + tmpPath2); }
            else { console.log('[PAGE-GEN] Image refs[' + ri + ']: data: empty b64, skip'); }
            continue;
          }

          const httpSrc = (rawP.startsWith('http://') || rawP.startsWith('https://')) ? rawP
            : (rawU.startsWith('http://') || rawU.startsWith('https://')) ? rawU
              : null;
          if (httpSrc) {
            const tmpPath3 = await downloadThumbToTemp(httpSrc, 'imgref_' + ri + '.jpg');
            if (tmpPath3) { resolvedRefPaths.push(tmpPath3); console.log('[PAGE-GEN] Image refs[' + ri + ']: http → ' + tmpPath3); }
            else { console.log('[PAGE-GEN] Image refs[' + ri + ']: http download failed'); }
            continue;
          }

          const relSrc = rawP.startsWith('/') ? rawP : rawU.startsWith('/') ? rawU : null;
          if (relSrc) {
            const fullUrl = 'https://labs.google' + relSrc;
            const tmpPath4 = await downloadThumbToTemp(fullUrl, 'imgref_' + ri + '.jpg');
            if (tmpPath4) { resolvedRefPaths.push(tmpPath4); console.log('[PAGE-GEN] Image refs[' + ri + ']: relative → ' + tmpPath4); }
            else { console.log('[PAGE-GEN] Image refs[' + ri + ']: relative download failed'); }
            continue;
          }
          console.log('[PAGE-GEN] Image refs[' + ri + ']: no valid source (rawP=' + rawP.substring(0, 40) + ' rawU=' + rawU.substring(0, 40) + ')');
        } catch (e) {
          console.log('[PAGE-GEN] Image refs[' + ri + ']: resolve error:', e.message);
        }
      }
      console.log('[PAGE-GEN] Image refs: resolved', resolvedRefPaths.length, 'of', Math.max(_rawRefPaths.length, _rawRefUrls.length), 'paths');
      if (resolvedRefPaths.length > 0) {
        imgRefAttached = true;
        console.log('[PAGE-GEN] Image refs: attaching', resolvedRefPaths.length, 'reference image(s)...');
        for (let ri = 0; ri < resolvedRefPaths.length; ri++) {
          const imgPath = resolvedRefPaths[ri];
          const fileName = path.basename(imgPath);
          const fileBuffer = fs.readFileSync(imgPath);
          const base64 = fileBuffer.toString('base64');
          const ext = path.extname(imgPath).toLowerCase();
          const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          console.log('[PAGE-GEN] Image refs[' + ri + ']: uploading', fileName);

          const addClicked = await wv.executeJavaScript(`
          (function() {
            var btns = Array.from(document.querySelectorAll('button'));
            for (var i = 0; i < btns.length; i++) {
              var t = (btns[i].textContent || '').trim();
              if (t === 'add_2Create' || (t.indexOf('add_2') !== -1 && t.indexOf('New project') === -1 && t.indexOf('Add Media') === -1)) {
                var r = btns[i].getBoundingClientRect();
                if (r.width > 0) { btns[i].click(); return t; }
              }
            }
            return null;
          })()
        `);
          console.log('[PAGE-GEN] Image refs[' + ri + ']: add btn:', addClicked);
          if (!addClicked) { console.log('[PAGE-GEN] Image refs[' + ri + ']: + button not found, skip'); continue; }
          await new Promise(r => setTimeout(r, 1000));

          const uploadRowClicked = await wv.executeJavaScript(`
          (function() {
            var byClass = document.querySelector('.sc-f4c85962-10');
            if (byClass) {
              var r = byClass.getBoundingClientRect();
              if (r.width > 0) { byClass.click(); return { found: true, method: 'class', text: (byClass.textContent||'').trim().substring(0,40) }; }
            }
            var all = Array.from(document.querySelectorAll('div, button, span'));
            for (var i = 0; i < all.length; i++) {
              var t = (all[i].textContent || '').trim();
              var r = all[i].getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) continue;
              if (t.indexOf('T\u1EA3i h\u00ECnh \u1EA3nh l\u00EAn') !== -1 || t.indexOf('Upload image') !== -1 || t === 'uploadUpload image') {
                all[i].click(); return { found: true, method: 'text', text: t.substring(0,40) };
              }
            }
            var dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-radix-popper-content-wrapper]'));
            var root = dialogs.length > 0 ? dialogs[dialogs.length-1] : null;
            if (root) {
              var icons = Array.from(root.querySelectorAll('i, span'));
              for (var j = 0; j < icons.length; j++) {
                if ((icons[j].textContent||'').trim() === 'upload') {
                  var uploadRow = icons[j].closest('div') || icons[j].parentElement;
                  if (uploadRow) { uploadRow.click(); return { found: true, method: 'icon', text: 'upload icon' }; }
                }
              }
            }
            return { found: false };
          })()
        `);
          console.log('[PAGE-GEN] Image refs[' + ri + ']: upload row click:', JSON.stringify(uploadRowClicked));
          await new Promise(r => setTimeout(r, 500));

          const _b64_imgref = base64;
          const _fn_imgref = fileName.replace(/'/g, "\\'");
          const _mt_imgref = mimeType;
          const injected = await wv.executeJavaScript(`
          (async function() {
            var base64 = '` + _b64_imgref + `';
            var fileName = '` + _fn_imgref + `';
            var mimeType = '` + _mt_imgref + `';
            var byteChars = atob(base64);
            var byteArray = new Uint8Array(byteChars.length);
            for (var i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
            var file = new File([new Blob([byteArray], {type: mimeType})], fileName, {type: mimeType, lastModified: Date.now()});
            var fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
            if (fileInputs.length === 0) return { success: false, error: 'No file input' };
            var fi = fileInputs[fileInputs.length - 1];
            var dt = new DataTransfer();
            dt.items.add(file);
            fi.files = dt.files;
            fi.dispatchEvent(new Event('change', { bubbles: true }));
            fi.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true };
          })()
        `);
          console.log('[PAGE-GEN] Image refs[' + ri + ']: inject:', JSON.stringify(injected));
          if (!injected?.success) { console.log('[PAGE-GEN] Image refs[' + ri + ']: inject failed, skip'); continue; }

          const imgRefBaseline = await wv.executeJavaScript(`
          (function() {
            var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
            var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
            var root = dialogs.length > 0 ? dialogs[dialogs.length-1]
                     : poppers.length > 0  ? poppers[poppers.length-1]
                     : document;
            var imgs = Array.from(root.querySelectorAll('img')).filter(function(img) {
              var r = img.getBoundingClientRect();
              return r.width >= 30 && r.height >= 30 && (img.src||'').indexOf('placeholder') === -1;
            });
            return { count: imgs.length };
          })()
        `);
          const imgRefImgsBefore = imgRefBaseline.count || 0;
          console.log('[PAGE-GEN] Image refs[' + ri + ']: polling for thumbnail (baseline=' + imgRefImgsBefore + ')...');
          let imgRefReady = false;
          let imgRefPickerAutoClosed = false;
          for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            const imgRefCheck = await wv.executeJavaScript(`
            (function() {
              var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
              var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
              var root = dialogs.length > 0 ? dialogs[dialogs.length-1]
                       : poppers.length > 0  ? poppers[poppers.length-1]
                       : document;
              var isOpen = dialogs.length > 0 || poppers.length > 0;
              var imgs = Array.from(root.querySelectorAll('img')).filter(function(img) {
                var r = img.getBoundingClientRect();
                return r.width >= 30 && r.height >= 30 && (img.src||'').indexOf('placeholder') === -1;
              });
              return { count: imgs.length, open: isOpen };
            })()
          `);
            console.log('[PAGE-GEN] Image refs[' + ri + '] poll #' + (attempt + 1) + ': imgs=' + imgRefCheck.count + ' (need >' + imgRefImgsBefore + ') open=' + imgRefCheck.open);
            if (imgRefCheck.count > imgRefImgsBefore) { imgRefReady = true; break; }
            if (!imgRefCheck.open) {
              console.log('[PAGE-GEN] Image refs[' + ri + ']: picker auto-closed = attach success');
              imgRefReady = true;
              imgRefPickerAutoClosed = true;
              break;
            }
          }
          console.log('[PAGE-GEN] Image refs[' + ri + ']: ready=' + imgRefReady + ' autoClosed=' + imgRefPickerAutoClosed);

          if (imgRefPickerAutoClosed) {
            console.log('[PAGE-GEN] Image refs[' + ri + ']: skip step 5 — picker auto-closed (Google auto-selected)');
            await new Promise(r => setTimeout(r, 1000));
          } else {
            const escapedName = fileName.replace(/'/g, "\\'");
            const selectResult = await wv.executeJavaScript(`
            (function() {
              var target = '${escapedName}';
              var debug = [];
              var dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
              var poppers  = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
              var root = dialogs.length > 0 ? dialogs[dialogs.length-1]
                       : poppers.length > 0  ? poppers[poppers.length-1]
                       : document;
              debug.push((dialogs.length > 0 ? 'dialog' : poppers.length > 0 ? 'popper' : 'doc') + ':imgs=' + root.querySelectorAll('img').length);
              var items = Array.from(root.querySelectorAll('div, button, li, a'));
              var found = false;
              for (var i = 0; i < items.length; i++) {
                var el = items[i]; var r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0 || r.height > 150 || r.height < 25) continue;
                var txt = (el.textContent || '').trim();
                if (txt.indexOf(target) !== -1 && txt.length < target.length + 30) {
                  var cx = r.x+r.width/2, cy = r.y+r.height/2;
                  el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
                  el.dispatchEvent(new MouseEvent('mousedown',    {bubbles:true, clientX:cx, clientY:cy}));
                  el.dispatchEvent(new PointerEvent('pointerup',  {bubbles:true, clientX:cx, clientY:cy}));
                  el.dispatchEvent(new MouseEvent('mouseup',      {bubbles:true, clientX:cx, clientY:cy}));
                  el.dispatchEvent(new MouseEvent('click',        {bubbles:true, clientX:cx, clientY:cy}));
                  found = true; debug.push('by-name:' + txt.substring(0,40)); break;
                }
              }
              if (!found) {
                var allImgs = Array.from(root.querySelectorAll('img')).filter(function(img){
                  var ir = img.getBoundingClientRect();
                  return ir.width >= 30 && ir.height >= 30 && (img.src||'').indexOf('placeholder') === -1;
                });
                debug.push('fallback allImgs:' + allImgs.length);
                var tryIndices = allImgs.length > 0 ? [0, allImgs.length - 1] : [];
                var seen = {};
                for (var ti = 0; ti < tryIndices.length && !found; ti++) {
                  var j = tryIndices[ti];
                  if (seen[j]) continue; seen[j] = true;
                  var row = allImgs[j].closest('li') || allImgs[j].closest('[role="listitem"]') ||
                            allImgs[j].closest('.sc-f4c85962-14') || allImgs[j].closest('div[class]') || allImgs[j].parentElement;
                  if (!row) continue;
                  var rr = row.getBoundingClientRect();
                  if (rr.width <= 0 || rr.height <= 0) continue;
                  var cx = rr.x+rr.width/2, cy = rr.y+rr.height/2;
                  row.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
                  row.dispatchEvent(new MouseEvent('mousedown',    {bubbles:true, clientX:cx, clientY:cy}));
                  row.dispatchEvent(new PointerEvent('pointerup',  {bubbles:true, clientX:cx, clientY:cy}));
                  row.dispatchEvent(new MouseEvent('mouseup',      {bubbles:true, clientX:cx, clientY:cy}));
                  row.dispatchEvent(new MouseEvent('click',        {bubbles:true, clientX:cx, clientY:cy}));
                  found = true;
                  debug.push('fallback[' + j + '] alt=' + (allImgs[j].alt||'?').substring(0,40));
                }
              }
              if (!found) debug.push('NO selection made');
              return { success: found, debug: debug };
            })()
          `);
            console.log('[PAGE-GEN] Image refs[' + ri + ']: select:', JSON.stringify(selectResult));
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        console.log('[PAGE-GEN] Image refs: all', resolvedRefPaths.length, 'reference(s) attached, waiting 1s...');
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await wv.executeJavaScript(`
    (function() {
      var originalFetch = window.__originalFetch || window.fetch;
      window.__originalFetch = originalFetch;
      if (!window.__pageGenResults) window.__pageGenResults = {};
      if (!window.__pageGenResolvers) window.__pageGenResolvers = {};
      if (!window.__pageGenArmedQueue) window.__pageGenArmedQueue = [];

      window.fetch = async function() {
        var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url);
        var response = await originalFetch.apply(this, arguments);

        var isAiApi = url && url.indexOf('aisandbox') !== -1;
        if (isAiApi && window.__pageGenArmedQueue && window.__pageGenArmedQueue.length > 0) {
          try {
            var clone = response.clone();
            var data = await clone.json();
            var dataStr = JSON.stringify(data);
            var hasOps = data && data.operations && Array.isArray(data.operations) && data.operations.length > 0;
            var hasSingleOp = data && typeof data.name === 'string' && data.name.indexOf('operations/') !== -1;
            var hasMedia = data && data.media && Array.isArray(data.media) && data.media.length > 0;
            var isPending = dataStr.indexOf('PENDING') !== -1;
            var hasImageResult = hasMedia && (
              dataStr.indexOf('fifeUrl') !== -1 ||
              dataStr.indexOf('generatedImage') !== -1 ||
              dataStr.indexOf('imageUrl') !== -1
            );
            console.log('[FETCH-HOOK] aisandbox url=' + url.substring(url.lastIndexOf('/')+1) + ' status=' + response.status + ' hasOps=' + hasOps + ' hasSingleOp=' + hasSingleOp + ' hasMedia=' + hasMedia + ' isPending=' + isPending + ' keys=' + Object.keys(data||{}).join(','));
            if (hasOps || hasSingleOp || (hasMedia && isPending) || hasImageResult) {
              var respType = hasImageResult ? 'image' : 'video';
              var matchIdx = -1;
              for (var qi = 0; qi < window.__pageGenArmedQueue.length; qi++) {
                if (window.__pageGenArmedQueue[qi].type === respType) {
                  matchIdx = qi;
                  break;
                }
              }
              if (matchIdx === -1) {
                console.log('[FETCH-HOOK] Ignoring ' + respType + ' response — no matching armed request (queue: ' + window.__pageGenArmedQueue.map(function(a){return a.type}).join(',') + ')');
              } else {
                var armed = window.__pageGenArmedQueue.splice(matchIdx, 1)[0];
                var reqId = armed.id;
                console.log('[FETCH-HOOK] Caught ' + respType + ' response for reqId=' + reqId + ' (queue remaining: ' + window.__pageGenArmedQueue.length + ')');
                var result = { status: response.status, data: data, ok: response.ok };
                window.__pageGenResults[reqId] = result;
                if (window.__pageGenResolvers[reqId]) {
                  window.__pageGenResolvers[reqId](result);
                  delete window.__pageGenResolvers[reqId];
                }
              }
            }
          } catch(e) {}
        }
        return response;
      };
    })()
  `);

    const promptJson = JSON.stringify(String(prompt || ''));
    const fillResult = await wv.executeJavaScript(`
    (async function() {
      var value = ${promptJson};
      var textbox = document.querySelector('div[role="textbox"]')
        || document.querySelector('div[contenteditable="true"][role="textbox"]')
        || document.querySelector('div[contenteditable="true"]')
        || document.querySelector('textarea');
      if (!textbox) return { ok: false, text: 'NOT_FOUND' };

      textbox.focus();
      if (textbox.tagName === 'TEXTAREA' || textbox.tagName === 'INPUT') {
        textbox.value = value;
      } else {
        textbox.textContent = '';
        var textNode = document.createTextNode(value);
        textbox.appendChild(textNode);
      }

      var sel = window.getSelection();
      if (sel && document.createRange) {
        var range = document.createRange();
        range.selectNodeContents(textbox);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }

      ['beforeinput', 'input', 'change', 'keyup'].forEach(function(type) {
        try {
          textbox.dispatchEvent(new InputEvent(type, {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value
          }));
        } catch(e) {
          textbox.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        }
      });

      await new Promise(function(r) { setTimeout(r, 350); });
      var text = textbox.tagName === 'TEXTAREA' || textbox.tagName === 'INPUT'
        ? textbox.value
        : (textbox.innerText || textbox.textContent || '');
      return { ok: text.indexOf(value.slice(0, Math.min(32, value.length))) !== -1, text: text.slice(0, 160) };
    })()
  `);
    console.log('[PAGE-GEN] Textbox fill result:', JSON.stringify(fillResult).substring(0, 240));

    if (!fillResult || !fillResult.ok) {
      const previousClipboard = clipboard.readText();
      clipboard.writeText(String(prompt || ''));
      try {
        await wv.executeJavaScript(`
        (function() {
          var textbox = document.querySelector('div[role="textbox"]')
            || document.querySelector('div[contenteditable="true"][role="textbox"]')
            || document.querySelector('div[contenteditable="true"]')
            || document.querySelector('textarea');
          if (!textbox) return false;
          textbox.focus();
          var sel = window.getSelection();
          if (sel && document.createRange && textbox.tagName !== 'TEXTAREA') {
            var range = document.createRange();
            range.selectNodeContents(textbox);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          return true;
        })()
      `);
        const modifier = process.platform === 'darwin' ? 'Command' : 'Control';
        wv.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [modifier] });
        wv.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [modifier] });
        await new Promise(r => setTimeout(r, 80));
        wv.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
        wv.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
        await new Promise(r => setTimeout(r, 80));
        wv.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: [modifier] });
        wv.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: [modifier] });
        await new Promise(r => setTimeout(r, 500));
      } finally {
        clipboard.writeText(previousClipboard || '');
      }
    }

    const textContent = await wv.executeJavaScript(`
    (function() {
      var textbox = document.querySelector('div[role="textbox"]')
        || document.querySelector('div[contenteditable="true"]')
        || document.querySelector('textarea');
      if (!textbox) return 'NOT_FOUND';
      return textbox.tagName === 'TEXTAREA' ? textbox.value : (textbox.innerText || textbox.textContent || '');
    })()
  `);
    console.log('[PAGE-GEN] Textbox content:', String(textContent).substring(0, 120));
    if (!String(textContent || '').includes(String(prompt || '').slice(0, Math.min(24, String(prompt || '').length)))) {
      throw new Error('Prompt was not inserted into Google Flow editor — aborting before submit');
    }

    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    console.log('[PAGE-GEN] requestId:', requestId);
    await wv.executeJavaScript(`
    (function() {
      if (!window.__pageGenResults) window.__pageGenResults = {};
      if (!window.__pageGenResolvers) window.__pageGenResolvers = {};
      delete window.__pageGenResults['${requestId}'];
      delete window.__pageGenResolvers['${requestId}'];
    })()
  `);

    let createCoords = await wv.executeJavaScript(`
    (function() {
      var createBtn = null;

      var buttons = Array.from(document.querySelectorAll('button'));
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var icons = Array.from(btn.querySelectorAll('i')).map(function(ic) { return (ic.textContent||'').trim(); });
        var hasForward = icons.indexOf('arrow_forward') !== -1 || icons.indexOf('send') !== -1;
        var hasClose   = icons.indexOf('close') !== -1 || icons.indexOf('cancel') !== -1 || icons.indexOf('delete') !== -1 || icons.indexOf('clear') !== -1;
        if (hasForward && !hasClose) {
          var cr = btn.getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0) { createBtn = btn; break; }
        }
      }

      if (!createBtn) {
        for (var i = 0; i < buttons.length; i++) {
          var icons = Array.from(buttons[i].querySelectorAll('i')).map(function(ic) { return (ic.textContent||'').trim(); });
          if (icons.indexOf('arrow_forward') !== -1) {
            var cr = buttons[i].getBoundingClientRect();
            if (cr.width > 0) { createBtn = buttons[i]; break; }
          }
        }
      }

      if (!createBtn) {
        var allBtns = buttons.slice(0,30).map(function(b, i) {
          var ic = Array.from(b.querySelectorAll('i')).map(function(x) { return x.textContent.trim(); }).join(',');
          var cr = b.getBoundingClientRect();
          return i + ': icons=[' + ic + '] disabled=' + b.disabled + ' rect={w:' + Math.round(cr.width) + ',h:' + Math.round(cr.height) + '}';
        });
        console.log('[PAGE-GEN-DEBUG] Buttons:', allBtns.join(' || '));
        return null;
      }

      var cr = createBtn.getBoundingClientRect();
      return { x: Math.round(cr.x + cr.width/2), y: Math.round(cr.y + cr.height/2), text: createBtn.textContent.trim().substring(0,30), disabled: createBtn.disabled };
    })()
  `);
    console.log('[PAGE-GEN] createCoords:', JSON.stringify(createCoords));

    if (createCoords && createCoords.disabled) {
      const maxWaitSec = (genMode === 'charsync' || imgRefAttached) ? 30 : 15;
      console.log('[PAGE-GEN] Create btn disabled — polling until enabled (max ' + maxWaitSec + 's, imgRefAttached=' + imgRefAttached + ')...');
      for (let w = 0; w < maxWaitSec; w++) {
        await new Promise(r => setTimeout(r, 1000));
        const rc = await wv.executeJavaScript(`
        (function() {
          var buttons = Array.from(document.querySelectorAll('button'));
          for (var i = 0; i < buttons.length; i++) {
            var icons = Array.from(buttons[i].querySelectorAll('i')).map(function(ic) { return (ic.textContent||'').trim(); });
            var hasForward = icons.indexOf('arrow_forward') !== -1 || icons.indexOf('send') !== -1;
            var hasClose   = icons.indexOf('close') !== -1 || icons.indexOf('cancel') !== -1;
            if (hasForward && !hasClose) {
              var cr = buttons[i].getBoundingClientRect();
              if (cr.width > 0) return { x: Math.round(cr.x+cr.width/2), y: Math.round(cr.y+cr.height/2), disabled: buttons[i].disabled };
            }
          }
          return null;
        })()
      `);
        console.log('[PAGE-GEN] EnablePoll ' + (w + 1) + ':', JSON.stringify(rc));
        if (rc && !rc.disabled) { createCoords = rc; break; }
      }

      if (createCoords && createCoords.disabled) {
        throw new Error('Create button still disabled after ' + maxWaitSec + 's — ảnh chưa được validate, bỏ qua task');
      }
    }

    if (!createCoords) {
      console.log('[PAGE-GEN] Create button not found — trying to dismiss overlays...');
      wv.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      wv.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await new Promise(r => setTimeout(r, 500));

      await wv.executeJavaScript(`
      document.body.click();
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    `);
      await new Promise(r => setTimeout(r, 500));

      const retryCoords = await wv.executeJavaScript(`
      (function() {
        var buttons = Array.from(document.querySelectorAll('button'));
        for (var i = 0; i < buttons.length; i++) {
          var icons = Array.from(buttons[i].querySelectorAll('i')).map(function(ic) { return (ic.textContent||'').trim(); });
          var hasForward = icons.indexOf('arrow_forward') !== -1 || icons.indexOf('send') !== -1;
          var hasClose   = icons.indexOf('close') !== -1 || icons.indexOf('cancel') !== -1;
          if (hasForward && !hasClose && !buttons[i].disabled) {
            var cr = buttons[i].getBoundingClientRect();
            if (cr.width > 0) return { x: Math.round(cr.x+cr.width/2), y: Math.round(cr.y+cr.height/2), text: buttons[i].textContent.trim().substring(0,30) };
          }
        }
        return null;
      })()
    `);

      if (!retryCoords) throw new Error('Create button not found (even after dismissing overlays)');
      console.log('[PAGE-GEN] Create button found after dismiss:', JSON.stringify(retryCoords));
    }

    console.log('[PAGE-GEN] Create button found, clicking via JS...');

    await wv.executeJavaScript(`
    if (!window.__pageGenArmedQueue) window.__pageGenArmedQueue = [];
    window.__pageGenArmedQueue.push({ id: '${requestId}', type: '${genType}' });
    delete window.__pageGenResults['${requestId}'];
    console.log('[FETCH-HOOK] Armed reqId=${requestId} type=${genType}, queue:', JSON.stringify(window.__pageGenArmedQueue.map(function(a){return a.id.substring(0,12)+'('+a.type+')'})));
  `);

    const navHandler = (event) => {
      console.log('[PAGE-GEN] ⚠️ WebView navigated to:', event.url);
    };
    wv.on('did-navigate', navHandler);
    wv.on('did-navigate-in-page', navHandler);

    const clickResult = await wv.executeJavaScript(`
    (function() {
      var createBtn = null;
      var allArrowBtns = [];

      var buttons = Array.from(document.querySelectorAll('button'));
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var icons = Array.from(btn.querySelectorAll('i')).map(function(ic) { return (ic.textContent||'').trim(); });
        var hasForward = icons.indexOf('arrow_forward') !== -1 || icons.indexOf('send') !== -1;
        var hasClose   = icons.indexOf('close') !== -1 || icons.indexOf('cancel') !== -1 || icons.indexOf('delete') !== -1;
        if (hasForward) {
          var cr = btn.getBoundingClientRect();
          if (cr.width > 0) {
            allArrowBtns.push({
              text: (btn.textContent||'').trim().substring(0,30),
              class: (btn.className||'').substring(0,60),
              disabled: btn.disabled,
              hasClose: hasClose,
              rect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) }
            });
            if (!hasClose && !btn.disabled && !createBtn) createBtn = btn;
          }
        }
      }

      console.log('[PAGE-GEN] All arrow buttons:', JSON.stringify(allArrowBtns));
      console.log('[PAGE-GEN] Will click:', createBtn ? (createBtn.className||'').substring(0,60) : 'NONE');

      if (createBtn) {
        var cr = createBtn.getBoundingClientRect();
        var cx = Math.round(cr.x + cr.width / 2);
        var cy = Math.round(cr.y + cr.height / 2);
        var evtOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 };
        createBtn.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
        createBtn.dispatchEvent(new MouseEvent('mousedown', evtOpts));
        createBtn.dispatchEvent(new PointerEvent('pointerup', evtOpts));
        createBtn.dispatchEvent(new MouseEvent('mouseup', evtOpts));
        createBtn.dispatchEvent(new MouseEvent('click', evtOpts));
        createBtn.click();
        return { clicked: true, buttonCount: allArrowBtns.length, buttons: allArrowBtns };
      }
      return { clicked: false, buttonCount: allArrowBtns.length, buttons: allArrowBtns };
    })()
  `);

    console.log('[PAGE-GEN] Click result:', JSON.stringify(clickResult));

    if (createCoords && createCoords.x && createCoords.y) {
      const nx = createCoords.x;
      const ny = createCoords.y;
      await new Promise(r => setTimeout(r, 80));
      wv.sendInputEvent({ type: 'mouseDown', x: nx, y: ny, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 50));
      wv.sendInputEvent({ type: 'mouseUp', x: nx, y: ny, button: 'left', clickCount: 1 });
      console.log('[PAGE-GEN] Native click at createCoords', nx, ny, '(JS clicked=' + (clickResult && clickResult.clicked) + ')');
    }

    setTimeout(() => {
      try { wv.removeListener('did-navigate', navHandler); } catch { }
      try { wv.removeListener('did-navigate-in-page', navHandler); } catch { }
    }, 5000);

    return { status: 200, data: { submitted: true, requestId }, ok: true };
  });
});

ipcMain.handle('wait-page-gen-result', async (_, { timeoutMs, requestId }) => {
  const wv = findFlowWebview();
  if (!wv) throw new Error('WebView not found');

  const timeout = timeoutMs || 600000;
  const startTime = Date.now();
  const reqId = requestId || 'legacy';
  console.log('[PAGE-GEN] Waiting for result, requestId:', reqId);

  while (Date.now() - startTime < timeout) {
    const result = await wv.executeJavaScript(`window.__pageGenResults && window.__pageGenResults['${reqId}']`);
    if (result) {
      console.log('[PAGE-GEN] Got result for', reqId, ':', JSON.stringify(result).substring(0, 300));
      await wv.executeJavaScript(`delete window.__pageGenResults['${reqId}'];`);
      if (result.error) throw new Error(result.error);
      if (!result.ok) throw new Error('API ' + result.status + ': ' + JSON.stringify(result.data).substring(0, 500));
      return { status: result.status, data: result.data };
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error('Timeout — không nhận được response từ API');
});
};
