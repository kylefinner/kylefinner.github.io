#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="/Users/kyle/Work/MC2/all_tiles"
TARGET_DIR="$ROOT_DIR/mc2_tiles"
INDEX_TARGET="$ROOT_DIR/assets/data/mc2_tiles_index.json"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing source directory: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR" "$(dirname "$INDEX_TARGET")"

rsync -a --delete --exclude '.DS_Store' "$SOURCE_DIR"/ "$TARGET_DIR"/

jq '
  .out_dir = "mc2_tiles"
  | .clusters |= map(
      .tile_url_template |= sub("^/tiles/"; "mc2_tiles/")
      | .source_image = (.source_image | split("/") | last)
      | .source_head = (.source_head | split("/") | last)
    )
' "$SOURCE_DIR/index.json" > "$INDEX_TARGET"

echo "Synced MC2 tiles into $TARGET_DIR"
echo "Wrote index to $INDEX_TARGET"
