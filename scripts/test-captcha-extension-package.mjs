import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as packageTools from './lib/captcha-extension-package.mjs';

const {stageCaptchaExtension} = packageTools;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'narra-extension-package-'));
const source = path.join(repositoryRoot, 'apps', 'desktop', 'captcha-extension');
const missingSource = path.join(temporary, 'missing');
const destination = path.join(temporary, 'staged', 'captcha-extension');

try {
  assert.throws(
    () => packageTools.assertSafeDestination({source, destination: path.parse(source).root}),
    /Unsafe captcha extension destination/,
  );
  assert.throws(
    () => packageTools.assertSafeDestination({source, destination: path.join(source, 'staged')}),
    /Unsafe captcha extension destination/,
  );
  assert.throws(
    () => stageCaptchaExtension({source: missingSource, destination, requiredVersion: '1.3.1'}),
    /missing/i,
  );
  stageCaptchaExtension({source, destination, requiredVersion: '1.3.1'});
  assert.equal(
    JSON.parse(readFileSync(path.join(destination, 'manifest.json'), 'utf8')).version,
    '1.3.1',
  );
  for (const file of ['background.js', 'protocol.js', 'page-token.js']) {
    assert.equal(existsSync(path.join(destination, file)), true, `staged ${file}`);
  }

  const builderConfig = readFileSync(
    path.join(repositoryRoot, 'apps', 'desktop', 'electron-builder.yml'),
    'utf8',
  );
  assert.match(
    builderConfig,
    /extraResources:\s*[\s\S]*from:\s*captcha-extension\s*[\s\S]*to:\s*captcha-extension/,
  );
} finally {
  rmSync(temporary, {recursive: true, force: true});
}

console.log('Captcha extension package staging tests passed.');
