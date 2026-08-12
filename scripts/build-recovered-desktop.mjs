import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = path.join(repositoryRoot, 'apps', 'desktop');
const sourceRoot = path.join(desktopRoot, 'src');

for (const name of ['dist', 'dist-electron', 'config']) {
  const target = path.join(desktopRoot, name);
  if (!target.startsWith(`${desktopRoot}${path.sep}`)) throw new Error(`Unsafe build target: ${target}`);
  rmSync(target, {recursive: true, force: true});
}

const copies = [
  ['renderer', 'dist'],
  ['electron', 'dist-electron'],
  ['config', 'config'],
];
for (const [sourceName, destinationName] of copies) {
  const source = path.join(sourceRoot, sourceName);
  if (!existsSync(source)) throw new Error(`Missing Narra runtime source payload: ${source}`);
  const destination = path.join(desktopRoot, destinationName);
  mkdirSync(path.dirname(destination), {recursive: true});
  cpSync(source, destination, {recursive: true});
}

console.log('Built Narra desktop from the local runtime source.');
