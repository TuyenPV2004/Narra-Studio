import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'ui');
const preloadFile = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'electron', 'preload.js');
const manifestFile = path.join(repositoryRoot, 'docs', 'frontend-ipc-usage-manifest.json');
const writeManifest = process.argv.includes('--write-manifest');
const toRepositoryPath = (file) => path.relative(repositoryRoot, file).split(path.sep).join('/');
const collectFiles = (root, predicate) => {
  const files = [];
  const visit = (entry) => {
    if (statSync(entry).isDirectory()) for (const child of readdirSync(entry)) visit(path.join(entry, child));
    else if (predicate(entry)) files.push(entry);
  };
  visit(root);
  return files.sort();
};

const rendererFiles = collectFiles(rendererRoot, (file) => /\.(?:ts|tsx)$/u.test(file));
const usage = new Map();
const dynamicImports = [];
for (const file of rendererFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/getElectronApi\(\)\s*\.\s*([A-Za-z_$][\w$]*)/gu)) {
    const method = match[1];
    const entry = usage.get(method) ?? {method, callCount: 0, files: new Set()};
    entry.callCount += 1;
    entry.files.add(toRepositoryPath(file));
    usage.set(method, entry);
  }
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/gu)) {
    const specifier = match[1];
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
    const unresolved = specifier.startsWith('@/') ? path.join(rendererRoot, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
    const candidates = [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, path.join(unresolved, 'index.ts'), path.join(unresolved, 'index.tsx')];
    const target = candidates.find((candidate) => { try { return statSync(candidate).isFile(); } catch { return false; } });
    dynamicImports.push({importer: toRepositoryPath(file), specifier, target: target ? toRepositoryPath(target) : toRepositoryPath(unresolved), exists: Boolean(target)});
  }
}

const preloadSource = readFileSync(preloadFile, 'utf8');
const exposedMethods = new Map();
for (const match of preloadSource.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:\s*\(([^)]*)\)\s*=>/gmu)) {
  exposedMethods.set(match[1], match[2].split(',').map((parameter) => parameter.trim()).filter(Boolean));
}
const classifyBusinessArea = (method) => {
  if (/^aiAgent/u.test(method)) return 'AI Agent';
  if (/^(?:provider|cloudflare)/u.test(method)) return 'Provider';
  if (/(?:Captcha|Extension)/u.test(method)) return 'CAPTCHA / Extension';
  if (/^(?:workspace|projects|team|createAIAgentStoryProject)/u.test(method)) return 'Workspace';
  if (/(?:Flow|Slot|Auth|Webview|webview|Login|Session|Credits)/u.test(method)) return 'Google Flow / Session';
  if (/(?:Video|video|Image|image|Audio|audio|Media|media|Voice|voice|Tts|tts|Subtitle|Watermark|concat|LipSync|Thumbnail|upload|Upload|download|Download)/u.test(method)) return 'Media / Generation';
  if (/(?:File|Folder|Clipboard|External|App|Machine|History|Preset|Settings)/u.test(method)) return 'Desktop / Local utility';
  return 'Other frontend runtime';
};
const methods = [...usage.values()].sort((left, right) => left.method.localeCompare(right.method)).map((entry) => ({
  global: 'api', method: entry.method, businessArea: classifyBusinessArea(entry.method), callCount: entry.callCount,
  files: [...entry.files].sort(), preload: {exposed: exposedMethods.has(entry.method), parameters: exposedMethods.get(entry.method) ?? null},
}));
const usedApiMethods = new Set(methods.map((entry) => entry.method));
const missingEntries = methods.filter((entry) => !entry.preload.exposed);
const missingFromPreload = missingEntries.map((entry) => `api.${entry.method}`);
const missingFromPreloadCallSites = missingEntries.reduce((total, entry) => total + entry.callCount, 0);
const exposedButUnused = [...exposedMethods.keys()].filter((method) => !usedApiMethods.has(method)).sort();
dynamicImports.sort((left, right) => `${left.importer}:${left.specifier}`.localeCompare(`${right.importer}:${right.specifier}`));
const missingDynamicImports = dynamicImports.filter((entry) => !entry.exists);
const manifest = {
  schemaVersion: 2,
  guard: {
    name: 'static frontend IPC surface guard',
    protects: ['direct static frontend adapter method-name surface', 'methods missing from preload baseline', 'static dynamic import target baseline'],
    doesNotProtect: ['argument order or count', 'payload schema', 'response schema', 'callback semantics', 'indirect or aliased API access', 'backend handler semantics'],
  },
  rendererRoot: toRepositoryPath(rendererRoot), preloadFile: toRepositoryPath(preloadFile),
  summary: {usedMethods: methods.length, usedApiMethods: usedApiMethods.size, usedElectronApiMethods: 0, exposedPreloadMethods: exposedMethods.size,
    missingFromPreload: missingFromPreload.length, missingFromPreloadDistinctMethodCount: missingFromPreload.length,
    missingFromPreloadCallSiteCount: missingFromPreloadCallSites, exposedButUnused: exposedButUnused.length, dynamicImports: dynamicImports.length, missingDynamicImports: missingDynamicImports.length},
  methods, missingFromPreload, exposedButUnused, dynamicImports: {entries: dynamicImports, missing: missingDynamicImports},
};
const comparableSnapshot = (value) => ({methodKeys: value.methods.map((entry) => `${entry.global}.${entry.method}`), missingFromPreload: value.missingFromPreload, missingDynamicImports: value.dynamicImports.missing});
if (writeManifest) {
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${toRepositoryPath(manifestFile)} with ${methods.length} source frontend IPC methods.`);
} else {
  let baseline;
  try { baseline = JSON.parse(readFileSync(manifestFile, 'utf8')); }
  catch (error) { console.error(`Cannot read ${toRepositoryPath(manifestFile)}: ${error.message}`); process.exit(1); }
  if (JSON.stringify(comparableSnapshot(manifest)) !== JSON.stringify(comparableSnapshot(baseline))) {
    console.error('Static source frontend IPC surface changed. Review and regenerate the manifest explicitly.');
    process.exit(1);
  }
}
if (missingFromPreload.length) { console.error(`Source frontend methods missing from preload: ${missingFromPreload.join(', ')}`); process.exit(1); }
if (missingDynamicImports.length) { console.error(`Missing source dynamic import targets: ${missingDynamicImports.map((entry) => `${entry.importer} -> ${entry.specifier}`).join(', ')}`); process.exit(1); }
console.log(`Static source frontend IPC surface valid: ${methods.length} distinct direct adapter method names; all are exposed by preload; ${dynamicImports.length} dynamic imports validated.`);
