#!/usr/bin/env bash
# build-region-bundle.sh — Produce geocoding + Overture bundles for a Geofabrik region.
#
# Usage: ./scripts/build-region-bundle.sh us/new-york
#
# Prerequisites: osmium, duckdb, node (>=18), gzip
# Output: geocoding-data.sqlite.gz, overture-places.geojson.gz, manifest-entry.json

set -euo pipefail

SLUG="${1:?Usage: $0 <geofabrik-slug>  (e.g. us/new-york)}"
REGION_ID="${SLUG//\//-}"
HUMAN_NAME="$(echo "$SLUG" | sed 's|.*/||; s/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')"
VERSION="$(date +%Y-%m-%d)"
WORK_DIR="$(mktemp -d)"

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

echo "==> Working in $WORK_DIR"
echo "==> Region: $SLUG → id=$REGION_ID"

# ── 1. Download Geofabrik extract ────────────────────────────────────────────
PBF_URL="https://download.geofabrik.de/${SLUG}-latest.osm.pbf"
echo "==> Downloading $PBF_URL …"
curl -fSL -o "$WORK_DIR/input.osm.pbf" "$PBF_URL"

# ── 2. Filter to named/addressed features ────────────────────────────────────
echo "==> Filtering with osmium …"
osmium tags-filter "$WORK_DIR/input.osm.pbf" \
  n/name w/name n/addr:housenumber w/addr:housenumber \
  -o "$WORK_DIR/filtered.osm.pbf"

# ── 3. Build geocoding SQLite ────────────────────────────────────────────────
echo "==> Building geocoding-data.sqlite …"
node "$(dirname "$0")/osm-to-geocoding-sqlite.mjs" \
  "$WORK_DIR/filtered.osm.pbf" "$REGION_ID"
mv geocoding-data.sqlite "$WORK_DIR/geocoding-data.sqlite"

# ── 4. Extract bounding box from PBF metadata ───────────────────────────────
BBOX_JSON=$(osmium fileinfo -e -j "$WORK_DIR/input.osm.pbf" \
  | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const h=d.header?.boxes?.[0] ?? d.header?.option?.bounds;
    if(!h) { console.error('No bbox in PBF header'); process.exit(1); }
    // osmium returns [left,bottom,right,top] or object
    if(Array.isArray(h)) {
      console.log(JSON.stringify({west:h[0],south:h[1],east:h[2],north:h[3]}));
    } else {
      console.log(JSON.stringify({west:h.left,south:h.bottom,east:h.right,north:h.top}));
    }
")
WEST=$(echo "$BBOX_JSON" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).west")
SOUTH=$(echo "$BBOX_JSON" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).south")
EAST=$(echo "$BBOX_JSON" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).east")
NORTH=$(echo "$BBOX_JSON" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).north")

echo "==> Bounding box: W=$WEST S=$SOUTH E=$EAST N=$NORTH"

# ── 5. Extract Overture places via DuckDB ────────────────────────────────────
echo "==> Extracting Overture places with DuckDB …"
duckdb -c "
  INSTALL spatial; LOAD spatial;
  SET s3_region='us-west-2';
  COPY (
    SELECT id, names.primary AS name, categories.primary AS category,
           confidence, geometry
    FROM read_parquet(
      's3://overturemaps-us-west-2/release/2026-03-18.0/theme=places/type=place/*',
      hive_partitioning=1
    )
    WHERE bbox.xmin BETWEEN ${WEST} AND ${EAST}
      AND bbox.ymin BETWEEN ${SOUTH} AND ${NORTH}
  ) TO '${WORK_DIR}/overture-places.geojson'
  WITH (FORMAT GDAL, DRIVER 'GeoJSON');
"

# ── 6. Gzip outputs ─────────────────────────────────────────────────────────
echo "==> Compressing outputs …"
gzip -9 -k "$WORK_DIR/geocoding-data.sqlite"
gzip -9 -k "$WORK_DIR/overture-places.geojson"

GEOCODING_SIZE=$(stat -f%z "$WORK_DIR/geocoding-data.sqlite.gz" 2>/dev/null \
  || stat -c%s "$WORK_DIR/geocoding-data.sqlite.gz")
PLACES_SIZE=$(stat -f%z "$WORK_DIR/overture-places.geojson.gz" 2>/dev/null \
  || stat -c%s "$WORK_DIR/overture-places.geojson.gz")

# ── 7. Write manifest entry ─────────────────────────────────────────────────
cat > "$WORK_DIR/manifest-entry.json" <<EOF
{
  "id": "${REGION_ID}",
  "name": "${HUMAN_NAME}",
  "version": "${VERSION}",
  "bounds": { "minLat": ${SOUTH}, "maxLat": ${NORTH}, "minLng": ${WEST}, "maxLng": ${EAST} },
  "geocodingUrl": "https://cdn.example.com/regions/${REGION_ID}/geocoding-data.sqlite.gz",
  "geocodingSizeBytes": ${GEOCODING_SIZE},
  "placesUrl": "https://cdn.example.com/regions/${REGION_ID}/overture-places.geojson.gz",
  "placesSizeBytes": ${PLACES_SIZE}
}
EOF

# ── 8. Copy outputs to current directory ─────────────────────────────────────
cp "$WORK_DIR/geocoding-data.sqlite.gz" .
cp "$WORK_DIR/overture-places.geojson.gz" .
cp "$WORK_DIR/manifest-entry.json" .

echo ""
echo "=== BUILD COMPLETE ==="
echo "  geocoding-data.sqlite.gz  (${GEOCODING_SIZE} bytes)"
echo "  overture-places.geojson.gz  (${PLACES_SIZE} bytes)"
echo "  manifest-entry.json"
echo ""
echo "Upload instructions:"
echo "  1. Upload geocoding-data.sqlite.gz → https://cdn.example.com/regions/${REGION_ID}/geocoding-data.sqlite.gz"
echo "  2. Upload overture-places.geojson.gz → https://cdn.example.com/regions/${REGION_ID}/overture-places.geojson.gz"
echo "  3. Merge manifest-entry.json into the master regions-catalog.json:"
echo "     jq '.regions += [input]' regions-catalog.json manifest-entry.json > tmp.json && mv tmp.json regions-catalog.json"
echo "  4. Upload regions-catalog.json → https://cdn.example.com/regions/catalog.json"
