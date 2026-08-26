import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteCli = path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const viteConfig = path.join(repositoryRoot, 'apps', 'desktop', 'src', 'ui', 'vite.config.mts');
const build = spawnSync(process.execPath, [viteCli, 'build', '--config', viteConfig, '--configLoader', 'runner'], {
  cwd: repositoryRoot,
  env: {...process.env, NODE_ENV: 'production'},
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);
