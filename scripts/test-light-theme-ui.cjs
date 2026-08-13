'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'renderer');
const mainJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'index-JlIFz2Wa.js'),
  'utf8',
);
const captchaJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'CaptchaSetupPage-DbTYSglx.js'),
  'utf8',
);
const lucideJs = fs.readFileSync(
  path.join(rendererRoot, 'assets', 'lucide-BG4Ur802.js'),
  'utf8',
);
const lightCss = fs.readFileSync(path.join(rendererRoot, 'light-theme.css'), 'utf8');
const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
const brand = JSON.parse(
  fs.readFileSync(path.join(rendererRoot, 'brand', 'brand.generated.json'), 'utf8'),
);

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
assert.match(lightCss, /\/\* CAPTCHA light redesign \*\//);
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
