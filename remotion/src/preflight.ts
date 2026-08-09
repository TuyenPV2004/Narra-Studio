import type {ProjectBundle} from '@narra/contracts';
import {validateSceneShotDurations} from './timeline';

export type FileExists = (projectRelativePath: string) => boolean;

export const validateMediaFiles = (
  bundle: ProjectBundle,
  fileExists: FileExists,
): string[] => {
  const issues = validateSceneShotDurations(bundle);
  const assetsById = new Map(bundle.assets.map((asset) => [asset.id, asset]));

  for (const shot of bundle.shots) {
    if (!shot.assetId) {
      continue;
    }

    const asset = assetsById.get(shot.assetId);
    if (!asset) {
      issues.push(`Shot ${shot.id} references missing asset ${shot.assetId}`);
      continue;
    }

    if (!asset.path) {
      issues.push(`Shot ${shot.id} / asset ${asset.id} has no media path`);
      continue;
    }

    if (!fileExists(asset.path)) {
      issues.push(`Shot ${shot.id} / asset ${asset.id} is missing file ${asset.path}`);
    }
  }

  for (const kind of ['AUDIO', 'CAPTION'] as const) {
    const asset = bundle.assets.find((candidate) => candidate.kind === kind);
    if (!asset?.path) {
      issues.push(`Project ${bundle.project.id} has no ${kind.toLowerCase()} media path`);
    } else if (!fileExists(asset.path)) {
      issues.push(`Asset ${asset.id} is missing file ${asset.path}`);
    }
  }

  return issues;
};

