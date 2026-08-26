import {readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'ui');
const electronRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'electron');
const preloadFile = path.join(electronRoot, 'preload.js');
const sourceBuildFile = path.join(repositoryRoot, 'scripts', 'build-source-desktop.mjs');

const requiredFiles = [
  'index.html',
  'vite.config.mts',
  'tsconfig.json',
  'main.tsx',
  'app/App.tsx',
  'app/AppShell.tsx',
  'app/bootstrap.tsx',
  'app/ErrorBoundary.tsx',
  'app/navigation.ts',
  'app/page-config.ts',
  'components/ui/Badge.tsx',
  'components/ui/Button.tsx',
  'components/ui/Input.tsx',
  'components/ui/Surface.tsx',
  'components/ui/Tabs.tsx',
  'components/Header/Header.tsx',
  'components/Sidebar/Sidebar.tsx',
  'hooks/useAppRuntime.ts',
  'i18n/LocaleProvider.tsx',
  'i18n/messages.ts',
  'pages/CaptchaSetup/CaptchaSetupPage.tsx',
  'pages/CaptchaSetup/useCaptchaSetup.ts',
  'pages/ProviderHub/ProviderSelectionPage.tsx',
  'pages/Settings/SettingsPage.tsx',
  'pages/Image/ImageGeneratorPage.tsx',
  'pages/Image/ImageEditorPage.tsx',
  'pages/Image/ImageAnnotationCanvas.tsx',
  'pages/Voice/VoicePage.tsx',
  'pages/Video/VideoGeneratorPage.tsx',
  'pages/MediaLibrary/MediaLibraryPage.tsx',
  'pages/QuickCut/QuickCutPage.tsx',
  'pages/SceneMerge/SceneMergePage.tsx',
  'pages/ProviderAccount/ProviderConnectionsPage.tsx',
  'pages/ProviderAccount/AiProviderProfilesPanel.tsx',
  'pages/GoogleFlow/GoogleFlowPage.tsx',
  'pages/Dashboard/DashboardPage.tsx',
  'pages/Guide/GuidePage.tsx',
  'pages/AIAgent/AIAgentSourcePage.tsx',
  'services/electron-api/client.ts',
  'services/electron-api/provider.ts',
  'services/electron-api/ai-providers.ts',
  'services/electron-api/settings.ts',
  'services/electron-api/image.ts',
  'services/electron-api/voice.ts',
  'services/electron-api/video.ts',
  'services/electron-api/media.ts',
  'services/electron-api/flow.ts',
  'services/electron-api/dashboard.ts',
  'services/electron-api/agent.ts',
  'storage/keys.ts',
  'storage/safe-storage.ts',
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
  if (/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*getElectronApi\(\)\s*;/u.test(source)) {
    failures.push(`Aliased Electron API access is outside the static surface guard: ${relativeFile}`);
  }
  if (/from\s+["'][^"']*(?:\/|\\)renderer(?:\/|\\)/u.test(source)) {
    failures.push(`Source frontend imports recovered renderer code: ${relativeFile}`);
  }
  for (const match of source.matchAll(/getElectronApi\(\)\s*\.\s*([A-Za-z_$][\w$]*)/gu)) {
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

const expectedSourcePageIds = [
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
  'ai-agent',
];
const pageConfigSource = readFileSync(path.join(sourceRoot, 'app', 'page-config.ts'), 'utf8');
const pageIdBlock = pageConfigSource.match(/sourcePageIds\s*=\s*\[([\s\S]*?)\]\s*as const/u)?.[1] ?? '';
const actualSourcePageIds = [...pageIdBlock.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
if (JSON.stringify(actualSourcePageIds) !== JSON.stringify(expectedSourcePageIds)) {
  failures.push('Production source page inventory drifted from the cutover baseline.');
}

const electronFiles = collectFiles(electronRoot, (file) => /\.js$/u.test(file));
for (const file of electronFiles) {
  const source = readFileSync(file, 'utf8');
  if (/(?:src[\\/]+ui|dist-source-renderer)/u.test(source)) {
    failures.push(`Electron runtime references the parallel source renderer: ${path.relative(repositoryRoot, file)}`);
  }
}

const sourceBuildSource = readFileSync(sourceBuildFile, 'utf8');
if (!/path\.join\(sourceRoot,\s*["']ui["']\)/u.test(sourceBuildSource) || /src["', ]*,?\s*["']renderer["']/u.test(sourceBuildSource)) failures.push('Production source build does not isolate the maintained UI from the recovered renderer.');

const rootPackage = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const desktopPackage = JSON.parse(readFileSync(path.join(repositoryRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
if (rootPackage.scripts?.['build:source'] !== 'node scripts/build-source-renderer.mjs') {
  failures.push('Root build:source does not use the production source-renderer wrapper.');
}
if (desktopPackage.scripts?.build !== 'node ../../scripts/build-source-desktop.mjs') {
  failures.push('Desktop production build does not use the source renderer build.');
}
if (desktopPackage.dependencies?.react || desktopPackage.devDependencies?.react) {
  failures.push('Source-only React dependencies leaked into the deployable Electron package.');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Source frontend guard valid: ${sourceFiles.length} TypeScript files, ${adapterMethods.size} direct adapter method names, ${actualSourcePageIds.length} production page IDs, production runtime source-built.`,
);
