import type {ReactNode} from 'react';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {CAPTIONS, SCENES, sceneStartFrame, type Scene} from './data';

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

const CheckIcon = ({size = 48}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill={COLORS.pale} stroke={COLORS.green} strokeWidth="4" />
    <path d="M18 33.5 27.5 43 47 22" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LaptopIcon = () => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame, [0, 28, 56], [0.92, 1.05, 0.92], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  return (
    <div style={{position: 'relative', width: 420, height: 330, scale: pulse}}>
      <div
        style={{
          position: 'absolute',
          inset: '22px 38px 72px',
          borderRadius: 30,
          border: `8px solid ${COLORS.ink}`,
          background: 'linear-gradient(145deg, #ffffff, #dff0e8)',
          boxShadow: '0 28px 70px rgba(16,42,33,.16)',
        }}
      >
        <div style={{display: 'grid', placeItems: 'center', height: '100%'}}>
          <svg width="180" height="180" viewBox="0 0 180 180" fill="none" aria-hidden="true">
            <path d="M52 128h80c22 0 36-13 36-32 0-18-13-31-31-32C131 38 111 22 86 22 57 22 34 43 31 71 14 76 4 89 4 105c0 13 7 23 18 29" fill="#dff0e8" stroke={COLORS.green} strokeWidth="8" strokeLinecap="round" />
            <path d="M90 117V68m0 0L68 90m22-22 22 22" stroke={COLORS.orange} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 34,
          height: 52,
          borderRadius: '0 0 34px 34px',
          background: COLORS.ink,
          clipPath: 'polygon(10% 0,90% 0,100% 100%,0 100%)',
        }}
      />
    </div>
  );
};

const CalendarCard = ({label, value, delay}: {label: string; value: string; delay: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const rise = spring({frame: frame - delay, fps, config: {damping: 18, stiffness: 120}});
  return (
    <div
      style={{
        flex: 1,
        minHeight: 260,
        padding: '42px 38px',
        borderRadius: 34,
        background: COLORS.card,
        border: `2px solid ${COLORS.line}`,
        boxShadow: '0 24px 70px rgba(16,42,33,.09)',
        opacity: interpolate(rise, [0, 1], [0, 1], clamp),
        translate: `0 ${interpolate(rise, [0, 1], [55, 0], clamp)}px`,
      }}
    >
      <div style={{fontSize: 26, fontWeight: 800, color: COLORS.muted, marginBottom: 24}}>{label}</div>
      <div style={{fontSize: 55, lineHeight: 1.05, fontWeight: 950, letterSpacing: '-0.045em', color: COLORS.ink}}>{value}</div>
    </div>
  );
};

const BulletList = ({items, compact = false}: {items: string[]; compact?: boolean}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{display: 'grid', gap: compact ? 22 : 28, width: '100%'}}>
      {items.map((item, index) => {
        const appear = spring({frame: frame - 12 - index * 10, fps, config: {damping: 20, stiffness: 130}});
        return (
          <div
            key={item}
            style={{
              display: 'grid',
              gridTemplateColumns: `${compact ? 52 : 62}px 1fr`,
              alignItems: 'center',
              gap: compact ? 18 : 24,
              padding: compact ? '20px 24px' : '26px 28px',
              borderRadius: 25,
              background: 'rgba(255,255,255,.94)',
              border: `2px solid ${COLORS.line}`,
              boxShadow: '0 16px 44px rgba(16,42,33,.07)',
              opacity: interpolate(appear, [0, 1], [0, 1], clamp),
              translate: `${interpolate(appear, [0, 1], [50, 0], clamp)}px 0`,
            }}
          >
            <CheckIcon size={compact ? 48 : 56} />
            <div style={{fontSize: compact ? 32 : 37, lineHeight: 1.25, fontWeight: 780, color: COLORS.ink}}>{item}</div>
          </div>
        );
      })}
    </div>
  );
};

const SceneShell = ({scene, children}: {scene: Scene; children: ReactNode}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 110}});
  const exit = interpolate(frame, [scene.durationInFrames - 20, scene.durationInFrames], [1, 0], {
    ...clamp,
    easing: Easing.bezier(0.4, 0, 1, 1),
  });
  return (
    <AbsoluteFill
      style={{
        padding: '170px 72px 285px',
        opacity: interpolate(enter, [0, 1], [0, 1], clamp) * exit,
      }}
    >
      <div
        style={{
          marginBottom: 30,
          fontSize: 24,
          lineHeight: 1,
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
          fontSize: scene.kind === 'intro' ? 84 : scene.kind === 'electronic' ? 73 : 68,
          lineHeight: 1.05,
          letterSpacing: '-0.052em',
          fontWeight: 950,
          color: COLORS.ink,
          opacity: interpolate(enter, [0, 1], [0, 1], clamp),
          translate: `0 ${interpolate(enter, [0, 1], [50, 0], clamp)}px`,
        }}
      >
        {scene.title}
      </h1>
      {scene.subtitle ? (
        <p
          style={{
            margin: '26px 0 0',
            maxWidth: 860,
            fontSize: 34,
            lineHeight: 1.35,
            fontWeight: 650,
            color: COLORS.muted,
            opacity: interpolate(frame, [16, 34], [0, 1], clamp),
          }}
        >
          {scene.subtitle}
        </p>
      ) : null}
      <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 36}}>{children}</div>
    </AbsoluteFill>
  );
};

const IntroScene = ({scene}: {scene: Scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame: frame - 12, fps, config: {damping: 16, stiffness: 125}});
  return (
    <SceneShell scene={scene}>
      <div style={{width: '100%', display: 'grid', placeItems: 'center'}}>
        <div
          style={{
            width: 560,
            height: 560,
            borderRadius: 140,
            display: 'grid',
            placeItems: 'center',
            background: `linear-gradient(145deg, ${COLORS.green}, #124532)`,
            boxShadow: '0 45px 100px rgba(16,42,33,.25)',
            scale: interpolate(pop, [0, 1], [0.75, 1], {...clamp, output: 'perceptual-scale'}),
            rotate: `${interpolate(pop, [0, 1], [-5, 0], clamp)}deg`,
          }}
        >
          <div style={{textAlign: 'center', color: 'white'}}>
            <div style={{fontSize: 190, lineHeight: 0.9, fontWeight: 950, letterSpacing: '-0.08em'}}>89</div>
            <div style={{marginTop: 26, fontSize: 34, fontWeight: 850, letterSpacing: '0.05em'}}>TT-BTC · 2026</div>
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

const TimelineScene = ({scene}: {scene: Scene}) => (
  <SceneShell scene={scene}>
    <div style={{width: '100%'}}>
      <div style={{display: 'flex', gap: 26, marginBottom: 32}}>
        <CalendarCard label="BAN HÀNH" value="30/06/2026" delay={8} />
        <CalendarCard label="HIỆU LỰC" value="01/07/2026" delay={18} />
      </div>
      <BulletList items={scene.bullets ?? []} compact />
    </div>
  </SceneShell>
);

const ElectronicScene = ({scene}: {scene: Scene}) => (
  <SceneShell scene={scene}>
    <div style={{display: 'grid', placeItems: 'center', width: '100%'}}>
      <LaptopIcon />
      <div
        style={{
          marginTop: 8,
          padding: '18px 30px',
          borderRadius: 999,
          background: '#fff3ed',
          color: '#9d3f1d',
          fontSize: 29,
          fontWeight: 850,
        }}
      >
        Hồ sơ · giải trình · trao đổi trên môi trường số
      </div>
    </div>
  </SceneShell>
);

const BenefitsScene = ({scene}: {scene: Scene}) => (
  <SceneShell scene={scene}>
    <BulletList items={scene.bullets ?? []} />
  </SceneShell>
);

const PrepareScene = ({scene}: {scene: Scene}) => (
  <SceneShell scene={scene}>
    <div style={{width: '100%'}}>
      <BulletList items={scene.bullets ?? []} compact />
      <div
        style={{
          marginTop: 30,
          padding: '22px 28px',
          borderRadius: 24,
          border: '2px solid rgba(227,106,62,.28)',
          background: '#fff8f4',
          color: '#6b321f',
          fontSize: 26,
          lineHeight: 1.4,
          fontWeight: 700,
        }}
      >
        Video là nội dung tóm tắt hỗ trợ tiếp cận, không thay thế toàn văn và hướng dẫn của cơ quan có thẩm quyền.
      </div>
    </div>
  </SceneShell>
);

const SceneRenderer = ({scene}: {scene: Scene}) => {
  if (scene.kind === 'intro') return <IntroScene scene={scene} />;
  if (scene.kind === 'timeline') return <TimelineScene scene={scene} />;
  if (scene.kind === 'electronic') return <ElectronicScene scene={scene} />;
  if (scene.kind === 'benefits') return <BenefitsScene scene={scene} />;
  return <PrepareScene scene={scene} />;
};

const CaptionBar = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const currentMs = (frame / fps) * 1000;
  const caption = CAPTIONS.find((item) => currentMs >= item.startMs && currentMs < item.endMs);
  if (!caption) return null;
  const localMs = currentMs - caption.startMs;
  const duration = caption.endMs - caption.startMs;
  return (
    <div
      style={{
        position: 'absolute',
        left: 56,
        right: 56,
        bottom: 72,
        zIndex: 20,
        padding: '25px 31px',
        borderRadius: 27,
        background: 'rgba(16,42,33,.96)',
        boxShadow: '0 25px 70px rgba(16,42,33,.23)',
        color: 'white',
        fontSize: 31,
        lineHeight: 1.35,
        fontWeight: 700,
        textAlign: 'center',
        opacity: interpolate(localMs, [0, 160, duration - 180, duration], [0, 1, 1, 0], clamp),
      }}
    >
      {caption.text}
    </div>
  );
};

export const ThongTu89 = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        fontFamily: 'Arial, "DejaVu Sans", sans-serif',
        background: `radial-gradient(circle at 92% 5%, #d4eee2 0, transparent 32%), linear-gradient(155deg, #fbfdfc 0%, ${COLORS.pale} 100%)`,
      }}
    >
      <div style={{position: 'absolute', width: 520, height: 520, borderRadius: '50%', background: 'rgba(227,106,62,.08)', left: -240, top: 920}} />
      <div style={{position: 'absolute', width: 330, height: 330, borderRadius: '50%', border: `4px solid rgba(31,107,80,.08)`, right: -120, top: 300}} />
      <div style={{position: 'absolute', top: 62, left: 68, zIndex: 30, fontSize: 34, fontWeight: 950, letterSpacing: '-0.05em', color: COLORS.ink}}>
        Thuế<span style={{color: COLORS.orange}}>.</span>
      </div>
      <div style={{position: 'absolute', top: 78, right: 68, zIndex: 30, fontSize: 22, fontWeight: 800, color: COLORS.muted}}>TÓM TẮT VĂN BẢN</div>
      <div style={{position: 'absolute', top: 122, left: 68, right: 68, height: 7, borderRadius: 99, background: 'rgba(31,107,80,.12)', zIndex: 30}}>
        <div
          style={{
            width: `${interpolate(frame, [0, durationInFrames - 1], [0, 100], clamp)}%`,
            height: '100%',
            borderRadius: 99,
            background: `linear-gradient(90deg, ${COLORS.green}, ${COLORS.orange})`,
          }}
        />
      </div>
      {SCENES.map((scene, index) => (
        <Sequence key={scene.id} from={sceneStartFrame(index)} durationInFrames={scene.durationInFrames} layout="absolute-fill">
          <SceneRenderer scene={scene} />
          <Audio src={staticFile(scene.audio)} volume={1} />
        </Sequence>
      ))}
      <div style={{position: 'absolute', left: 72, bottom: 235, zIndex: 15, color: COLORS.muted, fontSize: 20, fontWeight: 700}}>
        Nguồn: Cổng TTĐT Chính phủ và Báo Điện tử Chính phủ
      </div>
      <CaptionBar />
    </AbsoluteFill>
  );
};
