#!/usr/bin/env python3
"""Build a pack's geocoding database from a clipped OSM extract.

Writes the schema the app imports (`src/services/database/init.ts`) plus the
`region_id` column the region cascade delete needs, then fills it from the PBF:

  - nodes carrying `addr:street` (an address) or a `name` + `amenity` (a place);
  - ways carrying `addr:street` or `name` + `building`, at their first node;
  - `addr:interpolation` ranges expanded into intermediate numbers, which the
    app labels and de-ranks. It also interpolates at query time for the gaps
    this misses (`src/services/search/addressInterpolation.ts`).

Usage:
  python3 scripts/osm-to-geocoding-sqlite.py <input.osm.pbf> <output.db> [region_id]

Requires `osmium` (pyosmium).

The DDL lives here, not inline in the workflow, so `packSchemaDrift.test.ts` can
execute it and catch drift. It was inline in `build-region-data.yml`, which is
exactly why it could omit the `text` column the importer selects — every CI-built
pack then failed to import on device, silently, because pack import is
best-effort by design. The table now carries `text` and the FTS index is
populated from it, so the packed schema and the app schema agree.
"""

import sys

try:
    import osmium
except ImportError:  # pragma: no cover - CI installs osmium
    sys.stderr.write("pyosmium is required: pip install osmium\n")
    raise

# Kept in sync with `geocoding_data` in src/services/database/init.ts; the
# drift test executes both and compares. `text` is what the importer reads to
# rebuild ITS index, so a pack without it cannot be imported at all.
PACK_GEOCODING_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS geocoding_data (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    type TEXT NOT NULL,
    housenumber TEXT,
    street TEXT,
    city TEXT,
    state TEXT,
    postcode TEXT,
    country TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    region_id TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS geocoding_entries USING fts5(
    text, type, housenumber, street, city, state, postcode, country,
    content='geocoding_data', content_rowid='id'
);
"""

# `addr:interpolation` mode -> step between house numbers.
INTERP_STEP = {"all": 1, "odd": 2, "even": 2}


def interpolate_range(start_number, end_number, step, limit=200):
    """Numbers strictly between the endpoints, preserving the way's direction.

    Mirrors `interpolateRange` in src/services/search/addressInterpolation.ts.
    """
    lo, hi = sorted((start_number, end_number))
    out, n = [], lo + step
    while n < hi and len(out) < limit:
        out.append(n)
        n += step
    return out if start_number <= end_number else list(reversed(out))


def compose_text(housenumber, street, city):
    """The searchable line for one row ("12 High St, Springfield")."""
    parts = []
    if housenumber:
        parts.append(str(housenumber))
    if street:
        parts.append(str(street))
    head = " ".join(parts)
    if city:
        return f"{head}, {city}" if head else str(city)
    return head


class Handler(osmium.SimpleHandler):
    def __init__(self, db, region_id):
        super().__init__()
        self.db = db
        self.region_id = region_id
        self.count = 0
        self.batch = []
        self.flushed = 0
        # Address node id -> housenumber, so an `addr:interpolation` way can
        # resolve the numbers at its two endpoints.
        self.addr_numbers = {}

    def flush(self):
        if not self.batch:
            return
        self.db.executemany(
            "INSERT INTO geocoding_data "
            "(text,type,housenumber,street,city,state,postcode,country,lat,lng,region_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            self.batch,
        )
        # Only the rows just written: ids are ascending, so the slice below
        # cannot reach a row that was already indexed.
        self.db.executemany(
            "INSERT INTO geocoding_entries(rowid,text,type,housenumber,street,city,state,postcode,country) "
            "SELECT id,text,type,housenumber,street,city,state,postcode,country "
            "FROM geocoding_data ORDER BY id DESC LIMIT ?",
            [(len(self.batch),)],
        )
        self.flushed += len(self.batch)
        self.batch = []
        self.db.commit()

    def _add(self, tags, lat, lng, kind=None):
        street = tags.get("addr:street")
        name = tags.get("name")
        if not street and not name:
            return
        housenumber = tags.get("addr:housenumber")
        city = tags.get("addr:city") or tags.get("addr:suburb")
        self.batch.append(
            (
                compose_text(housenumber, street or name, city),
                kind or ("address" if street else "place"),
                housenumber,
                street or name,
                city,
                tags.get("addr:state"),
                tags.get("addr:postcode"),
                tags.get("addr:country"),
                lat,
                lng,
                self.region_id,
            )
        )
        self.count += 1
        if len(self.batch) >= 5000:
            self.flush()

    def node(self, n):
        tags = n.tags
        if tags.get("addr:housenumber"):
            self.addr_numbers[n.id] = tags["addr:housenumber"]
        if tags.get("addr:street") or (tags.get("name") and tags.get("amenity")):
            self._add(tags, n.location.lat, n.location.lon)

    def way(self, w):
        tags = w.tags
        interp = (tags.get("addr:interpolation") or "").lower()
        if interp in INTERP_STEP and len(w.nodes) >= 2:
            self._interpolate(w, INTERP_STEP[interp])
        if tags.get("addr:street") or (tags.get("name") and tags.get("building")):
            try:
                self._add(tags, w.nodes[0].lat, w.nodes[0].lon)
            except Exception:
                # A way with no located nodes is not an address worth failing over.
                pass

    def _interpolate(self, w, step):
        try:
            first, last = w.nodes[0], w.nodes[-1]
            start = self.addr_numbers.get(first.ref)
            end = self.addr_numbers.get(last.ref)
            if not start or not end:
                return
            start_number, end_number = int(start), int(end)
        except (AttributeError, TypeError, ValueError):
            return
        span = end_number - start_number
        if span == 0:
            return
        tags = w.tags
        city = tags.get("addr:city") or tags.get("addr:suburb")
        street = tags.get("addr:street")
        for number in interpolate_range(start_number, end_number, step):
            t = (number - start_number) / span
            self.batch.append(
                (
                    compose_text(number, street, city),
                    "address_interpolated",
                    str(number),
                    street,
                    city,
                    tags.get("addr:state"),
                    tags.get("addr:postcode"),
                    tags.get("addr:country"),
                    first.lat + (last.lat - first.lat) * t,
                    first.lon + (last.lon - first.lon) * t,
                    self.region_id,
                )
            )
            self.count += 1
            if len(self.batch) >= 5000:
                self.flush()


def build(pbf_path, db_path, region_id=None):
    import sqlite3

    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(PACK_GEOCODING_SCHEMA_SQL)

    handler = Handler(db, region_id)
    handler.apply_file(pbf_path, locations=True)
    handler.flush()
    db.execute("INSERT INTO geocoding_entries(geocoding_entries) VALUES('optimize')")
    db.commit()
    db.close()
    return handler.count


def main():
    if len(sys.argv) < 3:
        sys.stderr.write(
            "Usage: osm-to-geocoding-sqlite.py <input.osm.pbf> <output.db> [region_id]\n"
        )
        return 2
    pbf_path, db_path = sys.argv[1], sys.argv[2]
    region_id = sys.argv[3] if len(sys.argv) > 3 else None
    count = build(pbf_path, db_path, region_id)
    print(f"Indexed {count} entries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
