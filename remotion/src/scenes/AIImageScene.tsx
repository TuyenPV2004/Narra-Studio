import type {ProjectBundle} from '@narra/contracts';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

interface AIImageSceneProps {
  readonly scene: ProjectBundle['scenes'][number];
  readonly imagePath: string;
}

export const AIImageScene = ({scene, imagePath}: AIImageSceneProps) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: '#07101c', overflow: 'hidden'}}>
      <Img
        src={staticFile(imagePath)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          scale: interpolate(frame, [0, durationInFrames], [1, 1.08], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          translate: `${interpolate(frame, [0, durationInFrames], [-18, 18], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}px 0`,
        }}
      />
      <AbsoluteFill
        style={{
          background: 'linear-gradient(90deg, rgba(4,8,14,0.9), rgba(4,8,14,0.1) 68%)',
        }}
      />
      <div style={{position: 'absolute', left: 110, top: 125, width: 850}}>
        <div style={{color: '#7ba9ff', fontFamily: 'Arial, sans-serif', fontSize: 28, fontWeight: 700, letterSpacing: 5}}>
          CHAPTER 01
        </div>
        <div style={{marginTop: 24, color: '#f4f7fb', fontFamily: 'Georgia, serif', fontSize: 104, lineHeight: 0.98, letterSpacing: -3}}>
          {scene.title}
        </div>
      </div>
    </AbsoluteFill>
  );
};

