import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {ProjectBundleSchema} from '../src/schemas';

const loadJson = async (relativePath: string): Promise<unknown> => {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
};

describe('ProjectBundleSchema', () => {
  it('accepts the valid 90-second documentary fixture', async () => {
    const fixture = await loadJson('../../../fixtures/documentary-90s/bundle.json');
    expect(ProjectBundleSchema.safeParse(fixture).success).toBe(true);
  });

  it('rejects a bundle with broken provenance', async () => {
    const fixture = await loadJson('../../../fixtures/invalid/broken-provenance.json');
    const result = ProjectBundleSchema.safeParse(fixture);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(({message}) => message.includes('unknown source'))).toBe(true);
    }
  });

  it('rejects narration segments that reference an unknown scene', async () => {
    const fixture = await loadJson('../../../fixtures/documentary-90s/bundle.json') as {
      narrationSegments: Array<{sceneId: string}>;
    };
    if (fixture.narrationSegments[0]) fixture.narrationSegments[0].sceneId = 'scene-missing';
    const result = ProjectBundleSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(({message}) => message.includes('unknown scene'))).toBe(true);
    }
  });
});
