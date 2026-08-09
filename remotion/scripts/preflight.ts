import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectBundleSchema} from '@narra/contracts';
import {validateMediaFiles} from '../src/preflight';

const remotionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.resolve(remotionRoot, '../fixtures/documentary-90s');
const bundlePath = path.join(fixtureRoot, 'bundle.json');
const bundle = ProjectBundleSchema.parse(
  JSON.parse(readFileSync(bundlePath, 'utf8')) as unknown,
);
const issues = validateMediaFiles(bundle, (relativePath) =>
  existsSync(path.join(fixtureRoot, relativePath)),
);

if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`PRECHECK: ${issue}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Preflight passed for ${bundle.project.id}`);
}

