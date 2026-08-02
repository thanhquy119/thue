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
  ink: '#102d24',
  deep: '#123c31',
  green: '#267159',
  greenSoft: '#dceee6',
  pale: '#eef6f2',
  card: '#ffffff',
  orange: '#e36a3e',
  line: '#c9dfd5',
  muted: '#587268',
};

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const justified = {
  textAlign: 'justify' as const,
  textAlignLast: 'left' as const,
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

const CheckIcon = ({size = 52}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill={COLORS.greenSoft} stroke={COLORS.green} strokeWidth="3.5" />
    <path d="M18 33.5 27.5 43 47 22" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BulletList = ({items}: {items: string[]}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'grid', gap: 22, width: '100%'}}>
      {items.slice(0, 3).map((item, index) => {
        const appear = spring({frame: frame - 8 - index * 7, fps, config: {damping: 24, stiffness: 105}});
        const fontSize = item.length > 220 ? 28 : item.length > 140 ? 31 : 35;
        return (
          <div
            key={`${item}-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '58px 1fr',
              alignItems: 'center',
              gap: 22,
              minHeight: 126,
              padding: '25px 29px',
              borderRadius: 28,
              background: index === 0 ? 'rgba(255,255,255,.98)' : 'rgba(250,253,251,.96)',
              border: `2px solid ${COLORS.line}`,
              boxShadow: '0 18px 48px rgba(16,45,36,.075)',
              opacity: interpolate(appear, [0, 1], [0, 1], clamp),
              transform: `translateY(${interpolate(appear, [0, 1], [26, 0], clamp)}px)`,
            }}
          >
            <CheckIcon />
            <div
              style={{
                ...justified,
                fontSize,
                lineHeight: 1.31,
                fontWeight: 750,
                color: COLORS.ink,
                letterSpacing: '-0.012em',
              }}
            >
              {item}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SceneShell = ({scene, durationInFrames, children}: {scene: LegalVideoScene; durationInFrames: number; children: ReactNode}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 24, stiffness: 92}});
  const exit = interpolate(frame, [Math.max(0, durationInFrames - 16), durationInFrames], [1, 0], {
    ...clamp,
    easing: Easing.bezier(0.4, 0, 1, 1),
  });
  const titleSize = scene.kind === 'intro'
    ? 78
    : scene.title.length > 95
      ? 51
      : scene.title.length > 65
        ? 57
        : 64;

  return (
    <AbsoluteFill
      style={{
        padding: '188px 64px 306px',
        opacity: interpolate(enter, [0, 1], [0, 1], clamp) * exit,
        transform: `translateY(${interpolate(enter, [0, 1], [22, 0], clamp)}px)`,
      }}
    >
      <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
        <div
          style={{
            alignSelf: 'flex-start',
            marginBottom: 24,
            padding: '11px 17px',
            borderRadius: 999,
            border: `2px solid ${COLORS.line}`,
            background: 'rgba(255,255,255,.78)',
            color: COLORS.green,
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: '0.12em',
          }}
        >
          {scene.eyebrow}
        </div>
        <h1
          style={{
            margin: 0,
            maxWidth: 940,
            fontSize: titleSize,
            lineHeight: 1.08,
            letterSpacing: '-0.044em',
            fontWeight: 950,
            color: COLORS.ink,
          }}
        >
          {scene.title}
        </h1>
        {scene.subtitle ? (
          <p
            style={{
              ...justified,
              margin: '24px 0 0',
              maxWidth: 915,
              fontSize: 31,
              lineHeight: 1.4,
              fontWeight: 620,
              color: COLORS.muted,
            }}
          >
            {scene.subtitle}
          </p>
        ) : null}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 34,
          }}
        >
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const IntroVisual = ({document}: {document: LegalVideoProps['storyboard']['document']}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const appear = spring({frame: frame - 7, fps, config: {damping: 24, stiffness: 95}});
  const main = document.number.split('/')[0] || document.type.slice(0, 4).toLocaleUpperCase('vi');
  return (
    <div
      style={{
        width: '100%',
        minHeight: 520,
        padding: '62px 54px',
        borderRadius: 52,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        background: `linear-gradient(145deg, ${COLORS.deep} 0%, #1c604b 100%)`,
        border: '2px solid rgba(255,255,255,.24)',
        color: '#fff',
        boxShadow: '0 38px 90px rgba(16,45,36,.22)',
        opacity: interpolate(appear, [0, 1], [0, 1], clamp),
        transform: `translateY(${interpolate(appear, [0, 1], [30, 0], clamp)}px) scale(${interpolate(appear, [0, 1], [.97, 1], clamp)})`,
      }}
    >
      <div style={{width: '100%'}}>
        <div style={{fontSize: main.length <= 4 ? 174 : 110, lineHeight: .92, fontWeight: 950, letterSpacing: '-0.075em'}}>{main}</div>
        <div style={{marginTop: 28, fontSize: 34, lineHeight: 1.25, fontWeight: 850}}>{document.number}</div>
        <div style={{width: 110, height: 5, margin: '30px auto 24px', borderRadius: 99, background: COLORS.orange}} />
        <div style={{fontSize: 27, lineHeight: 1.35, fontWeight: 650, opacity: .88}}>
          {document.type} · {document.issuer}
        </div>
      </div>
    </div>
  );
};

const TimelineVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gap: 22}}>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20}}>
      {scene.bullets.slice(0, 2).map((item, index) => (
        <div
          key={`${item}-${index}`}
          style={{
            minHeight: 242,
            borderRadius: 34,
            background: index === 0 ? COLORS.deep : '#fff',
            color: index === 0 ? '#fff' : COLORS.ink,
            border: `2px solid ${index === 0 ? COLORS.deep : COLORS.line}`,
            padding: '38px 32px',
            boxShadow: '0 20px 55px rgba(16,45,36,.09)',
          }}
        >
          <div style={{fontSize: 21, fontWeight: 900, letterSpacing: '0.1em', color: index === 0 ? 'rgba(255,255,255,.7)' : COLORS.muted, marginBottom: 24}}>
            {index === 0 ? 'MỐC 1' : 'MỐC 2'}
          </div>
          <div style={{...justified, fontSize: item.length > 100 ? 34 : 40, fontWeight: 870, lineHeight: 1.22}}>{item}</div>
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
    <div style={{display: 'grid', gap: 19, width: '100%'}}>
      {scene.bullets.slice(0, 3).map((item, index) => {
        const appear = spring({frame: frame - index * 9, fps, config: {damping: 23, stiffness: 100}});
        return (
          <div
            key={`${item}-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '86px 1fr',
              gap: 20,
              alignItems: 'stretch',
              opacity: appear,
              transform: `translateY(${interpolate(appear, [0, 1], [24, 0], clamp)}px)`,
            }}
          >
            <div
              style={{
                minHeight: 100,
                borderRadius: 28,
                display: 'grid',
                placeItems: 'center',
                background: index === 0 ? COLORS.orange : COLORS.green,
                color: '#fff',
                fontSize: 34,
                fontWeight: 950,
              }}
            >
              {index + 1}
            </div>
            <div
              style={{
                ...justified,
                borderRadius: 28,
                background: '#fff',
                border: `2px solid ${COLORS.line}`,
                padding: '27px 30px',
                fontSize: item.length > 180 ? 28 : item.length > 110 ? 31 : 35,
                lineHeight: 1.31,
                fontWeight: 750,
                boxShadow: '0 16px 42px rgba(16,45,36,.07)',
              }}
            >
              {item}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const NumberVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gridTemplateColumns: scene.bullets.length > 1 ? '1fr 1fr' : '1fr', gap: 22}}>
    {scene.bullets.slice(0, 3).map((item, index) => (
      <div
        key={`${item}-${index}`}
        style={{
          minHeight: 292,
          display: 'grid',
          placeItems: 'center',
          textAlign: item.length > 90 ? 'justify' : 'center',
          textAlignLast: item.length > 90 ? 'center' : 'auto',
          borderRadius: 40,
          padding: 38,
          background: index === 0 ? `linear-gradient(145deg, ${COLORS.deep}, ${COLORS.green})` : '#fff',
          color: index === 0 ? '#fff' : COLORS.ink,
          border: `2px solid ${index === 0 ? COLORS.deep : COLORS.line}`,
          boxShadow: '0 25px 65px rgba(16,45,36,.11)',
          fontSize: item.length > 110 ? 34 : 41,
          lineHeight: 1.2,
          fontWeight: 900,
        }}
      >
        {item}
      </div>
    ))}
  </div>
);

function SceneVisual({scene, document}: {scene: LegalVideoScene; document: LegalVideoProps['storyboard']['document']}) {
  if (scene.kind === 'intro') return <IntroVisual document={document} />;
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
  const intervals = captionIntervals(scene);
  const caption = intervals.find((item) => current >= item.start && current < item.end) ?? intervals.at(-1);
  if (!caption) return null;
  const fontSize = caption.text.length > 155 ? 27 : caption.text.length > 115 ? 29 : 32;

  return (
    <div
      style={{
        position: 'absolute',
        left: 52,
        right: 52,
        bottom: 52,
        height: 222,
        zIndex: 30,
        boxSizing: 'border-box',
        padding: '24px 31px 25px',
        borderRadius: 32,
        border: '2px solid rgba(255,255,255,.13)',
        background: 'linear-gradient(145deg, rgba(15,53,43,.985), rgba(20,66,53,.985))',
        boxShadow: '0 25px 72px rgba(16,45,36,.25)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12, color: 'rgba(255,255,255,.68)', fontSize: 17, fontWeight: 900, letterSpacing: '0.12em'}}>
        <span style={{display: 'block', width: 28, height: 4, borderRadius: 99, background: COLORS.orange}} />
        LỜI THUYẾT MINH
      </div>
      <div
        style={{
          textAlign: caption.text.length >= 72 ? 'justify' : 'center',
          textAlignLast: 'center',
          fontSize,
          lineHeight: 1.34,
          fontWeight: 720,
          letterSpacing: '-0.009em',
        }}
      >
        {caption.text}
      </div>
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
        background: `radial-gradient(circle at 88% 8%, rgba(128,202,169,.34) 0, transparent 31%), radial-gradient(circle at 4% 72%, rgba(227,106,62,.09) 0, transparent 28%), linear-gradient(155deg, #fbfdfc 0%, ${COLORS.pale} 100%)`,
        color: COLORS.ink,
      }}
    >
      <div style={{position: 'absolute', inset: 0, opacity: .22, backgroundImage: 'linear-gradient(rgba(31,107,80,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(31,107,80,.08) 1px, transparent 1px)', backgroundSize: '72px 72px'}} />
      <div style={{position: 'absolute', width: 520, height: 520, borderRadius: '50%', background: 'rgba(227,106,62,.07)', left: -260, top: 920, filter: 'blur(2px)'}} />
      <div style={{position: 'absolute', width: 340, height: 340, borderRadius: '50%', border: '4px solid rgba(31,107,80,.08)', right: -130, top: 390}} />

      <div
        style={{
          position: 'absolute',
          top: 48,
          left: 52,
          right: 52,
          height: 86,
          zIndex: 40,
          padding: '0 26px',
          borderRadius: 27,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,.82)',
          border: `2px solid ${COLORS.line}`,
          boxShadow: '0 14px 42px rgba(16,45,36,.07)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <div style={{fontSize: 33, fontWeight: 950, letterSpacing: '-0.05em', color: COLORS.deep}}>
          Thuế Rõ<span style={{color: COLORS.orange}}>.</span>
        </div>
        <div style={{maxWidth: 570, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 21, fontWeight: 850, color: COLORS.muted}}>
          {storyboard.document.number} · VIDEO CHI TIẾT
        </div>
      </div>

      <div style={{position: 'absolute', top: 153, left: 56, right: 56, height: 7, borderRadius: 99, background: 'rgba(31,107,80,.12)', zIndex: 40}}>
        <div
          style={{
            width: `${interpolate(frame, [0, durationInFrames - 1], [0, 100], clamp)}%`,
            height: '100%',
            borderRadius: 99,
            background: `linear-gradient(90deg, ${COLORS.green}, ${COLORS.orange})`,
          }}
        />
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
