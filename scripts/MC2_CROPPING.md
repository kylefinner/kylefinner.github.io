# MC2 Cropping Workflow

This workflow lets you crop the MC2 color JPGs while keeping the matching `.head`
files aligned for future WCS-based tools like contour overlays.

## 1. Create a starter manifest

```bash
cd /Users/kyle/kylefinner.github.io
python3 scripts/create_mc2_crop_manifest.py --out scripts/mc2_crop_manifest.json
```

For a centered crop that removes 10% from each edge:

```bash
python3 scripts/create_mc2_crop_manifest.py \
  --edge-percent 10 \
  --out scripts/mc2_crop_manifest_10pct.json
```

This keeps each cluster centered and crops the same fraction from every image.

If you truly want every output image to have the exact same final pixel size:

```bash
python3 scripts/create_mc2_crop_manifest.py \
  --edge-percent 10 \
  --same-final-size \
  --out scripts/mc2_crop_manifest_same_size.json
```

Be careful with this option: the smallest image sets the shared final size, so it
can over-crop the larger mosaics.

The manifest contains one entry per cluster:

```json
{
  "abell115": {
    "left": 0,
    "right": 0,
    "top": 0,
    "bottom": 0,
    "_current_width": 11725,
    "_current_height": 11702,
    "_crop_width": 11725,
    "_crop_height": 11702,
    "_nearest_multiple_width": 11264,
    "_nearest_multiple_height": 11264
  }
}
```

Only the four crop values are used when applying crops. The `_...` fields are just
reference notes to help choose target dimensions.

## 2. Edit the crop values

For each cluster, set the number of pixels to trim from:

- `left`
- `right`
- `top`
- `bottom`

Example:

```json
"abell115": {
  "left": 120,
  "right": 140,
  "top": 96,
  "bottom": 128
}
```

## 3. Apply crops and update `.head` files

```bash
python3 scripts/apply_mc2_crops.py \
  --manifest scripts/mc2_crop_manifest.json \
  --out-dir /Users/kyle/Work/MC2/Merging_Clusters_Website_Files_Cropped
```

This writes cropped JPGs and updated `.head` files to a new output directory.

The script updates:

- `NAXIS1`
- `NAXIS2`
- `CRPIX1`
- `CRPIX2`

So the cropped images remain aligned in pixel space.

## 4. Regenerate tiles

```bash
./scripts/regenerate_mc2_tiles.sh
```

That rebuilds the tile pyramids from the cropped source set.

## 5. Sync the updated tiles into the website

If the regenerated tiles look good, replace the site copy:

```bash
rsync -a --delete /Users/kyle/Work/MC2/all_tiles_cropped/ /Users/kyle/Work/MC2/all_tiles/
./scripts/sync_mc2_assets.sh
```

## Notes

- The crop script uses macOS `sips`, so it should work naturally on your machine.
- Cropping only the JPGs without updating the `.head` files will break future WCS and contour alignment.
- If you want, the next step can be an automatic crop suggester for detecting border artifacts.
