# Tasks — Deepen Search and Places

Ordered so the no-schema search UX lands first and independently; each group is shippable on its own.

## 1. Filter and sort view layer

- [x] 1.1 Define `SearchFilters` and `SortOption` types and a session-scoped `searchViewStore` (Zustand) holding `filters` and `sort`
- [x] 1.2 Implement `src/services/search/resultFilter.ts`: pure `applyFilters(results, filters)` covering open now, min rating, max price, max distance, categories
- [x] 1.3 Implement `src/services/search/resultSort.ts`: pure comparators for relevance, distance, rating, price, with distance tie-break
- [x] 1.4 Seed default filters from parsed intent (`wantsOpenNow` / `wantsQuality` / `wantsCheap`) and let explicit user selections override them
- [ ] 1.5 Apply filters and sort inside `usePlaceSearch` after each staged emission; keep canonical keys stable and throttle re-sorts to one per frame
- [ ] 1.6 Re-apply non-category filter changes locally over accumulated results without a refetch; route category changes through `deriveQueryContext` for source gating
- [ ] 1.7 Build the filter/sort sheet component under `src/components/search/` and wire it into `app/(tabs)/search.tsx`
- [ ] 1.8 Wire the same filter/sort sheet into `src/components/map/FloatingSearchPanel.tsx`
- [ ] 1.9 Add the filtered-empty state with a clear-filters action
- [x] 1.10 Unit tests: each predicate, unknown-data pass-through, comparator ordering and tie-breaks, intent-seeded defaults, explicit override
- [x] 1.11 Unit tests: filters re-applied on a later stage emission; results never reappear unfiltered; scores unchanged by filtering
- [x] 1.12 Integration test: apply filters plus sort in the search tab and confirm the rendered list order and membership

## 2. Rich rows, pagination, and voice search

- [ ] 2.1 Extend the search result model with optional rating, open-now state, price level, distance, category, and thumbnail fields from the ranked result
- [ ] 2.2 Build a `SearchResultRow` component rendering category icon, thumbnail, rating, open/closed badge, price, and distance with graceful omission of missing fields
- [ ] 2.3 Adopt the shared row in `SearchResults.tsx` and in the floating panel result list (preserve the transit-station variant)
- [ ] 2.4 Add cursor-based `loadMore()` pagination to `usePlaceSearch` with dedupe by canonical key across re-sorts
- [ ] 2.5 Add the scroll-to-load affordance and end-of-results state in both result lists
- [ ] 2.6 Create `useVoiceSearch` hook reusing the existing speech implementation from `SearchBar.tsx`, with just-in-time permission and keyboard fallback
- [ ] 2.7 Add the microphone control to `FloatingSearchPanel.tsx` that fills the input and triggers a search
- [ ] 2.8 Unit tests: row rendering with full and sparse data; pagination dedupe after a reordering emission; voice-search fallback when permission is denied
- [ ] 2.9 Integration test: paginate to a second page and confirm no duplicates and stable sort order

## 3. Place media (website scraping plus open supplements) and menus

- [ ] 3.1 Define `PlaceMediaItem` with source, license, license URL, author, and attribution fields; define the provider interface and mark the retained website scraper as the primary source
- [ ] 3.2 Implement `src/services/poi/placeMediaService.ts` layering a supplementary Wikimedia Commons provider (Wikidata QID plus Commons geosearch, reusing `commonsThumbUrl`) on top of the retained `websitePhotosService.ts` scraper
- [ ] 3.3 Add a supplementary Panoramax STAC provider with attribution metadata, layered on top of the retained website scraper
- [ ] 3.4 Add an optional Mapillary provider gated on a configured token and acceptable license (or record the decision to omit it)
- [ ] 3.5 Merge and de-duplicate scraped and open-provider results by content key (scraper output primary) and cache metadata with its attribution
- [ ] 3.6 Render media with visible attribution and a license link for open-source items in `POIInfoCard.tsx` and in result-row thumbnails
- [ ] 3.7 Add offline-safe media behaviour: cached thumbnails when offline, deliberate empty state otherwise
- [ ] 3.8 Render the parsed `menuUrl` in `POIInfoCard.tsx` with a viewer handling web pages and documents, plus an unreachable-menu state
- [ ] 3.9 Unit tests: provider normalization, attribution presence, dedupe, empty-provider result, unreachable menu handling
- [ ] 3.10 Integration test: open a place with media and a menu and confirm attribution and menu controls render

## 4. Reviews: photos, merged ratings, sort/filter/helpful

- [ ] 4.1 Extend `src/models/review.ts` with `media: ReviewMedia[]` and define `ReviewMedia` with hash, dimensions, mime, status, and timestamps
- [ ] 4.2 Add an idempotent `review_media` table migration in `src/services/database/init.ts` with FK to `reviews.id`
- [ ] 4.3 Implement photo attach: downscale, thumbnail, strip EXIF/GPS, write to the app documents directory
- [ ] 4.4 Persist and load media through `src/services/poi/reviewService.ts`; include media metadata in the Gun record
- [ ] 4.5 Implement P2P publication and retrieval by content hash behind an explicit opt-in; wire deletion to tombstone media for peers
- [ ] 4.6 Build the review photo gallery and full-size viewer with local-first loading and placeholder fallback
- [ ] 4.7 Add report/hide handling with `local → published | reported | hidden` status transitions and no re-publication of reported hashes
- [ ] 4.8 Surface the merged community rating and review count in `POIInfoCard.tsx`, clearly distinguishing any third-party rating
- [ ] 4.9 Add review sorting (newest, highest, lowest, most helpful) and filtering (rating, photos only) to the review surface
- [ ] 4.10 Add helpful voting with one-vote-per-identity and withdrawal, aggregating local and replicated votes
- [ ] 4.11 Coordinate with `restore-first-run-surfaces` so the review surface is reachable from the place card
- [ ] 4.12 Unit tests: model round-trip, EXIF stripping, status transitions, merged average and count, sort/filter predicates, helpful idempotency
- [ ] 4.13 Contract tests: review and media message shape and merge behaviour across the P2P boundary
- [ ] 4.14 Integration test: write a review with a photo, display it offline from local storage, and vote it helpful

## 5. Offline place details

- [ ] 5.1 Add a `place_detail_cache` table (canonical id, serialized snapshot, media metadata, reviews snapshot, `cachedAt`, `sourceVersion`) via an idempotent migration
- [ ] 5.2 Implement `src/services/places/placeDetailCache.ts` with get, put, evict, clear, and an LRU bound
- [ ] 5.3 Write the cache on successful place enrichment and read it as the offline fallback in `POIInfoCard.tsx` and the place detail route
- [ ] 5.4 Add the offline indicator and last-updated staleness label, plus refresh-on-reconnect
- [ ] 5.5 Merge canonical identifiers so one place viewed from search and from a saved list shares one snapshot
- [ ] 5.6 Support optional region-pack place-detail data that seeds the cache without overwriting newer snapshots
- [ ] 5.7 Add a settings control to clear cached place details
- [ ] 5.8 Unit tests: round-trip, key aliasing, LRU eviction, source-version precedence, clear
- [ ] 5.9 Benchmark: cache write/read timing and stored size for a realistic place snapshot
- [ ] 5.10 Integration test: view a place online, go offline, reopen it, and confirm cached detail plus staleness indication

## 6. Place sharing and deep links

- [ ] 6.1 Implement `src/services/places/shareService.ts` building a universal link for a place, falling back to coordinates/name when no canonical id exists
- [ ] 6.2 Add the `withUniversalLinks` config plugin writing the Associated Domains entitlement and register it in `app.json` (iOS scope)
- [ ] 6.3 Add Expo Router deep-link handling for `https://polarismaps.com/p/...` and the `polaris-maps://place/...` fallback, resolving to the place detail
- [ ] 6.4 Replace the plain-text `Share.share` in `POIInfoCard.tsx` with the link payload
- [ ] 6.5 Document the out-of-repo `apple-app-site-association` requirement and defer Android App Links with a recorded decision
- [ ] 6.6 Unit tests: link construction with and without a canonical id; link parsing and resolution
- [ ] 6.7 Integration test: open a inbound place link and confirm the correct place detail is shown

## 7. List export and collaborative sharing

- [ ] 7.1 Add list export to CSV and GeoJSON in `src/services/places/`, reusing the existing import field expectations
- [ ] 7.2 Add an export action and share sheet to `app/places/list.tsx` and the list card
- [ ] 7.3 Implement `listSyncService.ts`: Gun namespace per shared list, signed invite carrying list id and room key, membership over P2P
- [ ] 7.4 Implement the pure `mergeList(local, remote)` function with LWW metadata, place tombstones, and deterministic tie-breaks
- [ ] 7.5 Wire the owner sharing toggle into `placeListStore.ts` and the list UI, keeping `isPrivate: true` until explicitly enabled
- [ ] 7.6 Implement revoke by rotating the room key and removing the Gun namespace while preserving the local list
- [ ] 7.7 Surface sharing state on every list, replacing the always-true private/shared label
- [ ] 7.8 Unit tests: merge convergence under shuffled and tied edits, no resurrection, dedupe of concurrent adds, rename resolution
- [ ] 7.9 Contract tests: list-sync message format and merge determinism at the P2P boundary
- [ ] 7.10 Integration test: export a list, re-import it, and verify round-trip; share a list and confirm a collaborator receives an edit
- [ ] 7.11 Integration test: confirm an unshared list writes nothing to the P2P store

## 8. Verification and documentation

- [ ] 8.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` and resolve all issues introduced by this change
- [ ] 8.2 Run the relevant unit, integration, and contract suites and record actual results, noting pre-existing failures separately
- [ ] 8.3 Run storage and performance benchmarks for the media cache, place-detail cache, and list merge; record thresholds
- [ ] 8.4 Update `src/services/search/README.md`, `src/services/poi/README.md`, and `src/services/places/README.md` with the new contracts
- [ ] 8.5 Update `AGENTS.md` and the release notes with the new capabilities, iOS-only universal-link scope, and the `broaden-traffic-and-media-sources` coordination
- [ ] 8.6 Record unresolved open questions (ATProto photo blobs, Mapillary license, Panoramax coverage, menu viewer) in the change notes
