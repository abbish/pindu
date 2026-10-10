#!/usr/bin/env python3
"""Check an encoded video and extract visual evidence; human QA remains separate."""
from __future__ import annotations

import argparse
from fractions import Fraction
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image

from render import contact_sheet
from video_tools import load_config, media_tool, sha256, tool_version, write_json


def extract(ffmpeg: str, video: Path, t: float, target: Path) -> Image.Image:
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(t),
                    "-i", str(video), "-frames:v", "1", str(target)], check=True)
    return Image.open(target).convert("RGB")


def review(config_path: Path, video: Path, cover: Path, output: Path) -> bool:
    config = load_config(config_path)
    ffmpeg, ffprobe = media_tool("ffmpeg"), media_tool("ffprobe")
    if output.exists():
        raise ValueError(f"Review directory already exists: {output}; choose a new directory")
    output.mkdir(parents=True)
    metadata = json.loads(subprocess.check_output([
        ffprobe, "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_name,codec_type,width,height,nb_frames,avg_frame_rate,duration,channels,color_space,color_range",
        "-of", "json", str(video)], text=True))
    failures = []
    streams = metadata["streams"]
    picture = next((s for s in streams if s["codec_type"] == "video"), None)
    sound = next((s for s in streams if s["codec_type"] == "audio"), None)
    checks = {}
    def check(name, passed, actual):
        checks[name] = {"passed": bool(passed), "actual": actual}
        if not passed:
            failures.append(name)
    check("video_stream", picture is not None, picture)
    actual_duration = float(metadata["format"]["duration"])
    check("duration", abs(actual_duration - config["duration"]) <= 1 / config["fps"], actual_duration)
    if picture:
        if "video_codec" in config["review"]:
            check("video_codec", picture["codec_name"] == config["review"]["video_codec"], picture["codec_name"])
        if "color_space" in config["review"]:
            check("color_space", picture.get("color_space") == config["review"]["color_space"], picture.get("color_space"))
        check("size", [picture["width"], picture["height"]] == config["size"], [picture["width"], picture["height"]])
        rate = float(Fraction(picture["avg_frame_rate"]))
        check("fps", abs(rate - config["fps"]) < 1e-5, rate)
        count = picture.get("nb_frames")
        if count and count != "N/A":
            check("frame_count", int(count) == round(config["duration"] * config["fps"]), int(count))
    check("audio_stream", sound is not None, sound)
    if sound and "audio_codec" in config["review"]:
        check("audio_codec", sound["codec_name"] == config["review"]["audio_codec"], sound["codec_name"])
    decoded = subprocess.run([ffmpeg, "-hide_banner", "-v", "error", "-xerror", "-i", str(video),
                              "-f", "null", "-"], capture_output=True, text=True)
    check("full_decode", decoded.returncode == 0, decoded.stderr.strip() or "complete")
    samples = []
    for t in config["review"]["sample_times"]:
        if t < actual_duration:
            samples.append((t, extract(ffmpeg, video, t, output / f"encoded-{t:g}.png")))
    if samples:
        contact_sheet(samples, output / "encoded-storyboard.jpg")
    cover_frame = extract(ffmpeg, video, config["review"].get("cover_time", 0), output / "cover-reference.png")
    cover_image = Image.open(cover).convert("RGB")
    check("cover_size", cover_frame.size == cover_image.size, list(cover_image.size))
    if cover_frame.size == cover_image.size:
        difference = np.asarray(cover_frame, dtype=float) - np.asarray(cover_image, dtype=float)
        mse = float(np.mean(difference ** 2))
        psnr = 10 * np.log10(255 ** 2 / mse) if mse else None
        check("cover_matches_frame", psnr is None or psnr >= config["review"].get("cover_psnr_min", 38),
              {"psnr_db": round(float(psnr), 3) if psnr is not None else "identical",
               "mae": round(float(np.abs(difference).mean()), 4)})
    ending = config["review"].get("ending_start")
    if config["review"].get("ending_static") and ending is not None and ending < actual_duration:
        # Examine every decoded ending frame at reduced size, rather than only its endpoints.
        raw = subprocess.check_output([ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", str(ending),
                                       "-i", str(video), "-an", "-vf", "scale=320:180", "-pix_fmt", "gray",
                                       "-f", "rawvideo", "-"])
        pixels = 320 * 180
        if len(raw) % pixels:
            raise ValueError("Incomplete ending frame output")
        frames = np.frombuffer(raw, dtype=np.uint8).reshape((-1, pixels))
        expected_count = round((config["duration"] - ending) * config["fps"])
        check("ending_frame_count", len(frames) == expected_count, len(frames))
        max_mae = float(np.abs(frames.astype(float) - frames[0].astype(float)).mean(axis=1).max()) if len(frames) else None
        check("ending_static", max_mae is not None and max_mae <= config["review"].get("ending_max_mae", 2),
              {"max_mae": round(max_mae, 4) if max_mae is not None else None,
               "resolution": [320, 180], "frames_checked": len(frames),
               "interval_seconds": [ending, config["duration"]]})
    manifest_path = video.parent / "manifest.json"
    manifest_status = "legacy export; provenance not recorded by this tool"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        recorded = manifest.get("inputs", {}).get("config", {}).get("sha256")
        snapshot = video.parent / "render.json"
        check("export_config_snapshot_intact", snapshot.is_file() and sha256(snapshot) == recorded, recorded)
        if snapshot.is_file():
            exported = json.loads(snapshot.read_text())
            # A new sample list or cover timestamp does not require re-encoding the video.
            # Script versions are reported below; semantic differences still need human review.
            review_only = {"review", "script_sha256", "script_version"}
            render_fields = lambda value: {k: v for k, v in value.items() if k not in review_only}
            check("export_render_parameters_match", render_fields(exported) == render_fields(config),
                  {"exact_config_match": recorded == sha256(config_path),
                   "exported_script_version": exported.get("script_version"),
                   "current_script_version": config["script_version"],
                   "script_content_match": exported.get("script_sha256") == config["script_sha256"]})
        manifest_status = "export manifest checked"
    report = {"video": str(video), "video_sha256": sha256(video),
              "config_sha256": sha256(config_path), "script_version": config["script_version"],
              "provenance_status": manifest_status, "tools": {"ffmpeg": tool_version(ffmpeg), "ffprobe": tool_version(ffprobe)},
              "metadata": metadata, "checks": checks, "automatic_checks_passed": not failures,
              "failures": failures, "sample_times": [t for t, _ in samples],
              "visual_review": "pending", "audio_listening": "not performed",
              "manual_items": ["product claims and AI attribution", "readability and alignment", "source-mapped highlights",
                               "transition artifacts", "URL text and credits", "audio quality"]}
    write_json(output / "verification.json", report)
    print(f"{'Passed' if not failures else 'Failed'} automatic checks: {output / 'verification.json'}")
    print("Visual review and audio listening are separate; see encoded-storyboard.jpg and full-size frames.")
    return not failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--cover", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        passed = review(args.config.resolve(), args.video.resolve(), args.cover.resolve(), args.output.resolve())
    except (ValueError, RuntimeError, subprocess.CalledProcessError, FileNotFoundError) as exc:
        parser.exit(1, f"{exc}\n")
    if not passed:
        parser.exit(1)
