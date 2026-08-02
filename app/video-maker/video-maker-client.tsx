"use client";

import {useCallback, useEffect, useRef, useState} from "react";

type Candidate = {
  number: string;
  title: string;
  issuer: string;
  issued_date: string | null;
};

type SearchDocument = {
  number: string;
  title: string;
  issuer: string;
  type: string;
  issued_date: string | null;
  effective_date: string | null;
  status: string;
  official_text: string;
};

type SearchResponse = {
  document: SearchDocument | null;
  candidates?: Candidate[];
  direct_answer?: string;
  error?: string;
};

type Capabilities = {
  ready: boolean;
  missing: string[];
  defaultLength: "brief" | "standard" | "detailed";
  defaultVoice: "female" | "male";
};

type PublicJob = {
  jobId: string;
  documentNumber: string;
  documentTitle: string;
  status: "queued" | "summarizing" | "synthesizing" | "rendering" | "ready" | "failed";
  progress: number;
  message: string;
  sceneCount: number;
  ttsChunkCount: number;
  completedTtsChunks: number;
  videoUrl: string | null;
  error: string | null;
};

type VideoMakerClientProps = {
  initialQuery?: string;
};

const TERMINAL = new Set(["ready", "failed"]);
const LAST_JOB_KEY = "thue-ro:last-video-job";
const JOB_HISTORY_KEY = "thue-ro:video-job-history";

function dateLabel(value: string | null) {
  if (!value) return "Chưa xác định";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function rememberJob(jobId: string) {
  try {
    localStorage.setItem(LAST_JOB_KEY, jobId);
    const current = JSON.parse(localStorage.getItem(JOB_HISTORY_KEY) || "[]") as unknown;
    const history = Array.isArray(current)
      ? current.filter((item): item is string => typeof item === "string" && item !== jobId)
      : [];
    localStorage.setItem(JOB_HISTORY_KEY, JSON.stringify([jobId, ...history].slice(0, 10)));
    const url = new URL(window.location.href);
    url.searchParams.set("job", jobId);
    window.history.replaceState(null, "", url);
  } catch {
    // Job vẫn chạy khi trình duyệt chặn localStorage.
  }
}

export function VideoMakerClient({initialQuery = ""}: VideoMakerClientProps) {
  const [query, setQuery] = useState(initialQuery);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [document, setDocument] = useState<SearchDocument | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [length, setLength] = useState<"brief" | "standard" | "detailed">("standard");
  const [voice, setVoice] = useState<"female" | "male">("female");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [creating, setCreating] = useState(false);
  const [job, setJob] = useState<PublicJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumedRef = useRef(false);
  const initialSearchRef = useRef(false);

  useEffect(() => {
    fetch("/api/videos/capabilities", {cache: "no-store"})
      .then((response) => response.json())
      .then((value: Capabilities) => {
        setCapabilities(value);
        setLength(value.defaultLength);
        setVoice(value.defaultVoice);
      })
      .catch(() => setCapabilities({ready: false, missing: ["Không đọc được cấu hình"], defaultLength: "standard", defaultVoice: "female"}));
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/videos/jobs/${encodeURIComponent(jobId)}`, {cache: "no-store"});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Không đọc được tiến độ video.");
      const next = payload.job as PublicJob;
      setJob(next);
      rememberJob(next.jobId);
      if (!TERMINAL.has(next.status)) {
        pollRef.current = setTimeout(() => void pollJob(jobId), 3_000);
      }
    } catch (error) {
      setJob((current) => current ? {...current, error: error instanceof Error ? error.message : "Mất kết nối khi đọc tiến độ."} : current);
      pollRef.current = setTimeout(() => void pollJob(jobId), 5_000);
    }
  }, []);

  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const jobId = params.get("job") || localStorage.getItem(LAST_JOB_KEY);
      if (jobId && /^[0-9a-f-]{20,64}$/iu.test(jobId)) void pollJob(jobId);
    } catch {
      // Không có job cần khôi phục.
    }
  }, [pollJob]);

  const searchDocument = useCallback(async (forcedQuery?: string) => {
    const value = (forcedQuery ?? query).trim();
    if (!value) return;
    setSearching(true);
    setSearchError("");
    setDocument(null);
    setCandidates([]);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({query: value}),
      });
      const payload = await response.json() as SearchResponse;
      if (!response.ok) throw new Error(payload.error || "Không tìm được văn bản.");
      if (payload.document) {
        setDocument(payload.document);
        setQuery(payload.document.number);
      } else {
        setCandidates(payload.candidates ?? []);
        setSearchError(payload.candidates?.length ? "Có nhiều kết quả. Em chọn đúng số hiệu bên dưới." : (payload.direct_answer || "Chưa tìm thấy toàn văn phù hợp."));
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Không tìm được văn bản.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  useEffect(() => {
    const value = initialQuery.trim();
    if (!value || initialSearchRef.current) return;
    initialSearchRef.current = true;
    void searchDocument(value);
  }, [initialQuery, searchDocument]);

  const chooseCandidate = async (candidate: Candidate) => {
    setQuery(candidate.number);
    await searchDocument(candidate.number);
  };

  const createVideo = async () => {
    if (!document || creating) return;
    setCreating(true);
    setSearchError("");
    try {
      const response = await fetch("/api/videos/start", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({query: document.number, length, voice}),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (Array.isArray(payload.candidates)) setCandidates(payload.candidates);
        throw new Error(payload.error || "Không khởi động được video.");
      }
      const next = payload.job as PublicJob;
      setJob(next);
      rememberJob(next.jobId);
      if (!TERMINAL.has(next.status)) void pollJob(next.jobId);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Không khởi động được video.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="video-maker-grid">
      <section className="video-maker-card video-maker-controls">
        <div className="video-maker-section-heading">
          <span>01</span>
          <div>
            <h2>Chọn văn bản</h2>
            <p>Có thể nhập tên ngắn; hệ thống sẽ yêu cầu chọn số hiệu khi kết quả chưa duy nhất.</p>
          </div>
        </div>

        <form
          className="video-maker-search"
          onSubmit={(event) => {
            event.preventDefault();
            void searchDocument();
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ví dụ: Nghị định 178 hoặc 178/2025/NĐ-CP"
            aria-label="Số hiệu hoặc tên văn bản"
          />
          <button type="submit" disabled={searching || !query.trim()}>
            {searching ? <span className="video-maker-spinner" aria-hidden="true" /> : null}
            {searching ? "Đang tìm" : "Tìm văn bản"}
          </button>
        </form>

        {searchError ? <div className="video-maker-notice">{searchError}</div> : null}

        {candidates.length ? (
          <div className="video-maker-candidates">
            {candidates.map((candidate) => (
              <button key={`${candidate.number}-${candidate.issued_date ?? ""}`} type="button" onClick={() => void chooseCandidate(candidate)}>
                <strong>{candidate.number}</strong>
                <span>{candidate.title}</span>
                <small>{candidate.issuer || "Chưa rõ cơ quan"} · {dateLabel(candidate.issued_date)}</small>
              </button>
            ))}
          </div>
        ) : null}

        {document ? (
          <article className="video-maker-document">
            <div className="video-maker-document-tag">ĐÃ CÓ TOÀN VĂN</div>
            <h3>{document.number}</h3>
            <p>{document.title}</p>
            <dl>
              <div><dt>Cơ quan</dt><dd>{document.issuer || "Chưa xác định"}</dd></div>
              <div><dt>Ban hành</dt><dd>{dateLabel(document.issued_date)}</dd></div>
              <div><dt>Hiệu lực</dt><dd>{dateLabel(document.effective_date)}</dd></div>
            </dl>
          </article>
        ) : null}

        <div className="video-maker-section-heading video-maker-options-heading">
          <span>02</span>
          <div>
            <h2>Chọn cách tóm tắt</h2>
            <p>Bản tiêu chuẩn được ưu tiên để phủ đủ các nhóm ý chính mà vẫn dễ theo dõi.</p>
          </div>
        </div>

        <div className="video-maker-option-group" role="radiogroup" aria-label="Độ dài video">
          {([
            ["brief", "Ngắn", "60–90 giây · ưu tiên ý quan trọng"],
            ["standard", "Tiêu chuẩn", "2–3 phút · đủ các nhóm ý chính"],
            ["detailed", "Chi tiết", "4–6 phút · nhiều điều kiện và ngoại lệ"],
          ] as const).map(([value, label, note]) => (
            <label key={value} className={length === value ? "is-selected" : ""}>
              <input type="radio" name="length" value={value} checked={length === value} onChange={() => setLength(value)} />
              <strong>{label}</strong>
              <small>{note}</small>
            </label>
          ))}
        </div>

        <div className="video-maker-voice-row">
          <span>Giọng đọc</span>
          <div>
            <button type="button" className={voice === "female" ? "is-selected" : ""} onClick={() => setVoice("female")}>Hoài My</button>
            <button type="button" className={voice === "male" ? "is-selected" : ""} onClick={() => setVoice("male")}>Nam Minh</button>
          </div>
        </div>

        {capabilities && !capabilities.ready ? (
          <div className="video-maker-config-warning">
            <strong>Bản preview chưa đủ khóa dịch vụ để render thật.</strong>
            <span>Thiếu: {capabilities.missing.join(", ")}.</span>
          </div>
        ) : null}

        <button
          className="video-maker-create"
          type="button"
          disabled={!document || creating || capabilities?.ready === false}
          onClick={() => void createVideo()}
        >
          {creating ? <span className="video-maker-spinner" aria-hidden="true" /> : null}
          {creating ? "Đang xếp hàng" : "Tạo video tóm tắt"}
        </button>
      </section>

      <section className="video-maker-card video-maker-status">
        <div className="video-maker-section-heading">
          <span>03</span>
          <div>
            <h2>Tiến độ xử lý</h2>
            <p>Có thể đóng trang sau khi job được tạo; mở lại trang sẽ tự khôi phục tiến độ gần nhất.</p>
          </div>
        </div>

        {!job ? (
          <div className="video-maker-empty">
            <div className="video-maker-orbit"><i /><i /><i /></div>
            <strong>Video sẽ xuất hiện tại đây</strong>
            <span>Toàn văn → ý chính → giọng đọc → MP4</span>
          </div>
        ) : (
          <div className="video-maker-job">
            <div className="video-maker-job-topline">
              <span className={`video-maker-status-pill is-${job.status}`}>{job.status}</span>
              <strong>{job.progress}%</strong>
            </div>
            <h3>{job.documentNumber}</h3>
            <p>{job.message}</p>
            <div className="video-maker-progress" aria-label={`Tiến độ ${job.progress}%`}>
              <span style={{width: `${Math.max(0, Math.min(100, job.progress))}%`}} />
            </div>
            <div className="video-maker-metrics">
              <div><strong>{job.sceneCount || "—"}</strong><span>Cảnh</span></div>
              <div><strong>{job.completedTtsChunks}/{job.ttsChunkCount || "—"}</strong><span>Đoạn giọng</span></div>
            </div>
            {job.error ? <div className="video-maker-error">{job.error}</div> : null}
            {job.status === "ready" && job.videoUrl ? (
              <div className="video-maker-result">
                <video controls playsInline preload="metadata" src={job.videoUrl} />
                <a href={job.videoUrl} target="_blank" rel="noreferrer">Mở video MP4</a>
              </div>
            ) : (
              <div className="video-maker-working" aria-hidden="true">
                <span /><span /><span /><span />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
