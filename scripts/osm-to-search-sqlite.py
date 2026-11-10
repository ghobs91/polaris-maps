#!/usr/bin/env python3
"""
osm-to-search-sqlite.py — build the on-device search indices for a region pack.

Produces two SQLite files that the app imports after a pack download, so a
covered area answers POI and transit queries with no network call:

  search.sqlite   — named OSM POIs          (schema: PACK_POI_SCHEMA_SQL)
  transit.sqlite  — stops, route relations
                    with resolved geometry,
                    stop<->route join       (schema: PACK_TRANSIT_SCHEMA_SQL)

Both schemas must stay compatible with the app-side constants:
  src/services/poi/localPoiIndex.ts         PACK_POI_SCHEMA_SQL
  src/services/transit/localTransitIndex.ts PACK_TRANSIT_SCHEMA_SQL

Usage:
  python3 scripts/osm-to-search-sqlite.py <clipped.osm.pbf> <region_id> <out_dir>

Requires: osmium (pip install osmium). No other dependencies.
"""

import json
import os
import sqlite3
import sys
import time

try:
    import osmium
except ImportError:  # pragma: no cover - CI installs it
    sys.stderr.write("error: osmium is required (pip install osmium)\n")
    sys.exit(1)

# Primary keys that make a node/way a POI, in priority order. Mirrors
# VIEWPORT_POI_KEYS in src/services/poi/osmFetcher.ts.
POI_KEYS = ("amenity", "shop", "tourism", "leisure", "office", "craft", "healthcare")

TRANSIT_ROUTE_MODES = ("subway", "light_rail", "train", "tram", "monorail")

STOP_ROLES = (
    "stop",
    "stop_entry_only",
    "stop_exit_only",
    "platform",
    "platform_entry_only",
    "platform_exit_only",
)

STOP_RAILWAY = ("station", "halt", "stop", "tram_stop")
STOP_PUBLIC_TRANSPORT = ("stop_position", "platform", "station")

MODE_MAP = {
    "subway": "SUBWAY",
    "light_rail": "TRAM",
    "tram": "TRAM",
    "train": "RAIL",
    "monorail": "RAIL",
}

POI_SCHEMA = """
CREATE TABLE IF NOT EXISTS osm_pois (
  osm_type TEXT NOT NULL,
  osm_id INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  primary_key TEXT NOT NULL,
  subtype TEXT NOT NULL,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (osm_type, osm_id)
);
CREATE INDEX IF NOT EXISTS idx_osm_pois_bounds ON osm_pois (lat, lng);
CREATE INDEX IF NOT EXISTS idx_osm_pois_primary ON osm_pois (primary_key, subtype);
"""

TRANSIT_SCHEMA = """
CREATE TABLE IF NOT EXISTS osm_transit_stops (
  osm_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  tags_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_osm_transit_stops_bounds ON osm_transit_stops (lat, lng);

CREATE TABLE IF NOT EXISTS osm_transit_routes (
  osm_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL,
  ref TEXT,
  name TEXT,
  colour TEXT,
  geometry_json TEXT NOT NULL,
  stop_ids_json TEXT NOT NULL DEFAULT '[]',
  south REAL NOT NULL,
  west REAL NOT NULL,
  north REAL NOT NULL,
  east REAL NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_osm_transit_routes_bounds
  ON osm_transit_routes (south, north, west, east);

CREATE TABLE IF NOT EXISTS osm_transit_route_stops (
  stop_osm_id INTEGER NOT NULL,
  route_osm_id INTEGER NOT NULL,
  PRIMARY KEY (stop_osm_id, route_osm_id)
);
CREATE INDEX IF NOT EXISTS idx_osm_transit_route_stops_stop
  ON osm_transit_route_stops (stop_osm_id);
"""

BATCH_SIZE = 5000


def primary_key(tags):
    for key in POI_KEYS:
        value = tags.get(key)
        if value:
            return key, value
    return None


def way_coords(way):
    """[(lat, lng), ...] for a way, or [] when locations were not resolved."""
    coords = []
    try:
        for node_ref in way.nodes:
            location = node_ref.location
            if location.valid():
                coords.append((location.lat, location.lon))
    except Exception:
        return []
    return coords


class Builder(osmium.SimpleHandler):
    def __init__(self, poi_db, transit_db, now):
        super().__init__()
        self.poi_db = poi_db
        self.transit_db = transit_db
        self.now = now

        self.poi_batch = []
        self.poi_count = 0
        self.stops = {}       # osm_id -> (name, lat, lng, tags_json)
        self.ways = {}        # way_id -> [(lat, lng), ...] (transit-relevant only)
        self.route_rows = []
        self.route_stop_rows = set()

    # ── nodes ─────────────────────────────────────────────────────────────
    def node(self, node):
        if not node.tags:
            return
        tags = {t.k: t.v for t in node.tags}
        lat, lng = node.location.lat, node.location.lon
        name = tags.get("name")

        if name:
            key = primary_key(tags)
            if key:
                self._add_poi("node", node.id, lat, lng, key[0], key[1], name, tags)

        if name and (
            tags.get("railway") in STOP_RAILWAY
            or tags.get("public_transport") in STOP_PUBLIC_TRANSPORT
        ):
            self.stops[node.id] = (name, lat, lng, json.dumps(tags, sort_keys=True))

    # ── ways ──────────────────────────────────────────────────────────────
    def way(self, way):
        if not way.tags:
            return
        tags = {t.k: t.v for t in way.tags}

        # Transit relations reference railway/tram ways: keep their geometry,
        # which is the expensive part of what Overpass assembled on demand.
        if tags.get("railway") or tags.get("route"):
            coords = way_coords(way)
            if coords:
                self.ways[way.id] = coords

        name = tags.get("name")
        if not name:
            return
        key = primary_key(tags)
        if not key:
            return
        coords = way_coords(way)
        if not coords:
            return
        lat = sum(c[0] for c in coords) / len(coords)
        lng = sum(c[1] for c in coords) / len(coords)
        self._add_poi("way", way.id, lat, lng, key[0], key[1], name, tags)

    # ── relations ─────────────────────────────────────────────────────────
    def relation(self, relation):
        tags = {t.k: t.v for t in relation.tags} if relation.tags else {}
        mode = tags.get("route")
        if tags.get("type") != "route" or mode not in TRANSIT_ROUTE_MODES:
            return

        stop_ids = []
        geometry = []
        for member in relation.members:
            if member.type == "n" and member.role in STOP_ROLES:
                stop_ids.append(member.ref)
            elif member.type == "w":
                for lat, lng in self.ways.get(member.ref, ()):
                    if not geometry or geometry[-1] != [lat, lng]:
                        geometry.append([lat, lng])

        if len(geometry) < 2:
            return

        lats = [p[0] for p in geometry]
        lngs = [p[1] for p in geometry]
        self.route_rows.append(
            (
                relation.id,
                MODE_MAP.get(mode, "RAIL"),
                tags.get("ref"),
                tags.get("name"),
                tags.get("colour") or tags.get("color"),
                json.dumps(geometry, separators=(",", ":")),
                json.dumps(stop_ids),
                min(lats),
                min(lngs),
                max(lats),
                max(lngs),
                self.now,
            )
        )
        for stop_id in stop_ids:
            self.route_stop_rows.add((stop_id, relation.id))

    # ── helpers ───────────────────────────────────────────────────────────
    def _add_poi(self, osm_type, osm_id, lat, lng, key, subtype, name, tags):
        self.poi_batch.append(
            (
                osm_type,
                osm_id,
                lat,
                lng,
                key,
                subtype,
                name,
                name.lower(),
                json.dumps(tags, sort_keys=True),
                self.now,
            )
        )
        self.poi_count += 1
        if len(self.poi_batch) >= BATCH_SIZE:
            self.flush_pois()

    def flush_pois(self):
        if not self.poi_batch:
            return
        self.poi_db.executemany(
            """INSERT OR REPLACE INTO osm_pois
                 (osm_type, osm_id, lat, lng, primary_key, subtype, name,
                  name_norm, tags_json, version, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)""",
            self.poi_batch,
        )
        self.poi_db.commit()
        self.poi_batch = []


def main():
    if len(sys.argv) != 4:
        sys.stderr.write(
            "Usage: osm-to-search-sqlite.py <clipped.osm.pbf> <region_id> <out_dir>\n"
        )
        return 1
    pbf_path, region_id, out_dir = sys.argv[1:4]
    os.makedirs(out_dir, exist_ok=True)
    now = int(time.time())

    poi_path = os.path.join(out_dir, "search.sqlite")
    transit_path = os.path.join(out_dir, "transit.sqlite")
    for path in (poi_path, transit_path):
        if os.path.exists(path):
            os.remove(path)

    poi_db = sqlite3.connect(poi_path)
    poi_db.executescript(POI_SCHEMA)
    transit_db = sqlite3.connect(transit_path)
    transit_db.executescript(TRANSIT_SCHEMA)

    builder = Builder(poi_db, transit_db, now)
    # locations=True resolves node coordinates on ways, which is what turns
    # ways into centroid POIs and route members into real geometry.
    builder.apply_file(pbf_path, locations=True)
    builder.flush_pois()

    transit_db.executemany(
        """INSERT OR REPLACE INTO osm_transit_routes
             (osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
              south, west, north, east, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        builder.route_rows,
    )
    transit_db.executemany(
        """INSERT OR REPLACE INTO osm_transit_stops
             (osm_id, name, lat, lng, tags_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [
            (osm_id, name, lat, lng, tags_json, now)
            for osm_id, (name, lat, lng, tags_json) in builder.stops.items()
        ],
    )
    transit_db.executemany(
        "INSERT OR IGNORE INTO osm_transit_route_stops (stop_osm_id, route_osm_id) "
        "VALUES (?, ?)",
        sorted(builder.route_stop_rows),
    )
    transit_db.commit()

    for db, table in ((poi_db, "osm_pois"), (transit_db, "osm_transit_routes")):
        db.execute(f"ANALYZE {table}")
        db.commit()
        db.execute("VACUUM")
        db.close()

    print(
        f"[{region_id}] search.sqlite: {builder.poi_count} POIs; "
        f"transit.sqlite: {len(builder.stops)} stops, {len(builder.route_rows)} routes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
