import type {ProjectBundle} from '@narra/contracts';
import {Video} from '@remotion/media';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';

interface AIVideoSceneProps {
  readonly scene: ProjectBundle['scenes'][number];
  readonly videoPath: string;
  readonly sourceAudioMode: 'MUTE' | 'DUCK' | 'KEEP';
  readonly sourceAudioVolume: number;
}

export const AIVideoScene = ({scene, videoPath, sourceAudioMode, sourceAudioVolume}: AIVideoSceneProps) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: '#07101f'}}>
      <Video
        src={staticFile(videoPath)}
        muted={sourceAudioMode === 'MUTE'}
        volume={sourceAudioMode === 'DUCK' ? Math.min(sourceAudioVolume, 0.08) : sourceAudioVolume}
        objectFit="cover"
        style={{width: '100%', height: '100%'}}
      />
      <AbsoluteFill style={{background: 'linear-gradient(0deg, rgba(3,7,13,0.82), transparent 55%)'}} />
      <div
        style={{
          position: 'absolute',
          left: 110,
          bottom: 260,
          color: '#f5f8ff',
          fontFamily: 'Georgia, serif',
          fontSize: 86,
          opacity: interpolate(frame, [15, 55], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        {scene.title}
      </div>
    </AbsoluteFill>
  );
};
