from pathlib import Path


def replace_between(text: str, start: str, end: str, replacement: str) -> str:
    start_index = text.index(start)
    end_index = text.index(end, start_index)
    return text[:start_index] + replacement.rstrip() + "\n\n" + text[end_index:]


# Remotion: preserve semantic phrases, improve single-idea scenes and move captions above controls.
path = Path("experiments/remotion-tt89/src/LegalVideo.tsx")
source = path.read_text()
source = replace_between(
    source,
    "function splitVisualText",
    "function sceneVisualMode",
    r'''function normalizeVisualText(value: string) {
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
}''',
)

source = replace_between(
    source,
    "const FlowVisual",
    "const ContrastVisual",
    r'''const FlowVisual = ({scene}: {scene: LegalVideoScene}) => {
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
};''',
)

source = replace_between(
    source,
    "const ChecklistVisual",
    "const DecisionVisual",
    r'''const ChecklistVisual = ({scene}: {scene: LegalVideoScene}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const items=visualItems(scene,3);
  if (items.length === 1) {
    const item = items[0];
    const appear = spring({frame: frame - 5, fps, config: {damping: 24, stiffness: 96}});
    const check = interpolate(frame, [18, 34], [0, 1], clamp);
    return <div style={{width:'100%',minHeight:560,padding:'54px 50px',borderRadius:52,backgroundColor:COLORS.mint,border:`3px solid ${COLORS.line}`,boxShadow:'0 28px 72px rgba(36,88,74,.12)',display:'grid',gridTemplateColumns:'250px 1fr',alignItems:'center',gap:42,opacity:appear,scale:interpolate(appear,[0,1],[.95,1],clamp)}}><div style={{width:230,height:230,borderRadius:72,backgroundColor:COLORS.card,border:`4px solid ${COLORS.green}`,display:'grid',placeItems:'center',boxShadow:'0 18px 48px rgba(36,88,74,.10)'}}><svg width="142" height="142" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M13 33 26 46 52 17" stroke={COLORS.green} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-check}/></svg></div><div><div style={{fontSize:22,fontWeight:920,letterSpacing:'.11em',color:COLORS.green,marginBottom:22}}>TRỌNG TÂM CẦN THỰC HIỆN</div><div style={{fontSize:item.length>128?34:item.length>96?38:44,lineHeight:1.2,fontWeight:900,color:COLORS.ink}}>{item}</div></div></div>;
  }
  return <div style={{width:'100%',display:'grid',gap:20}}>{items.map((item,index)=>{const appear=spring({frame:frame-7-index*10,fps,config:{damping:24,stiffness:100}}); const check=interpolate(frame,[16+index*10,28+index*10],[0,1],clamp); return <div key={item} style={{minHeight:item.length>128?210:item.length>104?190:172,padding:'27px 30px',borderRadius:38,backgroundColor:index===0?COLORS.mint:index===1?COLORS.cream:COLORS.sky,border:`2px solid ${COLORS.line}`,boxShadow:'0 17px 46px rgba(36,88,74,.08)',display:'grid',gridTemplateColumns:'116px 1fr',alignItems:'center',gap:24,opacity:appear,translate:`0 ${interpolate(appear,[0,1],[30,0],clamp)}px`}}><div style={{width:100,height:100,borderRadius:32,backgroundColor:COLORS.card,border:`3px solid ${COLORS.green}`,display:'grid',placeItems:'center'}}><svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M13 33 26 46 52 17" stroke={COLORS.green} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-check}/></svg></div><div style={{fontSize:item.length>128?26:item.length>104?28:item.length>90?30:34,lineHeight:1.25,fontWeight:850,color:COLORS.ink}}>{item}</div></div>;})}</div>;
};''',
)

source = source.replace("padding: '184px 60px 258px'", "padding: '184px 60px 330px'")
source = source.replace("bottom:42,minHeight:176", "bottom:108,minHeight:154")
source = source.replace("padding:'26px 31px'", "padding:'20px 28px'")
source = source.replace("borderRadius:32,border:`2px solid", "borderRadius:28,border:`2px solid")
source = source.replace(
    "const fontSize=caption.text.length>135?29:caption.text.length>95?32:35;",
    "const fontSize=caption.text.length>135?27:caption.text.length>105?30:33;",
)
path.write_text(source)

# Storyboard: remove low-value/internal statements, preserve whole visual phrases and normalize mislabeled ML/data scenes.
path = Path("lib/video/storyboard.ts")
source = path.read_text()
insert_after = 'function hasTruncation(value: string) { return /…|\\.{3,}/u.test(value); }\n'
helper = '''function lowValueForViewer(value: string) {
  const text = cleanText(value);
  return /(?:kết quả (?:phân tích|đánh giá|phân loại).*(?:chỉ là|là) căn cứ hỗ trợ|không thay thế trách nhiệm ban hành quyết định hành chính|trách nhiệm ban hành quyết định hành chính|căn cứ hỗ trợ cơ quan thuế nhưng không thay thế)/iu.test(text);
}
function normalizedPointCategory(category: LegalVideoCategory, claim: string): LegalVideoCategory {
  if (category === "forms" && /chấm điểm|học máy|phân tích dữ liệu|mô hình rủi ro/iu.test(claim) && !/hồ sơ|biểu mẫu|mẫu số|tờ khai|chứng từ/iu.test(claim)) return "overview";
  return category;
}
'''
if "function lowValueForViewer" not in source:
    source = source.replace(insert_after, insert_after + helper)

old = '''function completeDisplayPhrase(value: string, maxChars = 138) {
  const text = cleanText(value);
  return text.length >= 12 && text.length <= maxChars && !hasTruncation(text) && !/[,;:]$/u.test(text)
    && !/\\b(?:và|hoặc|đồng thời|tại|trong|của|với|theo|để|do|bởi|từ|quản)$/iu.test(text)
    && validVietnameseText(text);
}'''
new = '''function completeDisplayPhrase(value: string, maxChars = 138) {
  const text = cleanText(value);
  const words = text.split(/\\s+/gu).filter(Boolean);
  return text.length >= 12 && text.length <= maxChars && !hasTruncation(text) && !/[,;:]$/u.test(text)
    && !/\\b(?:và|hoặc|đồng thời|tại|trong|của|với|theo|để|do|bởi|từ|quản|trụ)$/iu.test(text)
    && (/[0-9]/u.test(text) || words.length >= 3)
    && !lowValueForViewer(text)
    && validVietnameseText(text);
}'''
if old not in source:
    raise SystemExit("Không tìm thấy completeDisplayPhrase")
source = source.replace(old, new)

source = source.replace(
    'function visualKeyword(value: string) { return cleanText(value).replace(/,\\s*/gu, " · ").replace(/[.!?]$/u, ""); }',
    'function visualKeyword(value: string) { return cleanText(value).replace(/[.!?]$/u, ""); }',
)
old = '''function visualPhrases(points: LegalVideoEvidencePoint[], limit = 3) {
  const result: string[] = [];
  for (const point of points) for (const candidate of displayPhrasesFromPoint(point, 138)) {
    const phrase = visualKeyword(candidate); if (!phrase || result.some((item) => textSimilarity(item, phrase) > 0.8)) continue;
    result.push(phrase); if (result.length >= limit) return result;
  }
  return result;
}'''
new = '''function visualPhrases(points: LegalVideoEvidencePoint[], limit = 3) {
  const result: string[] = [];
  for (const point of points) {
    const claim = cleanText(point.claim);
    const candidates = completeDisplayPhrase(claim, 170) ? [claim] : displayPhrasesFromPoint(point, 170);
    for (const candidate of candidates) {
      const phrase = visualKeyword(candidate);
      if (!completeDisplayPhrase(phrase, 170) || result.some((item) => textSimilarity(item, phrase) > 0.8)) continue;
      result.push(phrase);
      if (result.length >= limit) return result;
    }
  }
  return result;
}'''
if old not in source:
    raise SystemExit("Không tìm thấy visualPhrases")
source = source.replace(old, new)

old = '''    if (!claim || claim.length > 165 || hasTruncation(claim) || !validVietnameseText(claim) || !sourceExcerpt || !validCategory(point.category)) return [];
    if (!sourceContainsEvidence(section.text, sourceExcerpt)) return [];
    const allowed = normalizeVideoEvidence(sourceExcerpt);'''
new = '''    if (!claim || claim.length > 165 || hasTruncation(claim) || lowValueForViewer(claim) || !validVietnameseText(claim) || !sourceExcerpt || !validCategory(point.category)) return [];
    if (!sourceContainsEvidence(section.text, sourceExcerpt)) return [];
    const category = normalizedPointCategory(point.category, claim);
    const allowed = normalizeVideoEvidence(sourceExcerpt);'''
if old not in source:
    raise SystemExit("Không tìm thấy lọc evidence")
source = source.replace(old, new)
source = source.replace("category: point.category, importance:", "category, importance:")

source = source.replace(
    '  const narration = cleanText(`${document.type} số ${document.number} quy định về ${subject}. Video tập trung vào các tác động, điều kiện và dòng thực hiện có ý nghĩa trực tiếp.`);',
    '  const narration = cleanText(`${document.type} số ${document.number} quy định về ${subject}.`);',
)
source = source.replace('    if (scene.category === "effective") return [scene];\n', "")
source = source.replace(
    '''    const remainingPoints = originalPoints.filter((point) => !isEffectiveOnly(`${point.claim} ${point.sourceExcerpt}`));
    const remainingBullets = scene.bullets.map(cleanText).filter((bullet) => !isEffectiveOnly(bullet) && completeDisplayPhrase(bullet, 138));
    const remainingNarration = cleanText(scene.narration).split(/(?<=[.!?])\\s+/gu).map(cleanText).filter((sentence) => sentence && !isEffectiveOnly(sentence)).map(ensureSentence).join(" ");''',
    '''    const remainingPoints = originalPoints.filter((point) => !isEffectiveOnly(`${point.claim} ${point.sourceExcerpt}`) && !lowValueForViewer(`${point.claim} ${point.sourceExcerpt}`));
    const remainingBullets = scene.bullets.map(cleanText).filter((bullet) => !isEffectiveOnly(bullet) && !lowValueForViewer(bullet) && completeDisplayPhrase(bullet, 138));
    const remainingNarration = cleanText(scene.narration).split(/(?<=[.!?])\\s+/gu).map(cleanText).filter((sentence) => sentence && !isEffectiveOnly(sentence) && !lowValueForViewer(sentence)).map(ensureSentence).join(" ");''',
)
source = source.replace(
    "  const selected = selectEvidence([...unique.values()], profile.maxEvidencePoints);",
    '  const relevantPoints = [...unique.values()].filter((point) => !lowValueForViewer(`${point.claim} ${point.sourceExcerpt}`));\n  const selected = selectEvidence(relevantPoints, profile.maxEvidencePoints);',
)
path.write_text(source)

# Bump both cache versions in chunking.
path = Path("lib/video/chunking.ts")
source = path.read_text().replace('VIDEO_TEMPLATE_VERSION = "legal-video-v4"', 'VIDEO_TEMPLATE_VERSION = "legal-video-v5"')
source = source.replace('VIDEO_PIPELINE_VERSION = "legal-video-pipeline-v4"', 'VIDEO_PIPELINE_VERSION = "legal-video-pipeline-v5"')
path.write_text(source)

# E2E: reject orphan visual cards, low-value scenes and mislabeled ML/data pages.
path = Path("scripts/run-video-v3-e2e.ts")
source = path.read_text()
old = '''function incompleteDisplayText(value: string) {
  const text = value.trim();
  return /…|\\.{3,}|[,;:]$/u.test(text)
    || /\\b(?:và|hoặc|đồng thời|tại|trong|của|với|theo|để|do|bởi|từ|quản)$/iu.test(text);
}'''
new = '''function incompleteDisplayText(value: string) {
  const text = value.trim();
  const words = text.split(/\\s+/gu).filter(Boolean);
  return /…|\\.{3,}|[,;:]$/u.test(text)
    || /\\b(?:và|hoặc|đồng thời|tại|trong|của|với|theo|để|do|bởi|từ|quản|trụ)$/iu.test(text)
    || (!/\\d/u.test(text) && words.length <= 2 && text.length < 24);
}

function lowValueForViewer(value: string) {
  return /(?:kết quả (?:phân tích|đánh giá|phân loại).*(?:chỉ là|là) căn cứ hỗ trợ|không thay thế trách nhiệm ban hành quyết định hành chính|trách nhiệm ban hành quyết định hành chính|căn cứ hỗ trợ cơ quan thuế nhưng không thay thế)/iu.test(value);
}'''
if old not in source:
    raise SystemExit("Không tìm thấy incompleteDisplayText")
source = source.replace(old, new)
marker = '''    if (scene.kind !== "intro" && !(scene.visualKeywords?.length)) {
      throw new Error(`[video-v3-e2e] Cảnh ${scene.id} chưa có visualKeywords.`);
    }
'''
addition = marker + '''    for (const keyword of scene.visualKeywords ?? []) {
      if (incompleteDisplayText(keyword)) {
        throw new Error(`[video-v3-e2e] Visual keyword bị cắt hoặc dang dở: ${scene.id} — ${keyword}`);
      }
    }
    if (lowValueForViewer([scene.title, ...scene.bullets, scene.narration].join(" "))) {
      throw new Error(`[video-v3-e2e] Cảnh ${scene.id} chứa nội dung nội bộ hoặc ít giá trị với người xem.`);
    }
    if (scene.category === "forms" && /chấm điểm|học máy|phân tích dữ liệu|mô hình rủi ro/iu.test([scene.title, ...scene.bullets].join(" ")) && !/hồ sơ|biểu mẫu|mẫu số|tờ khai|chứng từ/iu.test([scene.title, ...scene.bullets].join(" "))) {
      throw new Error(`[video-v3-e2e] Cảnh ${scene.id} bị gắn nhãn hồ sơ/dữ liệu không đúng ngữ nghĩa.`);
    }
'''
if marker not in source:
    raise SystemExit("Không tìm thấy vị trí kiểm tra visualKeywords")
source = source.replace(marker, addition, 1)
path.write_text(source)

# Static regression tests.
path = Path("tests/video-template.test.ts")
source = path.read_text()
source = source.replace('VIDEO_TEMPLATE_VERSION = "legal-video-v4"', 'VIDEO_TEMPLATE_VERSION = "legal-video-v5"')
source = source.replace('VIDEO_PIPELINE_VERSION = "legal-video-pipeline-v4"', 'VIDEO_PIPELINE_VERSION = "legal-video-pipeline-v5"')
source = source.replace('assert.ok(source.includes("minHeight:176"));', 'assert.ok(source.includes("bottom:108"));\n  assert.ok(source.includes("minHeight:154"));')
source += '''\n\ntest("visual card giữ nguyên một cụm ý và loại mảnh một hai từ", () => {
  const start = templateSource.indexOf("function visualItems");
  const end = templateSource.indexOf("function sceneVisualMode", start);
  const visualSource = templateSource.slice(start, end);
  assert.doesNotMatch(visualSource, /source\\.flatMap/u);
  assert.match(visualSource, /standaloneVisualFragment/u);
  assert.match(visualSource, /scene\\.visualKeywords/u);
});

test("pipeline loại nội dung nội bộ ít giá trị và không gắn học máy vào hồ sơ biểu mẫu", () => {
  assert.match(storyboardSource, /function lowValueForViewer/u);
  assert.match(storyboardSource, /normalizedPointCategory/u);
  assert.match(storyboardSource, /chấm điểm\\|học máy\\|phân tích dữ liệu/u);
  assert.doesNotMatch(storyboardSource, /if \\(scene\\.category === "effective"\\) return \\[scene\\]/u);
});

test("cảnh một ý dùng hero card và phụ đề nằm trên vùng điều khiển video", () => {
  assert.match(templateSource, /items\\.length === 1/u);
  assert.match(templateSource, /DÒNG XỬ LÝ CHÍNH/u);
  assert.match(templateSource, /TRỌNG TÂM CẦN THỰC HIỆN/u);
  assert.match(captionSource(), /bottom:108/u);
});\n'''
path.write_text(source)
