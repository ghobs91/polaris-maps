#!/usr/bin/env bash
#
# Mirror a published region-pack build to the secondary pack origins.
#
# GitHub Releases stays the primary origin. Cloudflare R2, Backblaze B2 and the
# Internet Archive are the redundancy/load-distribution tiers: the app rotates
# across every origin advertised in the catalog and verifies each transfer
# against the catalog checksum, so a mirror only has to serve the right bytes.
#
# Each origin is mirrored only when its environment is configured, so this is
# safe to run with one, two, three or four origins.
#
# Usage:
#   scripts/publish-region-mirrors.sh <tag> <dir> [--dry-run]
#
#   tag  release tag, e.g. map-data-2026-01 (mirrored as <origin>/<tag>/...)
#   dir  directory holding `<region>-tiles.pmtiles`, `<region>-routing.tar`, ...
#
# Environment (all optional; unset origins are skipped):
#   R2_BUCKET, RCLONE_CONFIG_R2_*                Cloudflare R2
#   B2_BUCKET, RCLONE_CONFIG_B2_ACCOUNT, ...     Backblaze B2
#   IA_ITEM,   RCLONE_CONFIG_IA_*                Internet Archive
#
# `rclone config` remotes of the same names also work; the script only checks
# that an origin is usable, not how it was configured.
set -euo pipefail

TAG="${1:-}"
SRC="${2:-}"
DRY_RUN="${3:-}"

if [ -z "$TAG" ] || [ -z "$SRC" ]; then
  echo "usage: $0 <tag> <dir> [--dry-run]" >&2
  exit 2
fi

if [ ! -d "$SRC" ]; then
  echo "error: $SRC is not a directory" >&2
  exit 2
fi

# Pack assets only — sizes/checksums metadata travels with the catalog, not the
# mirror, and must not be overwritten by a per-region copy.
INCLUDES=(
  --include "*-tiles.pmtiles"
  --include "*-routing.tar"
  --include "*-geocoding.db"
  --include "*-search.sqlite"
  --include "*-transit.sqlite"
  # The timetable is the largest asset a metro pack carries (Paris: 457 MB).
  # Leaving it out mirrored a pack's three small assets and not the one that
  # dominates the download, while the catalog still advertised a mirror URL for
  # it — a 404 on the heaviest asset of every mirrored metro.
  --include "*-transit-timetable.sqlite"
  # `*-search-shards.tar` is deliberately NOT mirrored. No client fetches it:
  # `registerPackShards` reads `shards.json` / `shards.manifest.json` out of a
  # pack already on disk, and the only tar the download path extracts is
  # `routing.tar`. It was 4.33 GB of a 62 GB mirror (7%) for an asset with no
  # consumer.
)

mirrored=0

copy_origin() {
  local name="$1" remote="$2" dest="$3"
  if [ -n "$DRY_RUN" ]; then
    echo "[$name] would copy $SRC/* → $remote:$dest/$TAG/"
    mirrored=$((mirrored + 1))
    return 0
  fi
  echo "[$name] mirroring → $remote:$dest/$TAG/"
  # --checksum: skip files whose size+hash already match, so re-running after a
  # partial failure resumes instead of re-uploading whole packs.
  #
  # Timeouts are set explicitly because the defaults make a broken upload very
  # expensive: `s3.us.archive.org` drops connections under concurrent PUTs
  # (`ContentLength=N with Body length 0`), and with rclone's 5m request timeout
  # a single region spent ~50 minutes across five attempts before failing. Two
  # transfers instead of four halves the concurrent PUTs that provoke it.
  rclone copy "$SRC" "$remote:$dest/$TAG/" \
    "${INCLUDES[@]}" \
    --checksum \
    --transfers 2 \
    --retries 3 \
    --timeout 120s \
    --contimeout 20s \
    --low-level-retries 3 \
    --stats-one-line
  mirrored=$((mirrored + 1))
}

# ── Cloudflare R2 ──────────────────────────────────────────────────────────
if [ -n "${R2_BUCKET:-}" ] && [ -n "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" ]; then
  copy_origin "r2" "r2" "$R2_BUCKET"
else
  echo "[r2] skipped (R2_BUCKET / RCLONE_CONFIG_R2_* not set)"
fi

# ── Backblaze B2 ───────────────────────────────────────────────────────────
if [ -n "${B2_BUCKET:-}" ] && [ -n "${RCLONE_CONFIG_B2_ACCOUNT:-}" ]; then
  copy_origin "b2" "b2" "$B2_BUCKET"
else
  echo "[b2] skipped (B2_BUCKET / RCLONE_CONFIG_B2_ACCOUNT not set)"
fi

# ── Internet Archive ──────────────────────────────────────────────────────
# IA items hold a flat file list; the tag is a path prefix inside the item, so
# `<item>/<tag>/<asset>` matches the catalog's `<base>/<tag>/<asset>` layout.
if [ -n "${IA_ITEM:-}" ] && [ -n "${RCLONE_CONFIG_IA_ACCESS_KEY_ID:-}" ]; then
  copy_origin "ia" "ia" "$IA_ITEM"
else
  echo "[ia] skipped (IA_ITEM / RCLONE_CONFIG_IA_* not set)"
fi

if [ "$mirrored" -eq 0 ]; then
  # Not an error: a deployment with no secondary origin is a supported state,
  # and GitHub Releases is the only required origin. Failing here made every
  # build red on a repo that had not configured a mirror yet.
  echo "no mirror origin configured — nothing to publish (GitHub Releases is the only origin)"
  exit 0
fi

echo "mirrored $TAG to $mirrored origin(s)"
