import {readFileSync, readdirSync, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'electron');
const rendererOutput = path.join(repositoryRoot, 'apps', 'desktop', 'dist');
const collect = (root, extension) => {
  const files = [];
  const visit = (entry) => {
    if (statSync(entry).isDirectory()) for (const child of readdirSync(entry)) visit(path.join(entry, child));
    else if (entry.endsWith(extension)) files.push(entry);
  };
  visit(root);
  return files;
};

const electronFiles = collect(electronRoot, '.js');
for (const file of electronFiles) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}

let rendererFiles = [];
try { rendererFiles = collect(rendererOutput, '.js'); } catch {}
for (const file of rendererFiles) {
  const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {input: readFileSync(file), stdio: ['pipe', 'inherit', 'inherit']});
  if (result.status !== 0) process.exit(result.status || 1);
}

const require = createRequire(import.meta.url);
require(path.join(electronRoot, 'ipc', 'media', 'voice-cache.js'));
console.log(`Syntax checked ${electronFiles.length} Electron files, ${rendererFiles.length} source-built renderer chunks, and startup-loaded voice cache.`);
