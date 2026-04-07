#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MC2_ROOT="/Users/kyle/Work/MC2"
CROPPED_DIR="${1:-$MC2_ROOT/Merging_Clusters_Website_Files_Cropped}"
TILES_DIR="${2:-$MC2_ROOT/all_tiles_cropped}"

python3 "$MC2_ROOT/make_all_tiles.py" \
  --source-dir "$CROPPED_DIR" \
  --out-dir "$TILES_DIR" \
  --overwrite

echo "Regenerated tiles in $TILES_DIR"
echo "If those look good, sync them into the site with:"
echo "  ./scripts/sync_mc2_assets.sh"
