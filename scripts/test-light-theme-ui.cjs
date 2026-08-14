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
const mainCss = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'index-DNnmb74c.css'),
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
  'sidebar.sections.edit',
  'sidebar.sections.assets',
  'sidebar.sections.system',
]) {
  assert.equal(
    mainJs.includes(`label: U("${sectionKey}")`),
    true,
    `${sectionKey} must label a semantic sidebar group`,
  );
}
assert.match(mainJs, /s\.jsxs\("header",\s*\{\s*className: "app-header atelier-header-profile"/s);
assert.match(
  mainJs,
  /className: "sidebar-nav-group",\s*role: "group",\s*"data-nav-group": P/s,
);
assert.match(mainJs, /className: "sidebar-nav-group-label",\s*"aria-hidden": "true"/s);
assert.match(mainJs, /"aria-current": Ge \? "page" : void 0/);
assert.match(mainJs, /"aria-disabled": Ye \|\| We \? "true" : void 0/);
assert.match(mainJs, /className: "header-account-trigger sidebar-provider-current"/);
assert.doesNotMatch(lightCss, /atelier-header-profile/);
assert.match(
  lightCss,
  /\.narra-image-studio \.img-page-header:after\{content:none!important/,
);
assert.match(lightCss, /Narra light theme/);
assert.match(lightCss, /\.vpro-output-open\{[^}]*display:inline-flex[^}]*gap:/);
assert.match(lightCss, /--surface-media:\s*#11131a/);
for (const designToken of [
  '--background',
  '--surface',
  '--surface-muted',
  '--surface-hover',
  '--foreground',
  '--muted-foreground',
  '--border-strong',
  '--primary',
  '--primary-foreground',
  '--primary-muted',
  '--sidebar-width',
  '--sidebar-collapsed-width',
  '--header-height',
]) {
  assert.match(lightCss, new RegExp(`${designToken}:\\s*[^;]+;`));
}
assert.match(
  lightCss,
  /\.sidebar\s*\{[^}]*background:\s*var\(--bg-0\)\s*!important;[^}]*border-right:\s*1px\s+solid\s+var\(--border-subtle\)\s*!important;/s,
);
assert.doesNotMatch(lightCss, /\.sidebar\s*\{[^}]*border-right:[^}]*#17131d/s);
assert.match(lightCss, /\.sidebar\.is-collapsed\s*\{[^}]*width:\s*var\(--sidebar-collapsed-width\)/s);
assert.match(
  lightCss,
  /body\.sidebar-collapsed \.app-header\s*\{[^}]*left:\s*var\(--sidebar-collapsed-width\)/s,
);
assert.match(
  lightCss,
  /\.sidebar-nav \.nav-item:hover\s*\{[^}]*background:\s*var\(--surface-hover\);/s,
);
assert.match(
  lightCss,
  /\.sidebar-nav \.nav-item\.active\s*\{[^}]*color:\s*var\(--primary\);[^}]*background:\s*var\(--primary-muted\);/s,
);
assert.match(
  lightCss,
  /\.app-header\s*\{[^}]*height:\s*var\(--header-height\);[^}]*background:\s*var\(--surface\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.nav-item:hover\s+:is\(\.nav-icon,\s*\.nav-label\)[^{]*\{[^}]*color:\s*var\(--primary\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.app:has\(> \.app-header\) > \.main-content::before\s*\{[^}]*background:\s*var\(--bg-0\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.sidebar-nav-group\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*4px;/s,
);
assert.match(lightCss, /\.sidebar-nav\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
assert.match(
  lightCss,
  /\.sidebar\.is-collapsed \.sidebar-nav-group-label\s*\{[^}]*display:\s*none;/s,
);
assert.match(lightCss, /\/\* Light typography compatibility \*\//);
assert.match(lightCss, /\/\* Light component compatibility \*\//);
assert.match(lightCss, /\/\* Intentional dark media surfaces \*\//);
assert.match(lightCss, /\/\* Shared visual contracts for the recovered renderer\. \*\//);
assert.match(
  lightCss,
  /\*,\s*\*::before,\s*\*::after\s*\{[^}]*font-family:\s*system-ui,[^}]*!important;/s,
);
for (const primitiveToken of [
  '--primary-hover',
  '--control-height-sm',
  '--control-height-md',
  '--focus-ring',
  '--control-disabled-opacity',
]) {
  assert.match(lightCss, new RegExp(`${primitiveToken}:\\s*[^;]+;`));
}
for (const primitiveSelector of [
  '.brand-button',
  '.brand-icon-button',
  '.brand-input',
  '.brand-surface',
  '.brand-badge--success',
]) {
  assert.equal(mainCss.includes(primitiveSelector), true, `${primitiveSelector} must be defined`);
}
for (const typographySelector of ['.brand-section-title', '.brand-helper-text']) {
  assert.equal(lightCss.includes(typographySelector), true, `${typographySelector} must be defined`);
}
assert.match(
  lightCss,
  /\.settings-flat-content \.settings-flat-folder-list button:disabled,[\s\S]*opacity:\s*var\(--control-disabled-opacity\);/,
);
assert.match(
  lightCss,
  /\.settings-flat-tabs\.brand-tabs > button:focus-visible,[\s\S]*outline:\s*2px solid var\(--focus-ring\);/,
);
assert.match(
  lightCss,
  /\.settings-flat-tabs\.brand-tabs > button\.active\s*\{[^}]*color:\s*var\(--primary-hover\)\s*!important;[^}]*border-bottom-color:\s*var\(--primary\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-folder-list\s*\{[^}]*background:\s*var\(--surface\)\s*!important;[^}]*box-shadow:\s*var\(--shadow-sm\)\s*!important;/s,
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
  /\.settings-flat-folder-icon\s*\{[^}]*border-radius:\s*0\s*!important;[^}]*background:\s*transparent\s*!important;/s,
);
assert.match(
  lightCss,
  /\.settings-flat-folder-list button:not\(:last-child\)\s*\{[^}]*color:\s*var\(--primary-foreground\)\s*!important;/s,
);
assert.doesNotMatch(lightCss, /\.settings-flat-content\s+:where\([^)]*button[^)]*input[^)]*\)/);
assert.match(
  lightCss,
  /\.settings-flat-section > header p,[\s\S]*\.settings-flat-result\s*\{[^}]*font-size:\s*14px\s*!important;[^}]*font-weight:\s*500\s*!important;/,
);
assert.match(
  lightCss,
  /\.settings-flat-section h2,[\s\S]*\.settings-flat-block-heading h3[\s\S]*\{[^}]*font-size:\s*16px\s*!important;[^}]*font-weight:\s*600\s*!important;/,
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
assert.equal(html.includes('fonts.googleapis.com'), false);
assert.equal(html.includes('sheet.cssRules'), false);
assert.match(html, /setTimeout\(hideSplash, 3000\)/);
assert.match(html, /\.sidebar\s*\{[^}]*width:\s*var\(--sidebar-width,\s*236px\)/s);
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
  /\.captcha-setup-wizard\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex-direction:\s*column\s*!important;[^}]*border:\s*0\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step\.done \.captcha-setup-step-number\s*\{[^}]*color:\s*var\(--primary-foreground\)\s*!important;[^}]*background:\s*var\(--success\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-panel li > span\s*\{[^}]*border-radius:\s*50%\s*!important;[^}]*background:\s*var\(--foreground\)\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-actions\s*\{[^}]*flex-wrap:\s*nowrap\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-actions \.brand-button\s*\{[^}]*width:\s*auto\s*!important;[^}]*min-width:\s*0\s*!important;[^}]*white-space:\s*nowrap\s*!important;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-copy strong\s*\{[^}]*font-size:\s*16px\s*!important;[^}]*font-weight:\s*600;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-step-copy > span\s*\{[^}]*font-size:\s*14px\s*!important;[^}]*font-weight:\s*500;/s,
);
assert.match(
  lightCss,
  /\.captcha-setup-refresh:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)\s*!important;/s,
);
assert.doesNotMatch(lightCss, /\.captcha-setup-step\.done \.captcha-setup-step-number\s*\{[^}]*#22c55e/s);
assert.doesNotMatch(lightCss, /\.captcha-setup-step-panel li > span\s*\{[^}]*#302b45/s);
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
