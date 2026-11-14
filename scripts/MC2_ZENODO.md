# MC2 downloads on Zenodo

The colour JPGs and WCS `.head` files in `Merging_Clusters/` (~590 MB) push the
GitHub Pages site past its 1 GB limit, which makes deploys time out. They are
moving to a Zenodo record, and the site links to them there.

The site's "Cluster WL Data" links come from `assets/data/mc2_downloads.json`,
which `scripts/mc2_zenodo.py` writes. It points either at `Merging_Clusters/` on the
site (`local-manifest`) or at the Zenodo record (`manifest`). Clusters with no
files get no download column.

## One-time setup

1. Create a token at zenodo.org → Account → Applications → Personal access tokens,
   with the `deposit:write` scope. Save it (it is never printed):

   ```bash
   pbpaste > ~/.zenodo_token && chmod 600 ~/.zenodo_token
   ```

2. Review `scripts/mc2_zenodo_metadata.json` (title, creators/ORCIDs, description,
   license, related paper). You can still edit everything on zenodo.org before
   publishing.

## Upload and publish

```bash
python3 scripts/mc2_zenodo.py upload --dry-run   # what would be uploaded + sanity checks
python3 scripts/mc2_zenodo.py upload             # creates a DRAFT and uploads (resumable)
```

`upload` refuses to run if a `.head` doesn't describe the same pixel size as its
JPG. If an upload is interrupted, run it again: it resumes the same draft
(saved in `scripts/mc2_zenodo_state.json`) and skips files whose checksums
already match.

The script never publishes. Open the draft link it prints, check it, and press
**Publish** on zenodo.org. Publishing mints the DOI and is permanent: files can't
be changed afterwards, only superseded by a new version.

To practise first, add `--sandbox` to both commands (it needs a separate token
from sandbox.zenodo.org).

## Switch the site to Zenodo

```bash
python3 scripts/mc2_zenodo.py manifest --record <RECORD_ID>
git rm -r --cached Merging_Clusters               # stop publishing the files (keeps them on disk)
echo "Merging_Clusters/" >> .gitignore
git add .gitignore assets/data/mc2_downloads.json scripts/mc2_zenodo_state.json
git commit -m "Serve MC2 downloads from Zenodo"
git push
```

`manifest` reads the published record, so it fails until the draft has been
published. The links then use `https://zenodo.org/records/<ID>/files/<name>?download=1`,
and each cluster panel shows the record's DOI.

## Adding mass maps later

Files named `<cluster>_WL_SN.fits` in `Merging_Clusters/` are picked up as
"Download the mass map." links. Zenodo records can't gain files after
publishing, so add them as a new version of the record (on zenodo.org: "New
version"), then rerun `manifest` with the new record ID. Don't use `upload` for
this; after publishing it starts a separate record, not a new version.
