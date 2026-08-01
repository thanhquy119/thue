import type {ReactNode} from 'react';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from 'remotion';

export type LegalVideoAudioChunk = {
  id: string;
  text: string;
  url: string;
  durationSeconds: number;
};

export type LegalVideoScene = {
  id: string;
  kind: 'intro' | 'timeline' | 'audience' | 'change' | 'process' | 'numbers' | 'prepare' | 'summary';
  category: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  bullets: string[];
  narration: string;
  captionChunks: string[];
  audioChunks?: LegalVideoAudioChunk[];
};

export type LegalVideoProps = {
  storyboard: {
    document: {
      number: string;
      title: string;
      type: string;
      issuer: string;
      issued_date: string | null;
      effective_date: string | null;
    };
    fps: number;
    width: number;
    height: number;
    scenes: LegalVideoScene[];
  };
};

const COLORS = {
  ink: '#102a21',
  green: '#1f6b50',
  pale: '#edf6f1',
  card: '#ffffff',
  orange: '#e36a3e',
  line: '#cfe2d9',
  muted: '#587267',
};

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

export const defaultLegalVideoProps: LegalVideoProps = {
  storyboard: {
    document: {
      number: '89/2026/TT-BTC',
      title: 'Tóm tắt những nội dung chính của văn bản pháp luật',
      type: 'Thông tư',
      issuer: 'Bộ Tài chính',
      issued_date: '2026-06-30',
      effective_date: '2026-07-01',
    },
    fps: 30,
    width: 1080,
    height: 1920,
    scenes: [
      {
        id: 'scene-1',
        kind: 'intro',
        category: 'overview',
        eyebrow: 'VĂN BẢN MỚI',
        title: '89/2026/TT-BTC',
        subtitle: 'Những nội dung chính cần nắm',
        bullets: [],
        narration: 'Những nội dung chính cần nắm.',
        captionChunks: ['Những nội dung chính cần nắm'],
        audioChunks: [],
      },
      {
        id: 'scene-2',
        kind: 'summary',
        category: 'overview',
        eyebrow: 'TỔNG QUAN',
        title: 'Nội dung video được tạo từ toàn văn',
        subtitle: 'Dữ liệu thật sẽ được truyền vào composition khi render',
        bullets: ['Ý chính thứ nhất', 'Ý chính thứ hai', 'Ý chính thứ ba'],
        narration: 'Dữ liệu thật sẽ được truyền vào composition khi render.',
        captionChunks: ['Dữ liệu thật được truyền vào khi render'],
        audioChunks: [],
      },
    ],
  },
};

function sceneAudioSeconds(scene: LegalVideoScene) {
  return (scene.audioChunks ?? []).reduce((sum, chunk) => sum + Math.max(0, chunk.durationSeconds), 0);
}

function sceneFrames(scene: LegalVideoScene, fps: number) {
  const audio = sceneAudioSeconds(scene);
  return Math.max(4 * fps, Math.ceil((audio > 0 ? audio + 0.7 : 6) * fps));
}

function sceneStart(scenes: LegalVideoScene[], index: number, fps: number) {
  return scenes.slice(0, index).reduce((sum, scene) => sum + sceneFrames(scene, fps), 0);
}

function totalFrames(props: LegalVideoProps) {
  const fps = props.storyboard.fps || 30;
  return Math.max(fps, props.storyboard.scenes.reduce((sum, scene) => sum + sceneFrames(scene, fps), 0));
}

export const calculateLegalVideoMetadata: CalculateMetadataFunction<LegalVideoProps> = ({props}) => ({
  durationInFrames: totalFrames(props),
  fps: props.storyboard.fps || 30,
  width: props.storyboard.width || 1080,
  height: props.storyboard.height || 1920,
});

const CheckIcon = ({size = 54}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill={COLORS.pale} stroke={COLORS.green} strokeWidth="4" />
    <path d="M18 33.5 27.5 43 47 22" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BulletList = ({items}: {items: string[]}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'grid', gap: 24, width: '100%'}}>
      {items.slice(0, 3).map((item, index) => {
        const appear = spring({frame: frame - 11 - index * 9, fps, config: {damping: 20, stiffness: 130}});
        return (
          <div
            key={`${item}-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '58px 1fr',
              alignItems: 'center',
              gap: 22,
              padding: '24px 27px',
              borderRadius: 25,
              background: 'rgba(255,255,255,.94)',
              border: `2px solid ${COLORS.line}`,
              boxShadow: '0 16px 44px rgba(16,42,33,.07)',
              opacity: interpolate(appear, [0, 1], [0, 1], clamp),
              translate: `${interpolate(appear, [0, 1], [50, 0], clamp)}px 0`,
            }}
          >
            <CheckIcon />
            <div style={{fontSize: 36, lineHeight: 1.24, fontWeight: 780, color: COLORS.ink}}>{item}</div>
          </div>
        );
      })}
    </div>
  );
};

const SceneShell = ({scene, durationInFrames, children}: {scene: LegalVideoScene; durationInFrames: number; children: ReactNode}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 110}});
  const exit = interpolate(frame, [Math.max(0, durationInFrames - 20), durationInFrames], [1, 0], {
    ...clamp,
    easing: Easing.bezier(0.4, 0, 1, 1),
  });
  return (
    <AbsoluteFill style={{padding: '170px 72px 260px', opacity: interpolate(enter, [0, 1], [0, 1], clamp) * exit}}>
      <div
        style={{
          marginBottom: 28,
          fontSize: 24,
          fontWeight: 900,
          letterSpacing: '0.14em',
          color: COLORS.green,
          opacity: interpolate(frame, [0, 18], [0, 1], clamp),
          translate: `0 ${interpolate(frame, [0, 18], [20, 0], clamp)}px`,
        }}
      >
        {scene.eyebrow}
      </div>
      <h1
        style={{
          margin: 0,
          maxWidth: 930,
          fontSize: scene.kind === 'intro' ? 82 : 68,
          lineHeight: 1.05,
          letterSpacing: '-0.052em',
          fontWeight: 950,
          color: COLORS.ink,
          opacity: interpolate(enter, [0, 1], [0, 1], clamp),
          translate: `0 ${interpolate(enter, [0, 1], [48, 0], clamp)}px`,
        }}
      >
        {scene.title}
      </h1>
      {scene.subtitle ? (
        <p style={{margin: '25px 0 0', maxWidth: 880, fontSize: 33, lineHeight: 1.35, fontWeight: 650, color: COLORS.muted}}>
          {scene.subtitle}
        </p>
      ) : null}
      <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 34}}>{children}</div>
    </AbsoluteFill>
  );
};

const IntroVisual = ({number, type}: {number: string; type: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame: frame - 10, fps, config: {damping: 16, stiffness: 125}});
  const main = number.split('/')[0] || type.slice(0, 4).toLocaleUpperCase('vi');
  return (
    <div
      style={{
        width: 570,
        minHeight: 520,
        padding: '72px 45px',
        borderRadius: 140,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        background: `linear-gradient(145deg, ${COLORS.green}, #124532)`,
        color: '#fff',
        boxShadow: '0 45px 100px rgba(16,42,33,.25)',
        scale: interpolate(pop, [0, 1], [0.76, 1], {...clamp, output: 'perceptual-scale'}),
        rotate: `${interpolate(pop, [0, 1], [-4, 0], clamp)}deg`,
      }}
    >
      <div>
        <div style={{fontSize: main.length <= 4 ? 188 : 115, lineHeight: .92, fontWeight: 950, letterSpacing: '-0.08em'}}>{main}</div>
        <div style={{marginTop: 28, fontSize: 30, lineHeight: 1.25, fontWeight: 850}}>{number}</div>
      </div>
    </div>
  );
};

const TimelineVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gap: 24}}>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20}}>
      {scene.bullets.slice(0, 2).map((item, index) => (
        <div key={item} style={{minHeight: 230, borderRadius: 32, background: '#fff', border: `2px solid ${COLORS.line}`, padding: '38px 32px', boxShadow: '0 20px 55px rgba(16,42,33,.08)'}}>
          <div style={{fontSize: 23, fontWeight: 850, color: COLORS.muted, marginBottom: 24}}>{index === 0 ? 'MỐC 1' : 'MỐC 2'}</div>
          <div style={{fontSize: 43, fontWeight: 930, lineHeight: 1.14, color: COLORS.ink}}>{item}</div>
        </div>
      ))}
    </div>
    {scene.bullets.length > 2 ? <BulletList items={scene.bullets.slice(2)} /> : null}
  </div>
);

const ProcessVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'grid', gap: 18, width: '100%'}}>
      {scene.bullets.slice(0, 3).map((item, index) => {
        const appear = spring({frame: frame - index * 12, fps, config: {damping: 19, stiffness: 115}});
        return (
          <div key={item} style={{display: 'grid', gridTemplateColumns: '90px 1fr', gap: 22, alignItems: 'center', opacity: appear, translate: `0 ${interpolate(appear, [0, 1], [40, 0], clamp)}px`}}>
            <div style={{width: 82, height: 82, borderRadius: 28, display: 'grid', placeItems: 'center', background: index === 0 ? COLORS.orange : COLORS.green, color: '#fff', fontSize: 35, fontWeight: 950}}>{index + 1}</div>
            <div style={{borderRadius: 25, background: '#fff', border: `2px solid ${COLORS.line}`, padding: '27px 29px', fontSize: 35, lineHeight: 1.25, fontWeight: 780}}>{item}</div>
          </div>
        );
      })}
    </div>
  );
};

const NumberVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gridTemplateColumns: scene.bullets.length > 1 ? '1fr 1fr' : '1fr', gap: 22}}>
    {scene.bullets.slice(0, 3).map((item, index) => (
      <div key={item} style={{minHeight: 280, display: 'grid', placeItems: 'center', textAlign: 'center', borderRadius: 38, padding: 35, background: index === 0 ? COLORS.green : '#fff', color: index === 0 ? '#fff' : COLORS.ink, border: `2px solid ${index === 0 ? COLORS.green : COLORS.line}`, boxShadow: '0 25px 65px rgba(16,42,33,.1)', fontSize: 43, lineHeight: 1.17, fontWeight: 900}}>{item}</div>
    ))}
  </div>
);

function SceneVisual({scene, document}: {scene: LegalVideoScene; document: LegalVideoProps['storyboard']['document']}) {
  if (scene.kind === 'intro') return <IntroVisual number={document.number} type={document.type} />;
  if (scene.kind === 'timeline') return <TimelineVisual scene={scene} />;
  if (scene.kind === 'process') return <ProcessVisual scene={scene} />;
  if (scene.kind === 'numbers') return <NumberVisual scene={scene} />;
  return <BulletList items={scene.bullets.length ? scene.bullets : [scene.narration]} />;
}

function captionIntervals(scene: LegalVideoScene) {
  const chunks = scene.captionChunks.filter(Boolean);
  const audioSeconds = sceneAudioSeconds(scene);
  const duration = audioSeconds > 0 ? audioSeconds : 5.3;
  const weights = chunks.map((chunk) => Math.max(8, chunk.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = 0;
  return chunks.map((text, index) => {
    const start = cursor;
    cursor = index === chunks.length - 1 ? duration : cursor + duration * (weights[index] / total);
    return {text, start, end: cursor};
  });
}

const CaptionBar = ({scene}: {scene: LegalVideoScene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const current = frame / fps;
  const caption = captionIntervals(scene).find((item) => current >= item.start && current < item.end);
  if (!caption) return null;
  const local = current - caption.start;
  const duration = Math.max(.4, caption.end - caption.start);
  return (
    <div
      style={{
        position: 'absolute',
        left: 56,
        right: 56,
        bottom: 68,
        zIndex: 30,
        padding: '24px 31px',
        borderRadius: 27,
        background: 'rgba(16,42,33,.96)',
        boxShadow: '0 25px 70px rgba(16,42,33,.23)',
        color: '#fff',
        fontSize: 33,
        lineHeight: 1.3,
        fontWeight: 760,
        textAlign: 'center',
        opacity: interpolate(local, [0, .14, Math.max(.18, duration - .16), duration], [0, 1, 1, 0], clamp),
      }}
    >
      {caption.text}
    </div>
  );
};

const SceneAudio = ({scene}: {scene: LegalVideoScene}) => {
  const {fps} = useVideoConfig();
  let cursor = 0;
  return (
    <>
      {(scene.audioChunks ?? []).map((chunk) => {
        const from = Math.round(cursor * fps);
        const durationInFrames = Math.max(1, Math.ceil(chunk.durationSeconds * fps));
        cursor += chunk.durationSeconds;
        return (
          <Sequence key={chunk.id} from={from} durationInFrames={durationInFrames} layout="none">
            <Audio src={chunk.url} volume={.97} />
          </Sequence>
        );
      })}
    </>
  );
};

export const LegalVideo = ({storyboard}: LegalVideoProps) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        fontFamily: 'Arial, "DejaVu Sans", sans-serif',
        background: `radial-gradient(circle at 92% 5%, #d4eee2 0, transparent 32%), linear-gradient(155deg, #fbfdfc 0%, ${COLORS.pale} 100%)`,
        color: COLORS.ink,
      }}
    >
      <div style={{position: 'absolute', width: 520, height: 520, borderRadius: '50%', background: 'rgba(227,106,62,.08)', left: -240, top: 920}} />
      <div style={{position: 'absolute', width: 330, height: 330, borderRadius: '50%', border: '4px solid rgba(31,107,80,.08)', right: -120, top: 300}} />
      <div style={{position: 'absolute', top: 62, left: 68, zIndex: 40, fontSize: 34, fontWeight: 950, letterSpacing: '-0.05em'}}>
        Thuế<span style={{color: COLORS.orange}}>.</span>
      </div>
      <div style={{position: 'absolute', top: 78, right: 68, zIndex: 40, fontSize: 22, fontWeight: 800, color: COLORS.muted}}>TÓM TẮT VĂN BẢN</div>
      <div style={{position: 'absolute', top: 122, left: 68, right: 68, height: 7, borderRadius: 99, background: 'rgba(31,107,80,.12)', zIndex: 40}}>
        <div style={{width: `${interpolate(frame, [0, durationInFrames - 1], [0, 100], clamp)}%`, height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${COLORS.green}, ${COLORS.orange})`}} />
      </div>
      {storyboard.scenes.map((scene, index) => {
        const from = sceneStart(storyboard.scenes, index, fps);
        const duration = sceneFrames(scene, fps);
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} layout="absolute-fill">
            <SceneShell scene={scene} durationInFrames={duration}>
              <SceneVisual scene={scene} document={storyboard.document} />
            </SceneShell>
            <SceneAudio scene={scene} />
            <CaptionBar scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
