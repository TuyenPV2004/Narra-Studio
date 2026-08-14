import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {resolveElectronBuilderCli} from './resolve-electron-builder-cli.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builderCli = resolveElectronBuilderCli(repositoryRoot);
const outputDirectory = path.join(repositoryRoot, '.runtime-smoke-build');
const result = spawnSync(process.execPath, [
  builderCli,
  '--projectDir', path.join(repositoryRoot, '.package-stage', 'app'),
  '--config', '../../apps/desktop/electron-builder.yml',
  '--win',
  '--x64',
  '--dir',
  '--publish', 'never',
  `--config.directories.output=${outputDirectory}`,
], {cwd: repositoryRoot, stdio: 'inherit'});

if (result.status !== 0) {
  throw new Error(`Electron smoke package failed with exit code ${result.status ?? 'unknown'}.`);
}

console.log(`Prepared unpacked Electron smoke build at ${outputDirectory}`);
