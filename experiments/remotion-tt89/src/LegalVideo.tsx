import type {ReactNode} from 'react';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig,
  type CalculateMetadataFunction,
} from 'remotion';

export type LegalVideoAudioChunk = {id: string; text: string; url: string; durationSeconds: number};
export type LegalVideoVisualMode = 'document' | 'timeline' | 'network' | 'contrast' | 'flow' | 'metric' | 'checklist' | 'decision' | 'takeaways';
export type LegalVideoScene = {
  id: string;
  kind: 'intro' | 'timeline' | 'audience' | 'change' | 'process' | 'numbers' | 'prepare' | 'summary';
  category: string; eyebrow: string; title: string; subtitle?: string; bullets: string[];
  narration: string; captionChunks: string[]; visualMode?: LegalVideoVisualMode;
  visualKeywords?: string[]; audioChunks?: LegalVideoAudioChunk[];
};
export type LegalVideoProps = {storyboard: {
  document: {number: string; title: string; type: string; issuer: string; issued_date: string | null; effective_date: string | null};
  fps: number; width: number; height: number; scenes: LegalVideoScene[];
}};

const COLORS = {
  ink: '#173a31', deep: '#24584a', green: '#4a8b78', mint: '#dceee7', mintStrong: '#bcded1',
  sky: '#e4eff5', blue: '#9fc4d6', peach: '#f5e2d7', coral: '#db8d72', cream: '#f7f1e6',
  pale: '#f6f9f7', card: '#fffefd', line: '#c8ddd5', muted: '#5f776e', yellow: '#e7c968', white: '#ffffff',
};
const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
function readableAlign(text: string, justifyFrom = 165) {
  return {textAlign: text.length >= justifyFrom ? ('justify' as const) : ('left' as const), textAlignLast: 'left' as const};
}

export const defaultLegalVideoProps: LegalVideoProps = {storyboard: {
  document: {number: '94/2026/TT-BTC', title: 'Quản lý tuân thủ và quản lý rủi ro trong quản lý thuế', type: 'Thông tư', issuer: 'Bộ Tài chính', issued_date: '2026-07-01', effective_date: '2026-07-01'},
  fps: 30, width: 1080, height: 1920,
  scenes: [{
    id: 'scene-1', kind: 'intro', category: 'overview', eyebrow: 'VĂN BẢN TRONG 1 MẠCH KỂ', title: '94/2026/TT-BTC',
    subtitle: 'Quản lý tuân thủ và quản lý rủi ro trong quản lý thuế', bullets: [],
    narration: 'Thông tư quy định về quản lý tuân thủ và quản lý rủi ro trong quản lý thuế.',
    captionChunks: ['Thông tư quy định về quản lý tuân thủ và quản lý rủi ro trong quản lý thuế.'],
    visualMode: 'document', visualKeywords: ['Người nộp thuế', 'Cơ quan thuế', 'Quản lý rủi ro'], audioChunks: [],
  }],
}};

function sceneAudioSeconds(scene: LegalVideoScene) {
  return (scene.audioChunks ?? []).reduce((sum, chunk) => sum + Math.max(0, chunk.durationSeconds), 0);
}
function sceneFrames(scene: LegalVideoScene, fps: number) {
  const audio = sceneAudioSeconds(scene);
  return Math.max(4.5 * fps, Math.ceil((audio > 0 ? audio + .55 : 6.2) * fps));
}
function sceneStart(scenes: LegalVideoScene[], index: number, fps: number) {
  return scenes.slice(0, index).reduce((sum, scene) => sum + sceneFrames(scene, fps), 0);
}
function totalFrames(props: LegalVideoProps) {
  const fps = props.storyboard.fps || 30;
  return Math.max(fps, props.storyboard.scenes.reduce((sum, scene) => sum + sceneFrames(scene, fps), 0));
}
export const calculateLegalVideoMetadata: CalculateMetadataFunction<LegalVideoProps> = ({props}) => ({
  durationInFrames: totalFrames(props), fps: props.storyboard.fps || 30,
  width: props.storyboard.width || 1080, height: props.storyboard.height || 1920,
});

const DocumentGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <rect x="24" y="12" width="72" height="96" rx="16" fill={COLORS.card} stroke={COLORS.deep} strokeWidth="4" />
    <path d="M72 12v25h24" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="4" strokeLinejoin="round" />
    <path d="M39 55h43M39 71h43M39 87h28" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" />
  </svg>
);
const PeopleGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <circle cx="60" cy="38" r="18" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="4" />
    <circle cx="24" cy="50" r="13" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="3.5" />
    <circle cx="96" cy="50" r="13" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="3.5" />
    <path d="M31 104c2-25 12-39 29-39s27 14 29 39" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="4" />
    <path d="M5 104c2-18 9-29 20-29 9 0 16 6 20 17M75 92c4-11 11-17 20-17 11 0 18 11 20 29" stroke={COLORS.deep} strokeWidth="4" strokeLinecap="round" />
  </svg>
);
const ClockGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <circle cx="60" cy="62" r="43" fill={COLORS.cream} stroke={COLORS.deep} strokeWidth="5" />
    <path d="M60 36v29l21 13" stroke={COLORS.green} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M43 12h34" stroke={COLORS.coral} strokeWidth="7" strokeLinecap="round" />
  </svg>
);
const DatabaseGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <ellipse cx="60" cy="28" rx="39" ry="16" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="4" />
    <path d="M21 28v31c0 9 17 16 39 16s39-7 39-16V28M21 58v31c0 9 17 16 39 16s39-7 39-16V58" stroke={COLORS.deep} strokeWidth="4" />
    <path d="M30 55c7 6 18 9 30 9 13 0 24-3 31-9M30 84c7 6 18 9 30 9 13 0 24-3 31-9" stroke={COLORS.green} strokeWidth="4" strokeLinecap="round" />
  </svg>
);
const ShieldGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <path d="M60 10 99 25v31c0 25-16 43-39 54-23-11-39-29-39-54V25L60 10Z" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="4" />
    <path d="m41 58 13 13 26-29" stroke={COLORS.green} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const AlertGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <path d="M60 12 108 99H12L60 12Z" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="4" strokeLinejoin="round" />
    <path d="M60 42v27" stroke={COLORS.coral} strokeWidth="8" strokeLinecap="round" /><circle cx="60" cy="84" r="5" fill={COLORS.coral} />
  </svg>
);
const FlowGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <rect x="9" y="18" width="31" height="31" rx="9" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="4" />
    <rect x="80" y="18" width="31" height="31" rx="9" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="4" />
    <rect x="44" y="75" width="31" height="31" rx="9" fill={COLORS.mint} stroke={COLORS.deep} strokeWidth="4" />
    <path d="M40 33h40M95 49v19c0 12-9 22-20 22M25 49v19c0 12 8 22 19 22" stroke={COLORS.green} strokeWidth="5" strokeLinecap="round" />
    <path d="m72 81 8 9-8 9" stroke={COLORS.green} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CheckGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <rect x="16" y="15" width="88" height="90" rx="22" fill={COLORS.card} stroke={COLORS.deep} strokeWidth="4" />
    <path d="m32 46 8 8 13-16M62 47h24M32 76l8 8 13-16M62 77h24" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PercentGlyph = ({size = 96}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <circle cx="60" cy="60" r="47" fill={COLORS.cream} stroke={COLORS.deep} strokeWidth="4" />
    <circle cx="43" cy="42" r="10" fill={COLORS.sky} stroke={COLORS.deep} strokeWidth="3" />
    <circle cx="78" cy="79" r="10" fill={COLORS.peach} stroke={COLORS.deep} strokeWidth="3" />
    <path d="m40 86 42-51" stroke={COLORS.deep} strokeWidth="7" strokeLinecap="round" />
  </svg>
);

function KeywordGlyph({text, size = 82}: {text: string; size?: number}) {
  if (/ngày|thời hạn|hiệu lực|chậm nhất|mốc/iu.test(text)) return <ClockGlyph size={size} />;
  if (/người|cơ quan|công chức|tổ chức|cá nhân|đối tượng/iu.test(text)) return <PeopleGlyph size={size} />;
  if (/dữ liệu|hệ thống|phân hệ|tích hợp|cơ sở/iu.test(text)) return <DatabaseGlyph size={size} />;
  if (/rủi ro|sự cố|không đáp ứng|vi phạm|cảnh báo/iu.test(text)) return <AlertGlyph size={size} />;
  if (/phải|trách nhiệm|kiểm tra|thực hiện|chuẩn bị/iu.test(text)) return <CheckGlyph size={size} />;
  if (/\d+\s*%|đồng|triệu|tỷ|mức|tỷ lệ/iu.test(text)) return <PercentGlyph size={size} />;
  if (/quy trình|trình tự|chuyển|gửi|tiếp nhận|xử lý/iu.test(text)) return <FlowGlyph size={size} />;
  if (/bảo đảm|tuân thủ|an toàn|bảo mật/iu.test(text)) return <ShieldGlyph size={size} />;
  return <DocumentGlyph size={size} />;
}

function normalizeVisualText(value: string) {
  return value.replace(/\s+/gu, ' ').replace(/(?:…|\.{3,})$/u, '').trim();
}
function standaloneVisualFragment(value: string) {
  const text = normalizeVisualText(value);
  const words = text.split(/\s+/gu).filter(Boolean);
  return !/\d/u.test(text) && words.length <= 2 && text.length < 24;
}
function splitVisualText(value: string) {
  const normalized = normalizeVisualText(value);
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?;:])\s+/gu)
    .map(normalizeVisualText)
    .filter((item) => item.length >= 12 && !/[,;:]$/u.test(item));
}
function visualItems(scene: LegalVideoScene, limit = 3) {
  const sources = [
    ...(scene.visualKeywords?.length ? scene.visualKeywords : []),
    ...scene.bullets,
  ];
  const unique: string[] = [];
  for (const raw of sources) {
    const item = normalizeVisualText(raw);
    if (!item || /[,;:]$/u.test(item)) continue;
    if (scene.kind !== 'intro' && standaloneVisualFragment(item)) continue;
    const key = item.toLocaleLowerCase('vi');
    if (!unique.some((existing) => existing.toLocaleLowerCase('vi') === key)) unique.push(item);
    if (unique.length >= limit) break;
  }
  if (unique.length) return unique;
  return splitVisualText(scene.narration)
    .filter((item) => scene.kind === 'intro' || !standaloneVisualFragment(item))
    .slice(0, limit);
}

function sceneVisualMode(scene: LegalVideoScene): LegalVideoVisualMode {
  if (scene.visualMode) return scene.visualMode;
  if (scene.kind === 'intro') return 'document';
  if (scene.kind === 'timeline') return 'timeline';
  if (scene.kind === 'audience') return 'network';
  if (scene.kind === 'change') return 'contrast';
  if (scene.kind === 'process') return 'flow';
  if (scene.kind === 'numbers') return 'metric';
  if (scene.kind === 'prepare') return 'checklist';
  return 'decision';
}
function scenePalette(scene: LegalVideoScene) {
  const mode = sceneVisualMode(scene);
  if (mode === 'timeline') return {primary: COLORS.sky, accent: COLORS.blue};
  if (mode === 'network') return {primary: COLORS.mint, accent: COLORS.green};
  if (mode === 'contrast') return {primary: COLORS.peach, accent: COLORS.coral};
  if (mode === 'flow') return {primary: COLORS.sky, accent: COLORS.green};
  if (mode === 'metric') return {primary: COLORS.cream, accent: COLORS.yellow};
  if (mode === 'checklist') return {primary: COLORS.mint, accent: COLORS.green};
  if (mode === 'takeaways') return {primary: COLORS.cream, accent: COLORS.coral};
  return {primary: COLORS.mint, accent: COLORS.green};
}

const SceneBackdrop = ({scene}: {scene: LegalVideoScene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const palette = scenePalette(scene);
  const drift = interpolate(frame, [0, 7 * fps], [0, 42], {...clamp, easing: Easing.inOut(Easing.quad)});
  const pulse = 1 + Math.sin(frame / 22) * .025;
  return <AbsoluteFill style={{overflow: 'hidden'}}>
    <div style={{position: 'absolute', width: 430, height: 430, borderRadius: '50%', backgroundColor: palette.primary, right: -205 + drift, top: 300, opacity: .66, scale: pulse}} />
    <div style={{position: 'absolute', width: 320, height: 320, borderRadius: 86, backgroundColor: COLORS.peach, left: -190, bottom: 490 - drift * .35, opacity: .38, rotate: `${-12 + drift * .08}deg`}} />
    <div style={{position: 'absolute', width: 170, height: 170, borderRadius: 48, border: `4px solid ${palette.accent}`, right: 86, bottom: 390, opacity: .16, rotate: `${12 - drift * .12}deg`}} />
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, opacity: .12}} aria-hidden="true">
      <path d="M-40 660 C220 530, 365 760, 590 625 S970 460, 1130 620" fill="none" stroke={palette.accent} strokeWidth="5" strokeDasharray="18 20" strokeDashoffset={-frame * .7} />
    </svg>
  </AbsoluteFill>;
};

const SceneShell = ({scene, sceneIndex, sceneCount, children}: {scene: LegalVideoScene; sceneIndex: number; sceneCount: number; children: ReactNode}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 26, stiffness: 95, mass: .9}});
  const titleSize = scene.kind === 'intro' ? 76 : scene.title.length > 72 ? 48 : scene.title.length > 52 ? 54 : 62;
  return <AbsoluteFill style={{padding: '184px 60px 330px'}}>
    <div style={{height: '100%', display: 'flex', flexDirection: 'column', opacity: enter, translate: `0 ${interpolate(enter, [0, 1], [26, 0], clamp)}px`}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 16, marginBottom: 22}}>
        <div style={{minWidth: 68, height: 68, borderRadius: 22, display: 'grid', placeItems: 'center', backgroundColor: scenePalette(scene).primary, border: `2px solid ${COLORS.line}`, color: COLORS.deep, fontSize: 25, fontWeight: 950}}>{String(sceneIndex + 1).padStart(2, '0')}</div>
        <div style={{padding: '11px 17px', borderRadius: 999, backgroundColor: COLORS.card, border: `2px solid ${COLORS.line}`, color: COLORS.green, fontSize: 20, fontWeight: 920, letterSpacing: '.095em'}}>{scene.eyebrow}</div>
        <div style={{marginLeft: 'auto', fontSize: 19, fontWeight: 850, color: COLORS.muted}}>{sceneIndex + 1}/{sceneCount}</div>
      </div>
      <h1 style={{margin: 0, maxWidth: 950, fontSize: titleSize, lineHeight: 1.08, letterSpacing: '-.043em', fontWeight: 950, color: COLORS.ink}}>{scene.title}</h1>
      {scene.subtitle ? <p style={{...readableAlign(scene.subtitle, 190), margin: '19px 0 0', maxWidth: 920, fontSize: 29, lineHeight: 1.38, fontWeight: 630, color: COLORS.muted}}>{scene.subtitle}</p> : null}
      <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, paddingTop: 30}}>{children}</div>
    </div>
  </AbsoluteFill>;
};

const DocumentVisual = ({scene, document}: {scene: LegalVideoScene; document: LegalVideoProps['storyboard']['document']}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig(); const items = visualItems(scene, 3);
  const appear = spring({frame: frame - 5, fps, config: {damping: 24, stiffness: 90}});
  return <div style={{width: '100%', minHeight: 620, position: 'relative', display: 'grid', placeItems: 'center'}}>
    <div style={{width: 470, height: 470, borderRadius: 120, display: 'grid', placeItems: 'center', backgroundColor: COLORS.mint, border: `3px solid ${COLORS.line}`, boxShadow: '0 30px 80px rgba(36,88,74,.13)', scale: interpolate(appear, [0, 1], [.92, 1], clamp)}}>
      <div style={{textAlign: 'center'}}><DocumentGlyph size={190} /><div style={{fontSize: 48, fontWeight: 950, color: COLORS.deep, letterSpacing: '-.04em'}}>{document.number.split('/')[0]}</div><div style={{marginTop: 8, fontSize: 25, fontWeight: 760, color: COLORS.muted}}>{document.type} · {document.issuer}</div></div>
    </div>
    {items.map((item, index) => {
      const angle = [-155, -25, 92][index] * Math.PI / 180; const radius = index === 2 ? 350 : 365;
      const x = Math.cos(angle) * radius; const y = Math.sin(angle) * radius * .62;
      const card = spring({frame: frame - 14 - index * 8, fps, config: {damping: 23, stiffness: 105}});
      return <div key={item} style={{position: 'absolute', left: '50%', top: '50%', width: 290, minHeight: 126, marginLeft: -145, marginTop: -63, padding: '20px 22px', borderRadius: 28, backgroundColor: index === 0 ? COLORS.peach : index === 1 ? COLORS.sky : COLORS.cream, border: `2px solid ${COLORS.line}`, boxShadow: '0 16px 42px rgba(36,88,74,.10)', display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 14, opacity: card, translate: `${x * card}px ${y * card}px`}}><KeywordGlyph text={item} size={62} /><div style={{fontSize: 24, lineHeight: 1.24, fontWeight: 820, color: COLORS.ink}}>{item}</div></div>;
    })}
  </div>;
};

function numberParts(item: string) {
  const match = item.match(/\b\d+(?:[.,/]\d+)*(?:\s*%|\s*(?:đồng|triệu|tỷ))?/iu);
  if (!match) return {number: '', description: item};
  return {number: match[0], description: item.replace(match[0], '').replace(/^\s*[:–—-]?\s*/u, '').trim()};
}

const TimelineVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig(); const items = visualItems(scene, 3);
  const line = interpolate(frame, [8, 38], [0, 1], clamp);
  if (items.length === 1) {
    const parts = numberParts(items[0]);
    return <div style={{width: '100%', minHeight: 560, borderRadius: 52, backgroundColor: COLORS.sky, border: `2px solid ${COLORS.line}`, display: 'grid', gridTemplateColumns: '290px 1fr', alignItems: 'center', padding: '58px 54px', boxShadow: '0 24px 62px rgba(36,88,74,.10)'}}>
      <div style={{width: 240, height: 240, borderRadius: 72, display: 'grid', placeItems: 'center', backgroundColor: COLORS.card, border: `2px solid ${COLORS.line}`, scale: spring({frame: frame - 5, fps, config: {damping: 23, stiffness: 95}})}}><ClockGlyph size={170} /></div>
      <div>{parts.number ? <div style={{fontSize: 76, lineHeight: 1, fontWeight: 950, color: COLORS.deep, letterSpacing: '-.055em'}}>{parts.number}</div> : null}<div style={{...readableAlign(parts.description || items[0], 150), marginTop: parts.number ? 24 : 0, fontSize: 39, lineHeight: 1.22, fontWeight: 880, color: COLORS.ink}}>{parts.description || items[0]}</div></div>
    </div>;
  }
  return <div style={{width: '100%', minHeight: 590, position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 20, alignItems: 'center'}}>
    <div style={{position: 'absolute', left: 85, right: 85, top: '50%', height: 8, borderRadius: 99, backgroundColor: COLORS.line}}><div style={{height: '100%', width: `${line * 100}%`, borderRadius: 99, backgroundColor: COLORS.green}} /></div>
    {items.map((item, index) => {const appear = spring({frame: frame - 12 - index * 10, fps, config: {damping: 23, stiffness: 105}}); return <div key={item} style={{position: 'relative', zIndex: 2, minHeight: 360, padding: '34px 28px', borderRadius: 38, backgroundColor: index % 2 ? COLORS.card : COLORS.cream, border: `2px solid ${COLORS.line}`, boxShadow: '0 20px 52px rgba(36,88,74,.09)', opacity: appear, translate: `0 ${interpolate(appear, [0, 1], [30, 0], clamp)}px`}}><div style={{width: 105, height: 105, borderRadius: 34, display: 'grid', placeItems: 'center', backgroundColor: COLORS.sky, border: `2px solid ${COLORS.line}`}}><KeywordGlyph text={item} size={76} /></div><div style={{marginTop: 32, fontSize: item.length > 74 ? 28 : 32, lineHeight: 1.25, fontWeight: 860, color: COLORS.ink}}>{item}</div></div>;})}
  </div>;
};

const NetworkVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig(); const items = visualItems(scene, 3);
  return <div style={{width: '100%', minHeight: 650, position: 'relative', display: 'grid', placeItems: 'center'}}>
    <svg width="920" height="620" viewBox="0 0 920 620" style={{position: 'absolute'}} aria-hidden="true">{items.map((_item, index) => {const positions = [[155,135],[765,135],[460,520]]; const [x,y] = positions[index]; const progress = interpolate(frame, [12 + index * 8, 34 + index * 8], [0,1], clamp); return <line key={index} x1="460" y1="305" x2={460 + (x - 460) * progress} y2={305 + (y - 305) * progress} stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeDasharray="13 14" />;})}</svg>
    <div style={{width: 265, height: 265, borderRadius: '50%', display: 'grid', placeItems: 'center', backgroundColor: COLORS.mint, border: `4px solid ${COLORS.green}`, boxShadow: '0 24px 62px rgba(36,88,74,.14)', scale: spring({frame, fps, config: {damping: 24, stiffness: 90}})}}><div style={{textAlign: 'center'}}><ShieldGlyph size={112} /><div style={{fontSize: 27, fontWeight: 920, color: COLORS.deep}}>PHẠM VI<br />ÁP DỤNG</div></div></div>
    {items.map((item,index) => {const positions = [{left:5,top:20},{right:5,top:20},{left:290,bottom:-6}]; const appear = spring({frame: frame - 12 - index * 8, fps, config: {damping:23,stiffness:105}}); return <div key={item} style={{position:'absolute',...positions[index],width:index===2?340:285,minHeight:170,padding:'24px',borderRadius:34,backgroundColor:index===0?COLORS.peach:index===1?COLORS.sky:COLORS.card,border:`2px solid ${COLORS.line}`,boxShadow:'0 18px 48px rgba(36,88,74,.10)',opacity:appear,scale:interpolate(appear,[0,1],[.92,1],clamp)}}><KeywordGlyph text={item} size={68}/><div style={{marginTop:13,fontSize:item.length>74?25:28,lineHeight:1.24,fontWeight:840,color:COLORS.ink}}>{item}</div></div>;})}
  </div>;
};

const FlowVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame = useCurrentFrame(); const {fps} = useVideoConfig(); const items = visualItems(scene, 3);
  if (items.length === 1) {
    const item = items[0];
    const appear = spring({frame: frame - 5, fps, config: {damping: 24, stiffness: 96}});
    return <div style={{width:'100%',minHeight:560,padding:'54px 50px',borderRadius:52,backgroundColor:COLORS.sky,border:`3px solid ${COLORS.line}`,boxShadow:'0 28px 72px rgba(36,88,74,.12)',display:'grid',gridTemplateColumns:'250px 1fr',alignItems:'center',gap:42,opacity:appear,scale:interpolate(appear,[0,1],[.95,1],clamp)}}><div style={{width:230,height:230,borderRadius:72,backgroundColor:COLORS.card,border:`4px solid ${COLORS.green}`,display:'grid',placeItems:'center',boxShadow:'0 18px 48px rgba(36,88,74,.10)'}}><FlowGlyph size={142}/></div><div><div style={{fontSize:22,fontWeight:920,letterSpacing:'.11em',color:COLORS.green,marginBottom:22}}>DÒNG XỬ LÝ CHÍNH</div><div style={{fontSize:item.length>128?34:item.length>96?38:44,lineHeight:1.2,fontWeight:900,color:COLORS.ink}}>{item}</div></div></div>;
  }
  return <div style={{width:'100%',display:'grid',gap:0}}>{items.map((item,index) => {const appear=spring({frame:frame-8-index*11,fps,config:{damping:23,stiffness:100}}); const backgrounds=[COLORS.peach,COLORS.sky,COLORS.mint]; return <div key={item} style={{display:'grid',gridTemplateColumns:'126px 1fr',gap:22,alignItems:'stretch'}}>
    <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><div style={{width:112,height:112,borderRadius:34,display:'grid',placeItems:'center',backgroundColor:backgrounds[index],border:`3px solid ${COLORS.line}`,boxShadow:'0 14px 38px rgba(36,88,74,.09)',opacity:appear,scale:interpolate(appear,[0,1],[.86,1],clamp)}}><KeywordGlyph text={item} size={76}/></div>{index<items.length-1?<div style={{width:7,height:68,margin:'6px 0',borderRadius:99,backgroundColor:COLORS.line,overflow:'hidden'}}><div style={{width:'100%',height:`${interpolate(frame,[18+index*11,38+index*11],[0,100],clamp)}%`,backgroundColor:COLORS.green}}/></div>:null}</div>
    <div style={{minHeight:item.length>128?184:154,marginBottom:index<items.length-1?12:0,padding:'29px 32px',borderRadius:34,backgroundColor:COLORS.card,border:`2px solid ${COLORS.line}`,boxShadow:'0 16px 44px rgba(36,88,74,.08)',display:'flex',alignItems:'center',opacity:appear,translate:`${interpolate(appear,[0,1],[38,0],clamp)}px 0`}}><div style={{fontSize:item.length>128?27:item.length>96?29:34,lineHeight:1.25,fontWeight:850,color:COLORS.ink}}>{item}</div></div>
  </div>;})}</div>;
};

const ContrastVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const items=visualItems(scene,3);
  return <div style={{width:'100%',minHeight:610,position:'relative',display:'grid',gap:22,alignContent:'center'}}>{items.map((item,index)=>{const appear=spring({frame:frame-8-index*10,fps,config:{damping:24,stiffness:100}}); const fromLeft=index%2===0; return <div key={item} style={{width:index===1?'86%':'78%',marginLeft:fromLeft?0:'auto',minHeight:154,padding:'25px 30px',borderRadius:36,display:'grid',gridTemplateColumns:fromLeft?'96px 1fr':'1fr 96px',alignItems:'center',gap:22,backgroundColor:index===0?COLORS.peach:index===1?COLORS.sky:COLORS.mint,border:`2px solid ${COLORS.line}`,boxShadow:'0 18px 48px rgba(36,88,74,.09)',opacity:appear,translate:`${interpolate(appear,[0,1],[fromLeft?-55:55,0],clamp)}px 0`}}>{fromLeft?<KeywordGlyph text={item} size={82}/>:null}<div style={{fontSize:item.length>92?28:33,lineHeight:1.24,fontWeight:860,color:COLORS.ink}}>{item}</div>{!fromLeft?<KeywordGlyph text={item} size={82}/>:null}</div>;})}<div style={{position:'absolute',left:'50%',top:50,bottom:50,width:6,borderRadius:99,backgroundColor:COLORS.line,zIndex:-1}}/></div>;
};

const MetricVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const items=visualItems(scene,3);
  return <div style={{width:'100%',display:'grid',gridTemplateColumns:items.length>1?'1fr 1fr':'1fr',gap:22}}>{items.map((item,index)=>{const parts=numberParts(item); const appear=spring({frame:frame-index*9,fps,config:{damping:23,stiffness:100}}); return <div key={item} style={{minHeight:items.length===1?520:index===0&&items.length===3?390:305,gridColumn:items.length===3&&index===0?'1 / -1':undefined,borderRadius:44,padding:'38px',backgroundColor:index===0?COLORS.cream:index===1?COLORS.sky:COLORS.card,border:`2px solid ${COLORS.line}`,boxShadow:'0 22px 58px rgba(36,88,74,.10)',display:'flex',flexDirection:'column',justifyContent:'center',opacity:appear,scale:interpolate(appear,[0,1],[.94,1],clamp)}}>{parts.number?<div style={{fontSize:items.length===1?92:64,lineHeight:1,fontWeight:950,color:COLORS.deep,letterSpacing:'-.055em'}}>{parts.number}</div>:<KeywordGlyph text={item} size={items.length===1?150:90}/>}<div style={{...readableAlign(parts.description||item,155),marginTop:24,fontSize:item.length>100?29:items.length===1?43:34,lineHeight:1.24,fontWeight:850,color:COLORS.ink}}>{parts.description||item}</div></div>;})}</div>;
};

const ChecklistVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const items=visualItems(scene,3);
  if (items.length === 1) {
    const item = items[0];
    const appear = spring({frame: frame - 5, fps, config: {damping: 24, stiffness: 96}});
    const check = interpolate(frame, [18, 34], [0, 1], clamp);
    return <div style={{width:'100%',minHeight:560,padding:'54px 50px',borderRadius:52,backgroundColor:COLORS.mint,border:`3px solid ${COLORS.line}`,boxShadow:'0 28px 72px rgba(36,88,74,.12)',display:'grid',gridTemplateColumns:'250px 1fr',alignItems:'center',gap:42,opacity:appear,scale:interpolate(appear,[0,1],[.95,1],clamp)}}><div style={{width:230,height:230,borderRadius:72,backgroundColor:COLORS.card,border:`4px solid ${COLORS.green}`,display:'grid',placeItems:'center',boxShadow:'0 18px 48px rgba(36,88,74,.10)'}}><svg width="142" height="142" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M13 33 26 46 52 17" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-check}/></svg></div><div><div style={{fontSize:22,fontWeight:920,letterSpacing:'.11em',color:COLORS.green,marginBottom:22}}>TRỌNG TÂM CẦN THỰC HIỆN</div><div style={{fontSize:item.length>128?34:item.length>96?38:44,lineHeight:1.2,fontWeight:900,color:COLORS.ink}}>{item}</div></div></div>;
  }
  return <div style={{width:'100%',display:'grid',gap:20}}>{items.map((item,index)=>{const appear=spring({frame:frame-7-index*10,fps,config:{damping:24,stiffness:100}}); const check=interpolate(frame,[16+index*10,28+index*10],[0,1],clamp); return <div key={item} style={{minHeight:item.length>128?210:item.length>104?190:172,padding:'27px 30px',borderRadius:38,backgroundColor:index===0?COLORS.mint:index===1?COLORS.cream:COLORS.sky,border:`2px solid ${COLORS.line}`,boxShadow:'0 17px 46px rgba(36,88,74,.08)',display:'grid',gridTemplateColumns:'116px 1fr',alignItems:'center',gap:24,opacity:appear,translate:`0 ${interpolate(appear,[0,1],[30,0],clamp)}px`}}><div style={{width:100,height:100,borderRadius:32,backgroundColor:COLORS.card,border:`3px solid ${COLORS.green}`,display:'grid',placeItems:'center'}}><svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M13 33 26 46 52 17" stroke={COLORS.green} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-check}/></svg></div><div style={{fontSize:item.length>128?26:item.length>104?28:item.length>90?30:34,lineHeight:1.25,fontWeight:850,color:COLORS.ink}}>{item}</div></div>;})}</div>;
};

const DecisionVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const items=visualItems(scene,3);
  return <div style={{width:'100%',minHeight:630,position:'relative',display:'grid',placeItems:'center'}}><div style={{width:230,height:230,borderRadius:'50%',display:'grid',placeItems:'center',backgroundColor:COLORS.card,border:`4px solid ${COLORS.green}`,boxShadow:'0 22px 58px rgba(36,88,74,.12)',scale:spring({frame,fps,config:{damping:24,stiffness:95}})}}><FlowGlyph size={122}/></div>{items.map((item,index)=>{const positions=[{left:5,top:35},{right:5,top:35},{left:260,bottom:0}]; const appear=spring({frame:frame-10-index*9,fps,config:{damping:23,stiffness:105}}); return <div key={item} style={{position:'absolute',...positions[index],width:index===2?400:310,minHeight:178,padding:'25px 27px',borderRadius:36,backgroundColor:index===0?COLORS.peach:index===1?COLORS.sky:COLORS.mint,border:`2px solid ${COLORS.line}`,boxShadow:'0 18px 48px rgba(36,88,74,.10)',opacity:appear,translate:`0 ${interpolate(appear,[0,1],[25,0],clamp)}px`}}><KeywordGlyph text={item} size={72}/><div style={{marginTop:12,fontSize:item.length>82?26:30,lineHeight:1.24,fontWeight:850,color:COLORS.ink}}>{item}</div></div>;})}</div>;
};

const TakeawayVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const items=visualItems(scene,3);
  return <div style={{width:'100%',display:'grid',gap:18}}>{items.map((item,index)=>{const appear=spring({frame:frame-8-index*11,fps,config:{damping:23,stiffness:100}}); return <div key={item} style={{minHeight:180,padding:'26px 30px',borderRadius:40,display:'grid',gridTemplateColumns:'110px 84px 1fr',alignItems:'center',gap:18,backgroundColor:index===0?COLORS.cream:index===1?COLORS.mint:COLORS.sky,border:`2px solid ${COLORS.line}`,boxShadow:'0 18px 48px rgba(36,88,74,.09)',opacity:appear,translate:`${interpolate(appear,[0,1],[index%2?45:-45,0],clamp)}px 0`}}><div style={{fontSize:66,lineHeight:1,fontWeight:950,color:index===0?COLORS.coral:COLORS.green,letterSpacing:'-.06em'}}>0{index+1}</div><KeywordGlyph text={item} size={76}/><div style={{fontSize:item.length>96?28:33,lineHeight:1.24,fontWeight:870,color:COLORS.ink}}>{item}</div></div>;})}</div>;
};

function SceneVisual({scene,document}:{scene:LegalVideoScene;document:LegalVideoProps['storyboard']['document']}) {
  const mode=sceneVisualMode(scene);
  if(mode==='document')return <DocumentVisual scene={scene} document={document}/>;
  if(mode==='timeline')return <TimelineVisual scene={scene}/>;
  if(mode==='network')return <NetworkVisual scene={scene}/>;
  if(mode==='contrast')return <ContrastVisual scene={scene}/>;
  if(mode==='flow')return <FlowVisual scene={scene}/>;
  if(mode==='metric')return <MetricVisual scene={scene}/>;
  if(mode==='checklist')return <ChecklistVisual scene={scene}/>;
  if(mode==='takeaways')return <TakeawayVisual scene={scene}/>;
  return <DecisionVisual scene={scene}/>;
}

function captionIntervals(scene: LegalVideoScene) {
  const chunks=scene.captionChunks.filter(Boolean); const audioSeconds=sceneAudioSeconds(scene); const duration=audioSeconds>0?audioSeconds:5.3;
  const weights=chunks.map((chunk)=>Math.max(8,chunk.length)); const total=weights.reduce((sum,weight)=>sum+weight,0)||1; let cursor=0;
  return chunks.map((text,index)=>{const start=cursor; cursor=index===chunks.length-1?duration:cursor+duration*(weights[index]/total); return {text,start,end:cursor};});
}
const CaptionBar=({scene}:{scene:LegalVideoScene})=>{
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const current=frame/fps; const intervals=captionIntervals(scene);
  const caption=intervals.find((item)=>current>=item.start&&current<item.end)??intervals.at(-1); if(!caption)return null;
  const localFrame=Math.max(0,frame-Math.round(caption.start*fps)); const enter=interpolate(localFrame,[0,6],[0,1],clamp);
  const fontSize=caption.text.length>135?27:caption.text.length>105?30:33;
  return <div style={{position:'absolute',left:50,right:50,bottom:108,minHeight:154,zIndex:30,boxSizing:'border-box',padding:'20px 28px',borderRadius:28,border:`2px solid ${COLORS.line}`,backgroundColor:COLORS.card,boxShadow:'0 22px 58px rgba(36,88,74,.17)',color:COLORS.ink,display:'flex',alignItems:'center',overflow:'hidden'}}><div style={{position:'absolute',left:0,top:0,bottom:0,width:9,backgroundColor:scenePalette(scene).accent}}/><div style={{...readableAlign(caption.text,150),width:'100%',fontSize,lineHeight:1.33,fontWeight:760,letterSpacing:'-.01em',opacity:enter,translate:`0 ${interpolate(enter,[0,1],[10,0],clamp)}px`}}>{caption.text}</div></div>;
};
const SceneAudio=({scene}:{scene:LegalVideoScene})=>{const {fps}=useVideoConfig();let elapsed=0;const chunks=(scene.audioChunks??[]).map((chunk)=>{const from=Math.round(elapsed*fps);const durationInFrames=Math.max(1,Math.ceil(chunk.durationSeconds*fps));elapsed+=chunk.durationSeconds;return{chunk,from,durationInFrames};});return <>{chunks.map(({chunk,from,durationInFrames})=><Sequence key={chunk.id} from={from} durationInFrames={durationInFrames} layout="none"><Audio src={chunk.url} volume={.97}/></Sequence>)}</>;};

export const LegalVideo=({storyboard}:LegalVideoProps)=>{
  const frame=useCurrentFrame(); const {durationInFrames,fps}=useVideoConfig();
  return <AbsoluteFill style={{overflow:'hidden',fontFamily:'Arial, "DejaVu Sans", sans-serif',backgroundColor:COLORS.pale,color:COLORS.ink}}>
    <div style={{position:'absolute',inset:0,opacity:.18,backgroundImage:'linear-gradient(rgba(74,139,120,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(74,139,120,.08) 1px, transparent 1px)',backgroundSize:'76px 76px'}}/>
    <div style={{position:'absolute',top:46,left:50,right:50,height:82,zIndex:40,padding:'0 25px',borderRadius:27,display:'flex',alignItems:'center',justifyContent:'space-between',backgroundColor:COLORS.card,border:`2px solid ${COLORS.line}`,boxShadow:'0 13px 38px rgba(36,88,74,.07)'}}><div style={{fontSize:27,fontWeight:930,letterSpacing:'-.025em',color:COLORS.deep}}>{storyboard.document.number}</div><div style={{fontSize:19,fontWeight:900,letterSpacing:'.11em',color:COLORS.muted}}>VIDEO GIẢI THÍCH</div></div>
    <div style={{position:'absolute',top:147,left:55,right:55,height:7,borderRadius:99,backgroundColor:COLORS.line,zIndex:40}}><div style={{width:`${interpolate(frame,[0,durationInFrames-1],[0,100],clamp)}%`,height:'100%',borderRadius:99,backgroundColor:COLORS.green}}/></div>
    {storyboard.scenes.map((scene,index)=>{const from=sceneStart(storyboard.scenes,index,fps);const duration=sceneFrames(scene,fps);return <Sequence key={scene.id} from={from} durationInFrames={duration} layout="absolute-fill"><SceneBackdrop scene={scene}/><SceneShell scene={scene} sceneIndex={index} sceneCount={storyboard.scenes.length}><SceneVisual scene={scene} document={storyboard.document}/></SceneShell><SceneAudio scene={scene}/><CaptionBar scene={scene}/></Sequence>;})}
  </AbsoluteFill>;
};