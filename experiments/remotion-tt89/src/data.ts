import type {Caption} from '@remotion/captions';

export const FPS = 30;

export type SceneKind = 'intro' | 'timeline' | 'electronic' | 'benefits' | 'prepare';
export type SceneCard = {label: string; value: string};

export type Scene = {
  id: string;
  kind: SceneKind;
  durationInFrames: number;
  eyebrow: string;
  title: string;
  subtitle?: string;
  bullets?: string[];
  badgeTop?: string;
  badgeBottom?: string;
  cards?: SceneCard[];
  tag?: string;
  audio: string;
  narration: string;
};

export const SCENES: Scene[] = [
  {
    id: 'intro',
    kind: 'intro',
    durationInFrames: 180,
    eyebrow: 'VĂN BẢN THUẾ MỚI',
    title: 'Thông tư 89/2026/TT-BTC',
    subtitle: 'Ba điểm cần biết trong chưa đầy một phút',
    badgeTop: '89',
    badgeBottom: 'TT-BTC · 2026',
    audio: 'audio/scene-01.wav',
    narration: 'Thông tư số tám mươi chín năm hai nghìn không trăm hai mươi sáu của Bộ Tài chính có điểm gì đáng chú ý?',
  },
  {
    id: 'timeline',
    kind: 'timeline',
    durationInFrames: 330,
    eyebrow: 'MỐC THỜI GIAN',
    title: 'Có hiệu lực từ 01/07/2026',
    subtitle: 'Ban hành ngày 30/06/2026',
    cards: [
      {label: 'BAN HÀNH', value: '30/06/2026'},
      {label: 'HIỆU LỰC', value: '01/07/2026'},
    ],
    bullets: [
      'Hướng dẫn Luật Quản lý thuế số 108/2025/QH15',
      'Hướng dẫn Nghị định số 252/2026/NĐ-CP',
    ],
    audio: 'audio/scene-02.wav',
    narration: 'Văn bản được ban hành ngày ba mươi tháng sáu năm hai nghìn không trăm hai mươi sáu, có hiệu lực từ ngày một tháng bảy cùng năm, để hướng dẫn Luật Quản lý thuế và Nghị định hai trăm năm mươi hai.',
  },
  {
    id: 'electronic',
    kind: 'electronic',
    durationInFrames: 150,
    eyebrow: 'ĐIỂM MỚI NỔI BẬT',
    title: 'Kiểm tra thuế bằng phương thức điện tử',
    subtitle: 'Lần đầu tiên có quy định cụ thể cho quy trình trên môi trường số',
    tag: 'Hồ sơ · giải trình · trao đổi trên môi trường số',
    audio: 'audio/scene-03.wav',
    narration: 'Điểm mới nổi bật là lần đầu tiên quy định kiểm tra thuế bằng phương thức điện tử.',
  },
  {
    id: 'benefits',
    kind: 'benefits',
    durationInFrames: 300,
    eyebrow: 'NGƯỜI NỘP THUẾ ĐƯỢC GÌ?',
    title: 'Trao đổi hồ sơ trực tuyến',
    bullets: [
      'Gửi hồ sơ, tài liệu và giải trình điện tử',
      'Giảm đi lại và chi phí chuẩn bị hồ sơ',
      'Tăng công khai, minh bạch trong kiểm tra thuế',
    ],
    audio: 'audio/scene-04.wav',
    narration: 'Người nộp thuế có thể gửi hồ sơ, tài liệu, giải trình và trao đổi với cơ quan thuế trên môi trường số, giúp giảm đi lại, chi phí và tăng tính minh bạch.',
  },
  {
    id: 'prepare',
    kind: 'prepare',
    durationInFrames: 360,
    eyebrow: 'NÊN CHUẨN BỊ',
    title: 'Sẵn sàng cho quy trình điện tử',
    bullets: [
      'Duy trì chữ ký số còn hiệu lực',
      'Lưu trữ hóa đơn, sổ sách và chứng từ điện tử có hệ thống',
      'Đối chiếu toàn văn chính thức trước khi áp dụng',
    ],
    audio: 'audio/scene-05.wav',
    narration: 'Để sẵn sàng, doanh nghiệp nên duy trì chữ ký số còn hiệu lực và lưu trữ hóa đơn, sổ sách, chứng từ điện tử có hệ thống. Video chỉ tóm tắt; khi áp dụng cần đối chiếu toàn văn chính thức.',
  },
];

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0);

export const sceneStartFrame = (index: number) =>
  SCENES.slice(0, index).reduce((sum, scene) => sum + scene.durationInFrames, 0);

export const CAPTIONS: Caption[] = SCENES.map((scene, index) => {
  const startFrame = sceneStartFrame(index);
  const endFrame = startFrame + scene.durationInFrames;
  return {
    text: scene.narration,
    startMs: Math.round((startFrame / FPS) * 1000),
    endMs: Math.round((endFrame / FPS) * 1000),
    timestampMs: null,
    confidence: 1,
  };
});
