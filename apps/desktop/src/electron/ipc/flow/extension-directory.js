'use strict';

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

function findExtensionDirectory({fs, path, candidates, requiredVersion}) {
  for (const candidate of candidates) {
    try {
      const directory = path.resolve(candidate);
      if (!fs.statSync(directory).isDirectory()) continue;
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      if (manifest.manifest_version !== 3) continue;
      if (manifest.name !== 'Narra Captcha Bridge') continue;
      if (!versionAtLeast(manifest.version, requiredVersion)) continue;
      return directory;
    } catch {
    }
  }
  return null;
}

module.exports = {findExtensionDirectory, versionAtLeast};
