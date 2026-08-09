import type {ProjectBundle} from '@narra/contracts';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

interface TextDataSceneProps {
  readonly scene: ProjectBundle['scenes'][number];
}

const bars = [42, 58, 76, 94];

export const TextDataScene = ({scene}: TextDataSceneProps) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: '#09111d', padding: '110px 120px'}}>
      <div style={{color: '#74a5ff', fontFamily: 'Arial, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: 5}}>
        INFRASTRUCTURE CONSTRAINT
      </div>
      <div style={{marginTop: 22, color: '#f4f7fb', fontFamily: 'Georgia, serif', fontSize: 92, lineHeight: 1}}>
        {scene.title}
      </div>
      <div style={{marginTop: 22, color: '#8190a4', fontFamily: 'Arial, sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: 3}}>
        ILLUSTRATIVE DEMAND TREND · NOT TO SCALE
      </div>
      <div style={{display: 'flex', alignItems: 'end', gap: 32, height: 390, marginTop: 24}}>
        {bars.map((height, index) => (
          <div key={height} style={{display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'end', height: '100%'}}>
            <div
              style={{
                height: `${interpolate(frame, [index * 8, index * 8 + 2 * fps], [0, height], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                })}%`,
                borderRadius: '16px 16px 4px 4px',
                background: index === bars.length - 1 ? 'linear-gradient(#76a8ff, #376dcf)' : 'linear-gradient(#345887, #1a3150)',
              }}
            />
            <div style={{marginTop: 18, color: '#8d9aae', fontFamily: 'Arial, sans-serif', fontSize: 24, textAlign: 'center'}}>
              {2024 + index}
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
