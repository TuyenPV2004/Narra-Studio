import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRequire = createRequire(path.join(repositoryRoot, 'apps', 'desktop', 'package.json'));
const builderCli = desktopRequire.resolve('electron-builder/cli.js');
const result = spawnSync(process.execPath, [
  builderCli,
  '--projectDir', path.join(repositoryRoot, '.package-stage', 'app'),
  '--config', '../../apps/desktop/electron-builder.yml',
  '--win', 'portable', '--x64', '--publish', 'never',
], {cwd: repositoryRoot, stdio: 'inherit'});

if (result.status !== 0) throw new Error(`Windows package failed with exit code ${result.status ?? 'unknown'}.`);
