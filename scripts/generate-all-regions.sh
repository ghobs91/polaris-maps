#!/usr/bin/env bash
#
# generate-all-regions.sh
#
# Generates map data for all regions in the Polaris Maps catalog.
# Uses Geofabrik OSM extracts as the data source.
#
# Usage:
#   ./scripts/generate-all-regions.sh [output-dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-./region-data}"

# Geofabrik extract URLs for each catalog region.
# These are the smallest extracts that fully cover each region's bounds.
declare -A REGIONS=(
  ["us-ca-los-angeles"]="https://download.geofabrik.de/north-america/us/california-latest.osm.pbf"
  ["us-ca-san-francisco"]="https://download.geofabrik.de/north-america/us/california-latest.osm.pbf"
  ["us-ny-new-york"]="https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf"
  ["us-il-chicago"]="https://download.geofabrik.de/north-america/us/illinois-latest.osm.pbf"
  ["us-tx-houston"]="https://download.geofabrik.de/north-america/us/texas-latest.osm.pbf"
  ["us-wa-seattle"]="https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf"
  ["gb-england-london"]="https://download.geofabrik.de/europe/great-britain/england-latest.osm.pbf"
  ["de-berlin"]="https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf"
)

echo "=== Polaris Maps: Generate All Regions ==="
echo "Output: ${OUTPUT_DIR}"
echo "Regions: ${#REGIONS[@]}"
echo ""

for region_id in "${!REGIONS[@]}"; do
  url="${REGIONS[$region_id]}"
  echo "--- Processing ${region_id} ---"
  "${SCRIPT_DIR}/generate-region-data.sh" "${region_id}" "${url}" "${OUTPUT_DIR}"
  echo ""
done

echo "=== All regions generated ==="
echo ""
echo "Serve the data:"
echo "  cd ${OUTPUT_DIR} && python3 -m http.server 9000"
