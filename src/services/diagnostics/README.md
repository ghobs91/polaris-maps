# Diagnostics

A bounded, redacted, on-device log of network and mesh failures. Nothing is
uploaded automatically.

## Why

Most of Polaris's runtime dependencies are public third-party endpoints
(OpenFreeMap, Overpass, Nominatim, Photon, Valhalla, Overture, Transitous,
Google/Mapillary imagery). When one starts returning 403/429 under load, the
app degrades silently. This log records the reason so it can be exported from
Settings → Developer → Export Diagnostics.

## Contract

- **Bounded**: 250 entries, oldest dropped first.
- **Redacted**: URL query strings are replaced with `?<redacted>`; strings are
  truncated to 300 chars; nested data is depth- and key-limited.
- **Persisted**: encrypted MMKV, debounced 1 s, best-effort.
- **Non-fatal**: logging never throws and degrades to memory-only if storage is
  unavailable.
- **Manual only**: export writes `polaris-diagnostics.json` to the cache dir and
  opens the system share sheet. There is no automatic upload.

## Crash reports

Crash and hang reports come from App Store Connect (and Xcode Organizer), which
already aggregates them without a third-party SDK. This log complements that
with the _reason_ a feature degraded, which crash reports do not capture.

## Files

| File                   | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `diagnosticsLog.ts`    | Pure ring buffer + redaction + lazy MMKV persistence            |
| `diagnosticsExport.ts` | JSON file + share sheet (native imports kept out of the logger) |
