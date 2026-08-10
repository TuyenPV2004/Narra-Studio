import type {FlowPromptPackage, Project, Scene, Shot} from '@narra/contracts';

export type FlowPromptInput = {
  project: Project;
  scene: Scene;
  shot: Shot;
  version: number;
  imageModel?: string;
  videoModel?: string;
};

export interface MediaPromptProvider {
  readonly id: 'GOOGLE_FLOW';
  createPromptPackage(input: FlowPromptInput): FlowPromptPackage;
}

const supportedDuration = (durationSec: number): 4 | 6 | 8 => {
  if (durationSec <= 5) return 4;
  if (durationSec <= 7) return 6;
  return 8;
};

export class FlowAssistedProvider implements MediaPromptProvider {
  readonly id = 'GOOGLE_FLOW' as const;

  createPromptPackage({project, scene, shot, version, imageModel, videoModel}: FlowPromptInput): FlowPromptPackage {
    const createdAt = new Date().toISOString();
    const aspectRatio = project.aspectRatio;
    const durationSec = supportedDuration(shot.durationSec);
    const evidenceNote = shot.evidenceRequired
      ? 'This is an illustrative reconstruction only; do not imitate a real document, news frame, or photographic proof.'
      : 'Keep the result documentary in tone without claiming it is archival evidence.';
    const visualCore = [
      `Subject and purpose: ${shot.visualPurpose}.`,
      `Scene context: ${scene.title}.`,
      `Composition: ${aspectRatio}, editorial documentary frame, natural visual hierarchy, no embedded captions.`,
      evidenceNote,
    ].join(' ');
    const imagePrompt = [
      visualCore,
      'Create a production-ready still with believable lighting, coherent scale, restrained color, and space for optional captions added later in Narra.',
    ].join(' ');
    const videoPrompt = [
      visualCore,
      `Create a ${durationSec}-second continuous shot. Describe one clear subject action, stable environment, motivated camera movement, realistic motion, and consistent lighting from first frame to last.`,
      shot.durationSec > 8 ? `This clip covers the first ${durationSec} seconds of a ${shot.durationSec}-second Narra shot; keep the ending suitable for a clean follow-on clip.` : '',
    ].filter(Boolean).join(' ');
    const negativeGuidance = [
      'No watermark, logo, subtitles, UI chrome, illegible text, duplicated subjects, warped anatomy, abrupt morphing, random camera shake, or fabricated evidence.',
      shot.evidenceRequired ? 'Do not recreate official seals, source documents, charts, or quoted text.' : '',
    ].filter(Boolean).join(' ');

    return {
      version,
      shotToken: `flow-${shot.id}-v${version}`,
      imageModel: imageModel?.trim() || 'Nano Banana 2',
      videoModel: videoModel?.trim() || 'Veo 3.1 Lite',
      imagePrompt,
      videoPrompt,
      negativeGuidance,
      aspectRatio,
      generationDurationSec: durationSec,
      ingredients: [...new Set([...(shot.claimIds ?? []).map((id) => `claim:${id}`), `scene:${scene.id}`])],
      createdAt,
    };
  }
}
