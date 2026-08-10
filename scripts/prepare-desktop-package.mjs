/* global console, process */
import {spawnSync} from 'node:child_process';
import {cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagingRoot = path.join(repositoryRoot, '.package-stage');
const appRoot = path.join(stagingRoot, 'app');
const runtimeRoot = path.join(stagingRoot, 'narra-runtime', 'remotion');
if (!stagingRoot.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error('Package staging directory escaped the repository.');

const rewriteRuntimeSymlinks = (directory, temporaryRuntime) => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const destinationPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const temporaryTarget = path.resolve(path.dirname(destinationPath), readlinkSync(destinationPath));
      const sourcePackageRoot = path.join(repositoryRoot, 'remotion');
      if (temporaryTarget === sourcePackageRoot) {
        // pnpm adds a package self-link. Keeping it would create a directory
        // cycle for NSIS/7-Zip while it walks extraResources.
        unlinkSync(destinationPath);
        continue;
      }
      const relativeToTemporaryRuntime = path.relative(temporaryRuntime, temporaryTarget);
      const packagedTarget = path.join(runtimeRoot, relativeToTemporaryRuntime);
      if (relativeToTemporaryRuntime.startsWith('..') || path.isAbsolute(relativeToTemporaryRuntime)) {
        throw new Error(`Deployed dependency link escapes the temporary runtime: ${destinationPath}`);
      }
      const relativePackagedTarget = path.relative(path.dirname(destinationPath), packagedTarget);
      const linkType = lstatSync(temporaryTarget).isDirectory() ? 'dir' : 'file';
      unlinkSync(destinationPath);
      symlinkSync(relativePackagedTarget, destinationPath, linkType);
      continue;
    }
    if (entry.isDirectory()) rewriteRuntimeSymlinks(destinationPath, temporaryRuntime);
  }
};

rmSync(stagingRoot, {recursive: true, force: true});
mkdirSync(path.join(appRoot, 'dist-electron'), {recursive: true});
cpSync(path.join(repositoryRoot, 'apps/desktop/dist'), path.join(appRoot, 'dist'), {recursive: true});
cpSync(path.join(repositoryRoot, 'apps/desktop/dist-electron/preload.cjs'), path.join(appRoot, 'dist-electron/preload.cjs'));

const esbuild = spawnSync(path.join(repositoryRoot, 'node_modules/.bin/esbuild.cmd'), [
  path.join(repositoryRoot, 'apps/desktop/dist-electron/main.js'),
  '--bundle', '--platform=node', '--format=esm', '--target=node24', '--external:electron',
  `--outfile=${path.join(appRoot, 'dist-electron/main.js')}`,
], {cwd: repositoryRoot, stdio: 'inherit', shell: process.platform === 'win32'});
if (esbuild.status !== 0) throw new Error(`Electron main bundle failed with exit code ${esbuild.status ?? 'unknown'}.`);

writeFileSync(path.join(appRoot, 'package.json'), `${JSON.stringify({
  name: 'narra-studio',
  productName: 'Narra Studio',
  version: '0.1.0',
  private: true,
  type: 'module',
  main: 'dist-electron/main.js',
}, null, 2)}\n`, 'utf8');

const pnpmCli = process.env.npm_execpath;
const runPnpm = (args, options = {}) => spawnSync(pnpmCli ? process.execPath : 'pnpm.cmd', pnpmCli ? [pnpmCli, ...args] : args, {
  cwd: repositoryRoot,
  stdio: 'inherit',
  env: {...process.env, CI: 'true'},
  shell: !pnpmCli && process.platform === 'win32',
  ...options,
});
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'narra-package-remotion-'));
const temporaryRuntime = path.join(temporaryRoot, 'remotion');
let deploymentError;
try {
  const deployArgs = ['--config.node-linker=hoisted', '--filter', '@narra/render', 'deploy', '--prod', temporaryRuntime, '--legacy'];
  const deploy = runPnpm(deployArgs);
  if (deploy.status !== 0) throw new Error(`Remotion runtime deploy failed with exit code ${deploy.status ?? 'unknown'}.`);
  cpSync(temporaryRuntime, runtimeRoot, {recursive: true});
  rewriteRuntimeSymlinks(runtimeRoot, temporaryRuntime);
} catch (error) {
  deploymentError = error;
} finally {
  rmSync(temporaryRoot, {recursive: true, force: true});
}
const restore = runPnpm(['install', '--offline', '--frozen-lockfile']);
if (restore.status !== 0) throw new Error(`Workspace dependency restore failed with exit code ${restore.status ?? 'unknown'}.`);
if (deploymentError) throw deploymentError;

console.log(`Prepared desktop package at ${appRoot}`);
