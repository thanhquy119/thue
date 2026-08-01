import {Composition} from 'remotion';
import {ThongTu89} from './ThongTu89';
import {COMPOSITION_ID, FPS, TOTAL_FRAMES} from './data';

export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION_ID}
    component={ThongTu89}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1080}
    height={1920}
  />
);
