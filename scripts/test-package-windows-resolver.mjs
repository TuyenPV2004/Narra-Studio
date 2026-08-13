import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';

import {resolveElectronBuilderCli} from './resolve-electron-builder-cli.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const builderCli = resolveElectronBuilderCli(repositoryRoot);

assert.equal(existsSync(builderCli), true, 'electron-builder CLI must resolve to an existing file');
assert.equal(
  builderCli.endsWith(path.join('electron-builder', 'cli.js')),
  true,
  'resolved file must be electron-builder/cli.js',
);

console.log('Windows package CLI resolution test passed.');
