import {readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'renderer-source');
const electronRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'electron');
const preloadFile = path.join(electronRoot, 'preload.js');
const recoveredBuildFile = path.join(repositoryRoot, 'scripts', 'build-recovered-desktop.mjs');

const requiredFiles = [
  'index.html',
  'vite.config.mts',
  'tsconfig.json',
  'main.tsx',
  'app/App.tsx',
  'app/bootstrap.tsx',
  'app/page-config.ts',
  'app/routes.ts',
  'components/ui/Badge.tsx',
  'components/ui/Surface.tsx',
  'pages/SourceRecoveryStatusPage.tsx',
  'services/electron-api/client.ts',
  'services/electron-api/provider.ts',
  'services/electron-api/captcha.ts',
  'styles/tokens.css',
  'styles/base.css',
  'styles/components.css',
  'types/electron-api.d.ts',
];

const collectFiles = (root, predicate) => {
  const files = [];
  const visit = (entry) => {
    if (statSync(entry).isDirectory()) {
      for (const child of readdirSync(entry)) visit(path.join(entry, child));
    } else if (predicate(entry)) {
      files.push(entry);
    }
  };
  visit(root);
  return files.sort();
};

const failures = [];
for (const relativeFile of requiredFiles) {
  const file = path.join(sourceRoot, relativeFile);
  try {
    if (!statSync(file).isFile()) failures.push(`Required source file is not a file: ${relativeFile}`);
  } catch {
    failures.push(`Missing required source file: ${relativeFile}`);
  }
}

const sourceFiles = collectFiles(sourceRoot, (file) => /\.(?:ts|tsx)$/u.test(file));
const adapterMethods = new Set();
for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8');
  const relativeFile = path.relative(sourceRoot, file).split(path.sep).join('/');
  const isElectronClient = relativeFile === 'services/electron-api/client.ts';

  if (!isElectronClient && /window\s*\.\s*(?:api|electronAPI)\b/u.test(source)) {
    failures.push(`Direct Electron API access outside adapter client: ${relativeFile}`);
  }
  if (/from\s+["'][^"']*(?:\/|\\)renderer(?:\/|\\)/u.test(source)) {
    failures.push(`Source frontend imports recovered renderer code: ${relativeFile}`);
  }
  for (const match of source.matchAll(/getElectronApi\(\)\.([A-Za-z_$][\w$]*)/gu)) {
    adapterMethods.add(match[1]);
  }
}

const preloadSource = readFileSync(preloadFile, 'utf8');
const exposedMethods = new Set(
  [...preloadSource.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:\s*\([^)]*\)\s*=>/gmu)].map((match) => match[1]),
);
const missingAdapterMethods = [...adapterMethods].filter((method) => !exposedMethods.has(method)).sort();
if (missingAdapterMethods.length > 0) {
  failures.push(`Source adapter methods missing from preload: ${missingAdapterMethods.join(', ')}`);
}

const expectedAllowedPageIds = [
  'provider-hub',
  'dashboard',
  'image',
  'image-ultra',
  'video-pro',
  'video-standard',
  'upload',
  'concat',
  'video-editor',
  'capcut-video',
  'voice',
  'provider-account',
  'webview',
  'captcha-setup',
  'settings',
  'guide',
];
const pageConfigSource = readFileSync(path.join(sourceRoot, 'app', 'page-config.ts'), 'utf8');
const allowedPageBlock = pageConfigSource.match(/recoveredAllowedPageIds\s*=\s*\[([\s\S]*?)\]\s*as const/u)?.[1] ?? '';
const actualAllowedPageIds = [...allowedPageBlock.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
if (JSON.stringify(actualAllowedPageIds) !== JSON.stringify(expectedAllowedPageIds)) {
  failures.push('Recovered allowed-page inventory drifted from the Phase 5 verified baseline.');
}

const electronFiles = collectFiles(electronRoot, (file) => /\.js$/u.test(file));
for (const file of electronFiles) {
  const source = readFileSync(file, 'utf8');
  if (/(?:renderer-source|dist-source-renderer)/u.test(source)) {
    failures.push(`Electron runtime references the parallel source renderer: ${path.relative(repositoryRoot, file)}`);
  }
}

const recoveredBuildSource = readFileSync(recoveredBuildFile, 'utf8');
if (/(?:renderer-source|dist-source-renderer)/u.test(recoveredBuildSource)) {
  failures.push('Recovered production build references the parallel source renderer.');
}

const rootPackage = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const desktopPackage = JSON.parse(readFileSync(path.join(repositoryRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
if (!String(rootPackage.scripts?.['build:source'] ?? '').includes('renderer-source/vite.config.mts')) {
  failures.push('Root build:source does not use the isolated renderer-source Vite config.');
}
if (desktopPackage.scripts?.build !== 'node ../../scripts/build-recovered-desktop.mjs') {
  failures.push('Recovered production build command changed during source bootstrap.');
}
if (desktopPackage.dependencies?.react || desktopPackage.devDependencies?.react) {
  failures.push('Source-only React dependencies leaked into the deployable Electron package.');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Source frontend guard valid: ${sourceFiles.length} TypeScript files, ${adapterMethods.size} direct adapter method names, ${actualAllowedPageIds.length} recovered allowed-page IDs, production runtime isolated.`,
);
