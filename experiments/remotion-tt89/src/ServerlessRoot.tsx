import {Composition} from 'remotion';
import {
  LegalVideo,
  calculateLegalVideoMetadata,
  defaultLegalVideoProps,
} from './LegalVideo';

export const ServerlessRemotionRoot = () => (
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
);
