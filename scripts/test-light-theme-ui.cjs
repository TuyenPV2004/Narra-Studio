'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'renderer');
const desktopSourceRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src');
const electronRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'electron');
const mainJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'index-JlIFz2Wa.js'),
  'utf8',
);
const captchaJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'CaptchaSetupPage-DbTYSglx.js'),
  'utf8',
);
const settingsJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'SettingsPage-DD4JanXX.js'),
  'utf8',
);
const generationViJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'generation-Cwa9DMFz.js'),
  'utf8',
);
const lucideJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'lucide-BG4Ur802.js'),
  'utf8',
);
const lightCss = fs.readFileSync(path.join(rendererRoot, 'light-theme.css'), 'utf8');
const preloadJs = fs.readFileSync(path.join(electronRoot, 'preload.js'), 'utf8');
const flowSessionJs = fs.readFileSync(
  path.join(electronRoot, 'ipc', 'flow', 'session.js'),
  'utf8',
);
const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
const brand = JSON.parse(
  fs.readFileSync(path.join(rendererRoot, 'brand', 'brand.generated.json'), 'utf8'),
);

const rendererTextExtensions = new Set(['.css', '.html', '.js', '.json']);
const rendererTextFiles = [];
const collectRendererTextFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectRendererTextFiles(absolutePath);
    else if (rendererTextExtensions.has(path.extname(entry.name))) rendererTextFiles.push(absolutePath);
  }
};
collectRendererTextFiles(rendererRoot);

assert.equal(brand.displayNameUpper, 'Narra Studio');
assert.equal(brand.theme.background0, '#f8f7fc');
assert.equal(mainJs.includes('children: "LOCAL ONLY"'), false);
assert.equal(mainJs.includes('className: "sidebar-footer"'), false);
for (const sectionKey of [
  'sidebar.sections.create',
  'sidebar.sections.finish',
  'sidebar.sections.manage',
]) {
  assert.equal(
    mainJs.includes(`children: U("${sectionKey}")`),
    false,
    `${sectionKey} must not render a sidebar caption`,
  );
}
assert.match(
  lightCss,
  /\.narra-image-studio \.img-page-header:after\{content:none!important/,
);
assert.match(lightCss, /Narra light theme/);
assert.match(lightCss, /\.vpro-output-open\{[^}]*display:inline-flex[^}]*gap:/);
assert.match(lightCss, /--surface-media:\s*#11131a/);
assert.match(
  lightCss,
  /\.sidebar\s*\{[^}]*background:\s*var\(--bg-0\)\s*!important;[^}]*border-right:\s*0\s*!important;/s,
);
assert.match(
  lightCss,
  /\.nav-item:hover\s+:is\(\.nav-icon,\s*\.nav-label\)[^{]*\{[^}]*color:\s*var\(--brand-primary-hover\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.app:has\(> \.atelier-header-profile\) > \.main-content::before\s*\{[^}]*background:\s*var\(--bg-0\)\s*!important;/s,
);
assert.match(lightCss, /\/\* Light typography compatibility \*\//);
assert.match(lightCss, /\/\* Light component compatibility \*\//);
assert.match(lightCss, /\/\* Intentional dark media surfaces \*\//);
assert.match(lightCss, /\/\* Settings output folders \*\//);
assert.match(
  lightCss,
  /\*,\s*\*::before,\s*\*::after\s*\{[^}]*font-family:\s*system-ui,[^}]*!important;/s,
);
assert.match(lightCss, /\/\* Settings tab interaction states \*\//);
assert.match(
  lightCss,
  /\.settings-flat-tabs button,\s*\.settings-flat-tabs button:hover,\s*\.settings-flat-tabs button:active,\s*\.settings-flat-tabs button:focus-visible\s*\{[^}]*color:\s*var\(--text-2\)\s*!important;[^}]*background:\s*transparent\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-tabs button\.active,\s*\.settings-flat-tabs button\.active:hover,\s*\.settings-flat-tabs button\.active:active,\s*\.settings-flat-tabs button\.active:focus-visible\s*\{[^}]*color:\s*var\(--brand-primary-hover\)\s*!important;[^}]*background:\s*transparent\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-folder-list\s*\{[^}]*color:\s*#111827\s*!important;[^}]*background:\s*#ffffff\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-folder-list strong,\s*\.settings-flat-folder-list code\s*\{[^}]*color:\s*#111827\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-folder-list button:last-child\s*\{[^}]*color:\s*#111827\s*!important;[^}]*background:\s*#ffffff\s*!important;/s,
);

// Advanced VEO3 settings are backed by real auth and CAPTCHA actions.
assert.match(settingsJs, /onSetManualAuth:r/);
assert.match(settingsJs, /await r\(d\.trim\(\),null\)/);
assert.match(settingsJs, /await H\(m,v\)/);
assert.match(settingsJs, /c==="advanced"&&i==="veo3"/);
assert.equal(settingsJs.includes('children:s("settings.description")'), false);
assert.equal(settingsJs.includes('className:"settings-flat-warning"'), false);
assert.equal(settingsJs.includes('settings.advanced.authReceived'), false);
assert.equal(settingsJs.includes('settings.advanced.authMissing'), false);
assert.match(settingsJs, /className:"settings-flat-section settings-flat-output"/);
assert.match(preloadJs, /setManualAuth:\s*\(d\)\s*=>\s*ipcRenderer\.invoke\('set-manual-auth', d\)/);
assert.match(flowSessionJs, /ipcMain\.handle\('set-manual-auth'/);
assert.match(
  lightCss,
  /\.settings-flat-output > header p\s*\{[^}]*color:\s*var\(--text-2\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-folder-icon\s*\{[^}]*border-radius:\s*0\s*!important;[^}]*background:\s*transparent\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-folder-list button:not\(:last-child\)\s*\{[^}]*color:\s*#ffffff\s*!important;/s,
);
assert.match(
  lightCss,
  /\/\* Settings typography contract \*\/[\s\S]*\.settings-flat-content :where\(h2, h3, p, strong, code, span, label, summary, button, input\)\s*\{[^}]*font-size:\s*16px\s*!important;[^}]*font-weight:\s*600\s*!important;/,
);
assert.match(
  lightCss,
  /\.settings-flat-section > header p\s*\{[^}]*color:\s*var\(--text-2\)\s*!important;[^}]*font-size:\s*14px\s*!important;[^}]*font-weight:\s*500\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-section :where\(h2, h3\)\s*\{[^}]*color:\s*var\(--text\)\s*!important;/s,
);
assert.equal(mainJs.includes('jc = ["vi", "en", "zh"]'), false);
assert.equal(mainJs.includes('../locales/zh/'), false);
assert.equal(mainJs.includes('简体中文'), false);
for (const rendererFile of rendererTextFiles) {
  const source = fs.readFileSync(rendererFile, 'utf8');
  assert.doesNotMatch(
    source,
    /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u,
    `Chinese characters must not remain in ${path.relative(repositoryRoot, rendererFile)}`,
  );
}
for (const runtimeFile of fs.readdirSync(path.join(desktopSourceRoot, 'electron'), {
  recursive: true,
  withFileTypes: true,
})) {
  if (!runtimeFile.isFile() || !rendererTextExtensions.has(path.extname(runtimeFile.name))) continue;
  const source = fs.readFileSync(path.join(runtimeFile.parentPath, runtimeFile.name), 'utf8');
  assert.doesNotMatch(source, /zh(?:-cn|-hans|-hant|-tw)?/iu);
}

const mediaSection = lightCss.split('/* Intentional dark media surfaces */')[1] ?? '';
for (const forbiddenSelector of ['.sidebar', '.modal', '.menu', '.settings', '.account']) {
  assert.equal(
    mediaSection.includes(forbiddenSelector),
    false,
    `${forbiddenSelector} must remain a light application surface`,
  );
}
assert.match(html, /href="\.\/light-theme\.css"/);
assert.match(html, /body\s*\{[^}]*background:\s*#f8f7fc/s);
assert.match(
  html,
  /body\s*\{[^}]*font-family:\s*system-ui,\s*-apple-system,\s*BlinkMacSystemFont,\s*'Segoe UI',\s*sans-serif;/s,
);
assert.equal(html.includes("'Inter'"), false);
assert.equal(html.includes("'JetBrains Mono'"), false);
assert.equal(html.includes('id="devtools-trigger"'), false);

// CAPTCHA setup must behave like a light, accessible accordion.
assert.equal(
  captchaJs.includes('className:"captcha-setup-eyebrow"'),
  false,
  'CAPTCHA setup must not render the Narra Studio · VEO3 eyebrow',
);
assert.match(
  captchaJs,
  /onClick:\(\)=>y\(u\?-1:r\)/,
  'clicking the expanded CAPTCHA step must collapse it',
);
assert.match(captchaJs, /"aria-controls":`captcha-step-\$\{a\.id\}`/);
assert.match(captchaJs, /id:`captcha-step-\$\{a\.id\}`/);
assert.equal(
  captchaJs.includes('e.jsx("small",{children:s("captcha.setup.stepLabel"'),
  false,
  'the step label must be part of the card title instead of a separate line',
);
assert.match(captchaJs, /stepLabel[^\n]+\.replace\(\/\\s\*\\\/\\s\*\/,"\/"\)/);
assert.match(captchaJs, /children:a\.done\?e\.jsx\(N,\{size:17,strokeWidth:3\}\):r\+1/);
assert.match(captchaJs, /children:e\.jsx\(W,\{size:28\}\)/);
assert.match(captchaJs, /className:`captcha-refresh-icon \$\{l\?"is-spinning":""\}`/);
for (const expectedCopy of [
  'openFolder:"Mở thư mục"',
  'downloadButton:"Tải Extension"',
  'copyChromeAddress:"chrome://extensions"',
  'refreshStatus:"Kiểm tra"',
  'title:"Tải Extension về máy"',
  'title:"Cài đặt Extension"',
  'title:"Mở Google Flow"',
  'title:"Kiểm tra kết nối"',
]) {
  assert.equal(
    generationViJs.includes(expectedCopy),
    true,
    `missing CAPTCHA setup copy: ${expectedCopy}`,
  );
}
assert.match(lightCss, /\/\* CAPTCHA light redesign \*\//);
assert.match(
  lightCss,
  /\.captcha-setup-step\.done \.captcha-setup-step-number\s*\{[^}]*color:\s*#ffffff\s*!important;[^}]*background:\s*#22c55e\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-panel li > span\s*\{[^}]*border-radius:\s*50%\s*!important;[^}]*background:\s*#302b45\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-actions\s*\{[^}]*flex-wrap:\s*nowrap\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-actions \.brand-button\s*\{[^}]*width:\s*auto\s*!important;[^}]*min-width:\s*0\s*!important;[^}]*white-space:\s*nowrap\s*!important;/s,
);
assert.match(lightCss, /@keyframes captcha-refresh-clockwise\s*\{[^}]*rotate\(0deg\)[\s\S]*rotate\(1turn\)/);
assert.match(
  lightCss,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.captcha-refresh-icon\.is-spinning/,
);
assert.match(
  lightCss,
  /\.toast\s*\{[^}]*display:\s*flex\s*!important;[^}]*gap:\s*8px\s*!important;/s,
);
assert.match(
  lightCss,
  /\.toast\.success\s*>\s*svg\s*\{[^}]*color:\s*var\(--success-text\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.nav-icon\s*\{[^}]*display:\s*grid\s*!important;[^}]*place-items:\s*center\s*!important;/s,
);

// The existing Lucide aliases used by ToastRenderer are semantic status icons.
assert.match(mainJs, /case "success":\s*return s\.jsx\(xS,/);
assert.match(mainJs, /case "error":\s*return s\.jsx\(AS,/);
assert.match(mainJs, /case "info":\s*return s\.jsx\(wS,/);
assert.match(lucideJs, /rc=e\("circle-check"/);
assert.match(lucideJs, /xc=e\("circle-x"/);
assert.match(lucideJs, /Go=e\("info"/);

console.log('Narra light theme UI contract is valid.');
