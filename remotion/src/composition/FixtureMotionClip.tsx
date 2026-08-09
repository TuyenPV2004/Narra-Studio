import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export const FixtureMotionClip = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: '#07101f', overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          opacity: interpolate(frame, [0, 45], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          background:
            'radial-gradient(circle at 25% 50%, rgba(69, 128, 255, 0.35), transparent 30%), radial-gradient(circle at 75% 50%, rgba(60, 218, 181, 0.2), transparent 32%)',
        }}
      />
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left: 170 + index * 330,
            top: 210,
            width: 200,
            height: 660,
            borderRadius: 24,
            border: '2px solid rgba(132, 177, 255, 0.45)',
            backgroundColor: 'rgba(24, 55, 100, 0.65)',
            translate: `0 ${interpolate(frame, [0, durationInFrames], [18, -18], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }) * (index % 2 === 0 ? 1 : -1)}px`,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((light) => (
            <div
              key={light}
              style={{
                position: 'absolute',
                left: 28,
                right: 28,
                top: 55 + light * 92,
                height: 16,
                borderRadius: 8,
                backgroundColor: light % 2 === 0 ? '#6ca0ff' : '#42d6b2',
                opacity: interpolate(
                  frame % 90,
                  [0, 30, 60, 90],
                  [0.2, 1, 0.35, 0.2],
                ),
              }}
            />
          ))}
        </div>
      ))}
    </AbsoluteFill>
  );
};
