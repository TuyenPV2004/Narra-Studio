import {ProjectBundleSchema} from '@narra/contracts';
import {Composition, Folder} from 'remotion';
import bundleJson from '../../fixtures/documentary-90s/bundle.json';
import {DocumentaryComposition} from './composition/DocumentaryComposition';
import {FixtureMotionClip} from './composition/FixtureMotionClip';
import {VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH} from './constants';
import {getTotalDurationFrames} from './timeline';

const fixtureBundle = ProjectBundleSchema.parse(bundleJson);

export const RemotionRoot = () => (
  <>
    <Folder name="Narra-Fixture-Components">
      <Composition
        id="FixtureMotionClip"
        component={FixtureMotionClip}
        durationInFrames={40 * VIDEO_FPS}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
      />
    </Folder>
    <Composition
      id="DocumentaryFixture"
      component={DocumentaryComposition}
      durationInFrames={getTotalDurationFrames(fixtureBundle.scenes, VIDEO_FPS)}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
    />
  </>
);
