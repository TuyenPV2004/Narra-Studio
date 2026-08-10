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
    if (asset.status !== 'QA_PASS') {
      issues.push(`Shot ${shot.id} / asset ${asset.id} has not passed QA`);
    }
  }

  if (bundle.narrationSegments.length === 0 || bundle.narrationSegments.some(({audioPath, durationSec}) => !audioPath || !durationSec)) {
    issues.push(`Project ${bundle.project.id} does not have complete narration audio`);
  }
  for (const segment of bundle.narrationSegments) {
    if (segment.audioPath && !fileExists(segment.audioPath)) issues.push(`Narration ${segment.id} is missing file ${segment.audioPath}`);
  }
  if (bundle.captions.length === 0) issues.push(`Project ${bundle.project.id} has no caption cues`);
  const durationMs = bundle.narrationSegments.reduce((total, segment) => total + (segment.durationSec ?? 0), 0) * 1000;
  for (const caption of bundle.captions) {
    if (caption.endMs > durationMs + 50) issues.push(`Caption ${caption.id} extends past narration duration`);
  }
  for (const asset of bundle.assets.filter(({kind}) => kind === 'AUDIO')) {
    if (asset.path && !fileExists(asset.path)) issues.push(`Audio layer ${asset.id} is missing file ${asset.path}`);
  }

  return issues;
};
