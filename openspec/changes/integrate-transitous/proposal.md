## Why

Polaris Maps currently maintains 16 city-specific transit API endpoints — each with its own fetcher module, API key, data format, and failure mode. This per-city approach doesn't scale: it cannot cover the thousands of additional transit systems worldwide, requires manual endpoint maintenance as APIs change, and provides no real-time data for most cities. Transitous is a community-run, FOSS routing service that aggregates global transit data (GTFS static + real-time + SIRI + GBFS) behind a single unified MOTIS 2 API — integrating it gives Polaris Maps worldwide transit coverage with real-time capabilities from one backend.

## What Changes

- Add Transitous as a new global endpoint in the OTP registry (`apiStyle: "transitous-v1"`, worldwide bbox)
- Create a `transitousClient.ts` module that wraps the MOTIS 2 OpenAPI using the official `@motis-project/motis-client` JS library
- Map MOTIS API route geometry, stops, and departures to the existing Polaris `TransitRouteLine`, `OtpItinerary`, and `StopDepartureInfo` data models
- Add Transitous dispatch branch in `tryFetchViaOtp` with a fallback chain: Transitous first (fastest for regions it covers), then city-specific endpoints, then Overpass
- Use Transitous for real-time departure data where available, falling back to agency-specific APIs (MBTA, WMATA)
- Add `EXPO_PUBLIC_TRANSITOUS_BASE_URL` env var for configurable endpoint (defaults to `https://api.transitous.org/api`)

## Capabilities

### New Capabilities

- `transitous-endpoint`: Global Transitous MOTIS 2 API endpoint registration, bbox covering the entire world, dispatch via `tryFetchViaOtp`
- `transitous-routing`: Journey planning via Transitous MOTIS `/trip` endpoint, mapped to existing `OtpItinerary` model — replaces OTP routing for all regions
- `transitous-lines`: Transit route line geometry and stops via MOTIS `/guesser` and `/tiles` endpoints, returning `TransitRouteLine[]`
- `transitous-departures`: Real-time and scheduled departure data via MOTIS `/stop_event` endpoint, mapped to `StopDepartureInfo`

### Modified Capabilities

None — existing endpoint registry entries, fetchers, and Overpass fallback remain unchanged. Transitous is added as an additional layer, not a replacement.

## Impact

- `src/services/transit/transitousClient.ts` — new module wrapping MOTIS 2 API
- `src/services/transit/transitousFetcher.ts` — new fetcher for route lines + departures
- `src/services/transit/otpEndpointRegistry.ts` — new global endpoint entry
- `src/services/transit/transitLineFetcher.ts` — dispatch branch for `transitous-v1`
- `src/services/transit/transitRoutingService.ts` — dispatch to Transitous for trip planning
- `src/services/transit/transitDepartureFetcher.ts` — dispatch to Transitous for departures
- `package.json` — new dependency `@motis-project/motis-client`
- `app.json` / `.env` — new `EXPO_PUBLIC_TRANSITOUS_BASE_URL` variable
