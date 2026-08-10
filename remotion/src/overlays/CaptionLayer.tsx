import type {Caption} from '@remotion/captions';
import {AbsoluteFill, Sequence, useVideoConfig} from 'remotion';

interface CaptionLayerProps {
  readonly captions: Caption[];
}

export const CaptionLayer = ({captions}: CaptionLayerProps) => {
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {captions.map((caption) => {
        const from = Math.round((caption.startMs / 1000) * fps);
        const durationInFrames = Math.max(
          1,
          Math.round(((caption.endMs - caption.startMs) / 1000) * fps),
        );

        return (
          <Sequence key={`${caption.startMs}-${caption.text}`} from={from} durationInFrames={durationInFrames}>
            <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-end', padding: '0 170px 104px'}}>
              <div
                style={{
                  maxWidth: 1320,
                  padding: '14px 24px',
                  borderRadius: 12,
                  backgroundColor: 'rgba(3, 7, 13, 0.78)',
                  color: '#ffffff',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: 40,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  textAlign: 'center',
                  textShadow: '0 2px 10px rgba(0,0,0,0.8)',
                }}
              >
                {caption.text}
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
