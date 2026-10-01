## Why

Polaris Maps currently has strong US transit coverage via the DOT GTFS Registry and city-specific endpoints, but European coverage is limited to a handful of dedicated endpoints (TfL London, IDFM Paris, VBB Berlin, CRTM Madrid, Entur Norway). When a user pans to European cities outside these — Copenhagen, Helsinki, Stockholm, Amsterdam, Dublin, Zurich, Tallinn, Luxembourg City — the app falls back to Transitous or Overpass API, which are slow and lack complete route geometry.

The `data.public-transport.earth` service provides consolidated, country-level GTFS feeds for 10 European countries, updated regularly from official transit agency sources. Each feed is a single GTFS ZIP containing all transit agencies for that country — a clean, reliable data source with no API key required.

## What Changes

- **Add 10 European country GTFS feed URLs** from `data.public-transport.earth` as first-class data sources
- **Register each country as a GTFS endpoint** in the OTP endpoint registry with its national bounding box, using the existing `gtfs-static-v1` apiStyle already shared by city-specific GTFS fetchers
- **Integrate into the transit dispatch chain** — each country endpoint is placed after city-specific European endpoints (TfL, IDFM, VBB, CRTM, Entur) but before Transitous and Overpass in `tryFetchViaOtp`
- **Reuse existing GTFS infrastructure** — no new parsing or fetching code; the existing `gtfsStaticFetcher.ts` handles download, parse, and conversion to `TransitRouteLine[]` with mode support for all transit types (bus, rail, tram, metro, ferry)

## Capabilities

### New Capabilities

- `european-gtfs-endpoints`: Configuration of 10 European country GTFS feeds (de, dk, fi, ee, ie, lu, nl, no, se, ch) as entries in the OTP endpoint registry with national bounding boxes and `gtfs-static-v1` apiStyle

### Modified Capabilities

None — no existing specs are modified. Changes to `transit-line-fetcher` and `otp-endpoint-registry` are implementation-level additions that do not alter existing capability contracts.

## Impact

- `src/services/transit/otpEndpointRegistry.ts` — add 10 European country entries to `OTP_ENDPOINTS` array with bounding boxes and GTFS feed URLs
- `src/services/transit/transitLineFetcher.ts` — add `gtfs-static-v1` dispatch handling for the new European country endpoints in `tryFetchViaOtp`
- `src/services/transit/gtfsStaticFetcher.ts` — may need minor extension to support country-wide bounding boxes (existing city-specific fetcher works with single feed URLs already)
- No new files, no new dependencies, no API keys required
