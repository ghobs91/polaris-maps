#!/usr/bin/env bash
#
# generate-region-data.sh
#
# Generates PMTiles, Valhalla routing tiles, and a geocoding SQLite database
# from OpenStreetMap data for a given region.
#
# Prerequisites (install these first):
#   brew install valhalla osmium-tool       # macOS
#   pip install tilemaker                    # or install from https://github.com/systemed/tilemaker
#   # OR for PMTiles: download planetiler from https://github.com/onthegomap/planetiler
#
# Usage:
#   ./scripts/generate-region-data.sh <region-id> <geofabrik-extract-url> [output-dir]
#
# Example (New York Metro):
#   ./scripts/generate-region-data.sh us-ny-new-york \
#     https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf \
#     ./region-data
#
# The output directory will contain:
#   <output-dir>/<region-id>/tiles.pmtiles
#   <output-dir>/<region-id>/routing.tar
#   <output-dir>/<region-id>/geocoding.db
#
# To serve the data locally for the app:
#   cd <output-dir> && python3 -m http.server 9000
#   Then set DATA_BASE_URL in src/constants/config.ts to http://<your-ip>:9000

set -euo pipefail

REGION_ID="${1:?Usage: $0 <region-id> <geofabrik-url> [output-dir]}"
GEOFABRIK_URL="${2:?Usage: $0 <region-id> <geofabrik-url> [output-dir]}"
OUTPUT_DIR="${3:-./region-data}"

WORK_DIR="${OUTPUT_DIR}/.work/${REGION_ID}"
DEST_DIR="${OUTPUT_DIR}/${REGION_ID}"
PBF_FILE="${WORK_DIR}/extract.osm.pbf"

echo "=== Polaris Maps: Region Data Generator ==="
echo "Region:  ${REGION_ID}"
echo "Source:  ${GEOFABRIK_URL}"
echo "Output:  ${DEST_DIR}"
echo ""

mkdir -p "${WORK_DIR}" "${DEST_DIR}"

# ---------------------------------------------------------------------------
# Step 1: Download OSM extract from Geofabrik
# ---------------------------------------------------------------------------
if [ -f "${PBF_FILE}" ]; then
  echo "[1/5] OSM extract already downloaded, skipping."
else
  echo "[1/5] Downloading OSM extract from Geofabrik..."
  curl -L -o "${PBF_FILE}" "${GEOFABRIK_URL}"
  echo "      Downloaded $(du -h "${PBF_FILE}" | cut -f1)."
fi

# ---------------------------------------------------------------------------
# Step 2: Generate PMTiles (vector tiles)
# ---------------------------------------------------------------------------
PMTILES_FILE="${DEST_DIR}/tiles.pmtiles"
if [ -f "${PMTILES_FILE}" ]; then
  echo "[2/5] PMTiles already exists, skipping."
else
  echo "[2/5] Generating PMTiles..."
  if command -v planetiler &> /dev/null; then
    planetiler --osm-path="${PBF_FILE}" --output="${PMTILES_FILE}" --force
  elif command -v tilemaker &> /dev/null; then
    # tilemaker outputs mbtiles by default; convert if pmtiles-convert is available
    MBTILES_FILE="${WORK_DIR}/tiles.mbtiles"
    tilemaker --input "${PBF_FILE}" --output "${MBTILES_FILE}"
    if command -v pmtiles &> /dev/null; then
      pmtiles convert "${MBTILES_FILE}" "${PMTILES_FILE}"
      rm -f "${MBTILES_FILE}"
    else
      echo "      WARNING: pmtiles CLI not found. Saved as MBTiles instead."
      mv "${MBTILES_FILE}" "${PMTILES_FILE}"
    fi
  elif [ -f "planetiler.jar" ] || [ -f "scripts/planetiler.jar" ]; then
    JAR_PATH="planetiler.jar"
    [ -f "scripts/planetiler.jar" ] && JAR_PATH="scripts/planetiler.jar"
    java -jar "${JAR_PATH}" --osm-path="${PBF_FILE}" --output="${PMTILES_FILE}" --force
  else
    echo "      WARNING: No tile generator found (planetiler, tilemaker)."
    echo "      Install one of:"
    echo "        - Planetiler: https://github.com/onthegomap/planetiler/releases"
    echo "        - tilemaker:  brew install tilemaker"
    echo "      Skipping PMTiles generation."
  fi
  [ -f "${PMTILES_FILE}" ] && echo "      Generated $(du -h "${PMTILES_FILE}" | cut -f1) PMTiles."
fi

# ---------------------------------------------------------------------------
# Step 3: Generate Valhalla routing tiles
# ---------------------------------------------------------------------------
ROUTING_DIR="${WORK_DIR}/valhalla_tiles"
ROUTING_TAR="${DEST_DIR}/routing.tar"
if [ -f "${ROUTING_TAR}" ]; then
  echo "[3/5] Routing tiles already exist, skipping."
else
  echo "[3/5] Generating Valhalla routing tiles..."
  if command -v valhalla_build_tiles &> /dev/null; then
    mkdir -p "${ROUTING_DIR}"

    # Generate minimal Valhalla config
    VALHALLA_CONFIG="${WORK_DIR}/valhalla.json"
    cat > "${VALHALLA_CONFIG}" <<EOF
{
  "mjolnir": {
    "tile_dir": "${ROUTING_DIR}",
    "concurrency": $(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
  },
  "additional_data": {
    "elevation": ""
  }
}
EOF

    valhalla_build_tiles -c "${VALHALLA_CONFIG}" "${PBF_FILE}"

    # Package as tar (not gzipped — the app's extractor handles plain tar)
    echo "      Packaging routing tiles..."
    tar -cf "${ROUTING_TAR}" -C "${ROUTING_DIR}" .
    echo "      Generated $(du -h "${ROUTING_TAR}" | cut -f1) routing archive."
  else
    echo "      WARNING: valhalla_build_tiles not found."
    echo "      Install: brew install valhalla"
    echo "      Skipping Valhalla tile generation."
  fi
fi

# ---------------------------------------------------------------------------
# Step 4: Generate geocoding SQLite database
# ---------------------------------------------------------------------------
GEOCODING_DB="${DEST_DIR}/geocoding.db"
if [ -f "${GEOCODING_DB}" ]; then
  echo "[4/5] Geocoding DB already exists, skipping."
else
  echo "[4/5] Generating geocoding SQLite database..."
  if command -v python3 &> /dev/null; then
    python3 - "${PBF_FILE}" "${GEOCODING_DB}" <<'PYEOF'
"""
Build a geocoding SQLite FTS5 database from an OSM PBF extract.
Requires: pip install osmium
"""
import sys
import sqlite3

pbf_path = sys.argv[1]
db_path = sys.argv[2]

try:
    import osmium
except ImportError:
    print("      WARNING: python osmium not installed. Run: pip install osmium")
    print("      Skipping geocoding DB generation.")
    sys.exit(0)

db = sqlite3.connect(db_path)
db.execute("PRAGMA journal_mode=WAL")

db.executescript("""
    CREATE TABLE IF NOT EXISTS geocoding_data (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        housenumber TEXT,
        street TEXT,
        city TEXT,
        state TEXT,
        postcode TEXT,
        country TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS geocoding_entries USING fts5(
        text,
        type,
        housenumber,
        street,
        city,
        state,
        postcode,
        country,
        content='geocoding_data',
        content_rowid='id'
    );
""")

class AddressHandler(osmium.SimpleHandler):
    def __init__(self, database):
        super().__init__()
        self.db = database
        self.count = 0
        self.batch = []

    def flush(self):
        if not self.batch:
            return
        self.db.executemany(
            "INSERT INTO geocoding_data (type, housenumber, street, city, state, postcode, country, lat, lng) VALUES (?,?,?,?,?,?,?,?,?)",
            self.batch,
        )
        # Populate FTS index
        self.db.executemany(
            "INSERT INTO geocoding_entries (rowid, text, type, housenumber, street, city, state, postcode, country) SELECT id, COALESCE(housenumber,'') || ' ' || COALESCE(street,'') || ', ' || COALESCE(city,''), type, housenumber, street, city, state, postcode, country FROM geocoding_data WHERE id > ? - ? ORDER BY id DESC LIMIT ?",
            [(self.count, len(self.batch), len(self.batch))],
        )
        self.batch = []
        self.db.commit()

    def _extract(self, tags, lat, lng):
        street = tags.get("addr:street")
        housenumber = tags.get("addr:housenumber")
        city = tags.get("addr:city")
        name = tags.get("name")
        if not street and not name:
            return
        entry_type = "place" if name and not street else "address"
        self.batch.append((
            entry_type,
            housenumber,
            street or name,
            city or tags.get("addr:suburb"),
            tags.get("addr:state"),
            tags.get("addr:postcode"),
            tags.get("addr:country"),
            lat,
            lng,
        ))
        self.count += 1
        if len(self.batch) >= 5000:
            self.flush()

    def node(self, n):
        if n.tags.get("addr:street") or (n.tags.get("name") and n.tags.get("amenity")):
            self._extract(n.tags, n.location.lat, n.location.lon)

    def way(self, w):
        if w.tags.get("addr:street") or (w.tags.get("name") and w.tags.get("building")):
            try:
                # Use the centroid (first node as approximation)
                loc = w.nodes[0]
                self._extract(w.tags, loc.lat, loc.lon)
            except Exception:
                pass

handler = AddressHandler(db)
handler.apply_file(pbf_path, locations=True)
handler.flush()

# Build the FTS index optimize
db.execute("INSERT INTO geocoding_entries(geocoding_entries) VALUES('optimize')")
db.commit()
db.close()

print(f"      Indexed {handler.count} addresses/places.")
PYEOF
    [ -f "${GEOCODING_DB}" ] && echo "      Generated $(du -h "${GEOCODING_DB}" | cut -f1) geocoding DB."
  else
    echo "      WARNING: python3 not found. Skipping geocoding DB generation."
  fi
fi

# ---------------------------------------------------------------------------
# Step 5: Extract Overture Maps places for the region
# ---------------------------------------------------------------------------
OVERTURE_PLACES="${DEST_DIR}/overture-places.geojson"
OVERTURE_RELEASE="2026-02-18.0"
if [ -f "${OVERTURE_PLACES}" ]; then
  echo "[5/5] Overture places already extracted, skipping."
else
  echo "[5/5] Extracting Overture Maps places..."

  # Parse bbox from region bounds — expects BBOX env var or command-line arg
  # Format: "west,south,east,north" — passed as $BBOX or derived from regions.json
  BBOX="${BBOX:-$(echo "${4:-}" | tr -d ' ')}"

  if [ -z "${BBOX}" ] && command -v jq &> /dev/null; then
    # Try to extract bbox from regions.json for this region id
    REGIONS_FILE="$(dirname "$0")/regions.json"
    if [ -f "${REGIONS_FILE}" ]; then
      BBOX=$(jq -r --arg id "${REGION_ID}" \
        '.include[] | select(.id == $id) | .bbox // empty' \
        "${REGIONS_FILE}")
    fi
  fi

  if [ -z "${BBOX}" ]; then
    echo "      WARNING: No BBOX available for Overture extraction."
    echo "      Pass BBOX='west,south,east,north' or ensure regions.json is available."
    echo "      Skipping Overture places."
  elif command -v duckdb &> /dev/null; then
    # Use DuckDB to query Overture's S3-hosted GeoParquet
    echo "      Using DuckDB to query Overture S3 (release ${OVERTURE_RELEASE})..."
    IFS=',' read -r BBOX_WEST BBOX_SOUTH BBOX_EAST BBOX_NORTH <<< "${BBOX}"

    duckdb -c "
      LOAD spatial;
      SET s3_region='us-west-2';

      COPY (
        SELECT
          json_object(
            'type', 'Feature',
            'id', id,
            'geometry', json_object(
              'type', 'Point',
              'coordinates', json_array(
                ST_X(geometry),
                ST_Y(geometry)
              )
            ),
            'properties', json_object(
              'id', id,
              'names', CASE WHEN names IS NOT NULL
                THEN json_object('primary', names.primary)
                ELSE NULL END,
              'categories', CASE WHEN categories IS NOT NULL
                THEN json_object(
                  'primary', categories.primary,
                  'alternate', categories.alternate
                )
                ELSE NULL END,
              'basic_category', basic_category,
              'confidence', ROUND(confidence, 4),
              'websites', websites,
              'phones', phones,
              'addresses', CASE WHEN addresses IS NOT NULL AND len(addresses) > 0
                THEN json_array(json_object(
                  'freeform', addresses[1].freeform,
                  'locality', addresses[1].locality,
                  'postcode', addresses[1].postcode,
                  'region', addresses[1].region,
                  'country', addresses[1].country
                ))
                ELSE NULL END,
              'operating_status', operating_status,
              'brand', CASE WHEN brand IS NOT NULL AND brand.names IS NOT NULL
                THEN json_object('names', json_object('primary', brand.names.primary))
                ELSE NULL END
            )
          ) as feature
        FROM read_parquet('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/*/*')
        WHERE
          bbox.xmin BETWEEN ${BBOX_WEST} AND ${BBOX_EAST}
          AND bbox.ymin BETWEEN ${BBOX_SOUTH} AND ${BBOX_NORTH}
          AND confidence > 0.5
      ) TO '${OVERTURE_PLACES}' (FORMAT JSON, ARRAY true);
    " 2>&1 && {
      # Wrap the JSON array into a proper GeoJSON FeatureCollection
      python3 -c "
import json, sys
with open('${OVERTURE_PLACES}', 'r') as f:
    features = json.load(f)
# Each row is a JSON object with a 'feature' key
if features and 'feature' in features[0]:
    features = [json.loads(r['feature']) if isinstance(r['feature'], str) else r['feature'] for r in features]
fc = {'type': 'FeatureCollection', 'features': features}
with open('${OVERTURE_PLACES}', 'w') as f:
    json.dump(fc, f)
print(f'      Extracted {len(features)} Overture places.')
" 2>&1
    } || {
      echo "      DuckDB query failed. Skipping Overture places."
      rm -f "${OVERTURE_PLACES}"
    }

  elif command -v overturemaps &> /dev/null; then
    # Fallback: use the official Overture Python CLI
    echo "      Using overturemaps CLI..."
    overturemaps download \
      --bbox="${BBOX}" \
      -f geojson \
      --type=place \
      -o "${OVERTURE_PLACES}" 2>&1
    PLACE_COUNT=$(python3 -c "
import json
with open('${OVERTURE_PLACES}') as f:
    data = json.load(f)
print(len(data.get('features', [])))
" 2>/dev/null || echo "?")
    echo "      Extracted ${PLACE_COUNT} Overture places."
  else
    echo "      WARNING: Neither duckdb nor overturemaps CLI is installed."
    echo "      Install one of:"
    echo "        - DuckDB:         brew install duckdb"
    echo "        - Overture CLI:   pip install overturemaps"
    echo "      Skipping Overture places extraction."
  fi

  [ -f "${OVERTURE_PLACES}" ] && echo "      Generated $(du -h "${OVERTURE_PLACES}" | cut -f1) Overture places file."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Generation complete ==="
echo "Output directory: ${DEST_DIR}"
ls -lh "${DEST_DIR}/" 2>/dev/null || true
echo ""
echo "To serve this data to the Polaris Maps app:"
echo "  cd ${OUTPUT_DIR} && python3 -m http.server 9000"
echo ""
echo "Then update DATA_BASE_URL in src/constants/config.ts:"
echo "  export const DATA_BASE_URL = 'http://<YOUR_LOCAL_IP>:9000';"
echo ""
echo "To generate data for all catalog regions, run:"
echo "  ./scripts/generate-all-regions.sh"
