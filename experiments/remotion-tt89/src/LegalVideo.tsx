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
  ink: '#18372f',
  deep: '#255247',
  green: '#477f6f',
  mint: '#dcebe5',
  mintLight: '#edf5f1',
  sky: '#e5eef4',
  peach: '#f4e5dc',
  cream: '#f6f1e8',
  pale: '#f5f8f6',
  card: '#fffefd',
  line: '#cadbd4',
  muted: '#61786f',
  white: '#ffffff',
  yellow: '#e6c66b',
};

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

function readableAlign(text: string, justifyFrom = 160) {
  return {
    textAlign: text.length >= justifyFrom ? ('justify' as const) : ('left' as const),
    textAlignLast: 'left' as const,
  };
}

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

const DocumentIcon = ({size = 150}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden="true">
    <rect x="32" y="18" width="96" height="124" rx="20" fill={COLORS.card} stroke={COLORS.deep} strokeWidth="5" />
    <path d="M100 18v30h28" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="5" strokeLinejoin="round" />
    <path d="M52 70h56M52 91h56M52 112h37" stroke={COLORS.green} strokeWidth="7" strokeLinecap="round" />
    <circle cx="111" cy="116" r="22" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="4" />
    <path d="m102 116 7 7 13-15" stroke={COLORS.deep} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CalendarIcon = ({size = 92}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <rect x="11" y="18" width="78" height="70" rx="17" fill={COLORS.card} stroke={COLORS.deep} strokeWidth="5" />
    <path d="M11 40h78" stroke={COLORS.deep} strokeWidth="5" />
    <path d="M31 11v18M69 11v18" stroke={COLORS.green} strokeWidth="7" strokeLinecap="round" />
    <circle cx="34" cy="60" r="6" fill={COLORS.peach} />
    <circle cx="51" cy="60" r="6" fill={COLORS.mint} />
    <circle cx="68" cy="60" r="6" fill={COLORS.sky} />
    <circle cx="34" cy="76" r="6" fill={COLORS.mint} />
    <circle cx="51" cy="76" r="6" fill={COLORS.peach} />
  </svg>
);

const PeopleIcon = ({size = 142}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden="true">
    <circle cx="80" cy="48" r="23" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="5" />
    <circle cx="35" cy="66" r="17" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="4" />
    <circle cx="125" cy="66" r="17" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="4" />
    <path d="M44 132c2-30 15-48 36-48s34 18 36 48" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="5" strokeLinecap="round" />
    <path d="M10 132c2-22 11-35 26-35 12 0 22 8 26 22M98 119c4-14 14-22 26-22 15 0 24 13 26 35" stroke={COLORS.deep} strokeWidth="5" strokeLinecap="round" />
  </svg>
);

const ArrowsIcon = ({size = 126}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 140 140" fill="none" aria-hidden="true">
    <rect x="12" y="24" width="44" height="92" rx="16" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="4" />
    <rect x="84" y="24" width="44" height="92" rx="16" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="4" />
    <path d="M58 53h23m-8-9 9 9-9 9M82 88H59m8 9-9-9 9-9" stroke={COLORS.deep} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const StepsIcon = ({size = 126}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 140 140" fill="none" aria-hidden="true">
    <rect x="14" y="84" width="34" height="38" rx="10" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="4" />
    <rect x="53" y="58" width="34" height="64" rx="10" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="4" />
    <rect x="92" y="30" width="34" height="92" rx="10" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="4" />
    <path d="m31 72 30-25 24 4 27-23" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m102 24 13 3-4 13" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PercentIcon = ({size = 124}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 140 140" fill="none" aria-hidden="true">
    <circle cx="70" cy="70" r="57" fill={COLORS.cream} stroke={COLORS.deep} strokeWidth="5" />
    <circle cx="48" cy="48" r="13" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="4" />
    <circle cx="92" cy="92" r="13" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="4" />
    <path d="m45 99 50-58" stroke={COLORS.deep} strokeWidth="8" strokeLinecap="round" />
  </svg>
);

const ClipboardIcon = ({size = 132}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 150 150" fill="none" aria-hidden="true">
    <rect x="24" y="20" width="102" height="116" rx="20" fill={COLORS.card} stroke={COLORS.deep} strokeWidth="5" />
    <rect x="52" y="11" width="46" height="24" rx="10" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="4" />
    <path d="m42 64 8 8 13-16M72 65h32M42 96l8 8 13-16M72 97h32" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LightbulbIcon = ({size = 126}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 140 140" fill="none" aria-hidden="true">
    <path d="M70 15c-27 0-46 19-46 44 0 18 10 30 23 40 5 4 8 10 8 16h30c0-6 3-12 8-16 13-10 23-22 23-40 0-25-19-44-46-44Z" fill={COLORS.cream} stroke={COLORS.deep} strokeWidth="5" />
    <path d="M54 115h32M58 127h24" stroke={COLORS.deep} strokeWidth="6" strokeLinecap="round" />
    <path d="M70 0v8M18 22l7 7M122 22l-7 7M3 66h10M127 66h10" stroke={COLORS.yellow} strokeWidth="6" strokeLinecap="round" />
    <path d="m53 60 12 12 23-27" stroke={COLORS.green} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = ({size = 49}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="32" cy="32" r="28" fill={COLORS.mint} stroke={COLORS.green} strokeWidth="3.5" />
    <path d="M18 33.5 27.5 43 47 22" stroke={COLORS.deep} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function SceneIcon({kind, size = 88}: {kind: LegalVideoScene['kind']; size?: number}) {
  if (kind === 'timeline') return <CalendarIcon size={size} />;
  if (kind === 'audience') return <PeopleIcon size={size} />;
  if (kind === 'change') return <ArrowsIcon size={size} />;
  if (kind === 'process') return <StepsIcon size={size} />;
  if (kind === 'numbers') return <PercentIcon size={size} />;
  if (kind === 'prepare') return <ClipboardIcon size={size} />;
  if (kind === 'summary') return <LightbulbIcon size={size} />;
  return <DocumentIcon size={size} />;
}

const BulletList = ({items}: {items: string[]}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'grid', gap: 20, width: '100%'}}>
      {items.slice(0, 3).map((item, index) => {
        const appear = spring({frame: frame - 8 - index * 7, fps, config: {damping: 24, stiffness: 105}});
        const fontSize = item.length > 220 ? 28 : item.length > 140 ? 31 : 35;
        const backgrounds = [COLORS.card, COLORS.cream, COLORS.sky];
        return (
          <div
            key={`${item}-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '54px 1fr',
              alignItems: 'center',
              gap: 20,
              minHeight: 122,
              padding: '24px 28px',
              borderRadius: 28,
              backgroundColor: backgrounds[index % backgrounds.length],
              border: `2px solid ${COLORS.line}`,
              boxShadow: '0 16px 38px rgba(37,82,71,.07)',
              opacity: interpolate(appear, [0, 1], [0, 1], clamp),
              transform: `translateY(${interpolate(appear, [0, 1], [24, 0], clamp)}px)`,
            }}
          >
            <CheckIcon />
            <div
              style={{
                ...readableAlign(item),
                fontSize,
                lineHeight: 1.31,
                fontWeight: 760,
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
    ? 76
    : scene.title.length > 95
      ? 49
      : scene.title.length > 65
        ? 55
        : 62;

  return (
    <AbsoluteFill
      style={{
        padding: '186px 64px 286px',
        opacity: interpolate(enter, [0, 1], [0, 1], clamp) * exit,
        transform: `translateY(${interpolate(enter, [0, 1], [20, 0], clamp)}px)`,
      }}
    >
      <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 24}}>
          <div style={{width: 72, height: 72, borderRadius: 24, display: 'grid', placeItems: 'center', backgroundColor: COLORS.mint, border: `2px solid ${COLORS.line}`}}>
            <SceneIcon kind={scene.kind} size={52} />
          </div>
          <div
            style={{
              padding: '11px 17px',
              borderRadius: 999,
              border: `2px solid ${COLORS.line}`,
              backgroundColor: COLORS.card,
              color: COLORS.green,
              fontSize: 21,
              fontWeight: 900,
              letterSpacing: '0.105em',
            }}
          >
            {scene.eyebrow}
          </div>
        </div>
        <h1
          style={{
            margin: 0,
            maxWidth: 940,
            fontSize: titleSize,
            lineHeight: 1.09,
            letterSpacing: '-0.042em',
            fontWeight: 950,
            color: COLORS.ink,
          }}
        >
          {scene.title}
        </h1>
        {scene.subtitle ? (
          <p
            style={{
              ...readableAlign(scene.subtitle, 190),
              margin: '22px 0 0',
              maxWidth: 915,
              fontSize: 30,
              lineHeight: 1.4,
              fontWeight: 620,
              color: COLORS.muted,
            }}
          >
            {scene.subtitle}
          </p>
        ) : null}
        <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 32}}>
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
        padding: '52px 48px',
        borderRadius: 48,
        display: 'grid',
        gridTemplateColumns: '230px 1fr',
        alignItems: 'center',
        gap: 42,
        backgroundColor: COLORS.mint,
        border: `3px solid ${COLORS.line}`,
        color: COLORS.ink,
        boxShadow: '0 30px 72px rgba(37,82,71,.12)',
        opacity: interpolate(appear, [0, 1], [0, 1], clamp),
        transform: `translateY(${interpolate(appear, [0, 1], [26, 0], clamp)}px) scale(${interpolate(appear, [0, 1], [.98, 1], clamp)})`,
      }}
    >
      <div style={{width: 210, height: 210, borderRadius: 54, display: 'grid', placeItems: 'center', backgroundColor: COLORS.card, border: `2px solid ${COLORS.line}`}}>
        <DocumentIcon size={168} />
      </div>
      <div>
        <div style={{fontSize: main.length <= 4 ? 132 : 94, lineHeight: .94, fontWeight: 950, letterSpacing: '-0.07em', color: COLORS.deep}}>{main}</div>
        <div style={{marginTop: 26, fontSize: 35, lineHeight: 1.25, fontWeight: 880}}>{document.number}</div>
        <div style={{width: 104, height: 6, margin: '28px 0 22px', borderRadius: 99, backgroundColor: COLORS.peach}} />
        <div style={{fontSize: 27, lineHeight: 1.35, fontWeight: 680, color: COLORS.muted}}>
          {document.type} · {document.issuer}
        </div>
      </div>
    </div>
  );
};

const TimelineVisual = ({scene}: {scene: LegalVideoScene}) => {
  const items = scene.bullets.slice(0, 2);
  return (
    <div style={{width: '100%'}}>
      <div style={{height: 6, margin: '0 88px -3px', borderRadius: 99, backgroundColor: COLORS.line}} />
      <div style={{display: 'grid', gridTemplateColumns: items.length > 1 ? '1fr 1fr' : '1fr', gap: 22}}>
        {items.map((item, index) => (
          <div key={`${item}-${index}`} style={{position: 'relative', paddingTop: 34}}>
            <div style={{position: 'absolute', top: -11, left: '50%', width: 28, height: 28, borderRadius: '50%', transform: 'translateX(-50%)', backgroundColor: index === 0 ? COLORS.peach : COLORS.sky, border: `5px solid ${COLORS.pale}`}} />
            <div
              style={{
                minHeight: items.length > 1 ? 250 : 220,
                borderRadius: 34,
                backgroundColor: index === 0 ? COLORS.cream : COLORS.card,
                color: COLORS.ink,
                border: `2px solid ${COLORS.line}`,
                padding: '32px 30px',
                boxShadow: '0 18px 46px rgba(37,82,71,.08)',
              }}
            >
              <CalendarIcon size={75} />
              <div style={{fontSize: 20, fontWeight: 900, letterSpacing: '0.09em', color: COLORS.muted, margin: '18px 0 16px'}}>
                {items.length === 1 ? 'MỐC THỜI GIAN' : `MỐC ${index + 1}`}
              </div>
              <div style={{...readableAlign(item, 180), fontSize: item.length > 100 ? 33 : 39, fontWeight: 880, lineHeight: 1.22}}>{item}</div>
            </div>
          </div>
        ))}
      </div>
      {scene.bullets.length > 2 ? <div style={{marginTop: 22}}><BulletList items={scene.bullets.slice(2)} /></div> : null}
    </div>
  );
};

const ProcessVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'grid', gap: 16, width: '100%'}}>
      {scene.bullets.slice(0, 3).map((item, index) => {
        const appear = spring({frame: frame - index * 9, fps, config: {damping: 23, stiffness: 100}});
        return (
          <div key={`${item}-${index}`}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '92px 1fr',
                gap: 20,
                alignItems: 'stretch',
                opacity: appear,
                transform: `translateY(${interpolate(appear, [0, 1], [22, 0], clamp)}px)`,
              }}
            >
              <div style={{minHeight: 104, borderRadius: 28, display: 'grid', placeItems: 'center', backgroundColor: index === 0 ? COLORS.peach : index === 1 ? COLORS.sky : COLORS.mint, color: COLORS.deep, border: `2px solid ${COLORS.line}`, fontSize: 34, fontWeight: 950}}>
                {index + 1}
              </div>
              <div style={{...readableAlign(item), borderRadius: 28, backgroundColor: COLORS.card, border: `2px solid ${COLORS.line}`, padding: '27px 30px', fontSize: item.length > 180 ? 28 : item.length > 110 ? 31 : 35, lineHeight: 1.31, fontWeight: 750, boxShadow: '0 14px 36px rgba(37,82,71,.06)'}}>
                {item}
              </div>
            </div>
            {index < Math.min(2, scene.bullets.length - 1) ? <div style={{width: 5, height: 18, margin: '0 0 0 43px', backgroundColor: COLORS.line}} /> : null}
          </div>
        );
      })}
    </div>
  );
};

function numberParts(item: string) {
  const match = item.match(/\b\d+(?:[.,/]\d+)*(?:\s*%|\s*(?:đồng|triệu|tỷ))?/iu);
  if (!match) return {number: '', description: item};
  return {number: match[0], description: item.replace(match[0], '').replace(/^\s*[:–—-]?\s*/u, '').trim()};
}

const NumberVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gridTemplateColumns: scene.bullets.length > 1 ? '1fr 1fr' : '1fr', gap: 22}}>
    {scene.bullets.slice(0, 3).map((item, index) => {
      const parts = numberParts(item);
      return (
        <div key={`${item}-${index}`} style={{minHeight: 292, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', borderRadius: 38, padding: 34, backgroundColor: index === 0 ? COLORS.cream : index === 1 ? COLORS.sky : COLORS.card, color: COLORS.ink, border: `2px solid ${COLORS.line}`, boxShadow: '0 22px 54px rgba(37,82,71,.09)'}}>
          {parts.number ? <div style={{padding: '12px 18px', borderRadius: 20, backgroundColor: COLORS.mint, color: COLORS.deep, fontSize: parts.number.length > 14 ? 40 : 50, lineHeight: 1, fontWeight: 950, letterSpacing: '-0.04em'}}>{parts.number}</div> : <PercentIcon size={82} />}
          <div style={{...readableAlign(parts.description || item, 170), marginTop: 22, fontSize: item.length > 120 ? 31 : 36, lineHeight: 1.25, fontWeight: 820}}>
            {parts.description || item}
          </div>
        </div>
      );
    })}
  </div>
);

const AudienceVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gap: 24}}>
    <div style={{height: 250, borderRadius: 38, backgroundColor: COLORS.sky, border: `2px solid ${COLORS.line}`, display: 'grid', gridTemplateColumns: '220px 1fr', alignItems: 'center', padding: '28px 42px'}}>
      <PeopleIcon size={174} />
      <div style={{fontSize: 39, lineHeight: 1.18, fontWeight: 900, color: COLORS.deep}}>Ai cần quan tâm đến quy định này?</div>
    </div>
    <BulletList items={scene.bullets.length ? scene.bullets : [scene.narration]} />
  </div>
);

const ChangeVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gap: 24}}>
    <div style={{height: 210, borderRadius: 38, backgroundColor: COLORS.peach, border: `2px solid ${COLORS.line}`, display: 'grid', gridTemplateColumns: '190px 1fr', alignItems: 'center', padding: '24px 42px'}}>
      <ArrowsIcon size={150} />
      <div style={{fontSize: 40, lineHeight: 1.18, fontWeight: 900, color: COLORS.deep}}>Điểm thay đổi hoặc nội dung cần đặc biệt lưu ý</div>
    </div>
    <BulletList items={scene.bullets.length ? scene.bullets : [scene.narration]} />
  </div>
);

const PrepareVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gridTemplateColumns: '250px 1fr', gap: 28, alignItems: 'center'}}>
    <div style={{height: 430, borderRadius: 42, backgroundColor: COLORS.mint, border: `2px solid ${COLORS.line}`, display: 'grid', placeItems: 'center'}}>
      <ClipboardIcon size={188} />
    </div>
    <BulletList items={scene.bullets.length ? scene.bullets : [scene.narration]} />
  </div>
);

const SummaryVisual = ({scene}: {scene: LegalVideoScene}) => (
  <div style={{width: '100%', display: 'grid', gap: 24}}>
    <div style={{height: 225, borderRadius: 40, backgroundColor: COLORS.cream, border: `2px solid ${COLORS.line}`, display: 'grid', gridTemplateColumns: '190px 1fr', alignItems: 'center', padding: '28px 46px'}}>
      <LightbulbIcon size={150} />
      <div style={{fontSize: 42, lineHeight: 1.16, fontWeight: 920, color: COLORS.deep}}>Giữ lại những ý quan trọng nhất</div>
    </div>
    <BulletList items={scene.bullets.length ? scene.bullets : [scene.narration]} />
  </div>
);

function SceneVisual({scene, document}: {scene: LegalVideoScene; document: LegalVideoProps['storyboard']['document']}) {
  if (scene.kind === 'intro') return <IntroVisual document={document} />;
  if (scene.kind === 'timeline') return <TimelineVisual scene={scene} />;
  if (scene.kind === 'audience') return <AudienceVisual scene={scene} />;
  if (scene.kind === 'change') return <ChangeVisual scene={scene} />;
  if (scene.kind === 'process') return <ProcessVisual scene={scene} />;
  if (scene.kind === 'numbers') return <NumberVisual scene={scene} />;
  if (scene.kind === 'prepare') return <PrepareVisual scene={scene} />;
  return <SummaryVisual scene={scene} />;
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
  const fontSize = caption.text.length > 175 ? 27 : caption.text.length > 125 ? 30 : 34;

  return (
    <div
      style={{
        position: 'absolute',
        left: 52,
        right: 52,
        bottom: 48,
        height: 196,
        zIndex: 30,
        boxSizing: 'border-box',
        padding: '28px 34px',
        borderRadius: 31,
        border: `2px solid ${COLORS.line}`,
        backgroundColor: COLORS.card,
        boxShadow: '0 22px 58px rgba(37,82,71,.16)',
        color: COLORS.ink,
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      <div style={{...readableAlign(caption.text, 150), width: '100%', fontSize, lineHeight: 1.34, fontWeight: 740, letterSpacing: '-0.009em'}}>
        {caption.text}
      </div>
    </div>
  );
};

const SceneAudio = ({scene}: {scene: LegalVideoScene}) => {
  const {fps} = useVideoConfig();
  let elapsed = 0;
  const chunks = (scene.audioChunks ?? []).map((chunk) => {
    const from = Math.round(elapsed * fps);
    const durationInFrames = Math.max(1, Math.ceil(chunk.durationSeconds * fps));
    elapsed += chunk.durationSeconds;
    return {chunk, from, durationInFrames};
  });
  return (
    <>
      {chunks.map(({chunk, from, durationInFrames}) => (
        <Sequence key={chunk.id} from={from} durationInFrames={durationInFrames} layout="none">
          <Audio src={chunk.url} volume={.97} />
        </Sequence>
      ))}
    </>
  );
};

export const LegalVideo = ({storyboard}: LegalVideoProps) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{overflow: 'hidden', fontFamily: 'Arial, "DejaVu Sans", sans-serif', backgroundColor: COLORS.pale, color: COLORS.ink}}>
      <div style={{position: 'absolute', inset: 0, opacity: .24, backgroundImage: 'linear-gradient(rgba(71,127,111,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(71,127,111,.08) 1px, transparent 1px)', backgroundSize: '76px 76px'}} />
      <div style={{position: 'absolute', width: 430, height: 430, borderRadius: '50%', backgroundColor: COLORS.peach, left: -245, top: 1010, opacity: .56}} />
      <div style={{position: 'absolute', width: 310, height: 310, borderRadius: '50%', backgroundColor: COLORS.sky, right: -145, top: 350, opacity: .72}} />
      <div style={{position: 'absolute', width: 170, height: 170, borderRadius: 48, backgroundColor: COLORS.mint, right: 82, top: 1180, transform: 'rotate(12deg)', opacity: .7}} />

      <div style={{position: 'absolute', top: 48, left: 52, right: 52, height: 84, zIndex: 40, padding: '0 26px', borderRadius: 27, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.card, border: `2px solid ${COLORS.line}`, boxShadow: '0 13px 38px rgba(37,82,71,.07)'}}>
        <div style={{fontSize: 27, fontWeight: 920, letterSpacing: '-0.025em', color: COLORS.deep}}>
          {storyboard.document.number}
        </div>
        <div style={{fontSize: 20, fontWeight: 900, letterSpacing: '0.11em', color: COLORS.muted}}>
          VIDEO CHI TIẾT
        </div>
      </div>

      <div style={{position: 'absolute', top: 151, left: 56, right: 56, height: 7, borderRadius: 99, backgroundColor: COLORS.line, zIndex: 40}}>
        <div style={{width: `${interpolate(frame, [0, durationInFrames - 1], [0, 100], clamp)}%`, height: '100%', borderRadius: 99, backgroundColor: COLORS.green}} />
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
