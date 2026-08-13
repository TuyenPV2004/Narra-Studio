# Narra Captcha Bridge Extension Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and bundle a least-privilege Manifest V3 Chrome extension that satisfies Narra Studio's existing CAPTCHA bridge protocol and replaces the broken remote extension download.

**Architecture:** `apps/desktop/captcha-extension` is the extension source of truth. Pure protocol validation is isolated from Chrome APIs, the service worker owns tab/WebSocket orchestration, a main-world helper performs one explicit reCAPTCHA execution, desktop diagnostics resolve only validated bundled folders, and packaging copies the extension as an unpacked resource.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JavaScript, Chrome `tabs`/`scripting` APIs, loopback WebSocket, Node.js built-in test/assert/vm/fs modules, Electron IPC, electron-builder, pnpm.

## Global Constraints

- Extension version is exactly `1.3.1`, matching the desktop minimum.
- WebSocket target is fixed to `ws://127.0.0.1:17773`.
- Host access is limited to `https://labs.google/*`.
- Allowed CAPTCHA actions are `IMAGE_GENERATION`, `VIDEO_GENERATION`, and `TEST`.
- Do not persist or log CAPTCHA tokens, cookies, credentials, passwords, or 2FA data.
- Do not add dependencies, remote services, analytics, CAPTCHA-solving services, or Chrome Web Store publishing.
- Do not commit, push, create/switch branches, or otherwise mutate Git history without an explicit user request.
- Do not claim end-to-end Google Flow success until the signed-in manual Chrome verification is completed.

---

## File Map

- Create `apps/desktop/captcha-extension/manifest.json`: Manifest V3 metadata and least-privilege permissions.
- Create `apps/desktop/captcha-extension/protocol.js`: pure message/action validation and bounded error helpers exposed as `globalThis.NarraCaptchaProtocol`.
- Create `apps/desktop/captcha-extension/page-token.js`: pure main-world token request function exposed as `globalThis.NarraCaptchaPageToken`.
- Create `apps/desktop/captcha-extension/background.js`: WebSocket lifecycle, Flow tab status, and token request routing.
- Create `scripts/test-captcha-extension.cjs`: extension manifest, protocol, helper, and worker regression checks.
- Create `apps/desktop/src/electron/ipc/flow/extension-directory.js`: validated extension-folder resolution.
- Modify `apps/desktop/src/electron/ipc/flow/diagnostics.js`: use the resolver and `app.getAppPath()` candidate.
- Modify `apps/desktop/src/renderer/assets/CaptchaSetupPage-DbTYSglx.js`: replace broken remote download actions with the bundled-folder action.
- Create `scripts/lib/captcha-extension-package.mjs`: validate/copy the extension into package staging.
- Create `scripts/test-captcha-extension-package.mjs`: isolated staging-copy tests.
- Modify `scripts/prepare-recovered-desktop-package.mjs`: call the packaging helper.
- Modify `apps/desktop/electron-builder.yml`: ship staged extension under `resources/captcha-extension` using `extraResources`.
- Modify `package.json`: include both new regression scripts in `pnpm test`.

---

### Task 1: Extension Contract and Manifest

**Files:**
- Create: `scripts/test-captcha-extension.cjs`
- Create: `apps/desktop/captcha-extension/manifest.json`
- Create: `apps/desktop/captcha-extension/protocol.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: desktop bridge messages documented in `apps/desktop/src/electron/captcha-bridge.js`.
- Produces: `globalThis.NarraCaptchaProtocol` with `VERSION`, `ALLOWED_ACTIONS`, `parseBridgeMessage(raw)`, `validateCaptchaRequest(message)`, and `toSafeError(error)`.

- [ ] **Step 1: Write failing manifest and protocol tests**

Add assertions to `scripts/test-captcha-extension.cjs` that load `manifest.json`, execute `protocol.js` in a `node:vm` context, and require:

```js
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '1.3.1');
assert.deepEqual(manifest.permissions, ['scripting']);
assert.deepEqual(manifest.host_permissions, ['https://labs.google/*']);
assert.equal(manifest.background.service_worker, 'background.js');
assert.equal(manifest.background.type, undefined);

assert.deepEqual(protocol.validateCaptchaRequest({
  type: 'captcha_request', id: 7, action: 'IMAGE_GENERATION',
}), {id: 7, action: 'IMAGE_GENERATION'});
assert.throws(
  () => protocol.validateCaptchaRequest({type: 'captcha_request', id: 7, action: 'ARBITRARY'}),
  /Unsupported CAPTCHA action/,
);
assert.equal(protocol.parseBridgeMessage('{"type":"ping","t":1}').type, 'ping');
assert.equal(protocol.parseBridgeMessage('not json'), null);
assert.equal(protocol.toSafeError(new Error('secret page detail')).includes('secret page detail'), false);
assert.equal(protocol.toSafeError(new Error('secret page detail')).length <= 160, true);
```

Update the root test command to run the existing workspace smoke test plus the new extension test:

```json
"test": "node scripts/smoke-local-workspace.cjs && node scripts/test-captcha-extension.cjs"
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-captcha-extension.cjs`

Expected: FAIL because `apps/desktop/captcha-extension/manifest.json` does not exist.

- [ ] **Step 3: Implement the minimal manifest and protocol**

Create a Manifest V3 manifest with only:

```json
{
  "manifest_version": 3,
  "name": "Narra Captcha Bridge",
  "version": "1.3.1",
  "description": "Connects an open Google Flow project to Narra Studio's local CAPTCHA bridge.",
  "permissions": ["scripting"],
  "host_permissions": ["https://labs.google/*"],
  "background": {"service_worker": "background.js"}
}
```

Implement `protocol.js` as a browser-safe IIFE. `validateCaptchaRequest` must require `type === 'captcha_request'`, a positive safe-integer `id`, and membership in the frozen action set. `parseBridgeMessage` returns `null` for malformed/non-object JSON. `toSafeError` returns a generic allowlisted message such as `Token request failed`, `Google Flow project is not open`, or a string capped at 160 characters without stack data.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node scripts/test-captcha-extension.cjs`

Expected: PASS with a final `Captcha extension contract tests passed.` line.

---

### Task 2: Token Helper and Service Worker

**Files:**
- Modify: `scripts/test-captcha-extension.cjs`
- Create: `apps/desktop/captcha-extension/page-token.js`
- Create: `apps/desktop/captcha-extension/background.js`

**Interfaces:**
- Consumes: `NarraCaptchaProtocol.validateCaptchaRequest(message)` and `NarraCaptchaProtocol.toSafeError(error)` from Task 1.
- Produces: `NarraCaptchaPageToken.requestToken(action)` and bridge messages `hello`, `status`, `captcha_response`, `pong`.

- [ ] **Step 1: Write failing page-helper tests**

Execute `page-token.js` in `node:vm` with a fake `document` and `grecaptcha`. Assert that it extracts only a `render` query value from an existing enterprise script, calls `grecaptcha.enterprise.execute(siteKey, {action})`, returns the token, and rejects when the runtime/key is missing:

```js
assert.equal(await helper.requestToken('TEST'), 'token-value-that-is-longer-than-twenty-characters');
assert.deepEqual(executeCalls, [{siteKey: 'site-key', options: {action: 'TEST'}}]);
await assert.rejects(() => missingRuntimeHelper.requestToken('TEST'), /reCAPTCHA runtime unavailable/);
await assert.rejects(() => missingKeyHelper.requestToken('TEST'), /reCAPTCHA site key unavailable/);
```

Add static worker assertions requiring the fixed loopback URL, `importScripts('protocol.js')`, `chrome.scripting.executeScript`, `files: ['page-token.js']`, and absence of `chrome.storage`, `console.log(token`, `fetch(`, and `<all_urls>`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-captcha-extension.cjs`

Expected: FAIL because `page-token.js` and `background.js` do not exist.

- [ ] **Step 3: Implement the main-world page helper**

Implement `requestToken(action)` so it:

1. Reads existing `script[src*="recaptcha/enterprise"]` or `script[src*="recaptcha/enterprise.js"]` elements.
2. Parses their URL and takes a non-empty `render` parameter that is not `explicit`.
3. Requires `globalThis.grecaptcha.enterprise.ready` and `.execute`; it does not inject a remote script.
4. Waits for `ready`, calls `execute(siteKey, {action})`, enforces a 20-second timeout, and requires a string token longer than 20 characters.
5. Exposes only `globalThis.NarraCaptchaPageToken = Object.freeze({requestToken})`.

- [ ] **Step 4: Implement the service worker**

Implement `background.js` with these exact behaviors:

- `importScripts('protocol.js')` in the service-worker world.
- Connect only to `ws://127.0.0.1:17773`; retry after 1, 2, 5, then at most 10 seconds.
- On open, send `{type:'hello', client:'narra-captcha-bridge', version:'1.3.1'}` and current status.
- Treat a Flow project as open only when a matching tab URL starts with `https://labs.google/fx/tools/flow/` and contains a non-empty segment after `/flow/`; the base `/flow` page is only `labsTabOpen`.
- Listen to `chrome.tabs.onCreated`, `onUpdated`, `onRemoved`, and `onActivated` and send updated bounded status.
- Reply to `ping` with `pong`.
- Validate every `captcha_request` and select the active matching project tab.
- First invoke `chrome.scripting.executeScript` with `world: 'MAIN'`, `target: {tabId}`, and `files: ['page-token.js']` so the helper is installed in the page's main world.
- Then invoke `chrome.scripting.executeScript` with the same world/target, `func: async (requestedAction) => globalThis.NarraCaptchaPageToken.requestToken(requestedAction)`, and the validated action argument.
- Return `{type:'captcha_response', id, token}` on success or `{type:'captcha_response', id, error: safeError}` on failure; never log or persist the token.

- [ ] **Step 5: Run the test and verify GREEN**

Run: `node scripts/test-captcha-extension.cjs`

Expected: PASS for contract, helper, and worker checks.

---

### Task 3: Validated Desktop Discovery and Setup Action

**Files:**
- Modify: `scripts/test-captcha-extension.cjs`
- Create: `apps/desktop/src/electron/ipc/flow/extension-directory.js`
- Modify: `apps/desktop/src/electron/ipc/flow/diagnostics.js`
- Modify: `apps/desktop/src/renderer/assets/CaptchaSetupPage-DbTYSglx.js`

**Interfaces:**
- Consumes: extension source directory containing `manifest.json` version `1.3.1`.
- Produces: `findExtensionDirectory({fs, path, candidates, requiredVersion}) -> string | null` and existing `open-extension-folder` IPC behavior.

- [ ] **Step 1: Write failing directory-resolution and renderer tests**

In `scripts/test-captcha-extension.cjs`, create temporary candidates and assert:

```js
assert.equal(findExtensionDirectory({fs, path, candidates: [emptyDir], requiredVersion: '1.3.1'}), null);
assert.equal(findExtensionDirectory({fs, path, candidates: [validDir], requiredVersion: '1.3.1'}), validDir);
assert.equal(findExtensionDirectory({fs, path, candidates: [oldDir], requiredVersion: '1.3.1'}), null);
```

Read the recovered setup asset and assert it contains `window.api.openExtensionFolder()` and does not contain `captcha-extension.zip` or `endpoints.updatesBase`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-captcha-extension.cjs`

Expected: FAIL because `extension-directory.js` does not exist and the renderer still contains the remote ZIP URL.

- [ ] **Step 3: Implement validated folder resolution**

Create `extension-directory.js` with a numeric dotted-version comparator and `findExtensionDirectory`. For each candidate it must read and parse `manifest.json`, require `manifest_version === 3`, require the extension name `Narra Captcha Bridge`, and require version `>= requiredVersion`; invalid JSON/read/stat results skip the candidate.

In `diagnostics.js`, replace the nested directory probe with:

```js
const {findExtensionDirectory} = require('./extension-directory');

function getExtensionDirectory() {
  return findExtensionDirectory({
    fs,
    path,
    requiredVersion: REQUIRED_EXTENSION_VERSION,
    candidates: [
      path.join(app.getAppPath(), 'captcha-extension'),
      path.join(process.resourcesPath || '', 'captcha-extension'),
      path.join(IPC_DIR, '..', '..', 'captcha-extension'),
      path.join(IPC_DIR, '..', 'captcha-extension'),
    ],
  });
}
```

- [ ] **Step 4: Replace remote download actions with bundled-folder action**

In `CaptchaSetupPage-DbTYSglx.js`, replace both `window.api.openExternalUrl(...captcha-extension.zip...)` callbacks with `()=>void v()`, where existing `v()` calls `window.api.openExtensionFolder()` and displays the existing toast. Preserve the Google Flow external URL action.

- [ ] **Step 5: Run focused and syntax checks**

Run:

```powershell
node scripts/test-captcha-extension.cjs
pnpm typecheck
```

Expected: both PASS; typecheck reports the recovered renderer and Electron source syntax are valid.

---

### Task 4: Deterministic Package Staging

**Files:**
- Create: `scripts/lib/captcha-extension-package.mjs`
- Create: `scripts/test-captcha-extension-package.mjs`
- Modify: `scripts/prepare-recovered-desktop-package.mjs`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: `apps/desktop/captcha-extension` from Tasks 1-2.
- Produces: `stageCaptchaExtension({source, destination, requiredVersion})` and staged `captcha-extension` copied by electron-builder to `resources/captcha-extension`.

- [ ] **Step 1: Write failing staging tests**

In `scripts/test-captcha-extension-package.mjs`, create temporary source/destination directories and assert:

```js
assert.throws(
  () => stageCaptchaExtension({source: missingSource, destination, requiredVersion: '1.3.1'}),
  /missing/i,
);
stageCaptchaExtension({source: validSource, destination, requiredVersion: '1.3.1'});
assert.equal(JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')).version, '1.3.1');
assert.equal(existsSync(join(destination, 'background.js')), true);
assert.equal(existsSync(join(destination, 'protocol.js')), true);
assert.equal(existsSync(join(destination, 'page-token.js')), true);
```

Also parse `electron-builder.yml` as text and require an `extraResources` mapping from `captcha-extension` to `captcha-extension`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/test-captcha-extension-package.mjs`

Expected: FAIL because the packaging helper does not exist.

- [ ] **Step 3: Implement validation and copy helper**

Create `stageCaptchaExtension` using only `node:fs` and `node:path`. It must require the four files `manifest.json`, `background.js`, `protocol.js`, and `page-token.js`, validate Manifest V3/name/version, resolve absolute source/destination paths, reject equal or nested-unsafe targets, clear only the explicitly supplied destination, then `cpSync(..., {recursive:true})`.

- [ ] **Step 4: Integrate package preparation and electron-builder**

In `prepare-recovered-desktop-package.mjs`, after copying `dist`, `dist-electron`, and `config`, call:

```js
stageCaptchaExtension({
  source: path.join(desktopRoot, 'captcha-extension'),
  destination: path.join(appRoot, 'captcha-extension'),
  requiredVersion: '1.3.1',
});
```

Add to `apps/desktop/electron-builder.yml`:

```yaml
extraResources:
  - from: captcha-extension
    to: captcha-extension
    filter:
      - "**/*"
```

Update the root test command to:

```json
"test": "node scripts/smoke-local-workspace.cjs && node scripts/test-captcha-extension.cjs && node scripts/test-captcha-extension-package.mjs"
```

- [ ] **Step 5: Run focused tests and full project gates**

Run:

```powershell
node scripts/test-captcha-extension-package.mjs
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0. `pnpm build` must preserve the source extension and build the desktop runtime.

- [ ] **Step 6: Prepare and inspect package staging**

Run:

```powershell
node scripts/prepare-recovered-desktop-package.mjs
Get-ChildItem -Recurse .package-stage\app\captcha-extension
```

Expected: the staged directory contains exactly the manifest, protocol, page helper, and background worker (plus any explicitly approved extension assets added later); `manifest.json` reports version `1.3.1`.

Do not run the full Windows packaging command unless requested or needed for final package delivery because it is slower and writes a release artifact.

---

### Task 5: Security Review and Manual Handoff

**Files:**
- Review only: all files changed in Tasks 1-4

**Interfaces:**
- Consumes: completed extension, desktop integration, and package staging.
- Produces: review findings, automated verification evidence, and signed-in manual test instructions.

- [ ] **Step 1: Run security-focused static checks**

Run:

```powershell
rg -n "chrome\.storage|cookies|identity|debugger|webRequest|<all_urls>|console\..*token|localStorage|sessionStorage|fetch\(" apps\desktop\captcha-extension
rg -n "ws://" apps\desktop\captcha-extension
```

Expected: the first command returns no matches; the second returns only `ws://127.0.0.1:17773`.

- [ ] **Step 2: Run final verification from a clean command invocation**

Run:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Expected: all exit 0 with no syntax or assertion failures.

- [ ] **Step 3: Review the diff without changing Git history**

Run: `git diff --check` and `git diff -- apps/desktop/captcha-extension apps/desktop/src/electron/ipc/flow apps/desktop/src/renderer/assets/CaptchaSetupPage-DbTYSglx.js scripts package.json apps/desktop/electron-builder.yml`

Expected: no whitespace errors; diff is limited to the approved extension recovery scope.

- [ ] **Step 4: Hand off signed-in Chrome verification**

Provide these steps without claiming they were completed:

1. In Narra, open CAPTCHA setup and click the bundled-folder action.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select that `captcha-extension` folder.
3. Open a real project URL under `https://labs.google/fx/tools/flow/`.
4. Confirm Narra detects extension `1.3.1`, the project, and then use **Verify now**.
5. If verification fails, collect only bounded error/status messages; never copy CAPTCHA tokens, cookies, or account credentials.
