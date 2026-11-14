#!/usr/bin/env python3
"""
build-transit-timetable.py — build the on-device transit timetable for a region pack.

Produces `transit-timetable.sqlite`, the schedule side of a GTFS feed that
`transit.sqlite` deliberately omits. `transit.sqlite` answers "which lines stop
here" from OSM geometry; this answers "can I get from A to B, and when".

The schema must stay compatible with the app-side constant:

  src/services/transit/transitTimetable.ts  TRANSIT_TIMETABLE_SCHEMA_SQL

Bump `schema_version` in BOTH places when the shape changes; the app ignores a
file whose version it does not know rather than misreading it.

Design notes
------------
* **Compact connections.** One row per (departure, arrival) hop rather than one
  per stop_time. A GTFS stop_times row with N stops per trip becomes N-1
  connections, which is what the connection scan actually reads.
* **Times are service-day seconds.** GTFS allows times past 24:00 for overnight
  service; those are preserved (dep_s can exceed 86400) because dropping them
  silently deletes late-night trips.
* **Frequencies are expanded.** Feeds that model service as headways
  (`frequencies.txt`) are expanded into explicit connections at build time, so
  the on-device planner never needs headway logic.
* **Weekday mask is Monday-based.** Bit 0 = Monday, matching
  `dayBit()` in the app. GTFS `calendar.txt` uses the same convention.

Usage:
  python3 scripts/build-transit-timetable.py <gtfs.zip> <out_dir> [--region-id ID]

Requires: none beyond the standard library.
"""

import argparse
import csv
import io
import os
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone

SCHEMA_VERSION = 1

SCHEMA_SQL = """
  CREATE TABLE IF NOT EXISTS timetable_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stops (
    id INTEGER PRIMARY KEY,
    stop_id TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    parent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tt_stops_bounds ON stops (lat, lon);

  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY,
    short_name TEXT,
    long_name TEXT,
    color TEXT,
    mode TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY,
    days_mask INTEGER NOT NULL,
    start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_exceptions (
    service_id INTEGER NOT NULL,
    date INTEGER NOT NULL,
    exception_type INTEGER NOT NULL,
    PRIMARY KEY (service_id, date)
  );

  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL,
    route_id INTEGER NOT NULL,
    headsign TEXT
  );

  CREATE TABLE IF NOT EXISTS connections (
    dep_s INTEGER NOT NULL,
    arr_s INTEGER NOT NULL,
    from_stop INTEGER NOT NULL,
    to_stop INTEGER NOT NULL,
    trip_id INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tt_connections_dep ON connections (dep_s);
  CREATE INDEX IF NOT EXISTS idx_tt_connections_trip ON connections (trip_id, seq);

  CREATE TABLE IF NOT EXISTS transfers (
    from_stop INTEGER NOT NULL,
    to_stop INTEGER NOT NULL,
    min_transfer_s INTEGER NOT NULL,
    PRIMARY KEY (from_stop, to_stop)
  );
"""

# GTFS route_type → the app's TransitMode. Mirrors DEFAULT_GTFS_MODE_MAP in
# src/services/transit/gtfsParser.ts.
ROUTE_TYPE_TO_MODE = {
    0: "TRAM",
    1: "SUBWAY",
    2: "RAIL",
    3: "BUS",
    4: "FERRY",
    5: "CABLE_CAR",
    6: "GONDOLA",
    7: "FUNICULAR",
    11: "BUS",
    12: "RAIL",
}

WEEKDAY_BITS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def log(message):
    sys.stderr.write(f"{message}\n")


def parse_gtfs_time(value):
    """`HH:MM:SS` (or `H:MM:SS`) → seconds after service-day midnight.

    Returns None for blank/malformed values so a single bad row cannot abort the
    build. GTFS permits hours > 23 for overnight service.
    """
    if not value:
        return None
    parts = value.strip().split(":")
    if len(parts) != 3:
        return None
    try:
        hours, minutes, seconds = (int(p) for p in parts)
    except ValueError:
        return None
    return hours * 3600 + minutes * 60 + seconds


def parse_gtfs_date(value):
    """`YYYYMMDD` → int, or 0 when absent."""
    if not value:
        return 0
    digits = value.strip()
    return int(digits) if digits.isdigit() else 0


def feed_prefix(archive):
    """Top-level directory inside the zip, when the feed is wrapped in one.

    GTFS zips are usually flat, but plenty of published feeds wrap every file in
    a single folder. Detect that rather than failing with "no stop_times.txt".
    """
    names = archive.namelist()
    if "stops.txt" in names or "stop_times.txt" in names:
        return ""
    candidates = {n.split("/", 1)[0] for n in names if "/" in n}
    if len(candidates) == 1:
        return candidates.pop() + "/"
    return ""


def read_table(archive, name, prefix=""):
    """Yield dict rows for a CSV member, or nothing when the member is absent."""
    try:
        raw = archive.read(prefix + name)
    except KeyError:
        return
    # GTFS files are UTF-8 with an optional BOM.
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        yield row


def expand_frequencies(trips, frequencies):
    """Expand headway-based trips into explicit departures.

    Returns the trips that keep a single explicit schedule plus synthetic trips
    for each expanded departure, so the planner only ever sees real times.
    """
    if not frequencies:
        return trips, []

    by_trip = {}
    for row in frequencies:
        by_trip.setdefault(row.get("trip_id", ""), []).append(row)

    if not by_trip:
        return trips, []

    kept = []
    synthetic = []
    for trip in trips:
        windows = by_trip.get(trip["trip_id"])
        if not windows:
            kept.append(trip)
            continue
        for index, window in enumerate(windows):
            start = parse_gtfs_time(window.get("start_time"))
            end = parse_gtfs_time(window.get("end_time"))
            headway = int(window.get("headway_secs") or 0)
            if start is None or end is None or headway <= 0:
                kept.append(trip)
                break
            # The first window reuses the trip itself; the rest are clones so
            # connection rows stay distinguishable.
            clone = dict(trip)
            if index > 0:
                clone["trip_id"] = f"{trip['trip_id']}__freq{index}"
            clone["__freq_start"] = start
            clone["__freq_end"] = end
            clone["__freq_headway"] = headway
            if index == 0:
                kept.append(clone)
            else:
                synthetic.append(clone)
    return kept, synthetic


def build(gtfs_path, out_dir, region_id=None):
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "transit-timetable.sqlite")
    if os.path.exists(out_path):
        os.remove(out_path)

    with zipfile.ZipFile(gtfs_path) as archive:
        prefix = feed_prefix(archive)
        stops_rows = list(read_table(archive, "stops.txt", prefix))
        routes_rows = list(read_table(archive, "routes.txt", prefix))
        trips_rows = list(read_table(archive, "trips.txt", prefix))
        stop_times_rows = list(read_table(archive, "stop_times.txt", prefix))
        calendar_rows = list(read_table(archive, "calendar.txt", prefix))
        calendar_dates_rows = list(read_table(archive, "calendar_dates.txt", prefix))
        frequencies_rows = list(read_table(archive, "frequencies.txt", prefix))
        transfers_rows = list(read_table(archive, "transfers.txt", prefix))
        feed_info_rows = list(read_table(archive, "feed_info.txt", prefix))

    if not stop_times_rows:
        log("error: feed has no stop_times.txt — nothing to plan with")
        return None

    db = sqlite3.connect(out_path)
    db.executescript(SCHEMA_SQL)

    # ── Stops ───────────────────────────────────────────────────────────
    stop_index = {}
    for row in stops_rows:
        stop_id = row.get("stop_id", "")
        lat = row.get("stop_lat")
        lon = row.get("stop_lon")
        if not stop_id or not lat or not lon:
            continue
        try:
            lat_f, lon_f = float(lat), float(lon)
        except ValueError:
            continue
        stop_index[stop_id] = len(stop_index) + 1
        db.execute(
            "INSERT INTO stops (id, stop_id, name, lat, lon, parent) VALUES (?,?,?,?,?,?)",
            (
                stop_index[stop_id],
                stop_id,
                row.get("stop_name") or stop_id,
                lat_f,
                lon_f,
                row.get("parent_station") or None,
            ),
        )

    # ── Routes ──────────────────────────────────────────────────────────
    route_index = {}
    for row in routes_rows:
        route_id = row.get("route_id", "")
        if not route_id:
            continue
        try:
            route_type = int(row.get("route_type") or 3)
        except ValueError:
            route_type = 3
        route_index[route_id] = len(route_index) + 1
        db.execute(
            "INSERT INTO routes (id, short_name, long_name, color, mode) VALUES (?,?,?,?,?)",
            (
                route_index[route_id],
                row.get("route_short_name") or None,
                row.get("route_long_name") or None,
                row.get("route_color") or None,
                ROUTE_TYPE_TO_MODE.get(route_type, "BUS"),
            ),
        )

    # ── Services ────────────────────────────────────────────────────────
    service_index = {}
    for row in calendar_rows:
        service_id = row.get("service_id", "")
        if not service_id:
            continue
        mask = 0
        for bit, day in enumerate(WEEKDAY_BITS):
            if (row.get(day) or "").strip() == "1":
                mask |= 1 << bit
        service_index[service_id] = len(service_index) + 1
        db.execute(
            "INSERT INTO services (id, days_mask, start_date, end_date) VALUES (?,?,?,?)",
            (
                service_index[service_id],
                mask,
                parse_gtfs_date(row.get("start_date")),
                parse_gtfs_date(row.get("end_date")),
            ),
        )

    for row in calendar_dates_rows:
        service_id = row.get("service_id", "")
        if service_id not in service_index:
            continue
        try:
            exception_type = int(row.get("exception_type") or 0)
        except ValueError:
            continue
        db.execute(
            "INSERT OR REPLACE INTO service_exceptions (service_id, date, exception_type)"
            " VALUES (?,?,?)",
            (service_index[service_id], parse_gtfs_date(row.get("date")), exception_type),
        )

    # ── Trips ───────────────────────────────────────────────────────────
    trips, synthetic = expand_frequencies(trips_rows, frequencies_rows)
    trip_index = {}
    for row in trips + synthetic:
        trip_id = row.get("trip_id", "")
        route_id = row.get("route_id", "")
        service_id = row.get("service_id", "")
        if not trip_id or route_id not in route_index or service_id not in service_index:
            continue
        trip_index[trip_id] = len(trip_index) + 1
        db.execute(
            "INSERT INTO trips (id, service_id, route_id, headsign) VALUES (?,?,?,?)",
            (
                trip_index[trip_id],
                service_index[service_id],
                route_index[route_id],
                row.get("trip_headsign") or None,
            ),
        )

    # ── Connections ─────────────────────────────────────────────────────
    # Group stop_times by trip, then emit one connection per consecutive pair.
    by_trip = {}
    for row in stop_times_rows:
        trip_id = row.get("trip_id", "")
        if trip_id not in trip_index:
            continue
        by_trip.setdefault(trip_id, []).append(row)

    # Frequency clones inherit the base trip's stop_times.
    trip_times = dict(by_trip)
    for clone in synthetic:
        base_id = clone["trip_id"].split("__freq")[0]
        if base_id in by_trip:
            trip_times[clone["trip_id"]] = by_trip[base_id]

    freq_window = {t["trip_id"]: t for t in synthetic}

    connection_count = 0
    for trip_id, rows in trip_times.items():
        rows.sort(key=lambda r: int(r.get("stop_sequence") or 0))
        window = freq_window.get(trip_id)

        points = []
        for row in rows:
            stop_id = row.get("stop_id", "")
            if stop_id not in stop_index:
                continue
            dep = parse_gtfs_time(row.get("departure_time"))
            arr = parse_gtfs_time(row.get("arrival_time"))
            # GTFS allows blank times at non-timepoint stops; inherit the
            # neighbouring value rather than dropping the stop.
            points.append((stop_index[stop_id], arr if arr is not None else dep, dep))

        # Fill blanks by forward/backward pass.
        last = None
        for i, (stop, arr, dep) in enumerate(points):
            if dep is None:
                points[i] = (stop, arr if arr is not None else last, last)
            else:
                last = dep
        for i in range(len(points) - 1, -1, -1):
            stop, arr, dep = points[i]
            if arr is None:
                points[i] = (stop, dep, dep)

        def emit(offset):
            nonlocal connection_count
            for i in range(len(points) - 1):
                from_stop, _, dep = points[i]
                to_stop, arr, _ = points[i + 1]
                if dep is None or arr is None:
                    continue
                db.execute(
                    "INSERT INTO connections (dep_s, arr_s, from_stop, to_stop, trip_id, seq)"
                    " VALUES (?,?,?,?,?,?)",
                    (dep + offset, arr + offset, from_stop, to_stop, trip_index[trip_id], i),
                )
                connection_count += 1

        if window:
            start = window["__freq_start"]
            end = window["__freq_end"]
            headway = window["__freq_headway"]
            offset = 0
            while start + offset < end:
                emit(offset)
                offset += headway
        else:
            emit(0)

    # ── Transfers ───────────────────────────────────────────────────────
    for row in transfers_rows:
        from_stop = stop_index.get(row.get("from_stop_id", ""))
        to_stop = stop_index.get(row.get("to_stop_id", ""))
        if from_stop is None or to_stop is None:
            continue
        try:
            min_time = int(row.get("min_transfer_time") or 0)
        except ValueError:
            min_time = 0
        db.execute(
            "INSERT OR REPLACE INTO transfers (from_stop, to_stop, min_transfer_s)"
            " VALUES (?,?,?)",
            (from_stop, to_stop, min_time),
        )

    # ── Meta ────────────────────────────────────────────────────────────
    service_starts = [row[0] for row in db.execute("SELECT start_date FROM services") if row[0]]
    service_ends = [row[0] for row in db.execute("SELECT end_date FROM services") if row[0]]
    feed_info = feed_info_rows[0] if feed_info_rows else {}

    bounds = db.execute("SELECT MIN(lat), MIN(lon), MAX(lat), MAX(lon) FROM stops").fetchone()

    meta = {
        "schema_version": SCHEMA_VERSION,
        "feed_version": feed_info.get("feed_version") or "",
        "feed_publisher": feed_info.get("feed_publisher_name") or "",
        "service_start": min(service_starts) if service_starts else 0,
        "service_end": max(service_ends) if service_ends else 0,
        "connection_count": connection_count,
        "stop_count": len(stop_index),
        "trip_count": len(trip_index),
        "south": bounds[0] if bounds and bounds[0] is not None else 0,
        "west": bounds[1] if bounds and bounds[1] is not None else 0,
        "north": bounds[2] if bounds and bounds[2] is not None else 0,
        "east": bounds[3] if bounds and bounds[3] is not None else 0,
        "region_id": region_id or "",
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    for key, value in meta.items():
        db.execute("INSERT OR REPLACE INTO timetable_meta (key, value) VALUES (?,?)", (key, str(value)))

    db.commit()
    db.execute("VACUUM")
    db.commit()
    db.close()

    size = os.path.getsize(out_path)
    log(
        f"built {out_path}: {connection_count} connections, "
        f"{len(stop_index)} stops, {len(trip_index)} trips, {size} bytes"
    )
    return out_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gtfs_zip", help="Path to the GTFS zip for this region")
    parser.add_argument("out_dir", help="Directory to write transit-timetable.sqlite into")
    parser.add_argument("--region-id", default=None, help="Region id stamped into the metadata")
    args = parser.parse_args()

    if not os.path.exists(args.gtfs_zip):
        log(f"error: {args.gtfs_zip} does not exist")
        sys.exit(1)

    result = build(args.gtfs_zip, args.out_dir, args.region_id)
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
