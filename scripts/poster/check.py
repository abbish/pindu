#!/usr/bin/env python3
"""Inspect an exported poster; dimensions do not prove copy or visual quality."""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps


def inspect(image_path, expected_size, output, preview_width=None, expected_mode=None):
    if output.exists():
        raise ValueError(f"Check record already exists: {output}")
    preview = output.with_name(output.stem + "-preview.png") if preview_width else None
    if preview and preview.exists():
        raise ValueError(f"Preview already exists: {preview}")
    with Image.open(image_path) as image:
        image.verify()
    with Image.open(image_path) as image:
        image.load()
        stored_size = image.size
        image_format = image.format
        frame_count = getattr(image, "n_frames", 1)
        orientation = image.getexif().get(274, 1)
        image = ImageOps.exif_transpose(image)
        failures = []
        if image.size != expected_size:
            failures.append("size")
        if expected_mode and image.mode != expected_mode:
            failures.append("mode")
        if frame_count != 1:
            failures.append("static_image")
        report = {
            "image": str(image_path.resolve()), "expected_size": list(expected_size),
            "actual_size": list(image.size), "stored_size": list(stored_size),
            "exif_orientation": orientation, "aspect_ratio": image.width / image.height,
            "format": image_format, "mode": image.mode, "expected_mode": expected_mode,
            "frame_count": frame_count,
            "icc_profile_present": bool(image.info.get("icc_profile")), "decode_complete": True,
            "automatic_checks_passed": not failures, "failures": failures,
            "visual_review": "pending", "text_and_url_review": "not performed",
            "qr_verification": "not performed", "print_suitability": "not assessed",
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        if preview:
            has_alpha = "A" in image.getbands() or "transparency" in image.info
            thumb = image.convert("RGBA" if has_alpha else "RGB")
            thumb.thumbnail((preview_width, max(1, round(image.height * preview_width / image.width))), Image.Resampling.LANCZOS)
            thumb.save(preview)
            report["viewing_preview"] = {
                "path": str(preview.resolve()), "requested_width": preview_width,
                "size": list(thumb.size), "mode": thumb.mode,
            }
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return not failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--width", required=True, type=int)
    parser.add_argument("--height", required=True, type=int)
    parser.add_argument("--mode", help="Expected Pillow color mode, only if the brief requires one")
    parser.add_argument("--preview-width", type=int, help="Expected viewing width in pixels")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if min(args.width, args.height) <= 0 or (args.preview_width is not None and args.preview_width <= 0):
        parser.error("Dimensions must be positive")
    try:
        passed = inspect(args.image, (args.width, args.height), args.output, args.preview_width, args.mode)
    except (ValueError, OSError) as exc:
        parser.exit(1, f"{exc}\n")
    print(f"{'Passed' if passed else 'Failed'} automatic image checks: {args.output}")
    print("Visual, text, URL and QR checks remain separate.")
    if not passed:
        parser.exit(1)
