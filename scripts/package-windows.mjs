import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {resolveElectronBuilderCli} from './resolve-electron-builder-cli.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builderCli = resolveElectronBuilderCli(repositoryRoot);
const builderArgs = [
  builderCli,
  '--projectDir', path.join(repositoryRoot, '.package-stage', 'app'),
  '--config', '../../apps/desktop/electron-builder.yml',
  '--win', 'portable', '--x64', '--publish', 'never',
];
if (process.env.NARRA_RELEASE_DIR) {
  builderArgs.push(`--config.directories.output=${path.resolve(repositoryRoot, process.env.NARRA_RELEASE_DIR)}`);
}
const result = spawnSync(process.execPath, builderArgs, {cwd: repositoryRoot, stdio: 'inherit'});

if (result.status !== 0) throw new Error(`Windows package failed with exit code ${result.status ?? 'unknown'}.`);
