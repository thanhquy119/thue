"use client";

import { useEffect, useMemo, useState } from "react";
import type { LegalVideoPlan } from "@/lib/video/storyboard";
import { renderHyperframesHtml, renderVideoVtt } from "@/lib/video/storyboard";
import "./video-lab.css";

const SAMPLE = `THÔNG TƯ MẪU VỀ QUẢN LÝ THUẾ ĐIỆN TỬ

Điều 1. Phạm vi điều chỉnh
Thông tư này hướng dẫn việc đăng ký, kê khai và nộp hồ sơ thuế bằng phương thức điện tử đối với tổ chức, hộ kinh doanh và cá nhân có nghĩa vụ thuế.

Điều 2. Thời hạn thực hiện
Người nộp thuế phải hoàn thành việc cập nhật thông tin đăng ký chậm nhất trong vòng 10 ngày làm việc kể từ ngày phát sinh thay đổi.

Điều 3. Trách nhiệm
Tổ chức cung cấp dịch vụ có trách nhiệm lưu vết giao dịch, bảo đảm khả năng tra cứu và cung cấp dữ liệu khi cơ quan thuế yêu cầu.

Điều 4. Hiệu lực thi hành
Thông tư này có hiệu lực thi hành từ ngày 01 tháng 10 năm 2026. Hồ sơ đã tiếp nhận trước ngày có hiệu lực tiếp tục được giải quyết theo quy định tại thời điểm tiếp nhận.`;

type ApiPayload = {
  plan?: LegalVideoPlan;
  engine?: string;
  warning?: string | null;
  error?: string;
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function VideoLabPage() {
  const [text, setText] = useState(SAMPLE);
  const [title, setTitle] = useState("");
  const [plan, setPlan] = useState<LegalVideoPlan | null>(null);
  const [engine, setEngine] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const scene = plan?.scenes[sceneIndex] ?? null;
  const totalSeconds = useMemo(
    () => plan?.scenes.reduce((sum, item) => sum + item.durationSeconds, 0) ?? 0,
    [plan],
  );

  useEffect(() => {
    if (!playing || !plan) return;
    const duration = (plan.scenes[sceneIndex]?.durationSeconds ?? 7) * 1_000;
    const timer = window.setTimeout(() => {
      if (sceneIndex >= plan.scenes.length - 1) {
        setPlaying(false);
        return;
      }
      setSceneIndex((current) => current + 1);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [playing, plan, sceneIndex]);

  async function generate() {
    setBusy(true);
    setError("");
    setWarning(null);
    try {
      const response = await fetch("/api/video-lab/storyboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, title }),
      });
      const payload = await response.json().catch(() => ({})) as ApiPayload;
      if (!response.ok || !payload.plan) throw new Error(payload.error || "Không tạo được storyboard.");
      setPlan(payload.plan);
      setEngine(payload.engine || "unknown");
      setWarning(payload.warning ?? null);
      setSceneIndex(0);
      setPlaying(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không tạo được storyboard.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="videoLabShell">
      <header className="videoLabTopbar">
        <a className="videoLabBrand" href="/">Thuế<span>.</span></a>
        <a href="/">Về trang tra cứu</a>
      </header>

      <section className="videoLabIntro">
        <p className="videoLabEyebrow">SPIKE · CHƯA ĐƯA LÊN MAIN</p>
        <h1>Từ văn bản pháp luật thành video dễ nắm ý.</h1>
        <p>Bản thử này tạo storyboard có dẫn chứng, xem trước từng cảnh và xuất gói HyperFrames. MP4 thật sẽ được render bởi worker cục bộ, không chạy trong Vercel.</p>
      </section>

      <section className="videoLabGrid">
        <form className="videoLabPanel videoLabForm" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
          <label>
            <span>Tiêu đề tùy chọn</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Để trống để tự nhận diện" />
          </label>
          <label>
            <span>Toàn văn hoặc phần cần tóm tắt</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={21} />
          </label>
          <div className="videoLabActions">
            <button type="submit" disabled={busy}>{busy ? "Đang tạo storyboard…" : "Tạo bản thử"}</button>
            <button type="button" className="secondary" onClick={() => setText(SAMPLE)}>Nạp văn bản mẫu</button>
          </div>
          {error ? <p className="videoLabError">{error}</p> : null}
          {warning ? <p className="videoLabWarning">{warning}</p> : null}
        </form>

        <section className="videoLabPanel videoLabPreview" aria-live="polite">
          {!plan || !scene ? (
            <div className="videoLabEmpty">
              <strong>Chưa có storyboard</strong>
              <span>Bấm “Tạo bản thử” để xem kết quả.</span>
            </div>
          ) : (
            <>
              <div className="videoLabMeta">
                <span>{engine}</span>
                <span>{plan.scenes.length} cảnh · khoảng {totalSeconds} giây</span>
              </div>
              <div className="videoPhone">
                <div className="videoPhoneBrand">Thuế<span>.</span></div>
                <div className="videoPhoneScene">
                  <small>{String(sceneIndex + 1).padStart(2, "0")} / {String(plan.scenes.length).padStart(2, "0")}</small>
                  <p>Ý CHÍNH CẦN NẮM</p>
                  <h2>{scene.heading}</h2>
                  <ul>{scene.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
                  <div className="videoPhoneCaption">{scene.narration}</div>
                </div>
              </div>
              <div className="videoLabTransport">
                <button type="button" onClick={() => setSceneIndex((current) => Math.max(0, current - 1))} disabled={sceneIndex === 0}>←</button>
                <button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? "Tạm dừng" : "Chạy thử"}</button>
                <button type="button" onClick={() => setSceneIndex((current) => Math.min(plan.scenes.length - 1, current + 1))} disabled={sceneIndex === plan.scenes.length - 1}>→</button>
              </div>
              <details className="videoLabEvidence">
                <summary>Dẫn chứng cho cảnh này</summary>
                <p>{scene.sourceExcerpt}</p>
              </details>
              <div className="videoLabExports">
                <button type="button" onClick={() => download("storyboard.json", JSON.stringify(plan, null, 2), "application/json")}>Storyboard JSON</button>
                <button type="button" onClick={() => download("index.html", renderHyperframesHtml(plan), "text/html")}>HyperFrames HTML</button>
                <button type="button" onClick={() => download("subtitles.vtt", renderVideoVtt(plan), "text/vtt")}>Phụ đề VTT</button>
              </div>
            </>
          )}
        </section>
      </section>

      <section className="videoLabArchitecture">
        <h2>Kiến trúc thử nghiệm</h2>
        <div>
          <article><strong>1. Nguồn</strong><span>Ưu tiên toàn văn đã chuẩn hóa trong Thuế Rõ; Docling chỉ xử lý PDF ngoài hệ thống.</span></article>
          <article><strong>2. Biên tập</strong><span>Ollama + Qwen3 tạo JSON có schema và bắt buộc dẫn chứng nguyên văn.</span></article>
          <article><strong>3. Âm thanh</strong><span>VieNeu-TTS đọc từng cảnh riêng; thời lượng WAV tạo thẳng mốc phụ đề.</span></article>
          <article><strong>4. Hình ảnh</strong><span>Mermaid xuất SVG, HyperFrames dựng cảnh, FFmpeg chuẩn hóa MP4.</span></article>
        </div>
      </section>
    </main>
  );
}
