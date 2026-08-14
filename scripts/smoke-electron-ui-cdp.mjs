import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const updateBaseline = process.argv.includes('--update-baseline');
const requestedPage = process.argv.find((argument) => argument.startsWith('--page='))?.slice('--page='.length) || 'settings';
const smokeTargets = {
  settings: {readySelector: '.settings-flat-content', artifactStem: 'app-shell'},
  'captcha-setup': {readySelector: '.captcha-setup-shell', artifactStem: 'captcha-setup'},
};
const smokeTarget = smokeTargets[requestedPage];
if (!smokeTarget) throw new Error(`Unsupported smoke page: ${requestedPage}`);
const smokeRoot = path.join(repositoryRoot, '.smoke', 'electron-ui');
const baselineRoot = path.join(repositoryRoot, 'tests', 'visual-baselines');
const executable = process.env.NARRA_SMOKE_EXE
  ? path.resolve(repositoryRoot, process.env.NARRA_SMOKE_EXE)
  : path.join(repositoryRoot, '.runtime-smoke-build', 'win-unpacked', 'Narra Studio.exe');
const packagedAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
const runtimeSourceRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src');
const profileRoot = mkdtempSync(path.join(os.tmpdir(), 'narra-electron-smoke-'));
const currentExpanded = path.join(smokeRoot, `${smokeTarget.artifactStem}-expanded.current.png`);
const currentCollapsed = path.join(smokeRoot, `${smokeTarget.artifactStem}-collapsed.current.png`);
const baselineExpanded = path.join(baselineRoot, `${smokeTarget.artifactStem}-expanded.png`);
const baselineCollapsed = path.join(baselineRoot, `${smokeTarget.artifactStem}-collapsed.png`);
const reportFile = path.join(smokeRoot, requestedPage === 'settings' ? 'report.json' : `report-${requestedPage}.json`);

mkdirSync(smokeRoot, {recursive: true});
mkdirSync(baselineRoot, {recursive: true});
if (!existsSync(executable) || !existsSync(packagedAsar)) {
  throw new Error('Missing current Electron smoke build. Run: pnpm package:electron-smoke');
}
const latestSourceMtime = (entry) => {
  const stats = statSync(entry);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return Math.max(stats.mtimeMs, ...readdirSync(entry).map((child) => latestSourceMtime(path.join(entry, child))));
};
const runtimeSourceMtimeMs = latestSourceMtime(runtimeSourceRoot);
if (statSync(packagedAsar).mtimeMs < runtimeSourceMtimeMs) {
  throw new Error('Electron smoke build predates runtime source. Run: pnpm package:electron-smoke');
}

const allocatePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const waitForRendererTarget = async (endpoint, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('/dist/index.html'));
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Electron CDP endpoint did not expose the renderer within ${timeoutMs}ms.`);
};

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.failureSnapshots = [];
    this.failureSnapshotTasks = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, {once: true});
      this.socket.addEventListener('error', reject, {once: true});
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
        if (message.method === 'Network.loadingFailed' && !message.params.canceled) {
          const observedAt = Date.now();
          const snapshot = this.evaluate(`(() => {
            const root = document.getElementById('root');
            const splash = document.getElementById('splash');
            const providerHub = document.querySelector('.atelier-launchpad');
            const activeSidebarItem = document.querySelector('.sidebar-item.active, .sidebar-nav-item.active, .sidebar-menu-item.active');
            return {
              url: location.href,
              title: document.title,
              rootChildren: root?.children.length ?? 0,
              splashHidden: !splash || splash.classList.contains('hidden'),
              providerHubMounted: Boolean(providerHub),
              providerHubVisible: Boolean(providerHub && providerHub.getClientRects().length),
              activeSidebarText: activeSidebarItem?.textContent?.trim() || null,
            };
          })()`)
            .then((state) => this.failureSnapshots.push({requestId: message.params.requestId, observedAt, state}))
            .catch((error) => this.failureSnapshots.push({requestId: message.params.requestId, observedAt, snapshotError: error.message}));
          this.failureSnapshotTasks.push(snapshot);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {method, resolve, reject});
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for runtime condition: ${expression}`);
  }

  close() {
    this.socket?.close();
  }
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const pixelSha256 = (file) => {
  if (process.platform !== 'win32') return sha256(file);
  const script = `
Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::FromFile($env:NARRA_SMOKE_IMAGE)
try {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)
  $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $length = [Math]::Abs($data.Stride) * $data.Height
    $bytes = New-Object byte[] $length
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $length)
    $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    -join ($hash | ForEach-Object { $_.ToString('x2') })
  } finally {
    $bitmap.UnlockBits($data)
  }
} finally {
  $bitmap.Dispose()
}`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: {...process.env, NARRA_SMOKE_IMAGE: file},
  });
  if (result.status !== 0) throw new Error(`Cannot hash screenshot pixels: ${result.stderr}`);
  return result.stdout.trim();
};
const comparePixels = (current, baseline) => {
  if (process.platform !== 'win32') {
    const match = pixelSha256(current) === pixelSha256(baseline);
    return {differentPixelRatio: match ? 0 : 1, differentPixels: match ? 0 : null, totalPixels: null};
  }
  const script = `
Add-Type -AssemblyName System.Drawing
function Read-Pixels($path) {
  $bitmap = [System.Drawing.Bitmap]::FromFile($path)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)
  $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $bytes = New-Object byte[] ([Math]::Abs($data.Stride) * $data.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    [pscustomobject]@{ Width = $bitmap.Width; Height = $bitmap.Height; Bytes = $bytes }
  } finally {
    $bitmap.UnlockBits($data)
    $bitmap.Dispose()
  }
}
$current = Read-Pixels $env:NARRA_SMOKE_CURRENT_IMAGE
$baseline = Read-Pixels $env:NARRA_SMOKE_BASELINE_IMAGE
if ($current.Width -ne $baseline.Width -or $current.Height -ne $baseline.Height) { throw 'Screenshot dimensions differ.' }
$different = 0
for ($offset = 0; $offset -lt $current.Bytes.Length; $offset += 4) {
  if ($current.Bytes[$offset] -ne $baseline.Bytes[$offset] -or $current.Bytes[$offset + 1] -ne $baseline.Bytes[$offset + 1] -or $current.Bytes[$offset + 2] -ne $baseline.Bytes[$offset + 2] -or $current.Bytes[$offset + 3] -ne $baseline.Bytes[$offset + 3]) { $different++ }
}
$total = $current.Width * $current.Height
[pscustomobject]@{ differentPixels = $different; totalPixels = $total; differentPixelRatio = $different / $total } | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      NARRA_SMOKE_CURRENT_IMAGE: current,
      NARRA_SMOKE_BASELINE_IMAGE: baseline,
    },
  });
  if (result.status !== 0) throw new Error(`Cannot compare screenshot pixels: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
};
const compareBaseline = (current, baseline) => {
  if (!existsSync(baseline)) return {status: 'MISSING', currentPixelSha256: pixelSha256(current)};
  const currentPixelSha256 = pixelSha256(current);
  const baselinePixelSha256 = pixelSha256(baseline);
  const comparison = comparePixels(current, baseline);
  return {
    status: comparison.differentPixelRatio <= 0.001 ? 'MATCH' : 'DIFFERENT',
    currentPixelSha256,
    baselinePixelSha256,
    ...comparison,
    allowedDifferentPixelRatio: 0.001,
  };
};
const writeScreenshot = async (client, file) => {
  const result = await client.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
  writeFileSync(file, Buffer.from(result.data, 'base64'));
};
const terminateProcessTree = async (processId) => {
  if (!processId) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
    await new Promise((resolve) => killer.once('exit', resolve));
  } else {
    try { process.kill(processId, 'SIGTERM'); } catch {}
  }
};

const port = await allocatePort();
const endpoint = `http://127.0.0.1:${port}`;
const launchedAt = Date.now();
const electronProcess = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileRoot}`,
  '--disable-gpu',
  '--force-device-scale-factor=1',
], {cwd: path.dirname(executable), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
const processOutput = {stdout: '', stderr: ''};
electronProcess.stdout.on('data', (chunk) => { processOutput.stdout += chunk.toString(); });
electronProcess.stderr.on('data', (chunk) => { processOutput.stderr += chunk.toString(); });

let client;
let runtime;
let cleanupWarning = null;
try {
  const rendererTarget = await waitForRendererTarget(endpoint);
  const targetDetectedMs = Date.now() - launchedAt;
  client = new CdpClient(rendererTarget.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([
    client.send('Runtime.enable'),
    client.send('Log.enable'),
    client.send('Network.enable'),
    client.send('Page.enable'),
    client.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false}),
  ]);
  await client.waitFor(`document.getElementById('root')?.children.length > 0`, 15000);
  const rootReadyMs = Date.now() - launchedAt;
  await client.waitFor(`!document.getElementById('splash') || document.getElementById('splash').classList.contains('hidden')`, 5000);
  const splashHiddenMs = Date.now() - launchedAt;
  await client.evaluate(`(() => {
    const style = document.createElement('style');
    style.dataset.smoke = 'phase4a';
    style.textContent = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}';
    document.head.appendChild(style);
    localStorage.setItem('narra-atelier-dock-collapsed', '0');
  })()`);
  const shellDeadline = Date.now() + 15000;
  let initialExpansionRequested = false;
  while (Date.now() < shellDeadline) {
    const shellState = await client.evaluate(`(() => {
      const sidebar = document.querySelector('.sidebar');
      return {
        mounted: Boolean(sidebar),
        collapsed: Boolean(sidebar?.classList.contains('is-collapsed')),
        headerMounted: Boolean(document.querySelector('.atelier-header-profile')),
      };
    })()`);
    if (shellState.mounted && !shellState.collapsed && shellState.headerMounted) break;
    if (shellState.mounted && shellState.collapsed && !initialExpansionRequested) {
      initialExpansionRequested = true;
      await client.evaluate(`document.querySelector('.sidebar-collapse-btn')?.click()`);
    }
    await client.evaluate(`window.dispatchEvent(new CustomEvent('genyu:navigate-page', {detail: {page: ${JSON.stringify(requestedPage)}}}))`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await client.waitFor(`document.querySelector('.sidebar:not(.is-collapsed)') && document.querySelector('.atelier-header-profile')`, 5000);
  await client.waitFor(`document.querySelector(${JSON.stringify(smokeTarget.readySelector)})`, 10000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await client.evaluate(`(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const slash = String.fromCharCode(92);
    const prefix = ['C:', 'Users'].join(slash) + slash;
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue;
      const prefixAt = value.indexOf(prefix);
      if (prefixAt < 0) continue;
      const userAt = prefixAt + prefix.length;
      const suffixAt = value.indexOf(slash, userAt);
      if (suffixAt > userAt) walker.currentNode.nodeValue = value.slice(0, userAt) + 'USER' + value.slice(suffixAt);
    }
  })()`);

  const measure = `(() => {
    const root = document.getElementById('root');
    const sidebar = document.querySelector('.sidebar');
    const header = document.querySelector('.atelier-header-profile');
    const main = document.querySelector('.main-content');
    const nav = sidebar.querySelector('.sidebar-nav');
    const groups = [...nav.querySelectorAll(':scope > .sidebar-nav-group')];
    const navItems = [...nav.querySelectorAll('.nav-item')];
    const rect = (element) => { const value = element.getBoundingClientRect(); return {x: value.x, y: value.y, width: value.width, height: value.height}; };
    return {
      rootChildren: root.children.length,
      rootDisplay: getComputedStyle(root).display,
      bodyCollapsed: document.body.classList.contains('sidebar-collapsed'),
      sidebar: rect(sidebar), header: rect(header), main: rect(main),
      shellSemantics: {
        headerTag: header.tagName,
        headerLabel: header.getAttribute('aria-label'),
        sidebarTag: sidebar.tagName,
        sidebarLabel: sidebar.getAttribute('aria-label'),
        navTag: nav.tagName,
        navLabel: nav.getAttribute('aria-label'),
        groupIds: groups.map((group) => group.dataset.navGroup),
        groupLabels: groups.map((group) => group.getAttribute('aria-label')),
        groupItemCounts: groups.map((group) => group.querySelectorAll('.nav-item').length),
        pageOrder: navItems.map((item) => item.dataset.page),
        currentPageCount: navItems.filter((item) => item.getAttribute('aria-current') === 'page').length,
        semanticHeaderClass: header.classList.contains('app-header'),
        semanticAccountTriggerClass: Boolean(header.querySelector('.header-account-trigger')),
        navHorizontalOverflow: nav.scrollWidth > nav.clientWidth,
        navOverflowX: getComputedStyle(nav).overflowX,
      },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`;
  const expanded = await client.evaluate(measure);
  await client.evaluate(`document.querySelector('.sidebar-collapse-btn').click()`);
  await client.waitFor(`document.querySelector('.sidebar')?.classList.contains('is-collapsed')`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const collapsed = await client.evaluate(measure);
  await writeScreenshot(client, updateBaseline ? baselineCollapsed : currentCollapsed);
  await client.evaluate(`document.querySelector('.sidebar-collapse-btn').click()`);
  await client.waitFor(`!document.querySelector('.sidebar')?.classList.contains('is-collapsed')`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const reexpanded = await client.evaluate(measure);
  await writeScreenshot(client, updateBaseline ? baselineExpanded : currentExpanded);
  const targetPage = requestedPage === 'captcha-setup'
    ? await client.evaluate(`(() => {
        const page = document.querySelector('.captcha-setup-page');
        const wizard = document.querySelector('.captcha-setup-wizard');
        const steps = [...document.querySelectorAll('.captcha-setup-step')];
        const actions = [...document.querySelectorAll('.captcha-setup-step-actions')];
        const style = wizard ? getComputedStyle(wizard) : null;
        return {
          visible: Boolean(page && page.getClientRects().length),
          stepCount: steps.length,
          wizardDisplay: style?.display || null,
          wizardFlexDirection: style?.flexDirection || null,
          wizardGridTemplateColumns: style?.gridTemplateColumns || null,
          stepRects: steps.map((step) => { const rect = step.getBoundingClientRect(); return {x: rect.x, width: rect.width}; }),
          overflowingActionGroups: actions.filter((group) => group.scrollWidth > group.clientWidth).length,
        };
      })()`)
    : {visible: Boolean(await client.evaluate(`document.querySelector(${JSON.stringify(smokeTarget.readySelector)})?.getClientRects().length`))};
  await Promise.allSettled(client.failureSnapshotTasks);
  runtime = {
    rendererTarget: {title: rendererTarget.title, url: rendererTarget.url},
    title: await client.evaluate('document.title'),
    url: await client.evaluate('location.href'),
    viewport: await client.evaluate('({width: innerWidth, height: innerHeight, devicePixelRatio})'),
    startup: {targetDetectedMs, rootReadyMs, splashHiddenMs}, expanded, collapsed, reexpanded, targetPage,
  };
} finally {
  client?.close();
  await terminateProcessTree(electronProcess.pid);
  const tempBase = path.resolve(os.tmpdir());
  const resolvedProfile = path.resolve(profileRoot);
  if (resolvedProfile.startsWith(`${tempBase}${path.sep}`) && path.basename(resolvedProfile).startsWith('narra-electron-smoke-')) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      rmSync(resolvedProfile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
    } catch (error) {
      cleanupWarning = `${error.code || 'ERROR'}: ${error.message}`;
    }
  }
}

const screenshots = updateBaseline
  ? {
      expanded: {status: 'UPDATED', pixelSha256: pixelSha256(baselineExpanded)},
      collapsed: {status: 'UPDATED', pixelSha256: pixelSha256(baselineCollapsed)},
    }
  : {expanded: compareBaseline(currentExpanded, baselineExpanded), collapsed: compareBaseline(currentCollapsed, baselineCollapsed)};
const runtimeErrors = client.events.filter((event) =>
  event.method === 'Runtime.exceptionThrown'
  || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error')
  || (event.method === 'Network.loadingFailed' && !event.params.canceled),
);
const networkRequests = new Map(client.events
  .filter((event) => event.method === 'Network.requestWillBeSent')
  .map((event) => [event.params.requestId, event.params]));
const failedRequests = runtimeErrors
  .filter((event) => event.method === 'Network.loadingFailed')
  .map((event) => {
    const request = networkRequests.get(event.params.requestId);
    const snapshot = client.failureSnapshots.find((entry) => entry.requestId === event.params.requestId);
    return {
      requestId: event.params.requestId,
      url: request?.request.url || null,
      documentURL: request?.documentURL || null,
      resourceType: event.params.type,
      initiator: request?.initiator || null,
      requestTimestamp: request?.timestamp || null,
      requestWallTime: request?.wallTime || null,
      failureTimestamp: event.params.timestamp,
      millisecondsAfterLaunch: request?.wallTime ? Math.round(request.wallTime * 1000 - launchedAt) : null,
      errorText: event.params.errorText,
      runtimeStateAtFailure: snapshot || null,
    };
  });
const shellValid = runtime.expanded.sidebar.width === 236
  && runtime.expanded.header.x === 236
  && runtime.collapsed.sidebar.width === 66
  && runtime.collapsed.header.x === 66
  && runtime.reexpanded.sidebar.width === 236
  && runtime.reexpanded.header.x === 236
  && !runtime.expanded.horizontalOverflow
  && !runtime.collapsed.horizontalOverflow;
const expectedGroupIds = ['create', 'edit', 'assets', 'system'];
const expectedPageOrder = [
  'image-ultra',
  'video-pro',
  'voice',
  'image-ultra',
  'capcut-video',
  'concat',
  'upload',
  'provider-account',
  'webview',
  'captcha-setup',
  'settings',
];
const shellSemantics = runtime.expanded.shellSemantics;
const shellSemanticsValid = shellSemantics.headerTag === 'HEADER'
  && shellSemantics.sidebarTag === 'ASIDE'
  && shellSemantics.navTag === 'NAV'
  && Boolean(shellSemantics.headerLabel)
  && Boolean(shellSemantics.sidebarLabel)
  && Boolean(shellSemantics.navLabel)
  && JSON.stringify(shellSemantics.groupIds) === JSON.stringify(expectedGroupIds)
  && JSON.stringify(shellSemantics.groupItemCounts) === JSON.stringify([3, 3, 1, 4])
  && JSON.stringify(shellSemantics.pageOrder) === JSON.stringify(expectedPageOrder)
  && shellSemantics.currentPageCount === 1
  && shellSemantics.semanticHeaderClass
  && shellSemantics.semanticAccountTriggerClass
  && shellSemantics.navOverflowX === 'hidden'
  && runtime.collapsed.shellSemantics.navOverflowX === 'hidden';
const targetPageValid = requestedPage !== 'captcha-setup'
  ? runtime.targetPage.visible
  : runtime.targetPage.visible
    && runtime.targetPage.stepCount === 4
    && runtime.targetPage.wizardDisplay === 'flex'
    && runtime.targetPage.wizardFlexDirection === 'column'
    && runtime.targetPage.overflowingActionGroups === 0;
const baselineValid = updateBaseline || Object.values(screenshots).every((entry) => entry.status === 'MATCH');
const report = {
  generatedAt: new Date().toISOString(),
  requestedPage,
  executable: path.relative(repositoryRoot, executable).split(path.sep).join('/'),
  packagedAsarMtime: statSync(packagedAsar).mtime.toISOString(),
  latestRuntimeSourceMtime: new Date(runtimeSourceMtimeMs).toISOString(),
  runtime, screenshots, runtimeErrors, failedRequests, electronProcessOutput: processOutput, cleanupWarning,
  assertions: {
    rootRendered: runtime.expanded.rootChildren > 0 && runtime.expanded.rootDisplay !== 'none',
    splashHidden: Number.isFinite(runtime.startup.splashHiddenMs),
    shellDimensionsAndOffsets: shellValid,
    shellSemanticStructure: shellSemanticsValid,
    targetPageLayout: targetPageValid,
    visualBaseline: baselineValid,
    noRuntimeErrors: runtimeErrors.length === 0,
  },
};
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const failures = Object.entries(report.assertions).filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length > 0) {
  console.error(`Electron UI smoke failed: ${failures.join(', ')}. See ${path.relative(repositoryRoot, reportFile)}.`);
  process.exitCode = 1;
} else console.log(`Electron UI smoke passed. Report: ${path.relative(repositoryRoot, reportFile)}`);
