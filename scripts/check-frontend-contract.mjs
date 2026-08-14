import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'renderer');
const preloadFile = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'electron', 'preload.js');
const manifestFile = path.join(repositoryRoot, 'docs', 'frontend-ipc-usage-manifest.json');
const writeManifest = process.argv.includes('--write-manifest');

const toRepositoryPath = (file) => path.relative(repositoryRoot, file).split(path.sep).join('/');

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

const rendererTextFiles = collectFiles(rendererRoot, (file) => /\.(?:html|js)$/u.test(file));
const rendererJsFiles = rendererTextFiles.filter((file) => file.endsWith('.js'));
const usage = new Map();

for (const file of rendererTextFiles) {
  const source = readFileSync(file, 'utf8');
  const matches = source.matchAll(/window\.(api|electronAPI)\.([A-Za-z_$][\w$]*)/gu);
  for (const match of matches) {
    const globalName = match[1];
    const method = match[2];
    const key = `${globalName}.${method}`;
    const entry = usage.get(key) ?? {
      global: globalName,
      method,
      callCount: 0,
      files: new Set(),
    };
    entry.callCount += 1;
    entry.files.add(toRepositoryPath(file));
    usage.set(key, entry);
  }
}

const preloadSource = readFileSync(preloadFile, 'utf8');
const exposedMethods = new Map();
const preloadMethodPattern = /^\s{2}([A-Za-z_$][\w$]*)\s*:\s*\(([^)]*)\)\s*=>/gmu;
for (const match of preloadSource.matchAll(preloadMethodPattern)) {
  exposedMethods.set(match[1], match[2].split(',').map((parameter) => parameter.trim()).filter(Boolean));
}

const classifyBusinessArea = (method) => {
  if (/^(?:aiAgent|avis)/u.test(method)) return 'AI Agent / Avis';
  if (/^(?:provider|cloudflare)/u.test(method)) return 'Provider';
  if (/(?:Captcha|Extension)/u.test(method)) return 'CAPTCHA / Extension';
  if (/^(?:workspace|projects|team|createAIAgentStoryProject)/u.test(method)) return 'Workspace';
  if (/(?:Flow|Slot|Auth|Webview|webview|Login|Session|Credits)/u.test(method)) return 'Google Flow / Session';
  if (/(?:Video|video|Image|image|Audio|audio|Media|media|Voice|voice|Tts|tts|Subtitle|Watermark|concat|LipSync|lipSync|Thumbnail|upload|Upload|download|Download)/u.test(method)) {
    return 'Media / Generation';
  }
  if (/(?:File|Folder|Clipboard|External|App|Machine|History|Preset|Settings)/u.test(method)) return 'Desktop / Local utility';
  return 'Other frontend runtime';
};

const methods = [...usage.values()]
  .sort((left, right) => `${left.global}.${left.method}`.localeCompare(`${right.global}.${right.method}`))
  .map((entry) => ({
    global: entry.global,
    method: entry.method,
    businessArea: classifyBusinessArea(entry.method),
    callCount: entry.callCount,
    files: [...entry.files].sort(),
    preload: {
      exposed: entry.global === 'api' && exposedMethods.has(entry.method),
      parameters: entry.global === 'api' ? (exposedMethods.get(entry.method) ?? null) : null,
    },
  }));

const dynamicImports = [];
for (const file of rendererJsFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), specifier.split('?')[0].split('#')[0]);
    dynamicImports.push({
      importer: toRepositoryPath(file),
      specifier,
      target: toRepositoryPath(target),
      exists: (() => {
        try {
          return statSync(target).isFile();
        } catch {
          return false;
        }
      })(),
    });
  }
}
dynamicImports.sort((left, right) => `${left.importer}:${left.specifier}`.localeCompare(`${right.importer}:${right.specifier}`));

const usedApiMethods = new Set(methods.filter((entry) => entry.global === 'api').map((entry) => entry.method));
const missingFromPreloadEntries = methods.filter((entry) => entry.global !== 'api' || !entry.preload.exposed);
const missingFromPreload = missingFromPreloadEntries.map((entry) => `${entry.global}.${entry.method}`);
const missingFromPreloadCallSites = missingFromPreloadEntries.reduce((total, entry) => total + entry.callCount, 0);
const exposedButUnused = [...exposedMethods.keys()].filter((method) => !usedApiMethods.has(method)).sort();
const missingDynamicImports = dynamicImports
  .filter((entry) => !entry.exists)
  .map(({importer, specifier, target}) => ({importer, specifier, target}));

const manifest = {
  schemaVersion: 1,
  baseCommit: '7d89b49fa484135019f08beeb3e0e1e2fc606d16',
  guard: {
    name: 'static frontend IPC surface guard',
    protects: [
      'direct static frontend method-name surface',
      'methods missing from preload baseline',
      'dynamic import target baseline',
    ],
    doesNotProtect: [
      'argument order or count',
      'payload schema',
      'response schema',
      'callback semantics',
      'indirect or aliased API access',
      'backend handler semantics',
    ],
  },
  rendererRoot: toRepositoryPath(rendererRoot),
  preloadFile: toRepositoryPath(preloadFile),
  summary: {
    usedMethods: methods.length,
    usedApiMethods: usedApiMethods.size,
    usedElectronApiMethods: methods.filter((entry) => entry.global === 'electronAPI').length,
    exposedPreloadMethods: exposedMethods.size,
    missingFromPreload: missingFromPreload.length,
    missingFromPreloadDistinctMethodCount: missingFromPreload.length,
    missingFromPreloadCallSiteCount: missingFromPreloadCallSites,
    exposedButUnused: exposedButUnused.length,
    dynamicImports: dynamicImports.length,
    missingDynamicImports: missingDynamicImports.length,
  },
  methods,
  missingFromPreload,
  exposedButUnused,
  dynamicImports: {
    entries: dynamicImports,
    missing: missingDynamicImports,
  },
};

const comparableSnapshot = (value) => ({
  methodKeys: value.methods.map((entry) => `${entry.global}.${entry.method}`),
  missingFromPreload: value.missingFromPreload,
  missingDynamicImports: value.dynamicImports.missing,
});

let baseline;
if (writeManifest) {
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${toRepositoryPath(manifestFile)} with ${methods.length} frontend IPC methods.`);
  baseline = manifest;
} else {
  try {
    baseline = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${toRepositoryPath(manifestFile)}: ${error.message}`);
    console.error('Run: node scripts/check-frontend-contract.mjs --write-manifest');
    process.exit(1);
  }

  if (JSON.stringify(comparableSnapshot(manifest)) !== JSON.stringify(comparableSnapshot(baseline))) {
    console.error('Static frontend IPC surface or lazy-import baseline changed. Review the generated manifest diff explicitly.');
    process.exit(1);
  }
}

const baselineMissingFromPreload = new Set(baseline.missingFromPreload ?? []);
const newMissingFromPreload = missingFromPreload.filter((method) => !baselineMissingFromPreload.has(method));
if (newMissingFromPreload.length > 0) {
  console.error(`New renderer methods missing from preload: ${newMissingFromPreload.join(', ')}`);
  process.exit(1);
}

if (missingFromPreload.length > 0) {
  console.warn(
    `Baseline debt: ${missingFromPreload.length} distinct direct renderer method names across ${missingFromPreloadCallSites} call sites are not exposed by preload.`,
  );
}

console.log(
  `Static frontend IPC surface valid: ${methods.length} distinct direct method names, ${dynamicImports.length} dynamic imports, ${missingDynamicImports.length} baseline-missing import targets.`,
);
