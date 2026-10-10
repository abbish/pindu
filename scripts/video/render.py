#!/usr/bin/env python3
"""Render a configured per-video layout; previews never claim to be encoded output."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import shutil
import subprocess
import time

from PIL import Image, ImageDraw

from video_tools import REPO, load_config, media_tool, provenance, repo_path, tool_version, write_json


def render(config_path: Path, output: Path, preview: bool) -> None:
    config = load_config(config_path)
    if output.exists():
        raise ValueError(f"Output batch already exists: {output}; choose a new batch")
    spec = importlib.util.spec_from_file_location("promo_layout", repo_path(config["renderer"]))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare(config, REPO)
    ffmpeg = None
    if not preview:
        ffmpeg = media_tool("ffmpeg")
        encoders = subprocess.check_output([ffmpeg, "-hide_banner", "-encoders"], text=True)
        if "libx264" not in encoders:
            raise ValueError("Renderer requires libx264; install imageio-ffmpeg or set PROMO_FFMPEG to a full FFmpeg")
    output.mkdir(parents=True)
    qa = output / "qa"
    qa.mkdir()
    manifest = provenance(config, config_path)
    manifest["kind"] = "source-preview" if preview else "encoded-export"
    manifest["visual_review"] = "pending"
    for source_key, filename in (("script", "script.md"), ("subtitles", "subtitles.srt")):
        shutil.copyfile(repo_path(config[source_key]), output / filename)
    shutil.copyfile(config_path, output / "render.json")
    times = config["review"]["sample_times"]
    thumbs = []
    for t in times:
        im = module.frame(t)
        if im.size != tuple(config["size"]):
            raise ValueError("Renderer frame size differs from config")
        im.save(qa / f"source-{t:g}.png")
        thumbs.append((t, im))
    contact_sheet(thumbs, qa / "source-storyboard.jpg")
    if preview:
        write_json(output / "manifest.json", manifest)
        print(f"Source preview: {output}")
        return
    import render_support
    manifest["fonts"] = {kind: {"path": path, "collection_index": index}
                         for kind, (path, index) in render_support.FONT_SPECS.items()}
    render_support.music(output / "original-music.wav")
    width, height = config["size"]
    fps, duration = config["fps"], config["duration"]
    count = round(fps * duration)
    video = output / config.get("video_name", "product.mp4")
    encoding = config.get("encoding", {})
    args = [ffmpeg, "-hide_banner", "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
            "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
            "-i", str(output / "original-music.wav"), "-map", "0:v:0", "-map", "1:a:0",
            "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709,setsar=1",
            "-c:v", "libx264", "-preset", encoding.get("preset", "medium"),
            "-crf", str(encoding.get("crf", 18)), "-pix_fmt", "yuv420p",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
            "-color_range", "tv", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            "-metadata", f"title={config.get('title', '')}", "-t", str(duration), str(video)]
    start = time.monotonic()
    with (qa / "encode.log").open("w") as log:
        proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log)
        try:
            for j in range(count):
                proc.stdin.write(module.frame(j / fps).convert("RGB").tobytes())
                if j % max(1, round(fps * 5)) == 0:
                    print(f"Rendered {j}/{count} frames; {time.monotonic() - start:.1f}s", flush=True)
            proc.stdin.close()
            if proc.wait():
                raise RuntimeError(f"Encoding failed; see {qa / 'encode.log'}")
        except BaseException:
            if proc.poll() is None:
                proc.terminate()
                proc.wait()
            raise
    for name in ("cover.png", "cover.jpg"):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss",
                        str(config["review"].get("cover_time", 0)), "-i", str(video),
                        "-frames:v", "1", str(output / name)], check=True)
    manifest["ffmpeg"] = tool_version(ffmpeg)
    manifest["video"] = video.name
    write_json(output / "manifest.json", manifest)
    print(f"Encoded export: {video}")


def contact_sheet(samples: list, path: Path) -> None:
    rows = (len(samples) + 2) // 3
    sheet = Image.new("RGB", (1920, rows * 382), "#F2F4F0")
    draw = ImageDraw.Draw(sheet)
    for j, (t, im) in enumerate(samples):
        x, y = j % 3 * 640, j // 3 * 382
        thumb = im.copy()
        thumb.thumbnail((640, 360), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x + (640 - thumb.width) // 2, y))
        draw.text((x + 8, y + 362), f"{t:g} s", fill="#143A36")
    sheet.save(path, quality=95, subsampling=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--preview", action="store_true", help="Source frames only; no encoded video")
    args = parser.parse_args()
    try:
        render(args.config.resolve(), args.output.resolve(), args.preview)
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"{exc}\n")
