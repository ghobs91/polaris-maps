## Why

The transit layer currently only works reliably for NYC (MTA OTP), Boston (MBTA V3), Portland (TriMet OTP), and Norway (Entur Transmodel). All other US and European cities fall back to Overpass API queries, which are too slow and heavy for mobile — the `out body geom` response can reach 5–10 MB per tile, causing frequent timeouts and silent failures on cellular networks. Users in Chicago, DC, SF, Philly, LA, Atlanta, and other major metros see no transit lines or only partial results.

## What Changes

- Add dedicated OpenTripPlanner (OTP) or agency-native API endpoints to the `OTP_ENDPOINTS` registry for major US and European cities that currently lack coverage
- For cities without a public OTP endpoint, implement agency-specific transit line fetchers using available public APIs (GTFS real-time, transitland, or direct agency REST/GraphQL endpoints)
- Improve the Overpass fallback reliability (POST requests, increased timeouts, retry logic) for cities where no API endpoint is available — already partially implemented in prior work
- Remove the stale "Overpass fallback" comments from the endpoint registry once each city gets a real endpoint

## Capabilities

### New Capabilities

- `transit-endpoint-wmata`: Dedicated transit API endpoint for Washington Metro (WMATA), covering the DC metro area
- `transit-endpoint-cta`: Dedicated transit API endpoint for Chicago Transit Authority (CTA "L"), covering greater Chicago
- `transit-endpoint-bart`: Dedicated transit API endpoint for BART, covering the SF Bay Area rapid transit network
- `transit-endpoint-septa`: Dedicated transit API endpoint for SEPTA Metro, covering Philadelphia metro rail/trolley
- `transit-endpoint-lametro`: Dedicated transit API endpoint for LA Metro Rail, covering Los Angeles County
- `transit-endpoint-marta`: Dedicated transit API endpoint for MARTA rail, covering Atlanta
- `transit-endpoint-miami`: Dedicated transit API endpoint for Miami-Dade Metrorail
- `transit-endpoint-baltimore`: Dedicated transit API endpoint for Baltimore Metro SubwayLink and PATCO Speedline
- `transit-endpoint-europe`: Dedicated transit API endpoints for major European metro systems (London TfL, Paris RATP, Berlin BVG, Madrid Metro, etc.)
- `overpass-reliability`: Overpass fallback hardening — POST, 60s server timeout, 75s client timeout, 3-retry backoff, error logging. Serves as safety net for cities not covered by any dedicated endpoint.

### Modified Capabilities

None — existing OTP endpoints (MTA NYC, TriMet, MBTA, Entur) are unchanged.

## Impact

- `src/services/transit/otpEndpointRegistry.ts` — new entries in `OTP_ENDPOINTS` with bbox, URL, and apiStyle for each city
- `src/services/transit/` — new fetcher modules for agencies that don't speak OTP REST (e.g., WMATA GTFS API, CTA Train Tracker, TfL Unified API)
- `src/services/transit/transitLineFetcher.ts` — `tryFetchViaOtp` dispatches to new fetchers by apiStyle (similar to `mbta-v3` path)
- `src/services/overpassClient.ts` — already updated to POST with retries in prior work; this change formalizes the improvement under the `overpass-reliability` spec
- No breaking changes to the transit store model, route line model, or TransitLayer rendering
