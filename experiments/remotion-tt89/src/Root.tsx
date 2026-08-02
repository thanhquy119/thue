import {Composition} from 'remotion';
import {ThongTu89} from './ThongTu89';
import {FPS, TOTAL_FRAMES} from './data';
import {
  LegalVideo,
  calculateLegalVideoMetadata,
  defaultLegalVideoProps,
} from './LegalVideo';

export const RemotionRoot = () => (
  <>
    <Composition
      id="ThongTu89"
      component={ThongTu89}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
    />
    <Composition
      id="LegalVideo"
      component={LegalVideo}
      durationInFrames={360}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultLegalVideoProps}
      calculateMetadata={calculateLegalVideoMetadata}
    />
  </>
);
