import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeScript = path.join(repositoryRoot, 'scripts', 'smoke-source-electron-ui.mjs');
const productionRuntime = process.argv.includes('--production');
const pages = ['provider-account', 'settings', 'captcha-setup', 'image-ultra', 'image-editor', 'video-pro', 'voice',
  'upload', 'video-editor', 'capcut-video', 'concat', 'webview', 'dashboard', 'guide', 'ai-agent'];

for (const page of pages) {
  console.log(`\n[source smoke] ${page}`);
  const result = spawnSync(process.execPath, [smokeScript, `--page=${page}`, ...(productionRuntime ? ['--production'] : [])], {cwd: repositoryRoot, stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Source Electron smoke passed for ${pages.length} routes.`);
