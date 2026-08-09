import type {ProjectBundle} from '@narra/contracts';

export const secondsToFrames = (seconds: number, fps: number): number =>
  Math.round(seconds * fps);

export const getTotalDurationSec = (scenes: ProjectBundle['scenes']): number =>
  scenes.reduce((total, scene) => total + scene.durationSec, 0);

export const getTotalDurationFrames = (
  scenes: ProjectBundle['scenes'],
  fps: number,
): number => secondsToFrames(getTotalDurationSec(scenes), fps);

export const validateSceneShotDurations = (bundle: ProjectBundle): string[] => {
  const issues: string[] = [];

  for (const scene of bundle.scenes) {
    const shotDuration = bundle.shots
      .filter(({sceneId}) => sceneId === scene.id)
      .reduce((total, shot) => total + shot.durationSec, 0);

    if (Math.abs(shotDuration - scene.durationSec) > 0.001) {
      issues.push(
        `Scene ${scene.id} lasts ${scene.durationSec}s but its shots total ${shotDuration}s`,
      );
    }
  }

  return issues;
};

