"""Shared configuration, provenance and media-tool lookup for local promo exports."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[2]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repo_path(value: str) -> Path:
    path = (REPO / value).resolve()
    if not path.is_relative_to(REPO):
        raise ValueError(f"Expected repository-relative path: {value}")
    return path


def load_config(path: Path, *, check_script: bool = True) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    for key in ("script", "script_version", "script_sha256", "subtitles", "renderer",
                "duration", "fps", "size", "scenes", "assets", "review"):
        if key not in config:
            raise ValueError(f"Missing config field: {key}")
    duration, fps = config["duration"], config["fps"]
    if not all(isinstance(n, (int, float)) and math.isfinite(n) and n > 0
               for n in (duration, fps)):
        raise ValueError("duration and fps must be positive finite numbers")
    if abs(duration * fps - round(duration * fps)) > 1e-6:
        raise ValueError("duration × fps must be a whole number of frames")
    if (len(config["size"]) != 2 or
            any(not isinstance(n, int) or n <= 0 or n % 2 for n in config["size"])):
        raise ValueError("size must contain two positive even integers")
    cursor = 0
    for scene in config["scenes"]:
        if scene["start"] != cursor or scene["end"] <= cursor:
            raise ValueError("Scene timeline must be ordered and contiguous from zero")
        cursor = scene["end"]
    if cursor != duration:
        raise ValueError("Scene timeline does not cover duration")
    for key in ("script", "subtitles", "renderer"):
        if not repo_path(config[key]).is_file():
            raise ValueError(f"Missing {key}: {config[key]}")
    if check_script and sha256(repo_path(config["script"])) != config["script_sha256"]:
        raise ValueError("Script changed: sync render config and its script_sha256 before export")
    for name, asset in config["assets"].items():
        if not repo_path(asset["path"]).is_file() or not asset.get("provenance"):
            raise ValueError(f"Missing asset or provenance: {name}")
    review = config["review"]
    if not 0 <= review.get("cover_time", 0) < duration:
        raise ValueError("cover_time is outside video")
    if any(not 0 <= t < duration for t in review.get("sample_times", [])):
        raise ValueError("Review sample time is outside video")
    if "ending_start" in review and not 0 <= review["ending_start"] < duration:
        raise ValueError("ending_start is outside video")
    name = config.get("video_name", "product.mp4")
    if Path(name).name != name or not name.endswith(".mp4"):
        raise ValueError("video_name must be a simple .mp4 filename")
    cues = re.findall(r"(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})",
                      repo_path(config["subtitles"]).read_text(encoding="utf-8"))
    def seconds(stamp):
        h, m, rest = stamp.split(":")
        s, ms = rest.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
    previous = 0
    for start, end in cues:
        start, end = seconds(start), seconds(end)
        if start < previous or end <= start or end > duration:
            raise ValueError("Subtitles overlap or exceed video duration")
        previous = end
    return config


def media_tool(name: str) -> str:
    override = os.environ.get(f"PROMO_{name.upper()}")
    if override:
        resolved = shutil.which(override)
        if not resolved:
            raise ValueError(f"PROMO_{name.upper()} is not executable: {override}")
        return resolved
    found = shutil.which(name)
    if found:
        return found
    if name == "ffmpeg":
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            pass
    machine = {"arm64": "aarch64", "AMD64": "x86_64"}.get(platform.machine(), platform.machine())
    suffix = {"Darwin": "apple-darwin", "Linux": "unknown-linux-gnu",
              "Windows": "pc-windows-msvc.exe"}.get(platform.system())
    candidate = REPO / "src-tauri" / "binaries" / f"{name}-{machine}-{suffix}"
    if suffix and candidate.is_file():
        return str(candidate)
    raise ValueError(f"{name} unavailable: install it or set PROMO_{name.upper()}")


def tool_version(tool: str) -> str:
    return subprocess.check_output([tool, "-version"], text=True).splitlines()[0]


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def provenance(config: dict, config_path: Path) -> dict:
    paths = {"script": repo_path(config["script"]), "subtitles": repo_path(config["subtitles"]),
             "renderer": repo_path(config["renderer"]), "config": config_path.resolve()}
    return {
        "script_version": config["script_version"],
        "inputs": {k: {"path": str(v.relative_to(REPO)), "sha256": sha256(v)} for k, v in paths.items()},
        "assets": {k: {**v, "sha256": sha256(repo_path(v["path"]))} for k, v in config["assets"].items()},
        "helpers": {p.name: sha256(p) for p in Path(__file__).parent.glob("*.py")},
    }
