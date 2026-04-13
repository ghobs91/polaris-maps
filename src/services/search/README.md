# Geocoding & Search

Unified search pipeline combining local FTS5, Photon geocoding, Overpass category search, query parsing, and relevance ranking.

## Overview

Search is designed as a parallel multi-source pipeline:

1. **Query parser** analyzes natural-language input to extract intent — brand names, cuisine hints, modifiers ("near me", "open now"), and resolved POI categories
2. **Four search sources** execute in parallel:
   - Local FTS5 over Overture places + GeoNames cities1000 (~140k cities)
   - Category-filtered Overpass API queries
   - Photon geocoder (Komoot) for fuzzy, typo-tolerant address/POI search
   - Nominatim for structured address geocoding
3. **Deduplication** removes spatial duplicates across sources
4. **Search ranker** scores results 0–100 by combining text match quality, viewport distance, category match, and popularity
5. **Search history** persists the last 10 selections in MMKV

## Architecture

```
User query
    ↓
queryParser.ts → { categories, brand, cuisine, modifiers }
    ↓
unifiedSearch.ts (parallel dispatch)
    ├── geocodingService.ts → FTS5 local + Nominatim
    ├── photonGeocoder.ts → Komoot Photon API
    ├── categorySearchService.ts → Overpass by category
    └── globalGeocoderService.ts → GeoNames cities1000 (offline)
    ↓
Deduplication (spatial + name)
    ↓
searchRanker.ts → scored 0–100
    ↓
SearchResults component
    ↓
searchHistoryService.ts → MMKV (last 10)
```

## Files

### Search (`src/services/search/`)

| File                      | Description                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unifiedSearch.ts`        | Top-level orchestrator — runs all search sources in parallel, deduplicates, relevance-ranks merged results. Entry point for all search operations. |
| `queryParser.ts`          | Parses natural-language queries into structured intent — extracting brand names, cuisine hints, modifiers, and resolved POI categories.            |
| `searchRanker.ts`         | Scores results 0–100: Levenshtein distance, name containment, viewport center distance, category match, popularity signals.                        |
| `photonGeocoder.ts`       | Komoot Photon API client — fuzzy, typo-tolerant OSM-based geocoding returning POIs and addresses with structured metadata.                         |
| `searchHistoryService.ts` | MMKV-persisted last 10 search selections with add, remove, and clear operations.                                                                   |

### Geocoding (`src/services/geocoding/`)

| File                       | Description                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geocodingService.ts`      | FTS5 local geocoding over the Overture places SQLite table + Nominatim fallback. Rate-limited (1s min gap). Handles FTS5 injection prevention.             |
| `globalGeocoderService.ts` | Offline city-level geocoder backed by GeoNames cities1000 SQLite database (~140k cities). Downloaded once from CDN. Provides FTS5 + R-Tree spatial search. |

## Key Constants

| Constant               | Value | Description                                 |
| ---------------------- | ----- | ------------------------------------------- |
| `NOMINATIM_MIN_GAP_MS` | 1,000 | Minimum inter-request gap for Nominatim API |
| `SEARCH_HISTORY_MAX`   | 10    | Maximum saved search history entries        |
| `LEVENSHTEIN_WEIGHT`   | 0.3   | Text match quality weight in ranking        |
| `DISTANCE_WEIGHT`      | 0.3   | Viewport distance weight in ranking         |
| `CATEGORY_WEIGHT`      | 0.2   | Category match weight in ranking            |
| `POPULARITY_WEIGHT`    | 0.2   | Popularity signal weight in ranking         |

## Related Files

- [`src/components/search/`](../../components/search/) — SearchBar, SearchResults, and SearchHistory UI
- [`src/services/poi/categorySearchService.ts`](../poi/categorySearchService.ts) — Category search with Overpass fallback
- [`src/services/poi/categoryResolver.ts`](../poi/categoryResolver.ts) — Natural-language → PlaceCategory mapping
- [`app/(tabs)/search.tsx`](<../../../app/(tabs)/search.tsx>) — Search tab with coordinate/Plus Code detection
