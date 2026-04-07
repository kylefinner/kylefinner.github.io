#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


CARD_RE = re.compile(r"^(?P<key>[A-Z0-9_-]+)\s*=\s*(?P<value>.{0,70})$")
NUMERIC_RE = re.compile(r"^[\s]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)")


def run_command(args: list[str]) -> None:
    subprocess.run(args, check=True)


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


def parse_head_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def parse_numeric_card(line: str) -> tuple[str, float] | None:
    match = CARD_RE.match(line.rstrip())
    if not match:
        return None
    key = match.group("key")
    value_field = match.group("value")
    numeric = NUMERIC_RE.match(value_field)
    if not numeric:
        return None
    return key, float(numeric.group(1))


def update_card_value(line: str, new_value: str) -> str:
    if "=" not in line:
        return line
    prefix, suffix = line.split("=", 1)
    comment = ""
    if "/" in suffix:
        value_part, comment_part = suffix.split("/", 1)
        comment = "/" + comment_part
    else:
        value_part = suffix

    width = max(len(value_part), len(new_value) + 1)
    new_field = f" {new_value}".rjust(width)
    updated = prefix + "=" + new_field
    if comment:
        updated += comment
    return updated


def update_head(path_in: Path, path_out: Path, crop: dict[str, int], width: int, height: int) -> None:
    left = int(crop["left"])
    top = int(crop["top"])
    right = int(crop["right"])
    bottom = int(crop["bottom"])

    new_width = width - left - right
    new_height = height - top - bottom
    if new_width <= 0 or new_height <= 0:
        raise ValueError(f"Invalid crop for {path_in.name}: resulting size is non-positive")

    updates = {
        "NAXIS1": str(new_width),
        "NAXIS2": str(new_height),
    }

    lines = parse_head_lines(path_in)
    new_lines: list[str] = []

    for line in lines:
        parsed = parse_numeric_card(line)
        if not parsed:
            new_lines.append(line)
            continue

        key, value = parsed
        if key in updates:
            new_lines.append(update_card_value(line, updates[key]))
        elif key == "CRPIX1":
            new_lines.append(update_card_value(line, f"{value - left:.12E}"))
        elif key == "CRPIX2":
            new_lines.append(update_card_value(line, f"{value - top:.12E}"))
        else:
            new_lines.append(line)

    path_out.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def apply_crop(image_in: Path, image_out: Path, crop: dict[str, int], width: int, height: int) -> tuple[int, int]:
    left = int(crop["left"])
    top = int(crop["top"])
    right = int(crop["right"])
    bottom = int(crop["bottom"])
    new_width = width - left - right
    new_height = height - top - bottom

    if min(left, top, right, bottom) < 0:
        raise ValueError(f"Negative crop margin for {image_in.name}")
    if new_width <= 0 or new_height <= 0:
        raise ValueError(f"Invalid crop for {image_in.name}: resulting size is non-positive")

    offset_y = height - top - new_height
    offset_x = left

    image_out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / image_out.name
        run_command([
            "sips",
            "--cropToHeightWidth",
            str(new_height),
            str(new_width),
            "--cropOffset",
            str(offset_y),
            str(offset_x),
            str(image_in),
            "--out",
            str(tmp_path),
        ])
        shutil.move(str(tmp_path), str(image_out))

    return new_width, new_height


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply MC2 JPG crops and update matching .head files.")
    parser.add_argument("--manifest", required=True, help="JSON manifest with per-cluster crop margins")
    parser.add_argument("--source-dir", default="/Users/kyle/Work/MC2/Merging_Clusters_Website_Files")
    parser.add_argument("--out-dir", required=True, help="Output directory for cropped JPG/.head pairs")
    parser.add_argument("--cluster", action="append", default=[], help="Only process a specific cluster id")
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))

    requested = set(args.cluster) if args.cluster else None
    out_dir.mkdir(parents=True, exist_ok=True)

    for cluster, crop in sorted(manifest.items()):
      if requested is not None and cluster not in requested:
          continue

      image_in = source_dir / f"{cluster}_color.jpg"
      if not image_in.exists():
          alt = next(iter(source_dir.glob(f"{cluster}*.jpg")), None)
          if alt is None:
              raise FileNotFoundError(f"No JPG found for cluster {cluster}")
          image_in = alt

      head_in = source_dir / f"{cluster}.head"
      if not head_in.exists():
          alt = next(iter(source_dir.glob(f"{cluster}*.head")), None)
          if alt is None:
              raise FileNotFoundError(f"No .head found for cluster {cluster}")
          head_in = alt

      width, height = image_size(image_in)
      image_out = out_dir / image_in.name
      head_out = out_dir / head_in.name

      new_width, new_height = apply_crop(image_in, image_out, crop, width, height)
      update_head(head_in, head_out, crop, width, height)

      print(
          f"{cluster}: {width}x{height} -> {new_width}x{new_height} "
          f"(left={crop['left']}, right={crop['right']}, top={crop['top']}, bottom={crop['bottom']})"
      )


if __name__ == "__main__":
    main()
