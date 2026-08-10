import type {ProjectBundle} from '@narra/contracts';
import {Audio} from '@remotion/media';
import {AbsoluteFill, Sequence, Series, staticFile, useVideoConfig} from 'remotion';
import {CaptionLayer} from '../overlays/CaptionLayer';
import {AIImageScene} from '../scenes/AIImageScene';
import {AIVideoScene} from '../scenes/AIVideoScene';
import {EvidenceScene} from '../scenes/EvidenceScene';
import {TextDataScene} from '../scenes/TextDataScene';
import {secondsToFrames} from '../timeline';

export type StoryboardPreviewProps = {
  readonly bundle: ProjectBundle;
};

export const getStoryboardDurationFrames = (bundle: ProjectBundle, fps: number): number =>
  bundle.shots.reduce((total, shot) => total + secondsToFrames(shot.durationSec, fps), 0);

export const getMasterDurationFrames = (bundle: ProjectBundle, fps: number): number => {
  const narrationDuration = (bundle.narrationSegments ?? []).reduce((total, segment) => total + (segment.durationSec ?? 0), 0);
  return narrationDuration > 0 ? secondsToFrames(narrationDuration, fps) : getStoryboardDurationFrames(bundle, fps);
};

export const StoryboardPreview = ({bundle}: StoryboardPreviewProps) => {
  const {fps} = useVideoConfig();
  const scenes = new Map(bundle.scenes.map((scene) => [scene.id, scene]));
  const assets = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  const shots = [...bundle.shots].sort((left, right) => {
    const sceneOrder = (scenes.get(left.sceneId)?.order ?? 0) - (scenes.get(right.sceneId)?.order ?? 0);
    return sceneOrder || left.order - right.order;
  });
  const narrationSegments = [...(bundle.narrationSegments ?? [])].sort((left, right) => left.order - right.order);
  const audioLayers = bundle.assets.filter(({kind, path, status, audioRole}) => kind === 'AUDIO' && path && status === 'QA_PASS' && audioRole);
  const shotOffsets = new Map<string, number>();
  let shotOffset = 0;
  for (const shot of shots) {
    shotOffsets.set(shot.id, shotOffset);
    shotOffset += secondsToFrames(shot.durationSec, fps);
  }
  let narrationOffset = 0;
  const captions = (bundle.captions ?? []).map((caption) => ({
    text: caption.text,
    startMs: caption.startMs,
    endMs: caption.endMs,
    timestampMs: null,
    confidence: caption.words?.length
      ? caption.words.reduce((total, word) => total + (word.confidence ?? 1), 0) / caption.words.length
      : null,
  }));

  return (
    <AbsoluteFill style={{backgroundColor: '#070b12'}}>
      <Series>
        {shots.map((shot) => {
          const scene = scenes.get(shot.sceneId);
          const asset = shot.assetId ? assets.get(shot.assetId) : undefined;
          const renderableAsset = asset?.status === 'QA_PASS' && asset.path ? asset : undefined;
          if (!scene) return null;

          return (
            <Series.Sequence key={shot.id} durationInFrames={secondsToFrames(shot.durationSec, fps)}>
              {renderableAsset?.kind === 'IMAGE' && renderableAsset.path ? <AIImageScene scene={scene} imagePath={renderableAsset.path} /> : null}
              {renderableAsset?.kind === 'VIDEO' && renderableAsset.path ? <AIVideoScene scene={scene} videoPath={renderableAsset.path} sourceAudioMode={shot.sourceAudioMode} sourceAudioVolume={shot.sourceAudioVolume} /> : null}
              {shot.visualType === 'CHART' || shot.visualType === 'MAP' || shot.visualType === 'TEXT' ? <TextDataScene scene={scene} /> : null}
              {shot.visualType === 'EVIDENCE' ? <EvidenceScene source={bundle.sources[0]} /> : null}
              {!renderableAsset && !['CHART', 'MAP', 'TEXT', 'EVIDENCE'].includes(shot.visualType) ? (
                <AbsoluteFill style={{display: 'grid', placeItems: 'center', color: '#91a0b5', fontFamily: 'Arial, sans-serif'}}>
                  <div style={{textAlign: 'center'}}>
                    <div style={{fontSize: 26, fontWeight: 700, letterSpacing: 4}}>ASSET NOT QA APPROVED</div>
                    <div style={{marginTop: 18, maxWidth: 900, fontSize: 42, color: '#f2f5fa'}}>{shot.visualPurpose}</div>
                  </div>
                </AbsoluteFill>
              ) : null}
            </Series.Sequence>
          );
        })}
      </Series>
      {narrationSegments.map((segment) => {
        const from = narrationOffset;
        const durationInFrames = secondsToFrames(segment.durationSec ?? 0, fps);
        narrationOffset += durationInFrames;
        return segment.audioPath && durationInFrames > 0 ? (
          <Sequence key={segment.id} from={from} durationInFrames={durationInFrames} name={segment.id}>
            <Audio src={staticFile(segment.audioPath)} />
          </Sequence>
        ) : null;
      })}
      {audioLayers.map((asset) => {
        if (!asset.path) return null;
        const from = asset.audioRole === 'SFX' ? (shotOffsets.get(asset.shotId) ?? 0) : 0;
        const durationInFrames = asset.audioRole === 'SFX'
          ? secondsToFrames(asset.metadata?.durationSec ?? 1, fps)
          : getMasterDurationFrames(bundle, fps);
        const baseVolume = asset.volume ?? (asset.audioRole === 'MUSIC' ? 0.12 : 0.35);
        const volume = asset.duckUnderNarration ? Math.min(baseVolume, 0.08) : baseVolume;
        return (
          <Sequence key={asset.id} from={from} durationInFrames={Math.max(1, durationInFrames)} name={`${asset.audioRole}-${asset.id}`}>
            <Audio src={staticFile(asset.path)} volume={volume} loop={asset.audioRole === 'MUSIC'} />
          </Sequence>
        );
      })}
      {captions.length > 0 ? <CaptionLayer captions={captions} /> : null}
    </AbsoluteFill>
  );
};
