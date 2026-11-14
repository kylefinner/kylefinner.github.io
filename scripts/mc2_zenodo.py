#!/usr/bin/env python3
"""Host the MC2 cluster download files (colour JPGs + WCS .head files) on Zenodo
and keep the website's download links in sync.

The website reads its per-cluster download links from assets/data/mc2_downloads.json.
This script writes that file, either pointing at the copies in Merging_Clusters/ on
the site itself, or at a published Zenodo record.

Workflow (see scripts/MC2_ZENODO.md for details):

  1. python3 scripts/mc2_zenodo.py upload            # creates a Zenodo DRAFT, uploads files
  2. review the draft on zenodo.org and press Publish  # publishing is permanent: done by hand
  3. python3 scripts/mc2_zenodo.py manifest --record <ID>   # site links -> Zenodo

Before step 3, `python3 scripts/mc2_zenodo.py local-manifest` points the links at
Merging_Clusters/ on the site.

The access token is read from $ZENODO_TOKEN or ~/.zenodo_token (never printed).
Add --sandbox to any command to use sandbox.zenodo.org for a practice run
(it needs its own token, from a sandbox.zenodo.org account).
"""

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES_DIR = ROOT / "Merging_Clusters"
METADATA_FILE = ROOT / "scripts" / "mc2_zenodo_metadata.json"
MANIFEST_FILE = ROOT / "assets" / "data" / "mc2_downloads.json"
STATE_FILE = ROOT / "scripts" / "mc2_zenodo_state.json"

# Which files belong to a cluster, and the key the website uses for each link.
FILE_KINDS = [
    (re.compile(r"^(?P<cluster>.+)_color\.jpg$"), "color_jpg"),
    (re.compile(r"^(?P<cluster>.+)\.head$"), "wcs_head"),
    (re.compile(r"^(?P<cluster>.+)_WL_SN\.fits$"), "mass_map"),
]


def classify(filename):
    for pattern, kind in FILE_KINDS:
        m = pattern.match(filename)
        if m:
            return m.group("cluster"), kind
    return None, None


def group_by_cluster(filenames):
    """{cluster: {kind: filename}} for clusters that have a colour image.

    A header or mass map without its colour image is skipped (and reported),
    since it isn't useful to download on its own.
    """
    clusters, skipped = {}, []
    for name in sorted(filenames):
        cluster, kind = classify(name)
        if cluster is None:
            skipped.append(name)
            continue
        clusters.setdefault(cluster, {})[kind] = name
    for cluster in list(clusters):
        if "color_jpg" not in clusters[cluster]:
            skipped.extend(clusters.pop(cluster).values())
    return clusters, sorted(skipped)


def local_files():
    return [p.name for p in FILES_DIR.iterdir() if p.is_file() and not p.name.startswith(".")]


def jpeg_size(path):
    """(width, height) from a JPEG's start-of-frame marker."""
    with open(path, "rb") as f:
        data = f.read(1 << 20)
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height = int.from_bytes(data[i + 5:i + 7], "big")
            width = int.from_bytes(data[i + 7:i + 9], "big")
            return width, height
        i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    return None


def header_size(path):
    text = path.read_text(errors="replace")
    n1 = re.search(r"^NAXIS1\s*=\s*(\d+)", text, re.M)
    n2 = re.search(r"^NAXIS2\s*=\s*(\d+)", text, re.M)
    return (int(n1.group(1)), int(n2.group(1))) if n1 and n2 else None


def wcs_mismatches(clusters):
    """Clusters whose .head doesn't describe the same pixel grid as the colour JPG."""
    bad = []
    for cluster, files in sorted(clusters.items()):
        if "wcs_head" not in files:
            continue
        img = jpeg_size(FILES_DIR / files["color_jpg"])
        hdr = header_size(FILES_DIR / files["wcs_head"])
        if img != hdr:
            bad.append(f"{cluster}: JPG {img}, header NAXIS1/2 {hdr}")
    return bad


def md5sum(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(source, clusters, url_for, record_url=None, doi=None):
    manifest = {"source": source}
    if record_url:
        manifest["record_url"] = record_url
    if doi:
        manifest["doi"] = doi
    manifest["clusters"] = {
        cluster: {kind: url_for(name) for kind, name in sorted(files.items())}
        for cluster, files in sorted(clusters.items())
    }
    MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_FILE.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {MANIFEST_FILE.relative_to(ROOT)} ({len(clusters)} clusters, source: {source})")


# ── Zenodo API ────────────────────────────────────────────────────────────────

def base_url(sandbox):
    return "https://sandbox.zenodo.org" if sandbox else "https://zenodo.org"


def read_token():
    token = os.environ.get("ZENODO_TOKEN")
    token_file = Path.home() / ".zenodo_token"
    if not token and token_file.exists():
        token = token_file.read_text().strip()
    if not token:
        sys.exit(
            "No Zenodo token found. Create one at zenodo.org > Account > Applications >\n"
            "Personal access tokens (scope: deposit:write), then save it with:\n"
            "  pbpaste > ~/.zenodo_token && chmod 600 ~/.zenodo_token\n"
            "(or export ZENODO_TOKEN=...)."
        )
    return token


def api(session, method, url, **kwargs):
    import requests  # imported here so local-manifest works without it

    try:
        r = session.request(method, url, timeout=kwargs.pop("timeout", 60), **kwargs)
    except requests.RequestException as e:
        sys.exit(f"{method} {url} failed: {e}")
    if r.status_code >= 400:
        sys.exit(f"{method} {url} -> HTTP {r.status_code}: {r.text[:500]}")
    return r.json() if r.content else {}


def load_metadata():
    meta = json.loads(METADATA_FILE.read_text())
    meta.pop("_comment", None)
    # Drop empty optional fields (e.g. an ORCID not filled in) so Zenodo doesn't reject them.
    for creator in meta.get("creators", []):
        for key in [k for k, v in creator.items() if not v]:
            del creator[key]
    meta["prereserve_doi"] = True
    return meta


def cmd_upload(args):
    import requests

    clusters, skipped = group_by_cluster(local_files())
    to_upload = sorted(name for files in clusters.values() for name in files.values())
    total_mb = sum((FILES_DIR / n).stat().st_size for n in to_upload) / 1e6
    print(f"{len(to_upload)} files from {len(clusters)} clusters, {total_mb:.0f} MB")
    if skipped:
        print(f"Skipping (no colour image or not a data file): {', '.join(skipped)}")
    mismatches = wcs_mismatches(clusters)
    if mismatches:
        print("WCS header doesn't match the colour image size:")
        for line in mismatches:
            print("  ", line)
        if not args.allow_wcs_mismatch:
            sys.exit("Fix these (or pass --allow-wcs-mismatch) before uploading; "
                     "a published Zenodo record can't be edited in place.")
    if args.dry_run:
        for name in to_upload:
            print("  ", name)
        load_metadata()  # validates the JSON
        print("Dry run: nothing uploaded.")
        return

    base = base_url(args.sandbox)
    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {read_token()}"

    deposition_id = args.deposition
    if deposition_id is None and STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text())
        if state.get("base") == base and not state.get("published"):
            deposition_id = state["deposition_id"]
            print(f"Resuming draft {deposition_id} (from {STATE_FILE.name}; pass --new to start over)")
    if args.new:
        deposition_id = None

    if deposition_id is None:
        dep = api(session, "POST", f"{base}/api/deposit/depositions", json={})
        deposition_id = dep["id"]
        print(f"Created draft {deposition_id}")
    else:
        dep = api(session, "GET", f"{base}/api/deposit/depositions/{deposition_id}")
    STATE_FILE.write_text(json.dumps({"base": base, "deposition_id": deposition_id}, indent=2) + "\n")

    bucket = dep["links"]["bucket"]
    existing = {
        f["filename"]: f["checksum"]
        for f in api(session, "GET", f"{base}/api/deposit/depositions/{deposition_id}/files")
    }

    for i, name in enumerate(to_upload, 1):
        path = FILES_DIR / name
        local_md5 = md5sum(path)
        if existing.get(name) == local_md5:
            print(f"[{i}/{len(to_upload)}] {name}: already uploaded")
            continue
        size_mb = path.stat().st_size / 1e6
        print(f"[{i}/{len(to_upload)}] {name} ({size_mb:.1f} MB)...", flush=True)
        with open(path, "rb") as f:
            result = api(session, "PUT", f"{bucket}/{name}", data=f, timeout=1800)
        remote_md5 = result.get("checksum", "").removeprefix("md5:")
        if remote_md5 != local_md5:
            sys.exit(f"Checksum mismatch for {name}: local {local_md5}, Zenodo {remote_md5}")

    dep = api(
        session,
        "PUT",
        f"{base}/api/deposit/depositions/{deposition_id}",
        json={"metadata": load_metadata()},
    )
    doi = (dep.get("metadata", {}).get("prereserve_doi") or {}).get("doi")
    print()
    print(f"Draft ready (NOT published): {dep['links'].get('html', f'{base}/deposit/{deposition_id}')}")
    if doi:
        print(f"Reserved DOI: {doi}")
    print("Review it on Zenodo and press Publish. Then run:")
    sandbox_flag = " --sandbox" if args.sandbox else ""
    print(f"  python3 scripts/mc2_zenodo.py manifest --record {deposition_id}{sandbox_flag}")


def cmd_manifest(args):
    import requests

    base = base_url(args.sandbox)
    r = requests.get(f"{base}/api/records/{args.record}", timeout=60)
    if r.status_code == 404:
        sys.exit(f"Record {args.record} isn't public yet. Publish the draft on Zenodo first.")
    r.raise_for_status()
    record = r.json()

    files = record.get("files") or []
    keys = [f.get("key") or f.get("filename") for f in files]
    if not keys:
        sys.exit(f"Record {args.record} has no files listed.")
    clusters, skipped = group_by_cluster(keys)
    if skipped:
        print(f"Not linked from the site: {', '.join(skipped)}")

    record_url = f"{base}/records/{args.record}"
    doi = record.get("doi") or record.get("metadata", {}).get("doi")
    write_manifest(
        "zenodo",
        clusters,
        lambda name: f"{record_url}/files/{name}?download=1",
        record_url=record_url,
        doi=doi,
    )
    STATE_FILE.write_text(
        json.dumps({"base": base, "deposition_id": int(args.record), "published": True}, indent=2) + "\n"
    )


def cmd_local_manifest(args):
    clusters, skipped = group_by_cluster(local_files())
    if skipped:
        print(f"Not linked from the site: {', '.join(skipped)}")
    write_manifest("local", clusters, lambda name: f"{FILES_DIR.name}/{name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("upload", help="create/resume a Zenodo draft and upload the files (never publishes)")
    p.add_argument("--sandbox", action="store_true", help="use sandbox.zenodo.org")
    p.add_argument("--deposition", type=int, help="existing draft ID to upload into")
    p.add_argument("--new", action="store_true", help="ignore the saved draft and create a new one")
    p.add_argument("--dry-run", action="store_true", help="list what would be uploaded, then stop")
    p.add_argument("--allow-wcs-mismatch", action="store_true",
                   help="upload even if a .head doesn't match its JPG's pixel size")
    p.set_defaults(func=cmd_upload)

    p = sub.add_parser("manifest", help="point the site's download links at a published Zenodo record")
    p.add_argument("--record", required=True, help="Zenodo record ID")
    p.add_argument("--sandbox", action="store_true", help="use sandbox.zenodo.org")
    p.set_defaults(func=cmd_manifest)

    p = sub.add_parser("local-manifest", help="point the site's download links at Merging_Clusters/")
    p.set_defaults(func=cmd_local_manifest)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
