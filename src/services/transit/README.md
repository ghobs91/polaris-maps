# Public Transit

Multi-modal transit layer with route line rendering, stop departures, trip planning via OpenTripPlanner, and dedicated Amtrak/MBTA integrations.

## Overview

The transit service provides a comprehensive public transportation layer:

1. **Route line rendering** — transit route geometries fetched from OTP endpoints (primary) or Overpass API (fallback), with spatial 0.05° tile caching
2. **Stop display** — transit stops from OTP or Overpass with mode-aware icons (subway, rail, bus, tram, ferry)
3. **Departure times** — MBTA real-time predictions where available; estimated headway-based departures elsewhere
4. **Trip planning** — multi-modal itineraries via OTP2 GTFS GraphQL with automatic endpoint selection by region
5. **Amtrak routes** — national rail route geometries from BTS ArcGIS FeatureServer with viewport-based spatial queries
6. **MBTA integration** — Boston-area real-time route lines and stop departure predictions (subway, light rail, commuter rail, bus)

## Architecture

```
Transit layer toggle ON
    ↓
useTransitStops.ts (viewport-based incremental fetch)
    ↓
transitLineFetcher.ts → OTP / Overpass (spatial tile cache 0.05°)
transitStopFetcher.ts → OTP / Overpass (mode-tagged stops)
    ↓
transitStore (Zustand)
    ↓
TransitLayer.tsx (always-mounted GeoJSON layers, visibility toggled)
    ↓ (stop tap)
transitDepartureFetcher.ts → MBTA real-time / headway estimate
    ↓
TransitStopCard (departures display)

Trip planning:
    transitRoutingService.ts → OTP2 GTFS GraphQL
        ↓
    otpEndpointRegistry.ts → auto-select endpoint by lat/lng
        ↓
    OTP itinerary → transitStore
```

## Files

| File                         | Description                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transitLineFetcher.ts`      | Fetches transit route line geometries from OTP endpoints (primary) or Overpass API (fallback). Spatial tile cache at 0.05° (~5km) granularity — tiles fetched once, never evicted. |
| `transitStopFetcher.ts`      | Fetches transit stops for map rendering from OTP (if configured) or Overpass OSM. Maps railway/station tags to transit modes. TTL-based cache.                                     |
| `transitDepartureFetcher.ts` | Provides upcoming departure times for a stop. Uses MBTA real-time predictions where available, estimated headway-based departures elsewhere.                                       |
| `transitRoutingService.ts`   | Plans multi-modal transit trips via OTP2 GTFS GraphQL queries. Auto-selects correct endpoint from registry based on origin coordinates.                                            |
| `otpEndpointRegistry.ts`     | Static registry mapping geographic bounding boxes to public OTP deployments — REST v1, GTFS GraphQL v2, Transmodel v3, and MBTA v3.                                                |
| `amtrakFetcher.ts`           | Fetches Amtrak national rail route geometries from BTS ArcGIS FeatureServer with viewport-based spatial intersection queries and geometry simplification.                          |
| `mbtaFetcher.ts`             | MBTA V3 JSON:API integration — route line geometries + real-time stop departure predictions for Boston-area transit (subway, light rail, commuter rail, bus).                      |
| `gtfsStaticFetcher.ts`       | **Orphaned** — GTFS ZIP download logic, removed due to crash issues on mobile. Not imported anywhere.                                                                              |
| `transitFeedService.ts`      | **Orphaned** — GTFS feed management. Not imported anywhere.                                                                                                                        |

## Key Constants

| Constant              | Value   | Description                                  |
| --------------------- | ------- | -------------------------------------------- |
| `TILE_SIZE_DEG`       | 0.05    | Spatial cache tile granularity (~5km)        |
| `PROXIMITY_DEG`       | 0.003   | Stop-to-route geometry matching threshold    |
| `STOP_CACHE_TTL_MS`   | 300,000 | 5-minute TTL for stop cache entries          |
| `STOP_ROUTE_RADIUS_M` | 500     | Maximum distance for on-tap route enrichment |

## Related Files

- [`src/stores/transitStore.ts`](../../stores/transitStore.ts) — Transit visibility, route lines, stops, selected stop, OTP itineraries
- [`src/hooks/useTransitStops.ts`](../../hooks/useTransitStops.ts) — Viewport-based incremental line fetching with spatial cache restore
- [`src/components/map/`](../../components/map/) — TransitLayer component for GeoJSON rendering
