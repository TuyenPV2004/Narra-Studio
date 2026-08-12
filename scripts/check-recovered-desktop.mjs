import {readFileSync, readdirSync, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronRoot = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'electron');
const electronFiles = [];
const visit = (entry) => {
  if (statSync(entry).isDirectory()) {
    for (const child of readdirSync(entry)) visit(path.join(entry, child));
  } else if (entry.endsWith('.js')) {
    electronFiles.push(entry);
  }
};
visit(electronRoot);

for (const file of electronFiles) {
  const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
const rendererEntry = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'renderer', 'assets', 'index-JlIFz2Wa.js');
const rendererCheck = spawnSync(process.execPath, ['--check', '--input-type=module'], {
  input: readFileSync(rendererEntry),
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (rendererCheck.status !== 0) process.exit(rendererCheck.status || 1);
console.log(`Syntax checked ${electronFiles.length} Electron files and the recovered renderer entry.`);
