"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(
  repositoryRoot,
  "apps",
  "desktop",
  "src",
  "renderer-source",
);
const read = (relative) =>
  fs.readFileSync(path.join(sourceRoot, relative), "utf8");
const tokens = read("styles/tokens.css");
const base = read("styles/base.css");
const components = read("styles/components.css");
const shell = read("app/AppShell.tsx");
const sidebar = read("components/Sidebar/Sidebar.tsx");
const header = read("components/Header/Header.tsx");
const settings = read("pages/Settings/SettingsPage.tsx");
const captcha = read("pages/CaptchaSetup/CaptchaSetupPage.tsx");
const canvasGraph = read("pages/AIAgent/components/CanvasGraphPanel.tsx");
const mediaTools = read("pages/AIAgent/components/MediaToolsPanel.tsx");
const providerConnections = read(
  "pages/ProviderAccount/ProviderConnectionsPage.tsx",
);
const aiProviders = read("pages/ProviderAccount/AiProviderProfilesPanel.tsx");
const flow = read("pages/GoogleFlow/GoogleFlowPage.tsx");
const flowApi = read("services/electron-api/flow.ts");
const mediaLibrary = read("pages/MediaLibrary/MediaLibraryPage.tsx");
const mediaApi = read("services/electron-api/media.ts");
const storageIpc = fs.readFileSync(
  path.join(
    repositoryRoot,
    "apps",
    "desktop",
    "src",
    "electron",
    "ipc",
    "storage.js",
  ),
  "utf8",
);
const projectsIpc = fs.readFileSync(
  path.join(
    repositoryRoot,
    "apps",
    "desktop",
    "src",
    "electron",
    "ipc",
    "media",
    "projects.js",
  ),
  "utf8",
);

for (const token of [
  "--background",
  "--surface",
  "--surface-muted",
  "--surface-hover",
  "--foreground",
  "--muted-foreground",
  "--border",
  "--border-strong",
  "--primary",
  "--primary-hover",
  "--primary-muted",
  "--primary-foreground",
  "--focus-ring",
  "--sidebar-width",
  "--sidebar-collapsed-width",
  "--header-height",
]) {
  assert.match(
    tokens,
    new RegExp(`${token}:\\s*[^;]+;`),
    `Missing design token ${token}`,
  );
}
assert.match(tokens, /font-family:\s*system-ui/);
assert.match(base, /font-family:\s*inherit/);
assert.doesNotMatch(base + components, /transition:\s*all\b/);
assert.match(shell, /<main\b/);
assert.match(sidebar, /<aside\b/);
assert.match(sidebar, /<nav\b/);
assert.match(sidebar, /aria-current=/);
assert.match(header, /<header\b/);
assert.match(settings, /<Tabs\b/);
assert.doesNotMatch(
  settings,
  /captcha-site-key|captcha-action|setSiteKey|setCaptchaAction/,
);
assert.match(settings, /openFolder/);
assert.match(storageIpc, /const openError = await shell\.openPath\(dir\)/);
assert.match(
  storageIpc,
  /return \{ ok: !openError, error: openError \|\| null \}/,
);
assert.match(captcha, /aria-live=/);
assert.match(canvasGraph, /<audio controls/);
assert.match(mediaTools, /Audio trim start/);
assert.match(providerConnections, /AiProviderProfilesPanel/);
assert.match(aiProviders, /onDirtyChange/);
assert.match(aiProviders, /finally \{\s*setBusy\(false\);/s);
assert.match(aiProviders, /setModels\(\[\]\)/);
assert.doesNotMatch(aiProviders, /source-ai-providers__capability-options/);
assert.doesNotMatch(aiProviders, /source-provider-card__btn-select/);
assert.doesNotMatch(aiProviders, /Tự động dùng cho/);
assert.doesNotMatch(aiProviders, /Đang dùng:/);
assert.match(flowApi, /success === false/);
assert.match(flow, /loadRequestRef/);
assert.match(flow, /navigator\.clipboard\.writeText/);
assert.match(flow, /copyToClipboard/);
assert.doesNotMatch(flow, /catch \(_\) \{\}/);
assert.match(flow, /Xác nhận đăng xuất/);
assert.match(flow, /Sao chép Project ID Slot/);
for (const token of [
  "Base URL",
  "API key",
  "Kiểm tra kết nối",
  "Tải danh sách model",
  "Lưu cấu hình",
  "Capabilities",
  "Loại kết nối",
  "Text-to-speech",
  "Lip-sync",
]) {
  assert.match(aiProviders, new RegExp(token));
}

assert.match(mediaLibrary, /className="source-media-card__preview-btn"/);
assert.match(mediaLibrary, /aria-label=\{`Xem \$\{item\.name\}`\}/);
assert.doesNotMatch(mediaLibrary, /<article[^>]*role="button"/);
assert.match(mediaLibrary, /Trash2 size=\{13\} aria-hidden="true"/);
assert.match(mediaLibrary, /importing/);
assert.match(mediaLibrary, /source-media-filters/);
assert.match(mediaApi, /normalizeMediaItem/);
assert.match(mediaApi, /localPath:/);
assert.match(projectsIpc, /validateMediaDeleteTarget/);


const sourceFiles = [];
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (/\.(?:css|html|ts|tsx)$/.test(entry.name))
      sourceFiles.push(absolute);
  }
};
visit(sourceRoot);
for (const file of sourceFiles)
  assert.doesNotMatch(
    fs.readFileSync(file, "utf8"),
    /[\u3400-\u4dbf\u4e00-\u9fff]/u,
    `Chinese text found in ${path.relative(repositoryRoot, file)}`,
  );

console.log(
  `Source UI contract valid across ${sourceFiles.length} maintained frontend files.`,
);
