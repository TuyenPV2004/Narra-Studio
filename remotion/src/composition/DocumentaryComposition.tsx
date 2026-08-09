import {ProjectBundleSchema} from '@narra/contracts';
import type {Caption} from '@remotion/captions';
import {Audio} from '@remotion/media';
import {AbsoluteFill, Series, staticFile, useVideoConfig} from 'remotion';
import bundleJson from '../../../fixtures/documentary-90s/bundle.json';
import captionJson from '../../../fixtures/documentary-90s/captions/captions.json';
import {CaptionLayer} from '../overlays/CaptionLayer';
import {AIVideoScene} from '../scenes/AIVideoScene';
import {AIImageScene} from '../scenes/AIImageScene';
import {EvidenceScene} from '../scenes/EvidenceScene';
import {TextDataScene} from '../scenes/TextDataScene';
import {secondsToFrames} from '../timeline';

const fixtureBundle = ProjectBundleSchema.parse(bundleJson);

export const DocumentaryComposition = () => {
  const {fps} = useVideoConfig();
  const bundle = fixtureBundle;
  const scenes = [...bundle.scenes].sort((left, right) => left.order - right.order);
  const assetsById = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  const shotsByScene = new Map(
    scenes.map((scene) => [
      scene.id,
      bundle.shots
        .filter(({sceneId}) => sceneId === scene.id)
        .sort((left, right) => left.order - right.order),
    ]),
  );
  const narration = bundle.assets.find(({kind}) => kind === 'AUDIO');

  if (!narration?.path) {
    throw new Error(`Project ${bundle.project.id} has no narration path`);
  }

  return (
    <AbsoluteFill style={{backgroundColor: '#070b12'}}>
      <Series>
        {scenes.map((scene, sceneIndex) => {
          const shot = shotsByScene.get(scene.id)?.[0];
          const asset = shot?.assetId ? assetsById.get(shot.assetId) : undefined;
          const durationInFrames = secondsToFrames(scene.durationSec, fps);

          return (
            <Series.Sequence key={scene.id} durationInFrames={durationInFrames}>
              {shot?.visualType === 'AI_IMAGE' && asset?.path ? (
                <AIImageScene scene={scene} imagePath={asset.path} />
              ) : null}
              {shot?.visualType === 'AI_VIDEO' && asset?.path ? (
                <AIVideoScene scene={scene} videoPath={asset.path} />
              ) : null}
              {shot?.visualType === 'CHART' || shot?.visualType === 'TEXT' ? (
                <TextDataScene scene={scene} />
              ) : null}
              {sceneIndex === scenes.length - 1 ? (
                <EvidenceScene source={bundle.sources[0]} />
              ) : null}
            </Series.Sequence>
          );
        })}
      </Series>

      <Audio src={staticFile(narration.path)} volume={1} />
      <Audio src={staticFile('audio/music/music-bed.wav')} volume={0.035} />
      <CaptionLayer captions={captionJson as Caption[]} />
    </AbsoluteFill>
  );
};
