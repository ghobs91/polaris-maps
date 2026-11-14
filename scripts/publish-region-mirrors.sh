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
  --include "*-search-shards.tar"
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
  rclone copy "$SRC" "$remote:$dest/$TAG/" \
    "${INCLUDES[@]}" \
    --checksum \
    --transfers 4 \
    --retries 3 \
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
  echo "error: no mirror origin was configured" >&2
  exit 1
fi

echo "mirrored $TAG to $mirrored origin(s)"
