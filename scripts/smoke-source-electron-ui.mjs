import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const updateBaseline = process.argv.includes("--update-baseline");
const acceptCurrent = process.argv.includes("--accept-current");
const productionRuntime = process.argv.includes("--production");
const requestedPage =
  process.argv
    .find((argument) => argument.startsWith("--page="))
    ?.slice("--page=".length) || "provider-account";
const supportedPages = [
  "provider-account",
  "settings",
  "captcha-setup",
  "image-ultra",
  "image-editor",
  "video-pro",
  "voice",
  "upload",
  "video-editor",
  "capcut-video",
  "concat",
  "webview",
  "dashboard",
  "guide",
  "ai-agent",
];
if (!supportedPages.includes(requestedPage))
  throw new Error(`Unsupported source smoke page: ${requestedPage}`);
const targetRoute =
  requestedPage === "image-editor" ? "image-ultra" : requestedPage;
const artifactStem =
  requestedPage === "provider-account"
    ? "source-app-shell"
    : requestedPage === "image-ultra"
      ? "source-image"
      : `source-${requestedPage}`;
const executable = path.join(
  repositoryRoot,
  productionRuntime ? ".runtime-smoke-build" : ".runtime-source-smoke-build",
  "win-unpacked",
  "Narra Studio.exe",
);
const profileRoot = mkdtempSync(
  path.join(os.tmpdir(), "narra-source-electron-smoke-"),
);
const artifactRoot = path.join(repositoryRoot, ".smoke", "source-electron-ui");
const baselineRoot = path.join(repositoryRoot, "tests", "visual-baselines");
const currentExpanded = path.join(
  artifactRoot,
  `${artifactStem}-expanded.current.png`,
);
const currentCollapsed = path.join(
  artifactRoot,
  `${artifactStem}-collapsed.current.png`,
);
const baselineExpanded = path.join(
  baselineRoot,
  `${artifactStem}-expanded.png`,
);
const baselineCollapsed = path.join(
  baselineRoot,
  `${artifactStem}-collapsed.png`,
);
const reportFile = path.join(
  artifactRoot,
  requestedPage === "provider-account"
    ? "report.json"
    : `report-${requestedPage}.json`,
);

mkdirSync(artifactRoot, { recursive: true });
mkdirSync(baselineRoot, { recursive: true });
if (acceptCurrent) {
  if (!existsSync(currentExpanded) || !existsSync(currentCollapsed))
    throw new Error("Missing current source smoke artifacts to accept.");
  copyFileSync(currentExpanded, baselineExpanded);
  copyFileSync(currentCollapsed, baselineCollapsed);
  console.log(`Accepted reviewed current artifacts for ${requestedPage}.`);
  process.exit(0);
}
if (!existsSync(executable))
  throw new Error(
    "Missing source Electron smoke build. Run: pnpm package:electron-smoke:source",
  );

const allocatePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });

const waitForTarget = async (endpoint, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const target = targets.find(
        (entry) =>
          entry.type === "page" && entry.url.includes("/dist/index.html"),
      );
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Electron CDP endpoint did not expose the source renderer.");
};

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            new Error(`${pending.method}: ${message.error.message}`),
          );
        else pending.resolve(message.result);
      } else if (message.method) this.events.push(message);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  }
  async waitFor(expression, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }
  close() {
    this.socket?.close();
  }
}

const terminateProcessTree = async (processId) => {
  if (!processId) return;
  const killer = spawn(
    "taskkill.exe",
    ["/PID", String(processId), "/T", "/F"],
    { stdio: "ignore", windowsHide: true },
  );
  await new Promise((resolve) => killer.once("exit", resolve));
};
const screenshot = async (client, file) => {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  writeFileSync(file, Buffer.from(result.data, "base64"));
};
const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const pixelDifferenceRatio = (current, baseline) => {
  const script = `
Add-Type -AssemblyName System.Drawing
$a=[System.Drawing.Bitmap]::FromFile($env:NARRA_CURRENT)
$b=[System.Drawing.Bitmap]::FromFile($env:NARRA_BASELINE)
try {
  if ($a.Width -ne $b.Width -or $a.Height -ne $b.Height) { Write-Output 1; exit }
  $different=0
  for ($y=0; $y -lt $a.Height; $y+=2) { for ($x=0; $x -lt $a.Width; $x+=2) { if ($a.GetPixel($x,$y).ToArgb() -ne $b.GetPixel($x,$y).ToArgb()) { $different++ } } }
  $total=[Math]::Ceiling($a.Width/2)*[Math]::Ceiling($a.Height/2)
  Write-Output ($different/$total)
} finally { $a.Dispose(); $b.Dispose() }`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, NARRA_CURRENT: current, NARRA_BASELINE: baseline },
    },
  );
  if (result.status !== 0)
    throw new Error(`Cannot compare source smoke pixels: ${result.stderr}`);
  return Number(result.stdout.trim());
};
const baselineStatus = (current, baseline) =>
  !existsSync(baseline)
    ? { status: "MISSING", currentSha256: sha256(current) }
    : (() => {
        const differentPixelRatio = pixelDifferenceRatio(current, baseline);
        return {
          status: differentPixelRatio <= 0.001 ? "MATCH" : "DIFFERENT",
          differentPixelRatio,
          allowedDifferentPixelRatio: 0.001,
          currentSha256: sha256(current),
          baselineSha256: sha256(baseline),
        };
      })();

const port = await allocatePort();
const endpoint = `http://127.0.0.1:${port}`;
const electronProcess = spawn(
  executable,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileRoot}`,
    "--disable-gpu",
    "--force-device-scale-factor=1",
  ],
  {
    cwd: path.dirname(executable),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
const processOutput = { stdout: "", stderr: "" };
electronProcess.stdout.on("data", (chunk) => {
  processOutput.stdout += chunk.toString();
});
electronProcess.stderr.on("data", (chunk) => {
  processOutput.stderr += chunk.toString();
});

let client;
let runtime;
try {
  const target = await waitForTarget(endpoint);

  await new Promise((resolve) => setTimeout(resolve, 500));
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([
    client.send("Runtime.enable"),
    client.send("Log.enable"),
    client.send("Network.enable"),
    client.send("Page.enable"),
    client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }),
  ]);
  await client.waitFor(`document.getElementById('root')?.children.length > 0`);
  await client.waitFor(`typeof window.api === 'object'`);
  await client.waitFor(
    `document.querySelector('.source-provider-hub button:not(:disabled)')`,
  );
  await client.evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}';
    document.head.appendChild(style);
    localStorage.setItem('narra-atelier-dock-collapsed', '0');
    window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: ${JSON.stringify(targetRoute)}, imageMode: ${JSON.stringify(requestedPage === "image-editor" ? "edit" : undefined)}}}));
  })()`);
  await client.waitFor(
    `document.querySelector('.source-app-shell') && document.querySelector('.source-sidebar[data-collapsed="false"]') && document.querySelector('.source-header') && document.querySelector('.source-main-content')`,
  );
  if (requestedPage === "captcha-setup")
    await client.waitFor(
      `document.querySelector('.source-captcha-page') && !document.querySelector('.source-captcha-state .is-spinning')`,
    );
  if (requestedPage === "voice")
    await client.waitFor(
      `document.querySelector('.source-voice-page')?.dataset.loading === 'false'`,
    );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const measure = `(() => {
    const rect = (element) => { const value = element.getBoundingClientRect(); return {x: value.x, width: value.width}; };
    const sidebar = document.querySelector('.source-sidebar');
    const header = document.querySelector('.source-header');
    const main = document.querySelector('.source-main-content');
    const nav = document.querySelector('.source-sidebar__nav');
    const groups = [...document.querySelectorAll('[data-nav-group]')];
    const items = [...document.querySelectorAll('.source-sidebar__item')];
    return {
      rootChildren: document.getElementById('root')?.children.length || 0,
      preloadApiAvailable: typeof window.api === 'object',
      sidebar: rect(sidebar), header: rect(header), main: rect(main),
      collapsed: sidebar.dataset.collapsed === 'true',
      semantics: {sidebarTag: sidebar.tagName, headerTag: header.tagName, mainTag: main.tagName, navTag: nav.tagName,
        groupIds: groups.map((group) => group.dataset.navGroup), pageOrder: items.map((item) => item.dataset.page),
        currentPageCount: items.filter((item) => item.getAttribute('aria-current') === 'page').length,
        headerActionCount: document.querySelectorAll('.source-header__actions button').length,
        visibleHeaderActionCount: [...document.querySelectorAll('.source-header__actions button')].filter((button) => button.getClientRects().length > 0).length},
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`;
  const expanded = await client.evaluate(measure);
  await screenshot(client, currentExpanded);
  await client.evaluate(
    `document.querySelector('.source-sidebar__collapse').click()`,
  );
  await client.waitFor(
    `document.querySelector('.source-sidebar')?.dataset.collapsed === 'true' && document.body.classList.contains('sidebar-collapsed')`,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const collapsed = await client.evaluate(measure);
  await screenshot(client, currentCollapsed);
  await client.evaluate(
    `document.querySelector('.source-sidebar__collapse').click()`,
  );
  await client.waitFor(
    `document.querySelector('.source-sidebar')?.dataset.collapsed === 'false' && !document.body.classList.contains('sidebar-collapsed')`,
  );
  const reexpanded = await client.evaluate(measure);
  let interaction = null;
  if (requestedPage === "image-ultra") {
    await client.evaluate(
      `(() => { const input = document.querySelector('.source-prompt-row textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, 'Smoke prompt'); input.dispatchEvent(new Event('input', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('.source-prompt-add-btn')?.disabled === false`,
    );
    await client.evaluate(
      `document.querySelector('.source-prompt-add-btn')?.click()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-prompt-row').length === 2`,
    );
    await client.evaluate(
      `document.querySelectorAll('.source-prompt-row')[1]?.querySelector('button')?.click()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-prompt-row').length === 1`,
    );
    interaction = await client.evaluate(
      `({promptCount: document.querySelectorAll('.source-prompt-row').length, generateDisabledWithoutAccount: document.querySelector('.source-generate-main-btn')?.disabled === true})`,
    );
  } else if (requestedPage === "image-editor") {
    await client.evaluate(`(() => {
      const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const file = new File([bytes], 'source-smoke.png', {type: 'image/png'});
      const transfer = new DataTransfer(); transfer.items.add(file);
      const input = document.querySelector('.source-drop-input input');
      Object.defineProperty(input, 'files', {configurable: true, value: transfer.files});
      input.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    await client.waitFor(
      `document.querySelector('.source-image-annotation canvas')?.width === 1`,
    );
    interaction =
      await client.evaluate(`(() => { const canvas = document.querySelector('.source-image-annotation canvas'); return {
      canvasReady: canvas?.width === 1 && canvas?.height === 1,
      flattenedImage: canvas?.toDataURL('image/jpeg', 0.92).startsWith('data:image/jpeg;base64,'),
      annotationControls: document.querySelectorAll('.source-annotation-controls button').length === 2,
      generateDisabled: document.querySelector('.source-control-card > .narra-button:last-child')?.disabled === true,
    }; })()`);
  } else if (requestedPage === "voice") {
    await client.evaluate(
      `(() => { const input = document.querySelector('.source-voice-editor textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, 'Voice smoke'); input.dispatchEvent(new Event('input', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('.source-voice-editor textarea')?.value === 'Voice smoke'`,
    );
    interaction = await client.evaluate(
      `({textLength: document.querySelector('.source-voice-editor textarea')?.value.length, maxLength: document.querySelector('.source-voice-editor textarea')?.maxLength})`,
    );
  } else if (requestedPage === "video-pro") {
    const initialEmptyVisible = await client.evaluate(
      `Boolean(document.querySelector('.source-video-page .source-generation-empty')?.getClientRects().length)`,
    );
    await client.evaluate(
      `(() => { const input = document.querySelector('.source-video-page textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, 'Video smoke'); input.dispatchEvent(new Event('input', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('.source-video-page .source-generate-main-btn, .source-video-page .source-generation-controls .narra-button')?.disabled === false`,
    );
    await client.evaluate(
      `(() => { const key = 'narra-source-video-queue-history-v1'; const value = JSON.stringify([{id: 'smoke-video-result', prompt: 'Completed video smoke', status: 'success', src: 'data:video/mp4;base64,AAAA', mediaId: 'smoke-media-id'}]); localStorage.setItem(key, value); window.dispatchEvent(new StorageEvent('storage', {key, newValue: value})); })()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-video-post-actions button, .source-video-post-actions .source-task-action-btn').length === 3`,
    );
    interaction = {
      initialEmptyVisible,
      ...(await client.evaluate(
        `({postActionCount: document.querySelectorAll('.source-video-post-actions button, .source-video-post-actions .source-task-action-btn').length, postActionsEnabled: [...document.querySelectorAll('.source-video-post-actions button, .source-video-post-actions .source-task-action-btn')].every((button) => !button.disabled)})`,
      )),
    };
  } else if (requestedPage === "upload") {
    interaction = await client.evaluate(
      `({libraryTabCount: document.querySelectorAll('.source-media-page .narra-tabs__tab').length, localSelected: [...document.querySelectorAll('.source-media-page button')].some((button) => button.textContent?.includes('Nhập ảnh'))})`,
    );
  } else if (requestedPage === "video-editor") {
    await client.evaluate(
      `window.api.saveVideoProject({id: 'smoke-video-editor', data: {name: 'Video editor smoke', description: 'Project parity', videoSrc: 'data:video/mp4;base64,AAAA', videoName: 'primary.mp4', trimStart: 0, trimEnd: 10, speed: 1, volume: 1, rotate: 0, flipH: false, flipV: false, subtitlePath: 'file:///C:/narra-smoke/subtitle.srt', subtitleName: 'subtitle.srt', bgmPath: 'file:///C:/narra-smoke/bgm.mp3', bgmName: 'bgm.mp3', bgmVolume: 0.35, fadeIn: 0.5, fadeOut: 1, delogoRegions: [{x: 10, y: 20, w: 100, h: 40, label: 'Logo'}], timelineClips: [{filePath: 'file:///C:/narra-smoke/a.mp4', name: 'A.mp4', duration: 5, startTime: 0, endTime: 5}, {filePath: 'file:///C:/narra-smoke/b.mp4', name: 'B.mp4', duration: 6, startTime: 0, endTime: 6}], timelineTransitions: [{type: 'fade', duration: 0.5}], legacyVideoEditorProbe: 'keep-video-editor'}})`,
    );
    await client.evaluate(
      `window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: 'settings'}}))`,
    );
    await client.waitFor(`document.querySelector('.source-settings-page')`);
    await client.evaluate(
      `window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: 'video-editor'}}))`,
    );
    await client.waitFor(
      `document.querySelector('.source-video-editor-projects .source-project-grid article > button')`,
    );
    await client.evaluate(
      `document.querySelector('.source-video-editor-projects .source-project-grid article > button')?.click()`,
    );
    await client.waitFor(
      `document.querySelector('.source-video-editor-page') && document.querySelectorAll('.source-video-editor-timeline article').length === 2`,
    );
    await client.evaluate(
      `(() => { for (const [label, value] of [['Video editor trim start', '1.5'], ['Video editor trim end', '8.5']]) { const input = document.querySelector('[aria-label="' + label + '"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new Event('input', {bubbles: true})); } const transition = document.querySelector('[aria-label="Transition sau A.mp4"]'); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; selectSetter.call(transition, 'dissolve'); transition.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Video editor trim start"]')?.value === '1.5' && document.querySelector('[aria-label="Transition sau A.mp4"]')?.value === 'dissolve'`,
    );
    const toolPanels = await client.evaluate(
      `(async () => { const labels = ['Phụ đề', 'Watermark', 'Âm thanh', 'Cơ bản']; const visible = []; for (const label of labels) { [...document.querySelectorAll('.source-video-editor-inspector [role="tab"]')].find((button) => button.textContent?.includes(label))?.click(); await new Promise((resolve) => setTimeout(resolve, 30)); visible.push(Boolean(document.querySelector('.source-video-editor-inspector > section')?.getClientRects().length)); } return visible.every(Boolean); })()`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-video-editor-page > header .narra-button')].find((button) => button.textContent?.includes('Lưu'))?.click()`,
    );
    await client.waitFor(
      `window.api.loadVideoProject('smoke-video-editor').then((project) => project.trimStart === 1.5 && project.trimEnd === 8.5 && project.timelineTransitions?.[0]?.type === 'dissolve' && project.subtitleName === 'subtitle.srt' && project.bgmName === 'bgm.mp3' && project.delogoRegions?.[0]?.label === 'Logo' && project.legacyVideoEditorProbe === 'keep-video-editor')`,
    );
    interaction = await client.evaluate(
      `window.api.loadVideoProject('smoke-video-editor').then((project) => ({projectSaved: project.trimStart === 1.5 && project.trimEnd === 8.5, transitionSaved: project.timelineTransitions?.[0]?.type === 'dissolve', subtitlePreserved: project.subtitleName === 'subtitle.srt', bgmPreserved: project.bgmName === 'bgm.mp3', watermarkPreserved: project.delogoRegions?.[0]?.label === 'Logo', timelineCount: project.timelineClips?.length, legacyPreserved: project.legacyVideoEditorProbe === 'keep-video-editor', toolPanels: ${JSON.stringify(toolPanels)}}))`,
    );
  } else if (requestedPage === "capcut-video") {
    await client.evaluate(
      `window.api.projectsSave({id: 'smoke-transition-project', name: 'Transition smoke', createdAt: 1, updatedAt: 1, duration: 8, aspectRatio: '16:9', legacyProjectProbe: 'keep-project', clips: [{id: 'clip-a', path: 'data:video/mp4;base64,AAAA', name: 'A.mp4', duration: 4, legacyClipProbe: 'keep-clip', captions: [{text: 'legacy caption'}]}, {id: 'clip-b', path: 'data:video/mp4;base64,AAAA', name: 'B.mp4', duration: 4, stickerOverlays: [{format: 'image', filePath: 'C:/narra-smoke/sticker.png', scale: 1, posX: 0, posY: 0, rotation: 0, opacity: 1, startTime: 0, endTime: 4, legacyStickerProbe: 'keep-sticker'}]}], state: {legacyStateProbe: 'keep-state', clips: [{id: 'clip-a', path: 'data:video/mp4;base64,AAAA', name: 'A.mp4', duration: 4, legacyClipProbe: 'keep-clip', captions: [{text: 'legacy caption'}]}, {id: 'clip-b', path: 'data:video/mp4;base64,AAAA', name: 'B.mp4', duration: 4, stickerOverlays: [{format: 'image', filePath: 'C:/narra-smoke/sticker.png', scale: 1, posX: 0, posY: 0, rotation: 0, opacity: 1, startTime: 0, endTime: 4, legacyStickerProbe: 'keep-sticker'}]}]}})`,
    );
    await client.evaluate(
      `window.api.projectsGet('smoke-transition-project').then((project) => { const tracks = [{id: 'video-layer-1', name: 'Video 1', trackType: 'video', legacyTrackProbe: 'keep-track'}, {id: 'video-layer-2', name: 'Video 2', trackType: 'video'}, {id: 'audio-layer-1', name: 'Audio 1', trackType: 'audio'}]; const clips = (project.state?.clips || project.clips).map((clip, index) => ({...clip, trackType: 'video', trackId: index === 0 ? 'video-layer-1' : 'video-layer-2', startTime: index})); return window.api.projectsSave({...project, tracks, clips, state: {...project.state, tracks, clips}}); })`,
    );
    await client.evaluate(
      `window.api.saveUserPresets({version: 1, transitions: [{id: 'user-smoke-fade', name: 'Smoke Fade', category: 'user', type: 'fade', defaultDuration: 0.8}], effects: [{id: 'user-smoke-glow', name: 'Smoke Glow', category: 'user', parent: 'videoEffects', type: 'glow', defaults: {size: 70, strength: 70, amount: 60}}]})`,
    );
    await client.evaluate(
      `window.api.projectsGet('smoke-transition-project').then((project) => { const clips = (project.state?.clips || project.clips).map((clip, index) => index === 0 ? {...clip, removeFlickers: true, removeFlickersCfg: {mode: 'timelapse', level: 'strong'}, lipSync: true, lipSyncCfg: {status: 'done', renderPlayable: true, renderOutputUrl: clip.path, legacyLipProbe: 'keep-lip'}} : clip); return window.api.projectsSave({...project, clips, state: {...project.state, clips}}); })`,
    );
    await client.evaluate(
      `window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: 'settings'}}))`,
    );
    await client.waitFor(`document.querySelector('.source-settings-page')`);
    await client.evaluate(
      `window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: 'capcut-video'}}))`,
    );
    await client.waitFor(
      `document.querySelector('.source-project-grid article > button')`,
    );
    await client.evaluate(
      `document.querySelector('.source-project-grid article > button')?.click()`,
    );
    await client.waitFor(
      `document.querySelector('.source-capcut-workspace') && document.querySelector('.source-capcut-timeline')`,
    );
    await client.evaluate(
      `(() => { const items = [...document.querySelectorAll('.source-capcut-timeline article')]; const transfer = new DataTransfer(); items[0].dispatchEvent(new DragEvent('dragstart', {bubbles: true, dataTransfer: transfer})); items[1].dispatchEvent(new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer: transfer})); items[1].dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer})); items[0].dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer: transfer})); })()`,
    );
    await client.waitFor(
      `[...document.querySelectorAll('.source-capcut-timeline article strong')].map((node) => node.textContent).join(',') === 'B.mp4,A.mp4'`,
    );
    await client.evaluate(
      `(() => { const items = [...document.querySelectorAll('.source-capcut-timeline article')]; const transfer = new DataTransfer(); items[0].dispatchEvent(new DragEvent('dragstart', {bubbles: true, dataTransfer: transfer})); items[1].dispatchEvent(new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer: transfer})); items[1].dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer})); items[0].dispatchEvent(new DragEvent('dragend', {bubbles: true, dataTransfer: transfer})); })()`,
    );
    await client.waitFor(
      `[...document.querySelectorAll('.source-capcut-timeline article strong')].map((node) => node.textContent).join(',') === 'A.mp4,B.mp4'`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Chuyển cảnh sau clip"] option[value="user-smoke-fade"]') && document.querySelector('[aria-label="Hiệu ứng clip"] option[value="user-smoke-glow"]')`,
    );
    await client.evaluate(
      `(() => { const select = document.querySelector('[aria-label="Chuyển cảnh sau clip"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'basic-dissolve'); select.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Chuyển cảnh sau clip"]')?.value === 'basic-dissolve'`,
    );
    await client.evaluate(
      `(() => { const input = document.querySelector('[aria-label="Nội dung chữ trên clip"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Narra smoke'); input.dispatchEvent(new Event('input', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Nội dung chữ trên clip"]')?.value === 'Narra smoke'`,
    );
    await client.evaluate(
      `(() => { const input = document.querySelector('[aria-label="Fade in âm thanh"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '0.5'); input.dispatchEvent(new Event('input', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Fade in âm thanh"]')?.value === '0.5'`,
    );
    await client.evaluate(
      `(() => { const select = document.querySelector('[aria-label="Sticker emoji"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, '🔥'); select.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Sticker emoji"]')?.value === '🔥'`,
    );
    await client.evaluate(
      `(() => { const select = document.querySelector('[aria-label="Hiệu ứng clip"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'soft-focus'); select.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Hiệu ứng clip"]')?.value === 'soft-focus'`,
    );
    await client.evaluate(
      `(() => { const select = document.querySelector('[aria-label="Chế độ đường cong tốc độ"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'custom'); select.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelectorAll('[aria-label^="Tốc độ keyframe "]').length === 3`,
    );
    await client.evaluate(
      `(() => { for (const [label, value] of [['Tốc độ keyframe 1', '0.5'], ['Tỷ lệ clip', '125'], ['Vị trí X', '80'], ['Xoay clip', '15'], ['Crop width', '80'], ['Âm lượng clip', '75']]) { const input = document.querySelector('[aria-label="' + label + '"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new Event('input', {bubbles: true})); } })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Tốc độ keyframe 1"]')?.value === '0.5' && document.querySelector('[aria-label="Tỷ lệ clip"]')?.value === '125' && document.querySelector('[aria-label="Crop width"]')?.value === '80'`,
    );
    await client.evaluate(
      `(() => { const start = document.querySelector('[aria-label="Bắt đầu timeline A.mp4"]'); const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; inputSetter.call(start, '0.5'); start.dispatchEvent(new Event('input', {bubbles: true})); const track = document.querySelector('[aria-label="Track của A.mp4"]'); const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; selectSetter.call(track, 'video-layer-2'); track.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Bắt đầu timeline A.mp4"]')?.value === '0.5' && document.querySelector('[aria-label="Track của A.mp4"]')?.value === 'video-layer-2'`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-capcut-page > header .narra-button')].find((button) => button.textContent?.includes('Lưu'))?.click()`,
    );
    await client.waitFor(
      `window.api.projectsGet('smoke-transition-project').then((project) => { const clip = (project.state?.clips || project.clips)?.[0]; return clip?.transitionOut?.type === 'dissolve' && clip?.textOverlays?.[0]?.text === 'Narra smoke' && clip?.fadeIn === 0.5 && clip?.stickerOverlays?.[0]?.emoji === '🔥' && clip?.effects?.[0]?.libraryId === 'soft-focus' && clip?.speedCurveKeyframes?.[0]?.s === 0.5 && clip?.scale === 125 && clip?.posX === 80 && clip?.rotation === 15 && clip?.crop?.width === 80 && clip?.volume === 75 && clip?.startTime === 0.5 && clip?.trackId === 'video-layer-2' && project.state?.tracks?.[0]?.legacyTrackProbe === 'keep-track' && (project.state?.clips || project.clips)?.[1]?.stickerOverlays?.[0]?.format === 'image' && project.legacyProjectProbe === 'keep-project'; })`,
    );
    interaction = await client.evaluate(
      `Promise.all([window.api.projectsGet('smoke-transition-project'), window.api.loadUserPresets()]).then(([project, presets]) => { const clips = project.state?.clips || project.clips; const clip = clips?.[0]; return {workspaceVisible: Boolean(document.querySelector('.source-capcut-workspace')?.getClientRects().length), timelineVisible: Boolean(document.querySelector('.source-capcut-timeline')?.getClientRects().length), dragReorderRoundTrip: [...document.querySelectorAll('.source-capcut-timeline article strong')].map((node) => node.textContent).join(',') === 'A.mp4,B.mp4', exportDisabled: document.querySelector('.source-capcut-workspace aside:last-child > .narra-button')?.disabled, transitionType: clip?.transitionOut?.type, transitionDuration: clip?.transitionOut?.duration, overlayText: clip?.textOverlays?.[0]?.text, fadeIn: clip?.fadeIn, stickerEmoji: clip?.stickerOverlays?.[0]?.emoji, imageStickerPreserved: clips?.[1]?.stickerOverlays?.[0]?.format === 'image' && clips?.[1]?.stickerOverlays?.[0]?.legacyStickerProbe === 'keep-sticker', effectId: clip?.effects?.[0]?.libraryId, multiTrack: clip?.startTime === 0.5 && clip?.trackId === 'video-layer-2' && project.state?.tracks?.length === 3 && project.state?.tracks?.[0]?.legacyTrackProbe === 'keep-track', advancedClipControls: clip?.speedCurveKeyframes?.[0]?.s === 0.5 && clip?.scale === 125 && clip?.posX === 80 && clip?.rotation === 15 && clip?.crop?.width === 80 && clip?.volume === 75, legacyPreserved: project.legacyProjectProbe === 'keep-project' && project.state?.legacyStateProbe === 'keep-state' && clip?.legacyClipProbe === 'keep-clip' && clip?.captions?.[0]?.text === 'legacy caption', userPresetsLoaded: presets.transitions?.[0]?.id === 'user-smoke-fade' && presets.effects?.[0]?.id === 'user-smoke-glow'}; })`,
    );
    const toolState = await client.evaluate(
      `window.api.projectsGet('smoke-transition-project').then((project) => { const clip = (project.state?.clips || project.clips)?.[0]; return {toolPanelVisible: Boolean(document.querySelector('.source-capcut-tools')), deflickerPreserved: clip?.removeFlickers === true && clip?.removeFlickersCfg?.mode === 'timelapse' && clip?.removeFlickersCfg?.level === 'strong', lipSyncPreserved: clip?.lipSync === true && clip?.lipSyncCfg?.legacyLipProbe === 'keep-lip' && document.querySelector('.source-capcut-preview video')?.getAttribute('src') === clip.path}; })`,
    );
    interaction = { ...interaction, ...toolState };
  } else if (requestedPage === "concat") {
    await client.evaluate(
      `window.api.saveHistory('concat-history', [{id: 'smoke-merge', src: 'file:///C:/narra-smoke/merged.mp4', sourceCount: 2, time: '2026-01-01T00:00:00.000Z'}])`,
    );
    await client.evaluate(
      `window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: 'settings'}}))`,
    );
    await client.waitFor(`document.querySelector('.source-settings-page')`);
    await client.evaluate(
      `window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: 'concat'}}))`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-merge-history article').length === 1`,
    );
    const historyLoaded = await client.evaluate(
      `document.querySelectorAll('.source-merge-history article').length`,
    );
    await client.evaluate(
      `document.querySelector('.source-merge-history article .narra-button')?.click()`,
    );
    await client.waitFor(
      `window.api.loadHistory('concat-history').then((items) => Array.isArray(items) && items.length === 0)`,
    );
    interaction = { historyCleared: true, historyLoaded };
  } else if (requestedPage === "ai-agent") {
    const tabCount = await client.evaluate(
      `document.querySelectorAll('.source-agent-page .narra-tabs__tab').length`,
    );
    await client.waitFor(
      `document.querySelector('.source-agent-chat-toolbar')?.textContent?.includes('Lịch sử được lưu cục bộ')`,
    );
    await client.waitFor(
      `window.api.loadHistory('ai-agent-source-chat-v1').then((items) => Array.isArray(items) && items[0]?.version === 1 && items[0]?.messages?.length === 1)`,
    );
    await client.evaluate(
      `document.querySelector('[aria-label="Cuộc trò chuyện mới"]')?.click()`,
    );
    await client.waitFor(
      `document.querySelectorAll('[aria-label="Cuộc trò chuyện"] option').length === 2`,
    );
    await client.evaluate(
      `(() => { const input = document.querySelector('[aria-label="Conversation JSON file"]'); const packageFile = new File([JSON.stringify({schemaVersion: 1, title: 'Imported smoke', conversation: {kind: 'campaign', aspect: 'landscape', messages: [{id: 'smoke-message', role: 'user', content: 'Imported conversation'}]}, workflow: {plan: {title: 'Smoke plan'}, runItems: [{id: 'run-smoke', kind: 'note'}], assets: [], canvasGroups: [{id: 'group-smoke'}]}})], 'conversation.json', {type: 'application/json'}); const transfer = new DataTransfer(); transfer.items.add(packageFile); Object.defineProperty(input, 'files', {configurable: true, value: transfer.files}); input.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Tên cuộc trò chuyện"]')?.value === 'Imported smoke' && document.querySelectorAll('[aria-label="Cuộc trò chuyện"] option').length === 3`,
    );
    await client.waitFor(
      `window.api.loadHistory('ai-agent-conversations-v2').then((items) => Array.isArray(items) && items.length === 3 && items[0]?.title === 'Imported smoke' && items[0]?.runItems?.[0]?.id === 'run-smoke')`,
    );
    const chatHistory = await client.evaluate(
      `Promise.all([window.api.loadHistory('ai-agent-source-chat-v1'), window.api.loadHistory('ai-agent-conversations-v2')]).then(([source, library]) => ({saved: Array.isArray(source) && source[0]?.version === 1 && source[0]?.messages?.length === 1, clearDisabled: [...document.querySelectorAll('.source-agent-chat-toolbar .narra-button')].find((button) => button.textContent?.includes('Xóa trao đổi'))?.disabled === true, conversationCount: library.length, importedWorkflowPreserved: library[0]?.runItems?.[0]?.id === 'run-smoke' && library[0]?.canvasGroups?.[0]?.id === 'group-smoke'}))`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-agent-page .narra-tabs__tab')].find((node) => node.textContent?.includes('Workflow'))?.click()`,
    );
    await client.waitFor(
      `document.querySelector('.source-agent-workflow') && document.querySelectorAll('.source-agent-workflow__actions .narra-button').length === 4`,
    );
    const workflowVisible = await client.evaluate(
      `Boolean(document.querySelector('.source-agent-workflow')?.getClientRects().length)`,
    );
    const scriptStudioVisible = await client.evaluate(
      `Boolean(document.querySelector('.source-script-studio')?.getClientRects().length)`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-agent-page .narra-tabs__tab')].find((node) => node.textContent?.includes('Director'))?.click()`,
    );
    await client.waitFor(`document.querySelector('.source-director-panel')`);
    const directorVisible = await client.evaluate(
      `Boolean(document.querySelector('.source-director-panel')?.getClientRects().length)`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-agent-page .narra-tabs__tab')].find((node) => node.textContent?.includes('Media Tools'))?.click()`,
    );
    await client.waitFor(`document.querySelector('.source-agent-media-tools')`);
    const mediaToolsVisible = await client.evaluate(
      `Boolean(document.querySelector('.source-agent-media-tools')?.getClientRects().length)`,
    );
    const audioToolsVisible = await client.evaluate(
      `Boolean(document.querySelector('.source-agent-audio-tools')?.getClientRects().length && [...document.querySelectorAll('.source-agent-audio-tools .narra-button')].some((button) => button.textContent?.includes('Chọn audio')))`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-agent-page .narra-tabs__tab')].find((node) => node.textContent?.includes('Skills'))?.click()`,
    );
    await client.waitFor(`document.querySelector('.source-agent-skills')`);
    const skillsVisible = await client.evaluate(
      `Boolean(document.querySelector('.source-agent-skills')?.getClientRects().length)`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-agent-page .narra-tabs__tab')].find((node) => node.textContent?.includes('Workspace'))?.click()`,
    );
    await client.waitFor(`document.querySelector('.source-workspace-panel')`);
    await client.evaluate(
      `document.querySelector('.source-workspace-panel > aside:first-child .narra-button')?.click()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-workspace-panel > aside:first-child > .source-workspace-row').length === 1`,
    );
    await client.evaluate(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamWorkspaceToolboxUpsert({workspaceId: result.workspaces[0].id, toolbox: {id: 'smoke-toolbox', name: 'Smoke toolbox', nodes: [{id: 'toolbox-upstream', kind: 'note', displayTitle: 'Toolbox note', prompt: 'Reference', status: 'queued', isManualDraft: true, isManualNode: true, canvasGroupId: 'Toolbox source', canvasPosition: {x: 0, y: 0}}, {id: 'toolbox-downstream', kind: 'image', displayTitle: 'Toolbox image', prompt: 'Render', status: 'queued', isManualDraft: true, isManualNode: true, dependsOnSceneId: 'toolbox-upstream', canvasGroupId: 'Toolbox source', canvasPosition: {x: 240, y: 0}}]}}))`,
    );
    await client.evaluate(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamWorkspaceAssetUpsert({workspaceId: result.workspaces[0].id, asset: {workspaceId: result.workspaces[0].id, name: 'Workspace smoke image', kind: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', filePath: ''}}))`,
    );
    await client.evaluate(
      `document.querySelector('.source-workspace-panel > aside:nth-child(2) .narra-button')?.click()`,
    );
    await client.waitFor(
      `document.querySelector('.source-workspace-panel > main textarea')`,
    );
    await client.evaluate(
      `(() => { const input = document.querySelector('.source-workspace-panel > main > textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, 'Workspace revision smoke'); input.dispatchEvent(new Event('input', {bubbles: true})); [...document.querySelectorAll('.source-canvas-graph > header .narra-button')].find((button) => button.textContent?.includes('Ghi chú'))?.click(); })()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-canvas-graph__grid article').length === 1`,
    );
    await client.evaluate(
      `(() => { const input = document.querySelector('[aria-label="Tiêu đề node"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Smoke node'); input.dispatchEvent(new Event('input', {bubbles: true})); const group = document.querySelector('[aria-label^="Nhóm của"]'); setter.call(group, 'Scene smoke'); group.dispatchEvent(new Event('input', {bubbles: true})); document.querySelector('.source-workspace-panel > main > header .narra-button')?.click(); })()`,
    );
    await client.waitFor(
      `document.querySelector('.source-canvas-revisions summary')?.textContent?.includes('(1)')`,
    );
    await client.waitFor(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamCanvasList({workspaceId: result.workspaces[0].id})).then((result) => window.api.teamCanvasGet({id: result.canvases[0].id})).then((result) => result.canvas.snapshot.runItems?.[0]?.displayTitle === 'Smoke node' && result.canvas.snapshot.runItems?.[0]?.canvasGroupId === 'Scene smoke')`,
    );
    await client.evaluate(
      `document.querySelector('.source-workspace-toolbox > summary')?.click()`,
    );
    await client.waitFor(
      `document.querySelector('.source-workspace-toolbox article strong')?.textContent === 'Smoke toolbox'`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-workspace-toolbox article .narra-button')].find((button) => button.textContent?.includes('Chèn'))?.click()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-canvas-graph__grid article').length === 3`,
    );
    await client.evaluate(
      `document.querySelector('.source-workspace-panel > main > header .narra-button')?.click()`,
    );
    await client.waitFor(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamCanvasList({workspaceId: result.workspaces[0].id})).then((result) => window.api.teamCanvasGet({id: result.canvases[0].id})).then((result) => { const inserted = result.canvas.snapshot.runItems?.slice(1); return inserted?.length === 2 && inserted[0].id !== 'toolbox-upstream' && inserted[1].dependsOnSceneId === inserted[0].id && inserted.every((node) => node.canvasGroupId !== 'Toolbox source'); })`,
    );
    const toolboxRoundTrip = await client.evaluate(
      `window.api.teamWorkspaceList({}).then((result) => Promise.all([window.api.teamWorkspaceToolboxList({workspaceId: result.workspaces[0].id}), window.api.teamCanvasList({workspaceId: result.workspaces[0].id})])).then(([toolboxes, canvases]) => window.api.teamCanvasGet({id: canvases.canvases[0].id}).then((result) => { const inserted = result.canvas.snapshot.runItems?.slice(1); return toolboxes.toolboxes?.some((item) => item.toolbox?.name === 'Smoke toolbox') && inserted?.length === 2 && inserted[1].dependsOnSceneId === inserted[0].id; }))`,
    );
    await client.evaluate(
      `document.querySelector('.source-workspace-toolbox[open] > summary')?.click()`,
    );
    await client.evaluate(
      `document.querySelector('[aria-label="Làm mới workspace assets"]')?.click()`,
    );
    await client.waitFor(
      `[...document.querySelectorAll('.source-workspace-assets article strong')].some((node) => node.textContent === 'Workspace smoke image')`,
    );
    await client.evaluate(
      `document.querySelector('[aria-label="Đưa Workspace smoke image vào canvas"]')?.click()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-canvas-graph__grid article').length === 4`,
    );
    const assetCloneRoundTrip = await client.evaluate(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamWorkspaceAssetList({workspaceId: result.workspaces[0].id})).then((result) => result.assets?.length === 2 && result.assets.some((asset) => asset.destinationCanvasId && asset.clones?.[0]?.destinationNodeId))`,
    );
    const revisionCount = await client.evaluate(
      `Number(document.querySelector('.source-canvas-revisions summary')?.textContent?.match(/\\((\\d+)\\)/)?.[1] || 0)`,
    );
    await client.evaluate(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamCanvasList({workspaceId: result.workspaces[0].id})).then((result) => window.api.teamCanvasGet({id: result.canvases[0].id})).then((result) => window.api.teamCanvasSync({id: result.canvas.id, snapshot: {...result.canvas.snapshot, runItems: result.canvas.snapshot.runItems.map((item) => ({...item, legacyProbe: 'keep-me'}))}}))`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-agent-page .narra-tabs__tab')].find((node) => node.textContent?.includes('Trò chuyện'))?.click()`,
    );
    await client.waitFor(`document.querySelector('.source-agent-chat')`);
    await client.evaluate(
      `[...document.querySelectorAll('.source-agent-page .narra-tabs__tab')].find((node) => node.textContent?.includes('Workspace'))?.click()`,
    );
    await client.waitFor(
      `document.querySelector('.source-workspace-panel > aside:nth-child(2) > div > button')`,
    );
    await client.evaluate(
      `document.querySelector('.source-workspace-panel > aside:nth-child(2) > div > button')?.click()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Tiêu đề node"]')?.value === 'Smoke node'`,
    );
    await client.evaluate(
      `document.querySelector('.source-workspace-panel > main > header .narra-button')?.click()`,
    );
    await client.waitFor(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamCanvasList({workspaceId: result.workspaces[0].id})).then((result) => window.api.teamCanvasGet({id: result.canvases[0].id})).then((result) => result.canvas.snapshot.runItems?.[0]?.legacyProbe === 'keep-me')`,
    );
    const graphState = await client.evaluate(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamCanvasList({workspaceId: result.workspaces[0].id})).then((result) => Promise.all(result.canvases.map((canvas) => window.api.teamCanvasGet({id: canvas.id})))).then((results) => ({legacyPreserved: results.some((result) => result.canvas.snapshot.runItems?.[0]?.legacyProbe === 'keep-me'), nodeCount: results.reduce((count, result) => count + (result.canvas.snapshot.runItems?.length || 0), 0), nodeTitle: results.flatMap((result) => result.canvas.snapshot.runItems || [])[0]?.displayTitle, groupId: results.flatMap((result) => result.canvas.snapshot.runItems || [])[0]?.canvasGroupId}))`,
    );
    await client.evaluate(
      `document.querySelector('.source-workspace-panel > aside:nth-child(2) > header .narra-button')?.click()`,
    );
    await client.waitFor(
      `document.querySelectorAll('.source-workspace-panel > aside:nth-child(2) > div').length === 2`,
    );
    await client.evaluate(
      `(() => { const select = document.querySelector('[aria-label="Trạng thái Episode"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'ready'); select.dispatchEvent(new Event('change', {bubbles: true})); })()`,
    );
    await client.waitFor(
      `document.querySelector('[aria-label="Trạng thái Episode"]')?.value === 'ready'`,
    );
    await client.evaluate(
      `[...document.querySelectorAll('.source-workspace-panel > aside:nth-child(2) .narra-button')].find((node) => node.getAttribute('aria-label')?.includes('Di chuyển Canvas 2 xuống'))?.click()`,
    );
    await client.waitFor(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamCanvasList({workspaceId: result.workspaces[0].id})).then((result) => result.canvases.length === 2 && result.canvases.some((canvas) => canvas.episodeStatus === 'ready') && result.canvases.map((canvas) => canvas.episodeOrder).sort().join(',') === '0,1')`,
    );
    const episodeState = await client.evaluate(
      `window.api.teamWorkspaceList({}).then((result) => window.api.teamCanvasList({workspaceId: result.workspaces[0].id})).then((result) => ({orders: result.canvases.map((canvas) => canvas.episodeOrder).sort(), readyCount: result.canvases.filter((canvas) => canvas.episodeStatus === 'ready').length}))`,
    );
    interaction = {
      ...(await client.evaluate(
        `({workspaceCount: document.querySelectorAll('.source-workspace-panel > aside:first-child > .source-workspace-row').length, canvasCount: document.querySelectorAll('.source-workspace-panel > aside:nth-child(2) > .source-episode-row').length, canvasEditorVisible: Boolean(document.querySelector('.source-workspace-panel > main > textarea')?.getClientRects().length), packageControlLabels: [...document.querySelectorAll('.source-workspace-package-actions .narra-button[aria-label]')].map((button) => button.getAttribute('aria-label')), nodeKindControls: ['Ghi chú', 'Image', 'Video', 'Audio'].every((label) => [...document.querySelectorAll('.source-canvas-graph > header .narra-button')].some((button) => button.textContent?.includes(label)))})`,
      )),
      assetCloneRoundTrip,
      audioToolsVisible,
      chatHistory,
      directorVisible,
      episodeState,
      graphState,
      mediaToolsVisible,
      revisionCount,
      scriptStudioVisible,
      skillsVisible,
      tabCount,
      toolboxRoundTrip,
      workflowVisible,
    };
  }
  const selectorByPage = {
    "provider-account": ".source-provider-account",
    upload: ".source-media-page",
    "video-editor": ".source-video-editor-projects, .source-video-editor-page",
    "capcut-video": ".source-editor-projects, .source-capcut-page",
    concat: ".source-tool-page",
    webview: ".source-flow-page",
    dashboard: ".source-dashboard",
    guide: ".source-guide",
    "ai-agent": ".source-agent-page",
    "image-editor": ".source-image-editor",
  };
  const targetPage =
    requestedPage === "settings"
      ? await client.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.source-settings-page')?.getClientRects().length),
    tabCount: document.querySelectorAll('.narra-tabs__tab').length,
    folderRows: document.querySelectorAll('.source-folder-row').length,
    labels: [...document.querySelectorAll('.source-folder-row strong')].map((node) => node.textContent?.trim()),
  }))()`)
      : requestedPage === "captcha-setup"
        ? await client.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.source-captcha-page')?.getClientRects().length),
    stepCount: document.querySelectorAll('.source-captcha-step').length,
    titles: [...document.querySelectorAll('.source-captcha-step__summary strong')].map((node) => node.textContent?.trim()),
    overflowingActions: [...document.querySelectorAll('.source-captcha-step__actions')].filter((node) => node.scrollWidth > node.clientWidth).length,
  }))()`)
        : requestedPage === "image-ultra"
          ? await client.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.source-image-page')?.getClientRects().length),
    promptCount: document.querySelectorAll('.source-prompt-row').length,
    accountSelectorVisible: Boolean(document.querySelector('[aria-label="Tài khoản"]')?.getClientRects().length),
    generateDisabled: document.querySelector('.source-generate-main-btn')?.disabled,
    emptyVisible: Boolean(document.querySelector('.source-generation-empty')?.getClientRects().length),
  }))()`)
          : requestedPage === "video-pro"
            ? await client.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.source-video-page')?.getClientRects().length),
    modeCount: document.querySelectorAll('.source-video-page .source-segmented button').length,
    settingsCount: document.querySelectorAll('.source-video-page .source-control-card [role="combobox"]').length,
    accountSelectorVisible: Boolean(document.querySelector('[aria-label="Tài khoản"], [aria-label="Tài khoản Google Flow"]')?.getClientRects().length),
    emptyVisible: Boolean(document.querySelector('.source-video-page .source-generation-empty')?.getClientRects().length),
  }))()`)
            : requestedPage === "voice"
              ? await client.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.source-voice-page')?.getClientRects().length),
    textareaMaxLength: document.querySelector('.source-voice-editor textarea')?.maxLength,
    settingsVisible: Boolean(document.querySelector('.source-voice-settings')?.getClientRects().length),
    historyVisible: Boolean(document.querySelector('.source-voice-history')?.getClientRects().length),
  }))()`)
              : await client.evaluate(
                  `({visible: Boolean(document.querySelector(${JSON.stringify(selectorByPage[requestedPage] || ".source-migration-placeholder")})?.getClientRects().length)})`,
                );
  runtime = {
    target: { title: target.title, url: target.url },
    expanded,
    collapsed,
    reexpanded,
    targetPage,
    interaction,
  };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(
    `${message}\nElectron stderr:\n${processOutput.stderr || "(empty)"}`,
    { cause: error },
  );
} finally {
  client?.close();
  await terminateProcessTree(electronProcess.pid);
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    rmSync(profileRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch (error) {
    console.warn(
      `Source smoke profile cleanup deferred: ${error.code || "ERROR"}`,
    );
  }
}

if (updateBaseline) {
  writeFileSync(baselineExpanded, readFileSync(currentExpanded));
  writeFileSync(baselineCollapsed, readFileSync(currentCollapsed));
}
const screenshots = updateBaseline
  ? {
      expanded: { status: "UPDATED", sha256: sha256(baselineExpanded) },
      collapsed: { status: "UPDATED", sha256: sha256(baselineCollapsed) },
    }
  : {
      expanded: baselineStatus(currentExpanded, baselineExpanded),
      collapsed: baselineStatus(currentCollapsed, baselineCollapsed),
    };
const runtimeErrors = client.events.filter(
  (event) =>
    event.method === "Runtime.exceptionThrown" ||
    (event.method === "Log.entryAdded" &&
      event.params.entry.level === "error") ||
    (event.method === "Network.loadingFailed" && !event.params.canceled),
);
const expectedPages = [
  "image-ultra",
  "video-pro",
  "voice",
  "ai-agent",
  "image-ultra",
  "capcut-video",
  "concat",
  "upload",
  "provider-account",
  "webview",
  "captcha-setup",
  "settings",
];
const expectedCurrentPageCount = [
  "dashboard",
  "guide",
  "video-editor",
].includes(requestedPage)
  ? 0
  : 1;
const assertions = {
  rootRendered:
    runtime.expanded.rootChildren > 0 && runtime.expanded.preloadApiAvailable,
  shellDimensionsAndOffsets:
    runtime.expanded.sidebar.width === 236 &&
    runtime.expanded.header.x === 236 &&
    runtime.expanded.main.x === 236 &&
    runtime.collapsed.sidebar.width === 66 &&
    runtime.collapsed.header.x === 66 &&
    runtime.collapsed.main.x === 66 &&
    runtime.reexpanded.sidebar.width === 236,
  semanticStructure:
    runtime.expanded.semantics.sidebarTag === "ASIDE" &&
    runtime.expanded.semantics.headerTag === "HEADER" &&
    runtime.expanded.semantics.mainTag === "MAIN" &&
    runtime.expanded.semantics.navTag === "NAV" &&
    runtime.expanded.semantics.headerActionCount === 2 &&
    runtime.expanded.semantics.visibleHeaderActionCount === 2 &&
    runtime.collapsed.semantics.headerActionCount === 2 &&
    runtime.collapsed.semantics.visibleHeaderActionCount === 2 &&
    JSON.stringify(runtime.expanded.semantics.groupIds) ===
      JSON.stringify(["create", "edit", "assets", "system"]) &&
    JSON.stringify(runtime.expanded.semantics.pageOrder) ===
      JSON.stringify(expectedPages) &&
    runtime.expanded.semantics.currentPageCount === expectedCurrentPageCount,
  noHorizontalOverflow:
    !runtime.expanded.horizontalOverflow &&
    !runtime.collapsed.horizontalOverflow,
  targetPage:
    runtime.targetPage.visible &&
    (requestedPage !== "settings" ||
      (runtime.targetPage.tabCount === 2 &&
        runtime.targetPage.folderRows === 2 &&
        JSON.stringify(runtime.targetPage.labels) ===
          JSON.stringify(["Video", "Hình ảnh"]))) &&
    (requestedPage !== "captcha-setup" ||
      (runtime.targetPage.stepCount === 4 &&
        runtime.targetPage.overflowingActions === 0 &&
        JSON.stringify(runtime.targetPage.titles) ===
          JSON.stringify([
            "Bước 1/4. Chuẩn bị Extension",
            "Bước 2/4. Cài đặt Extension",
            "Bước 3/4. Mở Google Flow",
            "Bước 4/4. Kiểm tra kết nối",
          ]))) &&
    (requestedPage !== "image-ultra" ||
      (runtime.targetPage.promptCount === 1 &&
        runtime.targetPage.accountSelectorVisible &&
        runtime.targetPage.generateDisabled === true &&
        runtime.targetPage.emptyVisible &&
        runtime.interaction?.promptCount === 1 &&
        runtime.interaction?.generateDisabledWithoutAccount === true)) &&
    (requestedPage !== "image-editor" ||
      (runtime.interaction?.canvasReady &&
        runtime.interaction?.flattenedImage &&
        runtime.interaction?.annotationControls &&
        runtime.interaction?.generateDisabled)) &&
    (requestedPage !== "voice" ||
      (runtime.targetPage.textareaMaxLength === 20000 &&
        runtime.targetPage.settingsVisible &&
        runtime.targetPage.historyVisible &&
        runtime.interaction?.textLength === 11 &&
        runtime.interaction?.maxLength === 20000)) &&
    (requestedPage !== "video-pro" ||
      (runtime.targetPage.modeCount === 5 &&
        runtime.targetPage.settingsCount === 4 &&
        runtime.targetPage.accountSelectorVisible === true &&
        runtime.interaction?.initialEmptyVisible &&
        runtime.interaction?.postActionCount === 3 &&
        runtime.interaction?.postActionsEnabled === true)) &&
    (requestedPage !== "upload" ||
      (runtime.interaction?.libraryTabCount === 0 &&
        runtime.interaction?.localSelected)) &&
    (requestedPage !== "concat" ||
      (runtime.interaction?.historyLoaded === 1 &&
        runtime.interaction?.historyCleared === true)) &&
    (requestedPage !== "video-editor" ||
      (runtime.interaction?.projectSaved &&
        runtime.interaction?.transitionSaved &&
        runtime.interaction?.subtitlePreserved &&
        runtime.interaction?.bgmPreserved &&
        runtime.interaction?.watermarkPreserved &&
        runtime.interaction?.timelineCount === 2 &&
        runtime.interaction?.legacyPreserved &&
        runtime.interaction?.toolPanels)) &&
    (requestedPage !== "capcut-video" ||
      (runtime.interaction?.workspaceVisible &&
        runtime.interaction?.timelineVisible &&
        runtime.interaction?.dragReorderRoundTrip &&
        runtime.interaction?.transitionType === "dissolve" &&
        runtime.interaction?.transitionDuration === 0.7 &&
        runtime.interaction?.overlayText === "Narra smoke" &&
        runtime.interaction?.fadeIn === 0.5 &&
        runtime.interaction?.stickerEmoji === "🔥" &&
        runtime.interaction?.imageStickerPreserved &&
        runtime.interaction?.effectId === "soft-focus" &&
        runtime.interaction?.multiTrack &&
        runtime.interaction?.advancedClipControls &&
        runtime.interaction?.legacyPreserved &&
        runtime.interaction?.userPresetsLoaded &&
        runtime.interaction?.toolPanelVisible &&
        runtime.interaction?.deflickerPreserved &&
        runtime.interaction?.lipSyncPreserved)) &&
    (requestedPage !== "ai-agent" ||
      (runtime.interaction?.tabCount === 6 &&
        runtime.interaction?.workflowVisible &&
        runtime.interaction?.scriptStudioVisible &&
        runtime.interaction?.directorVisible &&
        runtime.interaction?.mediaToolsVisible &&
        runtime.interaction?.audioToolsVisible &&
        runtime.interaction?.skillsVisible &&
        runtime.interaction?.workspaceCount === 1 &&
        runtime.interaction?.canvasCount === 2 &&
        runtime.interaction?.canvasEditorVisible &&
        JSON.stringify(runtime.interaction?.packageControlLabels) ===
          JSON.stringify([
            "Import workspace",
            "Export workspace JSON",
            "Backup workspace",
            "Verify workspace backup",
          ]) &&
        runtime.interaction?.nodeKindControls &&
        runtime.interaction?.revisionCount === 3 &&
        runtime.interaction?.chatHistory?.saved &&
        runtime.interaction?.chatHistory?.clearDisabled &&
        runtime.interaction?.chatHistory?.conversationCount === 3 &&
        runtime.interaction?.chatHistory?.importedWorkflowPreserved &&
        runtime.interaction?.graphState?.legacyPreserved &&
        runtime.interaction?.graphState?.nodeCount === 4 &&
        runtime.interaction?.graphState?.nodeTitle === "Smoke node" &&
        runtime.interaction?.graphState?.groupId === "Scene smoke" &&
        runtime.interaction?.toolboxRoundTrip &&
        runtime.interaction?.assetCloneRoundTrip &&
        runtime.interaction?.episodeState?.readyCount === 1 &&
        JSON.stringify(runtime.interaction?.episodeState?.orders) ===
          JSON.stringify([0, 1]))),
  visualBaseline:
    updateBaseline ||
    Object.values(screenshots).every((entry) => entry.status === "MATCH"),
  noRuntimeErrors: runtimeErrors.length === 0,
};
writeFileSync(
  reportFile,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), requestedPage, runtime, screenshots, runtimeErrors, processOutput, assertions }, null, 2)}\n`,
);
const failures = Object.entries(assertions)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
if (failures.length) {
  console.error(
    `Source Electron UI smoke failed: ${failures.join(", ")}. See ${path.relative(repositoryRoot, reportFile)}.`,
  );
  process.exitCode = 1;
} else
  console.log(
    `Source Electron UI smoke passed. Report: ${path.relative(repositoryRoot, reportFile)}`,
  );
