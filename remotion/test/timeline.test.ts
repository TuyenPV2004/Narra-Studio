import {ProjectBundleSchema} from '@narra/contracts';
import {describe, expect, it} from 'vitest';
import bundleJson from '../../fixtures/documentary-90s/bundle.json';
import {VIDEO_FPS} from '../src/constants';
import {
  getTotalDurationFrames,
  getTotalDurationSec,
  validateSceneShotDurations,
} from '../src/timeline';

const bundle = ProjectBundleSchema.parse(bundleJson);

describe('documentary timeline', () => {
  it('uses the 90-second narration timeline at 30 fps', () => {
    expect(getTotalDurationSec(bundle.scenes)).toBe(90);
    expect(getTotalDurationFrames(bundle.scenes, VIDEO_FPS)).toBe(2700);
  });

  it('keeps shot durations aligned with their scenes', () => {
    expect(validateSceneShotDurations(bundle)).toEqual([]);
  });
});

