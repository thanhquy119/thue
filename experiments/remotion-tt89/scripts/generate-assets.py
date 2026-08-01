#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SPEC = ROOT / "content" / "video.json"


def run(command: list[str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def duration_seconds(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def synthesize(text: str, output: Path, voice: dict[str, str]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as handle:
        handle.write(text)
        text_path = Path(handle.name)
    try:
        run(
            [
                "edge-tts",
                "--voice",
                voice.get("name", "vi-VN-HoaiMyNeural"),
                f"--rate={voice.get('rate', '-4%')}",
                f"--pitch={voice.get('pitch', '+0Hz')}",
                f"--volume={voice.get('volume', '+0%')}",
                "--file",
                str(text_path),
                "--write-media",
                str(output),
            ]
        )
    finally:
        text_path.unlink(missing_ok=True)


def caption_timeline(chunks: list[str], start: float, speech_duration: float) -> list[dict[str, Any]]:
    cleaned = [chunk.strip() for chunk in chunks if chunk.strip()]
    if not cleaned:
        return []
    weights = [max(8, len(chunk)) for chunk in cleaned]
    total_weight = sum(weights)
    cursor = start + 0.08
    end_limit = start + max(0.4, speech_duration)
    result: list[dict[str, Any]] = []
    for index, (chunk, weight) in enumerate(zip(cleaned, weights, strict=True)):
        remaining = end_limit - cursor
        if index == len(cleaned) - 1:
            end = end_limit
        else:
            share = speech_duration * (weight / total_weight)
            end = min(end_limit, cursor + max(0.9, share))
        result.append(
            {
                "text": chunk,
                "startMs": round(cursor * 1000),
                "endMs": round(max(cursor + 0.35, end) * 1000),
                "timestampMs": None,
                "confidence": 1,
            }
        )
        cursor = end
    return result


def generate(spec_path: Path) -> None:
    if not shutil.which("edge-tts"):
        raise RuntimeError("Không tìm thấy edge-tts. Cài bằng: python -m pip install edge-tts==7.2.8")
    if not shutil.which("ffprobe"):
        raise RuntimeError("Không tìm thấy ffprobe trong PATH.")

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    fps = int(spec.get("fps", 30))
    voice = spec.get("voice", {})
    scenes: list[dict[str, Any]] = []
    captions: list[dict[str, Any]] = []
    current_frame = 0

    audio_dir = ROOT / "public" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    for raw_scene in spec["scenes"]:
        scene = dict(raw_scene)
        audio_name = f"{scene['id']}.mp3"
        audio_path = audio_dir / audio_name
        synthesize(scene["narration"], audio_path, voice)
        speech_duration = duration_seconds(audio_path)
        duration_in_frames = max(4 * fps, math.ceil((speech_duration + 0.65) * fps))
        scene["durationInFrames"] = duration_in_frames
        scene["audio"] = f"audio/{audio_name}"
        scene.pop("captionChunks", None)
        scenes.append(scene)

        scene_start_seconds = current_frame / fps
        captions.extend(
            caption_timeline(
                raw_scene.get("captionChunks") or [raw_scene["narration"]],
                scene_start_seconds,
                speech_duration,
            )
        )
        current_frame += duration_in_frames
        print(
            f"[scene] {scene['id']}: speech={speech_duration:.2f}s, timeline={duration_in_frames / fps:.2f}s",
            flush=True,
        )

    data_source = f"""import type {{Caption}} from '@remotion/captions';

export const FPS = {fps};

export type SceneKind = 'intro' | 'timeline' | 'electronic' | 'benefits' | 'prepare';
export type SceneCard = {{label: string; value: string}};

export type Scene = {{
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
}};

export const VIDEO_SLUG = {json.dumps(spec.get('slug', 'legal-video'), ensure_ascii=False)};
export const COMPOSITION_ID = {json.dumps(spec.get('compositionId', 'LegalVideo'), ensure_ascii=False)};
export const SCENES = {json.dumps(scenes, ensure_ascii=False, indent=2)} as Scene[];

export const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0);
export const sceneStartFrame = (index: number) =>
  SCENES.slice(0, index).reduce((sum, scene) => sum + scene.durationInFrames, 0);

export const CAPTIONS = {json.dumps(captions, ensure_ascii=False, indent=2)} as Caption[];
"""
    (ROOT / "src" / "data.ts").write_text(data_source, encoding="utf-8")
    (ROOT / "out").mkdir(exist_ok=True)
    print(f"[done] Đã tạo {len(scenes)} cảnh, tổng {current_frame / fps:.2f}s.", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Tạo giọng đọc và timeline cho video Remotion pháp luật.")
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    args = parser.parse_args()
    generate(args.spec.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
