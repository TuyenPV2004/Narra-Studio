import {ProjectBundleSchema} from '@narra/contracts';
import {describe, expect, it} from 'vitest';
import bundleJson from '../../fixtures/documentary-90s/bundle.json';
import {validateMediaFiles} from '../src/preflight';

const bundle = ProjectBundleSchema.parse(bundleJson);
const fixturePaths = new Set(
  bundle.assets.flatMap((asset) => (asset.path ? [asset.path] : [])),
);

describe('render preflight', () => {
  it('accepts a complete fixture media set', () => {
    expect(validateMediaFiles(bundle, (path) => fixturePaths.has(path))).toEqual([]);
  });

  it('reports the exact shot and asset when a video is missing', () => {
    const issues = validateMediaFiles(
      bundle,
      (path) => path !== 'assets/videos/power-flow-placeholder.mp4',
    );

    expect(issues).toContain(
      'Shot shot-power-flow / asset asset-power-flow-video is missing file assets/videos/power-flow-placeholder.mp4',
    );
  });
});

