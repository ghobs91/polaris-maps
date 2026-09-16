# Deepen Search and Places — Filters, Reviews, Media, Offline, Sharing

## Why

`improve-place-search` makes search fast and relevant (staged emission, result caching, ranking v2), but once results arrive users cannot narrow or reorder them, each row is a bare name + city + `% match`, reviews and photos are invisible, place details vanish with connectivity, and saved lists cannot be shared or exported. This change turns the now-fast search into a usable place-discovery surface and gives saved places a real lifecycle.

## What Changes

- **Search filters and sorting**: filter UI (open now, rating, price, distance, category) plus a sort control (relevance, distance, rating, price) that constrain and reorder the staged result pipeline from `improve-place-search`, compose with the parser's natural-language intent, and persist per session.
- **Rich result rows**: category icon, licensed thumbnail, rating, open/closed badge, price, and distance instead of name + city + `% match`.
- **Pagination / infinite scroll** over accumulated ranked results, replacing fixed 20–30 limits, and **voice search** in the floating map panel (today it exists only in the search tab).
- **Reviews surfaced and extended**: merged community ratings in `POIInfoCard`; a review list with sort, filter, and helpful voting; and **review photos** (reviews table + model updated) with on-device storage, P2P replication, moderation, and reporting. Cross-references `restore-first-run-surfaces` (make the review surface reachable) and `broaden-traffic-and-media-sources`.
- **Place media with optional open supplements**: keep on-device OpenGraph/`<img>` website scraping (`websitePhotosService.ts`) as the primary place-media source; optionally supplement it with openly licensed sources — Wikimedia Commons (Wikidata brand logos) and Panoramax street-level imagery (Mapillary only where license allows) — with attribution and license metadata, offline-safe fallbacks, and graceful empty states.
- **Menu rendering** for the parsed `menuUrl`, which `POIInfoCard` currently never displays.
- **Offline place details**: cache last-viewed hours, phone, address, media metadata, and a reviews snapshot for offline reads, with explicit staleness indication and region-pack integration.
- **Place sharing and lists**: deep/universal links for a place (replacing today's plain-text `Share.share`), list export (CSV/GeoJSON/GPX), and **collaborative P2P list sharing** over Gun/Hypercore with a CRDT conflict model and private-by-default privacy controls.

**BREAKING**: `SearchResults` and `FloatingSearchPanel` row layout changes; default result lists become paginated.

## Capabilities

### New Capabilities

- `search-filters`: filter and sort controls, their application to the staged ranking pipeline, session persistence, rich result rows, pagination, and in-panel voice search.
- `place-reviews-and-media`: review photos (upload, storage, replication, moderation), merged ratings surfaced in the place card, review sort/filter/helpful, website photo scraping retained as the primary place-media source with optional open-licensed supplementary media and attribution, offline-safe fallbacks, and menu rendering.
- `offline-place-details`: caching of last-viewed place details and reviews snapshots, region-pack integration, staleness indication, and bounded storage.
- `place-sharing-and-lists`: place deep/universal links, list export, and collaborative list sharing over P2P with privacy controls.

### Modified Capabilities

None — `openspec/specs/` is empty. `improve-place-search` will establish the initial `search-orchestration`, `search-result-cache`, `local-search-index`, `search-ranking`, and `search-evaluation` specs; this change only consumes that pipeline and does not redefine its requirements.

## Impact

- **Search UI**: `app/(tabs)/search.tsx`, `src/components/search/SearchResults.tsx`, `src/components/search/SearchBar.tsx`, `src/components/map/FloatingSearchPanel.tsx`; new filter/sort sheet and rich row components under `src/components/search/`.
- **Search services**: `src/services/search/unifiedSearch.ts` and `searchRanker.ts` (filter/sort hook points), `queryParser.ts` (intent → filter defaults), new `src/services/search/resultFilter.ts` and `resultSort.ts`.
- **Place detail**: `src/components/map/POIInfoCard.tsx` (ratings, media, menu); `app/poi/[id].tsx` and `app/poi/reviews.tsx` (review media, sort/filter/helpful) — coordinated with `restore-first-run-surfaces`.
- **Media services**: new `src/services/poi/placeMediaService.ts` layering Wikimedia Commons and Panoramax providers as supplementary sources on top of the retained `websitePhotosService.ts`; `websitePhotosService.ts` and `tripadvisorService.ts` are retained (coordinated with `broaden-traffic-and-media-sources`, which also retains them).
- **Reviews**: `src/models/review.ts`, `src/services/poi/reviewService.ts`, `src/services/atproto/atprotoReviewService.ts`, `src/services/database/init.ts` (new review media table/migration).
- **Offline**: `src/services/database/init.ts` (place-detail cache table), new `src/services/places/placeDetailCache.ts`, region-pack import/generation scripts.
- **Lists/sharing**: `src/stores/placeListStore.ts`, `app/places/list.tsx`, `src/services/places/importService.ts` (add export), new `src/services/places/shareService.ts` and `listSyncService.ts`; `app.json` (associated domains plugin) plus a new `plugins/` entry.
- **Tests**: new integration and unit suites under `__tests__/`, contract tests for the list-sync protocol, and storage/performance benchmarks per the constitution.
