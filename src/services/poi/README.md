# Points of Interest (POI)

Multi-source POI system with Overture Maps, OpenStreetMap, Apple MapKit enrichment, crowd-sourced edits, reviews, attestation, and reputation.

## Overview

The POI service aggregates place data from multiple sources into a unified browsing experience:

1. **Local Overture** — pre-downloaded places stored in SQLite, queried by bounding box with FTS5 search
2. **OSM Overpass** — real-time viewport queries for nodes/ways with `amenity|shop|tourism|leisure` tags
3. **Overture-hosted PMTiles** — visible place features decoded client-side from Overture's published `places.pmtiles` archive
4. **MapKit enrichment** — Apple's native MapKit fills missing phone, website, address, hours, and logo when a POI is selected (iOS only)
5. **Nominatim fallback** — last-resort geocoder when both local and Overpass return empty

Users can contribute back to the map through:

- **Edits** — field-level changes signed with Schnorr keypair, published to Gun.js for peer corroboration
- **Reviews** — 1–5 star ratings with text, stored locally and synced via Gun.js
- **Attestations** — cryptographic proof-of-presence (≤100m GPS proximity) confirming a POI exists
- **Reputation** — composite scoring from contributions, confirmations, and traffic probe accuracy

## Architecture

```
MapView (viewport change)
    ↓
Phase 1: poiService.ts → SQLite (instant local)
Phase 2: osmFetcher.ts → Overpass API + overtureFetcher.ts PMTiles fetch (parallel network)
Phase 3: osmFetcher.ts → Nominatim (fallback)
    ↓
Deduplication (30m spatial grid, O(n))
    ↓
poiSpatialFilter.ts (zoom-adaptive density filtering)
    ↓
POILayer.tsx (pill badge rendering)
    ↓ (on tap)
poiEnricher.ts → Apple MapKit native enrichment
    ↓
POI Detail Screen (reviews, edits, attestation)
    ↓
editService.ts / reviewService.ts / attestationService.ts
    ↓
Gun.js sync → other peers
```

## Files

| File                       | Description                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `osmFetcher.ts`            | Overpass API client — fetches nodes/ways by viewport, name regex, or tags. 5-min TTL bbox cache (max 20 entries). Also provides Nominatim fallback.                                                                                                                 |
| `poiService.ts`            | Local SQLite queries — `getPlacesInBounds()`, `searchPlacesByCategory()`, `searchPlacesFts()` on the Overture places table.                                                                                                                                         |
| `overtureFetcher.ts`       | Client-side Overture PMTiles reader that fetches visible vector tiles directly from Overture's hosted `places.pmtiles` archive.                                                                                                                                     |
| `categorySearchService.ts` | Category search orchestrator — resolves query to categories, queries local SQLite first, falls back to Overpass if <5 local results, deduplicates and ranks.                                                                                                        |
| `categoryResolver.ts`      | Maps natural-language category terms to `PlaceCategory` enum values with synonym support.                                                                                                                                                                           |
| `poiEnricher.ts`           | Optional on-device enrichment from native Apple MapKit (iOS) — fills phone, website, formatted address, timezone, hours, logo. OSM fields take priority; only fills missing data. LRU cache (500 entries). Gracefully no-ops when the native module is unavailable. |
| `websitePhotosService.ts`  | Primary place-media source — fetch + OpenGraph parse first, hidden on-device WebView fallback for JS-rendered sites.                                                                                                                                                |
| `editService.ts`           | Submits field-level POI edits signed with user's keypair. Published to Gun.js for peer corroboration/dispute. Pending → resolved workflow.                                                                                                                          |
| `reviewService.ts`         | POI reviews (1–5 star + text + optional photos) stored in local SQLite and synced to Gun.js. Keyed by place UUID + author pubkey. Persists/loads `review_media` rows and exposes publish/report/hide actions.                                                       |
| `reviewRanking.ts`         | Pure review helpers: merged community rating (average + count), sort (newest/highest/lowest/most-helpful), filters (min rating, photos only), and unique helpful-vote counting.                                                                                     |
| `reviewMediaStatus.ts`     | Pure moderation state machine for review photos: `local → published \| reported \| hidden`, visibility filtering, and one-way publication so reported/hidden hashes are never re-published.                                                                         |
| `reviewMediaService.ts`    | Review photo storage pipeline: downscale to a bounded edge, thumbnail, strip EXIF/GPS via re-encode, content-address and write to the documents directory, local-first resolution, and opt-in content-addressed Gun publication with peer tombstones.               |
| `placeMediaService.ts`     | Place media sourcing: the on-device website scraper is primary; openly-licensed Wikimedia Commons / Panoramax providers layer on as supplements with per-item license + attribution.                                                                                |
| `placeMediaProviders.ts`   | Concrete supplements for `placeMediaService`: `createWikidataCommonsProvider` (P18/P154 via `wbgetentities` → Commons URLs) and `createPanoramaxProvider` (STAC bbox search), both best-effort with injectable `fetch`. Rendered by `PlaceMediaCarousel`.           |
| `attestationService.ts`    | Cryptographic proof-of-presence — verifies GPS proximity ≤100m, signs attestation with Schnorr keypair.                                                                                                                                                             |
| `reputationService.ts`     | Reads/writes user reputation scores from Gun.js with signature verification. Composite of POI contributions, confirmations, and traffic probe accuracy.                                                                                                             |

## Key Constants

| Constant                      | Value  | Description                                            |
| ----------------------------- | ------ | ------------------------------------------------------ |
| `POI_MIN_ZOOM`                | 14     | POIs only fetch when map zoom ≥14                      |
| `OSM_FETCH_DEBOUNCE_MS`       | 300    | Debounce viewport changes before fetching              |
| `POI_FETCH_THRESHOLD`         | 0.01   | Skip re-fetch if viewport shifted <1km                 |
| `DEDUP_THRESHOLD_DEG`         | 0.0003 | ~30m threshold for duplicate detection                 |
| `LOCAL_SUFFICIENCY_THRESHOLD` | 5      | Trigger Overpass fallback if <5 local category results |
| `OVERPASS_TIMEOUT_MS`         | 5,000  | Overpass API request timeout                           |
| `ATTESTATION_RADIUS_M`        | 100    | Maximum GPS distance for proof-of-presence             |
| `ENRICHMENT_CACHE_SIZE`       | 500    | Max MapKit enrichment cache entries                    |

## Related Files

- [`src/utils/poiSpatialFilter.ts`](../../utils/poiSpatialFilter.ts) — Zoom-adaptive density filtering with placement grid
- [`src/utils/poiCategories.ts`](../../utils/poiCategories.ts) — Icon/color mappings for 60+ POI categories
- [`src/utils/placeToOsmPoi.ts`](../../utils/placeToOsmPoi.ts) — Overture Place → OsmPoi conversion (60+ categories)
- [`src/components/map/POILayer.tsx`](../../components/map/POILayer.tsx) — Map pill badge rendering
- [`src/stores/osmPoiStore.ts`](../../stores/osmPoiStore.ts) — Viewport POIs, selected POI, enrichment, category search
- [`src/stores/poiStore.ts`](../../stores/poiStore.ts) — Overture/local places, reviews, pending edits
- [`src/components/map/WebsitePhotosCarousel.tsx`](../../components/map/WebsitePhotosCarousel.tsx) — Primary place-media carousel, sourced on-device from the POI website's OpenGraph metadata
- [`app/poi/`](../../../app/poi/) — POI detail, edit, OSM edit, and review screens
