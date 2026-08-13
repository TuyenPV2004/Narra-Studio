import {existsSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

export function resolveElectronBuilderCli(repositoryRoot) {
  const packageFiles = [
    path.join(repositoryRoot, 'apps', 'desktop', 'package.json'),
    path.join(repositoryRoot, 'package.json'),
  ];

  for (const packageFile of packageFiles) {
    try {
      return createRequire(packageFile).resolve('electron-builder/cli.js');
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }

  const virtualStore = path.join(repositoryRoot, 'node_modules', '.pnpm');
  if (existsSync(virtualStore)) {
    const installedPackages = readdirSync(virtualStore, {withFileTypes: true})
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('electron-builder@'))
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const installedPackage of installedPackages) {
      const candidate = path.join(
        virtualStore,
        installedPackage,
        'node_modules',
        'electron-builder',
        'cli.js',
      );
      if (existsSync(candidate)) return candidate;
    }
  }

  throw new Error(
    'Cannot resolve electron-builder/cli.js. Restore workspace devDependencies before packaging.',
  );
}
