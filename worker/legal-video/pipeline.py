#!/usr/bin/env python3
"""Local legal-video spike.

Dry-run works with the Python standard library. Full mode optionally uses:
Docling -> Ollama -> VieNeu-TTS -> Mermaid CLI -> HyperFrames -> faster-whisper QC -> FFmpeg.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "enum": [1]},
        "title": {"type": "string"},
        "subtitle": {"type": "string"},
        "summary": {"type": "string"},
        "format": {"type": "string", "enum": ["vertical", "landscape"]},
        "scenes": {
            "type": "array",
            "minItems": 3,
            "maxItems": 8,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "heading": {"type": "string"},
                    "narration": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                    "sourceExcerpt": {"type": "string"},
                    "durationSeconds": {"type": "number", "minimum": 4, "maximum": 35},
                    "mermaid": {"type": "string"},
                },
                "required": ["id", "heading", "narration", "bullets", "sourceExcerpt", "durationSeconds"],
            },
        },
        "disclaimer": {"type": "string"},
    },
    "required": ["version", "title", "subtitle", "summary", "format", "scenes", "disclaimer"],
}


def run(command: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def extract_text(source: Path) -> str:
    if source.suffix.lower() != ".pdf":
        return source.read_text(encoding="utf-8")
    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise RuntimeError("PDF cần Docling. Cài bằng: pip install docling") from exc
    result = DocumentConverter().convert(source)
    return result.document.export_to_markdown()


def ollama_plan(text: str, model: str, endpoint: str) -> dict[str, Any]:
    prompt = (
        "Chỉ dùng thông tin trong nguồn, không suy đoán. Mỗi cảnh phải có sourceExcerpt nguyên văn. "
        "Ưu tiên phạm vi, điểm mới, nghĩa vụ, thời hạn, mức tiền, hiệu lực và chuyển tiếp. "
        "Tạo video 60-120 giây và luôn có cảnh báo không thay thế toàn văn.\n\nNGUỒN:\n" + text
    )
    body = json.dumps({
        "model": model,
        "stream": False,
        "format": SCHEMA,
        "messages": [
            {"role": "system", "content": "Bạn là biên tập viên pháp luật thuế Việt Nam."},
            {"role": "user", "content": prompt},
        ],
        "options": {"temperature": 0, "num_ctx": 32768},
    }).encode("utf-8")
    request = urllib.request.Request(
        endpoint.rstrip("/") + "/api/chat",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)
    return json.loads(payload["message"]["content"])


def fallback_plan(text: str) -> dict[str, Any]:
    clean = re.sub(r"\s+", " ", text).strip()
    sentences = [item.strip() for item in re.split(r"(?<=[.!?;:])\s+", clean) if len(item.strip()) >= 35]
    chosen = sentences[:5] or [clean[:500]]
    scenes = [{
        "id": "mo-dau",
        "heading": "Tóm tắt nhanh",
        "narration": "Video này tóm lược những nội dung đáng chú ý trong văn bản đầu vào.",
        "bullets": ["Bám theo chính văn bản", "Cần đối chiếu toàn văn"],
        "sourceExcerpt": clean[:360],
        "durationSeconds": 7,
    }]
    for index, sentence in enumerate(chosen, 1):
        scenes.append({
            "id": f"y-chinh-{index}",
            "heading": "Nội dung quan trọng",
            "narration": "Văn bản nêu: " + sentence[:560],
            "bullets": [sentence[:190]],
            "sourceExcerpt": sentence[:480],
            "durationSeconds": max(6, min(28, round(len(sentence.split()) / 2.35 + 2))),
        })
    scenes.append({
        "id": "ket-thuc",
        "heading": "Trước khi áp dụng",
        "narration": "Hãy kiểm tra đối tượng, hiệu lực, chuyển tiếp và văn bản sửa đổi trước khi thực hiện.",
        "bullets": ["Mở toàn văn", "Đối chiếu nguồn chính thức"],
        "sourceExcerpt": "Video chỉ là bản tóm tắt hỗ trợ tiếp cận văn bản.",
        "durationSeconds": 9,
    })
    return {
        "version": 1,
        "title": (sentences[0] if sentences else "Tóm tắt văn bản")[:140],
        "subtitle": "Các ý chính cần nắm",
        "summary": " ".join(chosen)[:480],
        "format": "vertical",
        "scenes": scenes[:8],
        "disclaimer": "Video chỉ nhằm hỗ trợ đọc nhanh; toàn văn và nguồn chính thức mới là căn cứ áp dụng.",
    }


def synthesize_scenes(plan: dict[str, Any], output: Path) -> list[float]:
    try:
        from vieneu import Vieneu
    except ImportError as exc:
        raise RuntimeError("Chưa có VieNeu-TTS. Cài theo tài liệu của dự án VieNeu-TTS rồi chạy lại.") from exc
    tts = Vieneu()
    durations: list[float] = []
    concat_lines: list[str] = []
    for index, scene in enumerate(plan["scenes"], 1):
        wav = output / f"scene-{index:02d}.wav"
        audio = tts.infer(text=scene["narration"])
        tts.save(audio, str(wav))
        duration = probe_duration(wav)
        scene["durationSeconds"] = round(max(4.0, duration), 3)
        durations.append(scene["durationSeconds"])
        concat_lines.append(f"file '{wav.name}'")
    (output / "audio-concat.txt").write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "audio-concat.txt", "-c:a", "pcm_s16le", "narration.wav"], output)
    return durations


def probe_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def timestamp(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def write_vtt(plan: dict[str, Any], output: Path) -> None:
    cursor = 0.0
    cues = ["WEBVTT", ""]
    for index, scene in enumerate(plan["scenes"], 1):
        start = cursor
        cursor += float(scene["durationSeconds"])
        cues.extend([str(index), f"{timestamp(start)} --> {timestamp(cursor)}", scene["narration"], ""])
    (output / "subtitles.vtt").write_text("\n".join(cues), encoding="utf-8")


def html_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def write_html(plan: dict[str, Any], output: Path, include_audio: bool) -> None:
    width, height = (1080, 1920) if plan.get("format") == "vertical" else (1920, 1080)
    cursor = 0.0
    scene_html: list[str] = []
    for index, scene in enumerate(plan["scenes"], 1):
        duration = float(scene["durationSeconds"])
        bullets = "".join(f"<li>{html_escape(item)}</li>" for item in scene["bullets"])
        scene_html.append(
            f'<section class="scene" data-start="{cursor:.3f}" data-duration="{duration:.3f}" data-track-index="1" data-fade="in">'
            f'<small>{index:02d}</small><p>THUẾ RÕ · Ý CHÍNH</p><h2>{html_escape(scene["heading"])}</h2>'
            f'<ul>{bullets}</ul><div class="caption">{html_escape(scene["narration"])}</div></section>'
        )
        cursor += duration
    audio = f'<audio src="narration.wav" data-start="0" data-duration="{cursor:.3f}" data-track-index="3"></audio>' if include_audio else ""
    document = f'''<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
*{{box-sizing:border-box}}body{{margin:0;overflow:hidden;font-family:Arial,sans-serif;background:#e8f1ed;color:#102a21}}
#stage{{position:relative;width:{width}px;height:{height}px;background:radial-gradient(circle at 85% 5%,#cfe8dc 0,transparent 32%),linear-gradient(160deg,#f9fcfa,#e5efea)}}
.brand{{position:absolute;top:72px;left:80px;font-size:34px;font-weight:900;z-index:3}}.brand b{{color:#db5b35}}
.scene{{position:absolute;inset:170px 80px 90px;display:flex;flex-direction:column;justify-content:center;padding:70px 62px 210px;border-radius:44px;background:rgba(255,255,255,.88)}}
.scene small{{position:absolute;right:52px;top:44px;font-size:28px;opacity:.4}}.scene p{{font-size:22px;font-weight:800;letter-spacing:.12em;color:#416a59}}
h2{{font-size:76px;line-height:1.05;letter-spacing:-.045em;margin:0 0 42px}}ul{{font-size:38px;line-height:1.3;display:grid;gap:22px}}li::marker{{color:#db5b35}}
.caption{{position:absolute;left:44px;right:44px;bottom:40px;padding:24px 28px;border-radius:22px;background:#102a21;color:white;font-size:29px;line-height:1.35;text-align:center}}
</style></head><body><div id="stage" data-composition-id="legal-summary" data-width="{width}" data-height="{height}" data-duration="{cursor:.3f}" data-fps="30">
<div class="brand" data-start="0" data-duration="{cursor:.3f}" data-track-index="4">Thuế<b>.</b></div>{''.join(scene_html)}{audio}</div></body></html>'''
    (output / "index.html").write_text(document, encoding="utf-8")


def render_mermaid(plan: dict[str, Any], output: Path) -> None:
    for index, scene in enumerate(plan["scenes"], 1):
        source = scene.get("mermaid")
        if not source:
            continue
        mmd = output / f"diagram-{index:02d}.mmd"
        svg = output / f"diagram-{index:02d}.svg"
        mmd.write_text(source, encoding="utf-8")
        run(["npx", "-y", "@mermaid-js/mermaid-cli", "-i", str(mmd), "-o", str(svg)])


def whisper_qc(audio: Path, output: Path) -> None:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("[qc] Bỏ qua faster-whisper vì chưa cài.")
        return
    model = WhisperModel(os.getenv("VIDEO_WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(audio), language="vi", word_timestamps=True, vad_filter=True)
    transcript = "\n".join(f"[{item.start:.2f}-{item.end:.2f}] {item.text.strip()}" for item in segments)
    (output / "whisper-qc.txt").write_text(transcript + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, default=Path(".video-lab/worker-demo"))
    parser.add_argument("--model", default=os.getenv("VIDEO_OLLAMA_MODEL", "qwen3:8b"))
    parser.add_argument("--ollama", default=os.getenv("VIDEO_OLLAMA_URL", "http://127.0.0.1:11434"))
    parser.add_argument("--dry-run", action="store_true", help="Không TTS/render; chỉ tạo plan, HTML và VTT.")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    text = extract_text(args.source)
    try:
        plan = ollama_plan(text, args.model, args.ollama)
        print(f"[plan] Ollama {args.model}")
    except Exception as exc:
        print(f"[plan] Ollama không sẵn sàng ({exc}); dùng fallback trích xuất.")
        plan = fallback_plan(text)

    if args.dry_run:
        for scene in plan["scenes"]:
            scene["durationSeconds"] = max(4, float(scene.get("durationSeconds", 8)))
    else:
        for binary in ("ffmpeg", "ffprobe", "npx"):
            if not shutil.which(binary):
                raise RuntimeError(f"Thiếu lệnh {binary} trong PATH.")
        synthesize_scenes(plan, args.out)
        render_mermaid(plan, args.out)

    (args.out / "storyboard.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_vtt(plan, args.out)
    write_html(plan, args.out, include_audio=not args.dry_run)

    if not args.dry_run:
        run(["npx", "-y", "hyperframes@0.6.62", "render", "index.html", "--out", "raw.mp4"], args.out)
        run(["ffmpeg", "-y", "-i", "raw.mp4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "legal-summary.mp4"], args.out)
        whisper_qc(args.out / "narration.wav", args.out)
    print(f"[done] {args.out.resolve()}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"[error] {error}", file=sys.stderr)
        raise SystemExit(1)
