#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def image_size(path: Path) -> tuple[int, int]:
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    width = None
    height = None
    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith("pixelWidth:"):
            width = int(line.split(":", 1)[1].strip())
        if line.startswith("pixelHeight:"):
            height = int(line.split(":", 1)[1].strip())
    if width is None or height is None:
        raise RuntimeError(f"Could not determine image size for {path}")
    return width, height


def normalize_cluster(image_name: str) -> str:
    stem = Path(image_name).stem
    return stem.replace("_color", "")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a starter MC2 crop manifest.")
    parser.add_argument("--source-dir", default="/Users/kyle/Work/MC2/Merging_Clusters_Website_Files")
    parser.add_argument("--out", required=True, help="Output manifest path")
    parser.add_argument("--multiple", type=int, default=512, help="Optional note for nice target sizes")
    parser.add_argument(
        "--edge-percent",
        type=float,
        default=0.0,
        help="Centered crop percentage to remove from each edge, e.g. 10 trims 10%% from left/right/top/bottom.",
    )
    parser.add_argument(
        "--same-final-size",
        action="store_true",
        help="Use one centered final width/height for every image after applying edge-percent.",
    )
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    out_path = Path(args.out).resolve()

    trim_fraction = args.edge_percent / 100.0
    if trim_fraction < 0 or trim_fraction >= 0.5:
        raise ValueError("--edge-percent must be >= 0 and < 50")

    images = sorted(source_dir.glob("*.jpg"))
    sizes = {image_path: image_size(image_path) for image_path in images}

    target_width = None
    target_height = None
    if args.same_final_size:
        target_width = min(round(width * (1.0 - (2.0 * trim_fraction))) for width, _ in sizes.values())
        target_height = min(round(height * (1.0 - (2.0 * trim_fraction))) for _, height in sizes.values())

    manifest = {}
    for image_path in images:
        cluster = normalize_cluster(image_path.name)
        width, height = sizes[image_path]

        if args.same_final_size:
            crop_width = int(target_width)
            crop_height = int(target_height)
            left = (width - crop_width) // 2
            right = width - crop_width - left
            top = (height - crop_height) // 2
            bottom = height - crop_height - top
        else:
            left = round(width * trim_fraction)
            right = left
            top = round(height * trim_fraction)
            bottom = top
            crop_width = width - left - right
            crop_height = height - top - bottom

        manifest[cluster] = {
            "left": left,
            "right": right,
            "top": top,
            "bottom": bottom,
            "_current_width": width,
            "_current_height": height,
            "_crop_width": crop_width,
            "_crop_height": crop_height,
            "_nearest_multiple_width": crop_width - (crop_width % args.multiple),
            "_nearest_multiple_height": crop_height - (crop_height % args.multiple),
        }

    out_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote starter manifest to {out_path}")


if __name__ == "__main__":
    main()
