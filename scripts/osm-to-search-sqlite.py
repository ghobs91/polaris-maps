#!/usr/bin/env python3
"""
osm-to-search-sqlite.py — build the on-device search indices for a region pack.

Produces two SQLite files that the app imports after a pack download, so a
covered area answers POI and transit queries with no network call:

  search.sqlite   — OSM POIs + the query shapes they cover
                    (schema: PACK_POI_SCHEMA_SQL)
  transit.sqlite  — stops, route relations
                    with resolved geometry,
                    stop<->route join       (schema: PACK_TRANSIT_SCHEMA_SQL)

Both schemas must stay compatible with the app-side constants:
  src/services/poi/localPoiIndex.ts         PACK_POI_SCHEMA_SQL
  src/services/transit/localTransitIndex.ts PACK_TRANSIT_SCHEMA_SQL

Two engines, deliberately:
  * POIs are extracted by DuckDB (`ST_ReadOSM`) — one SQL pass, ~15x faster
    than the Python walk it replaced, and the same engine the Overture step
    already uses.
  * Transit needs ordered route-relation members and assembled way geometry,
    which is a sequential walk: osmium.

`poi_index_shapes` is what lets the app treat a local answer as final. Without
it the app can only ask "is this box covered by a pack?", so a sparse area (a
category with no matches) looks indistinguishable from missing data and still
costs a third-party request. With it the app knows *which* tag pairs the pack
indexed and whether unnamed features are included, so "no matches here" is an
honest answer.

Usage:
  python3 scripts/osm-to-search-sqlite.py <clipped.osm.pbf> <region_id> <out_dir>

Requires: osmium (pip install osmium) and the duckdb CLI on PATH.
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

try:
    import osmium
except ImportError:  # pragma: no cover - CI installs it
    sys.stderr.write("error: osmium is required (pip install osmium)\n")
    sys.exit(1)

# Which features become POIs. Single source of truth, shared with the app-side
# drift test (__tests__/unit/poiIndexShapes.test.ts).
SHAPES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "poi-index-shapes.json")

# Which tags each POI keeps. Asserted against what the app reads by
# __tests__/unit/poiTagAllowlist.test.ts.
TAGS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "poi-tags.json")

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

-- What this index can answer. `value` is '*' for "any value of this key";
-- `named_only` is 0 when unnamed features are indexed too, so the app can tell
-- "no matches here" apart from "this pack never indexed that tag".
CREATE TABLE IF NOT EXISTS poi_index_shapes (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  named_only INTEGER NOT NULL,
  poi_count INTEGER NOT NULL,
  PRIMARY KEY (key, value)
);
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
    """Transit-only walk. POIs are extracted by DuckDB (see build_poi_index)."""

    def __init__(self, transit_db, now):
        super().__init__()
        self.transit_db = transit_db
        self.now = now

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


def _sql_literal(value):
    """Quote a Python string as a DuckDB/SQL string literal."""
    return "'" + str(value).replace("'", "''") + "'"


def _load_shapes():
    with open(SHAPES_PATH, "r", encoding="utf-8") as handle:
        shapes = json.load(handle)
    return shapes["anyValueKeys"], shapes["namedOptionalPairs"]


def _load_tags():
    with open(TAGS_PATH, "r", encoding="utf-8") as handle:
        tags = json.load(handle)
    return tags["exact"], tags["prefixes"]


def build_poi_index(pbf_path, poi_path, now):
    """Fill search.sqlite with POIs and the query shapes they cover.

    Schema and indexes are created here (plain SQLite, so the drift test can
    parse this file's DDL); DuckDB only inserts rows. That split keeps one
    owner for the pack DDL and lets the extractor be a single SQL pass.

    Rule, per feature: it is a POI if it carries one of `anyValueKeys`, or a
    `namedOptionalPairs` pair; and it is indexed if it has a name, or its
    (key, value) is one of those pairs — an unnamed parking lot or peak is
    still a useful search result, an unnamed bench is not.
    """
    if shutil.which("duckdb") is None:
        sys.stderr.write(
            "error: the duckdb CLI is required to build the POI index "
            "(https://duckdb.org/docs/installation/)\n"
        )
        return None

    any_keys, named_optional = _load_shapes()
    exact_tags, tag_prefixes = _load_tags()

    db = sqlite3.connect(poi_path)
    try:
        db.executescript(POI_SCHEMA)
        db.commit()
    finally:
        db.close()

    key_values = ", ".join(
        f"({_sql_literal(key)}, {prio})" for prio, key in enumerate(any_keys, start=1)
    )
    pair_values = ", ".join(
        f"({_sql_literal(key)}, {_sql_literal(value)})" for key, value in named_optional
    )

    # "Is this feature POI-shaped at all?" — pushed into the PBF scans so only
    # candidates are materialised. Without it DuckDB holds every node, way and
    # relation in memory: a 100 MB extract peaked at 4.9 GB, which is not a
    # safe CI footprint. Restricted to candidates the same extract peaks under
    # 600 MB.
    shape_clauses = [f"tags['{key}'] IS NOT NULL" for key in any_keys]
    shape_clauses += [
        f"tags[{_sql_literal(key)}] = {_sql_literal(value)}"
        for key, value in named_optional
        if key not in any_keys
    ]
    shape_predicate = "\n         OR ".join(shape_clauses)

    # Tags kept per row: an explicit key list plus whole namespaces, because
    # the app reads `payment:*`/`diet:*`/`addr:*` as families. Everything else
    # is render metadata the app never reads — 87% of the payload on a dense
    # metro — so it is dropped here rather than shipped and ignored.
    keep_clauses = [f"je.key = {_sql_literal(key)}" for key in exact_tags]
    keep_clauses += [f"starts_with(je.key, {_sql_literal(prefix)})" for prefix in tag_prefixes]
    keep_predicate = "\n         OR ".join(keep_clauses)

    sql = f"""
INSTALL spatial; LOAD spatial;
INSTALL sqlite; LOAD sqlite;

-- Way refs are aggregated in arbitrary order; preserving input order would
-- force DuckDB to buffer the whole aggregation.
SET preserve_insertion_order = false;

CREATE OR REPLACE TABLE any_keys(key VARCHAR, prio INT);
INSERT INTO any_keys VALUES {key_values};

CREATE OR REPLACE TABLE named_optional(k VARCHAR, v VARCHAR);
INSERT INTO named_optional VALUES {pair_values};

-- POI-shaped ways, kept for their tags and their node refs.
CREATE OR REPLACE TABLE poi_ways AS
  SELECT id, refs, tags
    FROM ST_ReadOSM({_sql_literal(pbf_path)})
   WHERE kind = 'way' AND tags IS NOT NULL AND cardinality(tags) > 0
     AND ({shape_predicate});

-- POI-shaped nodes carry their coordinates inline.
CREATE OR REPLACE TABLE poi_nodes AS
  SELECT id, lat, lon, tags
    FROM ST_ReadOSM({_sql_literal(pbf_path)})
   WHERE kind = 'node' AND tags IS NOT NULL AND cardinality(tags) > 0
     AND ({shape_predicate});

-- Only the nodes those ways reference: a third of Berlin's nodes, and the
-- difference between a join that fits and one that does not.
CREATE OR REPLACE TABLE way_nodes AS
  SELECT id, lat, lon
    FROM ST_ReadOSM({_sql_literal(pbf_path)})
   WHERE kind = 'node'
     AND id IN (SELECT DISTINCT unnest(refs) FROM poi_ways);

-- Way centroids, averaged over resolved members (what the osmium builder did).
CREATE OR REPLACE TABLE poi_way_centroids AS
  SELECT w.id, avg(n.lat) AS lat, avg(n.lon) AS lon, w.tags
    FROM poi_ways w
    JOIN unnest(w.refs) AS ref(node_id) ON true
    JOIN way_nodes n ON n.id = ref.node_id
   GROUP BY w.id, w.tags;

CREATE OR REPLACE TABLE candidates AS
  SELECT 'node' AS osm_type, id, lat, lon, tags FROM poi_nodes
  UNION ALL
  SELECT 'way' AS osm_type, id, lat, lon, tags FROM poi_way_centroids;

CREATE OR REPLACE TABLE keyed AS
  SELECT c.*, shape.key AS primary_key
    FROM candidates c
    JOIN LATERAL (
      SELECT key, 1 AS grp, prio AS ord FROM any_keys a WHERE c.tags[a.key] IS NOT NULL
      UNION ALL
      SELECT k AS key, 2 AS grp, 0 AS ord FROM named_optional no
       WHERE c.tags[no.k] = no.v AND no.k NOT IN (SELECT key FROM any_keys)
      ORDER BY grp, ord, key
      LIMIT 1
    ) shape ON true;

CREATE OR REPLACE TABLE final AS
  SELECT osm_type,
         id,
         lat,
         lon,
         primary_key,
         tags[primary_key] AS subtype,
         coalesce(tags['name'], '') AS name,
         tags
    FROM keyed
   WHERE tags['name'] IS NOT NULL
      OR EXISTS (
           SELECT 1 FROM named_optional no
            WHERE no.k = primary_key AND no.v = tags[primary_key]
         );

-- Tags kept per row: an explicit key list plus whole namespaces, because the
-- app reads `payment:*`/`diet:*`/`addr:*` as families. Everything else is
-- render metadata the app never reads — 87% of the payload on a dense metro —
-- so it is dropped here rather than shipped and ignored.
CREATE OR REPLACE TABLE trimmed AS
  SELECT f.osm_type, f.id, f.lat, f.lon, f.primary_key, f.subtype, f.name,
         to_json(map_from_entries(list(je))) AS tags_json
    FROM final f, unnest(map_entries(f.tags)) AS je
   WHERE ({keep_predicate})
   GROUP BY f.osm_type, f.id, f.lat, f.lon, f.primary_key, f.subtype, f.name;

-- Every indexed feature carries its primary key, which is always in the
-- allowlist, so the trim can never drop a row. If it ever does, fail here
-- rather than silently shrink the pack.
SELECT CASE WHEN (SELECT count(*) FROM trimmed) = (SELECT count(*) FROM final)
            THEN 1 ELSE error('tag trim dropped rows') END AS trim_check;

ATTACH {_sql_literal(poi_path)} AS pack (TYPE SQLITE);

INSERT INTO pack.osm_pois
  (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm,
   tags_json, version, updated_at)
SELECT osm_type, id, lat, lon, primary_key, subtype, name, lower(name),
       tags_json, 1, {now}
  FROM trimmed;

-- Wildcard rows: "any value of this key", named features only.
INSERT INTO pack.poi_index_shapes (key, value, named_only, poi_count)
SELECT a.key, '*', 1, (SELECT count(*) FROM final f
                        WHERE f.primary_key = a.key AND f.name <> '')
  FROM any_keys a;

-- Pair rows: named or unnamed, for the values the app can ask for.
INSERT INTO pack.poi_index_shapes (key, value, named_only, poi_count)
SELECT no.k, no.v, 0, (SELECT count(*) FROM final f
                        WHERE f.primary_key = no.k AND f.subtype = no.v)
  FROM named_optional no;

DETACH pack;
"""

    # SQL on stdin: the CLI runs in batch mode whenever stdin is not a TTY, so
    # this works across DuckDB versions without depending on a flag spelling.
    result = subprocess.run(
        ["duckdb"],
        input=sql,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        sys.stderr.write("error: duckdb POI extraction failed\n")
        sys.stderr.write(result.stderr[-4000:])
        return None

    db = sqlite3.connect(poi_path)
    try:
        total = db.execute("SELECT count(*) FROM osm_pois").fetchone()[0]
        named = db.execute("SELECT count(*) FROM osm_pois WHERE name <> ''").fetchone()[0]
        shapes = db.execute("SELECT count(*) FROM poi_index_shapes").fetchone()[0]
        db.execute("ANALYZE osm_pois")
        db.commit()
        db.execute("VACUUM")
    finally:
        db.close()

    return {"pois": total, "named": named, "unnamed": total - named, "shapes": shapes}


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

    poi_stats = build_poi_index(pbf_path, poi_path, now)
    if poi_stats is None:
        return 1

    transit_db = sqlite3.connect(transit_path)
    transit_db.executescript(TRANSIT_SCHEMA)

    builder = Builder(transit_db, now)
    # locations=True resolves node coordinates on ways, which is what turns
    # route members into real geometry.
    builder.apply_file(pbf_path, locations=True)

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

    transit_db.execute("ANALYZE osm_transit_routes")
    transit_db.commit()
    transit_db.execute("VACUUM")
    transit_db.close()

    print(
        f"[{region_id}] search.sqlite: {poi_stats['pois']} POIs "
        f"({poi_stats['named']} named, {poi_stats['unnamed']} unnamed) "
        f"across {poi_stats['shapes']} indexed shapes; "
        f"transit.sqlite: {len(builder.stops)} stops, {len(builder.route_rows)} routes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
