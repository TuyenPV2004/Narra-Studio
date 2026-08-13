/* global console, process */
import {cpSync, existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageCaptchaExtension} from './lib/captcha-extension-package.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = path.join(repositoryRoot, 'apps', 'desktop');
const stagingRoot = path.join(repositoryRoot, '.package-stage');
const appRoot = path.join(stagingRoot, 'app');
if (!stagingRoot.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error('Package staging escaped the repository.');

for (const required of ['dist', 'dist-electron', 'config']) {
  if (!existsSync(path.join(desktopRoot, required))) throw new Error(`Run the desktop build first; missing ${required}.`);
}

rmSync(stagingRoot, {recursive: true, force: true});
mkdirSync(stagingRoot, {recursive: true});
const pnpmCli = process.env.NARRA_PNPM_CLI || process.env.npm_execpath || 'pnpm.cmd';
const args = ['--filter', '@narra/desktop', 'deploy', appRoot, '--prod', '--legacy'];
const deploy = process.env.NARRA_PNPM_CLI || process.env.npm_execpath
  ? spawnSync(process.execPath, [pnpmCli, ...args], {cwd: repositoryRoot, stdio: 'inherit'})
  : spawnSync(pnpmCli, args, {cwd: repositoryRoot, stdio: 'inherit', shell: process.platform === 'win32'});
if (deploy.status !== 0) throw new Error(`Desktop runtime deploy failed with exit code ${deploy.status ?? 'unknown'}.`);

for (const name of ['dist', 'dist-electron', 'config']) {
  const destination = path.join(appRoot, name);
  rmSync(destination, {recursive: true, force: true});
  cpSync(path.join(desktopRoot, name), destination, {recursive: true});
}

stageCaptchaExtension({
  source: path.join(desktopRoot, 'captcha-extension'),
  destination: path.join(appRoot, 'captcha-extension'),
  requiredVersion: '1.3.1',
});

writeFileSync(path.join(appRoot, 'package.json'), `${JSON.stringify({
  name: 'narra-studio',
  productName: 'Narra Studio',
  version: '0.1.0',
  private: true,
  main: 'dist-electron/main.js',
  dependencies: {
    '@huggingface/transformers': '^3.8.1',
    aws4: '^1.13.2',
    'demucs-web': '^1.0.2',
    'ffmpeg-static': '^5.3.0',
    'onnxruntime-web': '^1.27.0',
  },
}, null, 2)}\n`, 'utf8');

console.log(`Prepared recovered Narra desktop package at ${appRoot}`);
