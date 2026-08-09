import type {ProjectBundle} from '@narra/contracts';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

interface EvidenceSceneProps {
  readonly source: ProjectBundle['sources'][number] | undefined;
}

export const EvidenceScene = ({source}: EvidenceSceneProps) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  if (!source) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 100,
        top: 140,
        width: 620,
        padding: '28px 32px',
        border: '1px solid rgba(150, 183, 235, 0.35)',
        borderRadius: 18,
        backgroundColor: 'rgba(8, 18, 31, 0.92)',
        color: '#eef4ff',
        fontFamily: 'Arial, sans-serif',
        opacity: interpolate(frame, [2 * fps, 3 * fps], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        translate: `0 ${interpolate(frame, [2 * fps, 3 * fps], [18, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })}px`,
      }}
    >
      <div style={{color: '#78a7ff', fontSize: 20, fontWeight: 700, letterSpacing: 3}}>SOURCE</div>
      <div style={{marginTop: 12, fontSize: 30, fontWeight: 700, lineHeight: 1.25}}>{source.title}</div>
      <div style={{marginTop: 10, color: '#9eabbc', fontSize: 22}}>{source.publisher}</div>
    </div>
  );
};
