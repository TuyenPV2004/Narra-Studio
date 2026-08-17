import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = path.join(repositoryRoot, 'apps', 'desktop');
const sourceRoot = path.join(desktopRoot, 'src');
const rendererSource = path.join(sourceRoot, 'renderer-source');
const rendererOutput = path.join(desktopRoot, 'dist');
const viteCli = path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const viteConfig = path.join(rendererSource, 'vite.config.mts');

for (const required of [rendererSource, viteCli, viteConfig]) {
  if (!existsSync(required)) throw new Error(`Missing source frontend build input: ${required}`);
}

const build = spawnSync(process.execPath, [viteCli, 'build', '--config', viteConfig, '--configLoader', 'runner'], {
  cwd: repositoryRoot,
  env: {...process.env, NODE_ENV: 'production', NARRA_SOURCE_RUNTIME_OUT_DIR: rendererOutput},
  stdio: 'inherit',
});
if (build.status !== 0) throw new Error(`Source renderer build failed with exit code ${build.status ?? 'unknown'}.`);

for (const name of ['dist-electron', 'config']) {
  const target = path.join(desktopRoot, name);
  if (!target.startsWith(`${desktopRoot}${path.sep}`)) throw new Error(`Unsafe build target: ${target}`);
  rmSync(target, {recursive: true, force: true});
  const source = path.join(sourceRoot, name === 'dist-electron' ? 'electron' : name);
  if (!existsSync(source)) throw new Error(`Missing Narra runtime source payload: ${source}`);
  mkdirSync(path.dirname(target), {recursive: true});
  cpSync(source, target, {recursive: true});
}

console.log('Built Narra desktop from the React/TypeScript source renderer.');
