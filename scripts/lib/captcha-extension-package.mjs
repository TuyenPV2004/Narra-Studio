import {cpSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';

const REQUIRED_FILES = Object.freeze([
  'manifest.json',
  'background.js',
  'protocol.js',
  'page-token.js',
]);

function versionAtLeast(actual, required) {
  const actualParts = String(actual || '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const requiredParts = String(required || '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(actualParts.length, requiredParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (actualParts[index] || 0) - (requiredParts[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function assertSafeDestination({source, destination}) {
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  const destinationRoot = path.parse(resolvedDestination).root;
  const withTrailingSeparator = value => (
    value.endsWith(path.sep) ? value : `${value}${path.sep}`
  );
  const sourcePrefix = withTrailingSeparator(resolvedSource);
  const destinationPrefix = withTrailingSeparator(resolvedDestination);
  if (
    resolvedDestination === destinationRoot
    || resolvedSource === resolvedDestination
    || resolvedSource.startsWith(destinationPrefix)
    || resolvedDestination.startsWith(sourcePrefix)
  ) {
    throw new Error('Unsafe captcha extension destination.');
  }
  return {resolvedSource, resolvedDestination};
}

export function stageCaptchaExtension({source, destination, requiredVersion}) {
  const {resolvedSource, resolvedDestination} = assertSafeDestination({source, destination});
  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(resolvedSource, file))) {
      throw new Error(`Missing captcha extension file: ${file}`);
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(resolvedSource, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error('Missing or invalid captcha extension manifest.');
  }
  if (manifest.manifest_version !== 3 || manifest.name !== 'Narra Captcha Bridge') {
    throw new Error('Invalid Narra Captcha Bridge manifest.');
  }
  if (!versionAtLeast(manifest.version, requiredVersion)) {
    throw new Error(`Captcha extension ${requiredVersion} or newer is required.`);
  }

  rmSync(resolvedDestination, {recursive: true, force: true});
  mkdirSync(path.dirname(resolvedDestination), {recursive: true});
  cpSync(resolvedSource, resolvedDestination, {recursive: true});
  return resolvedDestination;
}
