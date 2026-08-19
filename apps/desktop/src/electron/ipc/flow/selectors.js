'use strict';

const { withPageGenLock } = require('./page-gen-lock');

/**
 * Syncing app settings into the Flow page UI: model, quantity, aspect ratio.
 *
 * Shares the page-gen lock with `generate-via-page` — these clicks and a
 * running generation must never interleave in the same webview.
 * Registered by `electron/ipc/flow.js`.
 */

module.exports = function registerFlowSelectorsIpc(dependencies) {
  const {
    app,
    ipcMain,
    findFlowWebview,
  } = dependencies;

// ── Select Model on WebView ──────────────────────────────────────────
// Map app model values to WebView model display names
const MODEL_MAP = {
  'NARWHAL': 'Nano Banana 2',
  'GEM_PIX_2': 'Nano Banana Pro',
  'HARBOR_SEAL': 'Nano Banana 2 Lite',
};

ipcMain.handle('select-model-on-webview', async (_, { model }) => {
  return withPageGenLock(async () => {
    const wv = findFlowWebview();
    if (!wv) return { success: false, error: 'WebView not found' };

    const targetModel = MODEL_MAP[model];
    if (!targetModel) return { success: false, error: 'Unknown model: ' + model };

    console.log('[MODEL-SYNC] Selecting model:', targetModel);

    const result = await wv.executeJavaScript(`
    (async function() {
      var debug = [];
      var targetText = '${targetModel}';
      var modelNames = ['Nano Banana 2', 'Nano Banana Pro', 'Nano Banana 2 Lite'];

      try {
        // ═══ STEP 1: Click config trigger button ═══
        // Button with radix id containing a model name + "crop_"
        var configBtn = null;
        var buttons = Array.from(document.querySelectorAll('button'));
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || '');
          var id = buttons[i].id || '';
          for (var j = 0; j < modelNames.length; j++) {
            if (text.indexOf(modelNames[j]) !== -1 && (id.indexOf('radix') !== -1 || text.indexOf('crop_') !== -1)) {
              configBtn = buttons[i];
              break;
            }
          }
          if (configBtn) break;
        }
        if (!configBtn) return { success: false, error: 'Config button not found', debug: debug };

        // Click with native events for Radix
        var r = configBtn.getBoundingClientRect();
        var cx = r.x + r.width/2, cy = r.y + r.height/2;
        configBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:cx, clientY:cy}));
        await new Promise(r => setTimeout(r, 30));
        configBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:cx, clientY:cy}));
        await new Promise(r => setTimeout(r, 800));
        debug.push('Step1: Config clicked');

        // ═══ STEP 2: Find model dropdown button INSIDE the popover ═══
        // Radix renders popover in [data-radix-popper-content-wrapper]
        // Inside it, the model dropdown is a button with aria-haspopup="menu"
        var popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        debug.push('Step2: Found ' + popovers.length + ' radix popovers');

        // If no popover, config was already open and we toggled it closed — click again
        if (popovers.length === 0) {
          debug.push('Step2: No popover — re-clicking config to open');
          await new Promise(r => setTimeout(r, 300));
          var r2 = configBtn.getBoundingClientRect();
          var cx2 = r2.x + r2.width/2, cy2 = r2.y + r2.height/2;
          configBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx2, clientY:cy2}));
          configBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:cx2, clientY:cy2}));
          await new Promise(r => setTimeout(r, 30));
          configBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:cx2, clientY:cy2}));
          configBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx2, clientY:cy2}));
          configBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:cx2, clientY:cy2}));
          await new Promise(r => setTimeout(r, 800));
          popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
          debug.push('Step2: Re-check: ' + popovers.length + ' radix popovers');
        }

        var modelBtn = null;

        // Search inside popovers for button with aria-haspopup="menu"
        for (var p = 0; p < popovers.length; p++) {
          var btns = Array.from(popovers[p].querySelectorAll('button[aria-haspopup="menu"]'));
          for (var b = 0; b < btns.length; b++) {
            var txt = (btns[b].textContent || '');
            for (var m = 0; m < modelNames.length; m++) {
              if (txt.indexOf(modelNames[m]) !== -1) {
                modelBtn = btns[b];
                debug.push('Step2: Found model btn in popover: "' + txt.trim().substring(0,50) + '"');
                break;
              }
            }
            if (modelBtn) break;
          }
          if (modelBtn) break;
        }

        if (!modelBtn) {
          // Fallback: search ALL buttons with aria-haspopup="menu" containing a model name
          var allBtns = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'));
          for (var i = 0; i < allBtns.length; i++) {
            var txt = (allBtns[i].textContent || '');
            for (var m = 0; m < modelNames.length; m++) {
              if (txt.indexOf(modelNames[m]) !== -1) {
                modelBtn = allBtns[i];
                debug.push('Step2: Found model btn (global): "' + txt.trim().substring(0,50) + '"');
                break;
              }
            }
            if (modelBtn) break;
          }
        }

        if (!modelBtn) {
          // Dump what we found for debug
          var allHaspopup = Array.from(document.querySelectorAll('[aria-haspopup]')).map(function(e) {
            return e.tagName + '|' + (e.textContent||'').trim().substring(0,40);
          });
          debug.push('Step2: No model btn. aria-haspopup elements: ' + JSON.stringify(allHaspopup));
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
          return { success: false, error: 'Model dropdown btn not found', debug: debug };
        }

        // Click model dropdown button
        var mr = modelBtn.getBoundingClientRect();
        var mx = mr.x + mr.width/2, my = mr.y + mr.height/2;
        modelBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:mx, clientY:my}));
        modelBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:mx, clientY:my}));
        await new Promise(r => setTimeout(r, 30));
        modelBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:mx, clientY:my}));
        modelBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:mx, clientY:my}));
        modelBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:mx, clientY:my}));
        await new Promise(r => setTimeout(r, 600));
        debug.push('Step2: Model dropdown clicked');

        // ═══ STEP 3: Click target model in the new dropdown ═══
        // A second data-radix-popper-content-wrapper should appear with model items
        var popovers2 = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        debug.push('Step3: Now ' + popovers2.length + ' radix popovers');

        var clicked = false;

        // Try role-based selectors first
        var menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
        debug.push('Step3: menuitem elements: ' + menuItems.length);
        for (var i = 0; i < menuItems.length; i++) {
          var itemText = (menuItems[i].textContent || '').trim();
          if (itemText.indexOf(targetText) !== -1) {
            debug.push('Step3: Clicking menuitem: "' + itemText.substring(0,40) + '"');
            menuItems[i].click();
            clicked = true;
            break;
          }
        }

        // If not found via role, scan popovers for elements with target text
        if (!clicked) {
          for (var p = 0; p < popovers2.length; p++) {
            var allEls = Array.from(popovers2[p].querySelectorAll('*'));
            for (var i = 0; i < allEls.length; i++) {
              var el = allEls[i];
              var txt = (el.textContent || '').trim();
              var elR = el.getBoundingClientRect();
              if (txt.indexOf(targetText) !== -1 && txt.length < 40 && elR.width > 0 && elR.height > 0 && el.children.length <= 3) {
                debug.push('Step3: Clicking popover element: ' + el.tagName + '.' + (el.className||'').toString().substring(0,30) + ' "' + txt.substring(0,30) + '"');
                el.click();
                clicked = true;
                break;
              }
            }
            if (clicked) break;
          }
        }

        // Broadest fallback: any visible element with target text
        if (!clicked) {
          var allEls = Array.from(document.querySelectorAll('div, span, button, li, a'));
          for (var i = 0; i < allEls.length; i++) {
            var el = allEls[i];
            var txt = (el.textContent || '').trim();
            var elR = el.getBoundingClientRect();
            if (txt === targetText && elR.width > 0 && elR.height > 0) {
              debug.push('Step3: Exact text match: ' + el.tagName + ' "' + txt + '"');
              el.click();
              clicked = true;
              break;
            }
          }
        }

        if (!clicked) {
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
          await new Promise(r => setTimeout(r, 100));
          document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
          return { success: false, error: 'Target model not found', debug: debug };
        }

        // Close all popovers after successful selection
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
        await new Promise(r => setTimeout(r, 100));
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

        return { success: true, model: targetText, debug: debug };
      } catch(e) {
        return { success: false, error: e.message, debug: debug };
      }
    })()
  `);

    console.log('[MODEL-SYNC] Result:', JSON.stringify(result, null, 2));
    return result;
  }); // end withPageGenLock
});

// ── Select Quantity on WebView ────────────────────────────────────────
ipcMain.handle('select-quantity-on-webview', async (_, { quantity }) => {
  return withPageGenLock(async () => {
    const wv = findFlowWebview();
    if (!wv) return { success: false, error: 'WebView not found' };

    const targetText = 'x' + quantity; // "x1", "x2", "x3", "x4"
    console.log('[QTY-SYNC] Selecting quantity:', targetText);

    const result = await wv.executeJavaScript(`
    (async function() {
      var debug = [];
      var targetText = '${targetText}';
      var modelNames = ['Nano Banana 2', 'Nano Banana Pro', 'Imagen 4'];

      try {
        // Step 1: Open config panel
        var configBtn = null;
        var buttons = Array.from(document.querySelectorAll('button'));
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || '');
          var id = buttons[i].id || '';
          for (var j = 0; j < modelNames.length; j++) {
            if (text.indexOf(modelNames[j]) !== -1 && (id.indexOf('radix') !== -1 || text.indexOf('crop_') !== -1)) {
              configBtn = buttons[i];
              break;
            }
          }
          if (configBtn) break;
        }
        if (!configBtn) return { success: false, error: 'Config button not found', debug: debug };

        // Click to open config
        var r = configBtn.getBoundingClientRect();
        var cx = r.x + r.width/2, cy = r.y + r.height/2;
        configBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:cx, clientY:cy}));
        await new Promise(r => setTimeout(r, 30));
        configBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:cx, clientY:cy}));
        await new Promise(r => setTimeout(r, 800));

        // Check popover
        var popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        if (popovers.length === 0) {
          // Re-click
          await new Promise(r => setTimeout(r, 300));
          var r2 = configBtn.getBoundingClientRect();
          configBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          configBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          await new Promise(r => setTimeout(r, 30));
          configBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          configBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          configBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          await new Promise(r => setTimeout(r, 800));
          popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        }
        debug.push('Popovers: ' + popovers.length);

        // Step 2: Find quantity tab buttons (role="tab" with text x1/x2/x3/x4)
        var searchRoot = popovers.length > 0 ? popovers[0] : document;
        var tabs = Array.from(searchRoot.querySelectorAll('button[role="tab"]'));
        debug.push('Tabs found: ' + tabs.length);

        var clicked = false;
        for (var i = 0; i < tabs.length; i++) {
          var tabText = (tabs[i].textContent || '').trim();
          if (tabText === targetText) {
            debug.push('Clicking tab: "' + tabText + '"');
            var tr = tabs[i].getBoundingClientRect();
            var tx = tr.x + tr.width/2, ty = tr.y + tr.height/2;
            tabs[i].dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:tx, clientY:ty}));
            tabs[i].dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:tx, clientY:ty}));
            await new Promise(r => setTimeout(r, 30));
            tabs[i].dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:tx, clientY:ty}));
            tabs[i].dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:tx, clientY:ty}));
            tabs[i].dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:tx, clientY:ty}));
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          // Broader search: any button with exact quantity text
          var allBtns = Array.from(searchRoot.querySelectorAll('button'));
          for (var i = 0; i < allBtns.length; i++) {
            var bText = (allBtns[i].textContent || '').trim();
            if (bText === targetText) {
              debug.push('Clicking fallback button: "' + bText + '"');
              var br = allBtns[i].getBoundingClientRect();
              var bx = br.x + br.width/2, by = br.y + br.height/2;
              allBtns[i].dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:bx, clientY:by}));
              allBtns[i].dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:bx, clientY:by}));
              await new Promise(r => setTimeout(r, 30));
              allBtns[i].dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:bx, clientY:by}));
              allBtns[i].dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:bx, clientY:by}));
              allBtns[i].dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:bx, clientY:by}));
              clicked = true;
              break;
            }
          }
        }

        // Close popover
        await new Promise(r => setTimeout(r, 200));
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

        if (!clicked) return { success: false, error: 'Quantity tab not found', debug: debug };
        return { success: true, quantity: targetText, debug: debug };
      } catch(e) {
        return { success: false, error: e.message, debug: debug };
      }
    })()
  `);

    console.log('[QTY-SYNC] Result:', JSON.stringify(result, null, 2));
    return result;
  }); // end withPageGenLock
});

// ── Select Aspect Ratio on WebView ───────────────────────────────────
const ASPECT_MAP = {
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
  'landscape': '16:9',
  'portrait': '9:16',
  'square': '1:1',
};

ipcMain.handle('select-aspect-on-webview', async (_, { aspect }) => {
  return withPageGenLock(async () => {
    const wv = findFlowWebview();
    if (!wv) return { success: false, error: 'WebView not found' };

    const targetText = ASPECT_MAP[aspect] || '16:9';

    console.log('[ASPECT-SYNC] Selecting aspect:', targetText);

    const result = await wv.executeJavaScript(`
    (async function() {
      var debug = [];
      var targetText = '${targetText}';
      var modelNames = ['Nano Banana 2', 'Nano Banana Pro', 'Nano Banana 2 Lite', 'Nano Banana'];

      try {
        // Step 1: Open config panel
        var configBtn = null;
        var buttons = Array.from(document.querySelectorAll('button'));
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || '');
          var id = buttons[i].id || '';
          for (var j = 0; j < modelNames.length; j++) {
            if (text.indexOf(modelNames[j]) !== -1 && (id.indexOf('radix') !== -1 || text.indexOf('crop_') !== -1 || text.indexOf('16:9') !== -1 || text.indexOf('9:16') !== -1 || text.indexOf('1:1') !== -1)) {
              configBtn = buttons[i];
              break;
            }
          }
          if (!configBtn && (id.indexOf('radix') !== -1 && (text.indexOf('crop_') !== -1 || text.indexOf('16:9') !== -1 || text.indexOf('9:16') !== -1 || text.indexOf('1:1') !== -1 || text.indexOf('Landscape') !== -1 || text.indexOf('Portrait') !== -1))) {
            configBtn = buttons[i];
            break;
          }
          if (configBtn) break;
        }
        if (!configBtn) return { success: false, error: 'Config button not found', debug: debug };

        var r = configBtn.getBoundingClientRect();
        var cx = r.x + r.width/2, cy = r.y + r.height/2;
        configBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:cx, clientY:cy}));
        await new Promise(r => setTimeout(r, 30));
        configBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:cx, clientY:cy}));
        configBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:cx, clientY:cy}));
        await new Promise(r => setTimeout(r, 800));

        var popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        if (popovers.length === 0) {
          await new Promise(r => setTimeout(r, 300));
          var r2 = configBtn.getBoundingClientRect();
          configBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          configBtn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          await new Promise(r => setTimeout(r, 30));
          configBtn.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          configBtn.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          configBtn.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:r2.x+r2.width/2, clientY:r2.y+r2.height/2}));
          await new Promise(r => setTimeout(r, 800));
          popovers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
        }
        debug.push('Popovers: ' + popovers.length);

        // Step 2: Find aspect tab (role="tab" with text Landscape/Portrait)
        var searchRoot = popovers.length > 0 ? popovers[0] : document;
        var tabs = Array.from(searchRoot.querySelectorAll('button[role="tab"]'));
        debug.push('Tabs found: ' + tabs.length);

        var clicked = false;
        for (var i = 0; i < tabs.length; i++) {
          var tabText = (tabs[i].textContent || '').trim();
          // Tab text includes icon text like "crop_16_9Landscape" — check with indexOf
          if (tabText.indexOf(targetText) !== -1) {
            debug.push('Clicking tab: "' + tabText + '"');
            var tr = tabs[i].getBoundingClientRect();
            var tx = tr.x + tr.width/2, ty = tr.y + tr.height/2;
            tabs[i].dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:tx, clientY:ty}));
            tabs[i].dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:tx, clientY:ty}));
            await new Promise(r => setTimeout(r, 30));
            tabs[i].dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:tx, clientY:ty}));
            tabs[i].dispatchEvent(new MouseEvent('mouseup', {bubbles:true, clientX:tx, clientY:ty}));
            tabs[i].dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:tx, clientY:ty}));
            clicked = true;
            break;
          }
        }

        // Close popover
        await new Promise(r => setTimeout(r, 200));
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));

        if (!clicked) return { success: false, error: 'Aspect tab not found', debug: debug };
        return { success: true, aspect: targetText, debug: debug };
      } catch(e) {
        return { success: false, error: e.message, debug: debug };
      }
    })()
  `);

    console.log('[ASPECT-SYNC] Result:', JSON.stringify(result, null, 2));
    return result;
  }); // end withPageGenLock
});

};
