'use strict';

module.exports = function registerFlowWebviewUploadIpc(dependencies) {
  const {
    ipcMain,
    dialog,
    path,
    fs,
    findFlowWebview,
  } = dependencies;

ipcMain.handle('upload-start-image-on-webview', async (_, { imagePath, slot }) => {
  const wv = findFlowWebview();
  if (!wv) throw new Error('WebView not found');

  const slotLabel = slot === 'end' ? 'Kết thúc' : 'Bắt đầu';
  let imgPath = imagePath;
  if (imgPath.startsWith('file://')) imgPath = decodeURIComponent(imgPath.replace('file://', ''));
  if (!fs.existsSync(imgPath)) throw new Error('File not found: ' + imgPath);

  const fileName = path.basename(imgPath);
  const fileBuffer = fs.readFileSync(imgPath);
  const base64 = fileBuffer.toString('base64');
  const ext = path.extname(imgPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  console.log('[START-IMG] Starting upload for slot:', slotLabel, 'file:', fileName);

  const slotClicked = await wv.executeJavaScript(`
    (function() {
      var label = '${slotLabel}';
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
      el.focus();
      el.click();
      return { found: true, text: (el.textContent || '').trim().substring(0, 40) };
    })()
  `);
  console.log('[START-IMG] Slot button click:', JSON.stringify(slotClicked));
  if (!slotClicked.found) throw new Error('"' + slotLabel + '" button not found');
  await new Promise(r => setTimeout(r, 1000));

  const uploadIconClicked = await wv.executeJavaScript(`
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
            var row = icons[j].closest('div') || icons[j].parentElement;
            if (row) { row.click(); return { found: true, method: 'icon' }; }
          }
        }
      }
      return { found: false };
    })()
  `);
  console.log('[START-IMG] Upload icon:', JSON.stringify(uploadIconClicked));
  await new Promise(r => setTimeout(r, 500));

  const injected = await wv.executeJavaScript(`
    (async function() {
      var base64 = '${base64}';
      var fileName = '${fileName.replace(/'/g, "\\'")}';
      var mimeType = '${mimeType}';
      var byteChars = atob(base64);
      var byteArray = new Uint8Array(byteChars.length);
      for (var i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
      var file = new File([new Blob([byteArray], {type: mimeType})], fileName, {type: mimeType, lastModified: Date.now()});
      var fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (fileInputs.length === 0) return { success: false, error: 'No file input found' };
      var fi = fileInputs[fileInputs.length - 1];
      var dt = new DataTransfer();
      dt.items.add(file);
      fi.files = dt.files;
      fi.dispatchEvent(new Event('change', { bubbles: true }));
      fi.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true, fileName: fileName, inputCount: fileInputs.length };
    })()
  `);
  console.log('[START-IMG] File inject:', JSON.stringify(injected));
  if (!injected?.success) throw new Error(injected?.error || 'File inject failed');

  console.log('[START-IMG] Waiting for upload...');
  await new Promise(r => setTimeout(r, 6000));

  const selectResult = await wv.executeJavaScript(`
    (function() {
      var target = '${fileName.replace(/'/g, "\\'")}';

      var dialogs = Array.from(document.querySelectorAll('[role="dialog"], [data-radix-popper-content-wrapper]'));
      var root = dialogs.length > 0 ? dialogs[dialogs.length - 1] : document;
      var items = Array.from(root.querySelectorAll('div, button, li'));
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.height > 150 || r.height < 25) continue;
        var txt = (el.textContent || '').trim();
        if (txt.indexOf(target) !== -1 && txt.length < target.length + 50) {
          el.focus();
          el.click();
          return { success: true, text: txt.substring(0, 50) };
        }
      }

      var imgs = Array.from(root.querySelectorAll('img'));
      for (var j = 0; j < imgs.length; j++) {
        var ir = imgs[j].getBoundingClientRect();
        if (ir.width > 30 && ir.height > 30) {
          var row = imgs[j].closest('div[class], li') || imgs[j].parentElement;
          if (row) { row.click(); return { success: true, text: 'First image (fallback)' }; }
        }
      }
      return { success: false };
    })()
  `);
  console.log('[START-IMG] Select result:', JSON.stringify(selectResult));
  await new Promise(r => setTimeout(r, 500));

  return { success: selectResult?.success || false, fileName };
});

ipcMain.handle('upload-reference-on-webview', async (_, { imagePath }) => {
  const wv = findFlowWebview();
  if (!wv) return { success: false, error: 'WebView not found' };

  let imgPath = imagePath;
  if (imgPath.startsWith('file://')) {
    imgPath = decodeURIComponent(imgPath.replace('file://', ''));
  }

  if (!fs.existsSync(imgPath)) {
    return { success: false, error: 'File not found: ' + imgPath };
  }

  const fileName = path.basename(imgPath);
  const fileBuffer = fs.readFileSync(imgPath);
  const base64 = fileBuffer.toString('base64');
  const ext = path.extname(imgPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  console.log('[REF-UPLOAD] Starting:', fileName);

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
  console.log('[REF-UPLOAD] Add button:', addClicked);
  if (!addClicked) return { success: false, error: 'Add (+) button not found' };
  await new Promise(r => setTimeout(r, 1000));

  const uploadBtnClicked = await wv.executeJavaScript(`
    (function() {
      var btns = Array.from(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || '').trim();
        if (t === 'uploadUpload image' || t.indexOf('Upload image') !== -1) {
          btns[i].click(); return t;
        }
      }
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || '').trim();
        if (t === 'upload' || t.indexOf('upload') === 0) {
          btns[i].click(); return t;
        }
      }
      return null;
    })()
  `);
  console.log('[REF-UPLOAD] Upload button:', uploadBtnClicked);
  await new Promise(r => setTimeout(r, 500));

  const _b64_ref = base64;
  const _fn_ref = fileName.replace(/'/g, "\\'");
  const _mt_ref = mimeType;
  const injected = await wv.executeJavaScript(`
    (async function() {
      var base64 = '` + _b64_ref + `';
      var fileName = '` + _fn_ref + `';
      var mimeType = '` + _mt_ref + `';
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
      return { success: true, fileName: fileName };
    })()
  `);
  console.log('[REF-UPLOAD] File inject:', JSON.stringify(injected));
  if (!injected?.success) return { success: false, error: injected?.error || 'Inject failed' };

  console.log('[REF-UPLOAD] Waiting for upload...');
  await new Promise(r => setTimeout(r, 6000));

  const escapedName = fileName.replace(/'/g, "\\'");
  const selectResult = await wv.executeJavaScript(`
    (function() {
      var target = '${escapedName}';
      var debug = [];
      var popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
      var root = popovers.length > 0 ? popovers[popovers.length - 1] : document;
      debug.push('Popovers: ' + popovers.length);
      var items = Array.from(root.querySelectorAll('div, button, li, a'));
      var found = false;
      for (var i = 0; i < items.length; i++) {
        var el = items[i]; var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.height > 150 || r.height < 25) continue;
        var txt = (el.textContent || '').trim();
        if (txt.indexOf(target) !== -1 && txt.length < target.length + 30) {
          var cx = r.x+r.width/2, cy = r.y+r.height/2;
          el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
          el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:cx, clientY:cy}));
          el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:cx, clientY:cy}));
          el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx, clientY:cy}));
          el.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:cx, clientY:cy}));
          found = true; debug.push('Matched: ' + txt.substring(0,40)); break;
        }
      }
      if (!found) {
        var imgs = Array.from(root.querySelectorAll('img'));
        debug.push('Fallback imgs: ' + imgs.length);
        for (var j = 0; j < imgs.length; j++) {
          var ir = imgs[j].getBoundingClientRect();
          if (ir.width > 20 && ir.height > 20) {
            var row = imgs[j].closest('div, li') || imgs[j].parentElement;
            var rr = row.getBoundingClientRect();
            row.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:rr.x+rr.width/2, clientY:rr.y+rr.height/2}));
            row.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:rr.x+rr.width/2, clientY:rr.y+rr.height/2}));
            row.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:rr.x+rr.width/2, clientY:rr.y+rr.height/2}));
            row.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:rr.x+rr.width/2, clientY:rr.y+rr.height/2}));
            row.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:rr.x+rr.width/2, clientY:rr.y+rr.height/2}));
            found = true; debug.push('Clicked img row'); break;
          }
        }
      }
      return { success: found, debug: debug };
    })()
  `);
  console.log('[REF-UPLOAD] Select:', JSON.stringify(selectResult));
  await new Promise(r => setTimeout(r, 2000));

  return { success: true, fileName };
});
};
