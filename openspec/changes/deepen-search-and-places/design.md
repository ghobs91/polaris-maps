# Design — Deepen Search and Places

## Context

`improve-place-search` reworks `unifiedSearch` into a staged pipeline (`local → cities → photon → category → remaining`) that emits scored, stably keyed results after each stage, backed by an LRU result cache and a shared `usePlaceSearch` session. Ranking v2 already consumes parser intent (`wantsOpenNow`, `wantsQuality`, `wantsCheap`) and emits 0–100 scores. This change builds a _view_ layer on top of that pipeline plus new place-detail, media, offline, and sharing surfaces.

Current constraints discovered in the repo:

- `SearchResults.tsx` and the `FloatingSearchPanel` result rows render only name + city/type + `% match`; there is no filter or sort control anywhere.
- Reviews live in `reviews` (SQLite, `init.ts:182`) merged with Gun.js and ATProto in `src/services/poi/reviewService.ts`; the `reviews` table has no media column and `src/models/review.ts` has no photo field. The review UI is on the orphaned `app/poi/*` surfaces being revived by `restore-first-run-surfaces`.
- Place photos are sourced on-device by scraping the place's own website (`websitePhotosService.ts`, OpenGraph/`<img>`, 1 h in-memory), with `tripadvisorService.ts` also present; the owner decision retains this on-device scrape as the primary place-media source. `poiEnricher.ts` already builds Wikimedia Commons URLs from Wikidata (`commonsThumbUrl`, `fetchWikidataLogo`) for brand logos — the pattern to layer in as an optional supplement.
- MapKit enrichment (`poiEnricher.ts`) and website photos are in-memory only; nothing persists place details. `menuUrl` is parsed (`POIInfoCard.tsx:194`) but never rendered.
- `placeListStore.ts` is a local Zustand store persisted to MMKV; `PlaceList.isPrivate` is always `true` (`createList(..., isPrivate = true)`) and the "Shared" label is dead. There is no export and no collaboration.
- Sharing is plain text via `Share.share` (`POIInfoCard.tsx:581`). `app.json` declares only the `polaris-maps` custom scheme — no associated domains.
- No voice search in `FloatingSearchPanel`; no pagination (limits 20–30).

Constraints carried forward: TypeScript strict; no hand-editing generated native projects (config plugins only); Jest 29; P2P crypto uses `@noble/curves` Schnorr signatures and encrypted transports per the constitution; all user-facing features need integration tests, public functions unit tests, P2P boundaries contract tests, and storage-sensitive paths benchmarks.

## Goals / Non-Goals

**Goals:**

- Let users narrow and reorder the staged search results without weakening the progressive-emission guarantees.
- Surface reviews, ratings, photos, and menus where users already look (`POIInfoCard`, result rows).
- Keep on-device website photo scraping as the primary place-media source, supplementing it with openly licensed providers (Wikimedia/Wikidata, Panoramax) and attribution, without removing the scraper.
- Make the last-viewed place usable offline with an honest freshness signal.
- Share a place by link, export a list, and collaborate on a list over P2P — private by default.

**Non-Goals:**

- No server-side media proxy, reverse geocoder, or hosted list backend.
- No Android App Links in this change (universal links are iOS-only here; scheme fallback everywhere).
- No full CRDT library (Yjs/Automerge/Yjs-style) — Gun's merge semantics plus explicit tombstones are sufficient.
- No redesign of the ranking formula itself (owned by `improve-place-search`).
- No moderation ML; reporting and opt-in publication only.

## Decisions

### 1. Filters and sort as a view layer over the staged pipeline

Add `src/services/search/resultFilter.ts` and `resultSort.ts`. A `SearchViewState` (`filters`, `sort`) is applied inside `usePlaceSearch` to each staged emission, after `assembleResults` scoring and before the UI list. Hard filters (`openNow`, `minRating`, `maxPrice`, `maxDistanceKm`, `categories`) remove rows; sort replaces only the comparator used for ordering (default relevance). `% match` continues to reflect the ranker score, so filtering never rewrites score truthfulness.

Composition with NL intent: the parser's `wantsOpenNow` / `wantsQuality` / `wantsCheap` set _default_ filter values when the user has not explicitly touched a filter this session; explicit user filters always win. Effective constraints are the intersection of user filters and NL intent (they can only narrow, never widen). Applying a category filter also feeds `deriveQueryContext` so source gating in `improve-place-search` can still skip recall sources coherently.

Interaction with staging: filters/sorts are pure functions over the accumulated, stably keyed result set, so each stage emission applies them consistently and existing keys are never reordered except by the chosen sort. Changing a filter re-applies locally (no network); changing a category filter that alters source recall may trigger a refetch through the existing `usePlaceSearch` session. Re-sorts remain throttled to animation-frame cadence (as in `improve-place-search`).

- Alternative: push filters into SQL/source queries — rejected for this change: the pipeline has multiple heterogeneous sources and in-memory merging; applying filters at the view layer is uniform and keeps latency low. Local SQL pushdown can follow if benchmarks demand it.
- Alternative: treat filters as soft score boosts — rejected: "open now" and price are user expectations of exclusion, not preference.

### 2. Pagination as a client-side cursor over accumulated results

Stages already accumulate a bounded set (limits 20–30 today). Pagination raises the cap and exposes `loadMore()` that advances a cursor over the accumulated ranked array; new stage emissions rebuild ordering but keep canonical keys stable, and `loadMore` de-duplicates by key. Pages are small (default 20) and `usePlaceSearch` keeps only the accumulated results plus cursor, bounding memory. A network-bound page source (e.g. Photon `limit` growth) is out of scope until benchmarks show local accumulation is insufficient.

- Alternative: server/source offset pagination — rejected: no consistent cross-source offsets exist.

### 3. Place media: retain website scraping, layer open providers on top

On-device website photo scraping (`websitePhotosService.ts`, OpenGraph/`<img>` from the place's own website) remains the primary place-media source; `tripadvisorService.ts` is left as-is. New `src/services/poi/placeMediaService.ts` exposes `getPlaceMedia(poi, { lat, lng })` returning normalized `PlaceMediaItem[]`: `{ id, thumbUrl, fullUrl, width, height, license, licenseUrl, author, source, sourceUrl, attributionHtml }`. It layers supplementary open providers over the scraped results, tried in order and merged/de-duplicated by a content key:

1. **Wikimedia Commons (supplementary)** — resolve a Wikidata QID from `wikidata` / `brand:wikidata` / `operator:wikidata` tags, then `wbgetentities` (P18/P154) plus `geosearch` on the POI coordinates; build URLs with the existing `commonsThumbUrl` helper. Brand logos are the primary useful Commons result; Commons is not relied on for general place photos.
2. **Panoramax (supplementary)** — STAC search around the coordinates; 360° street-level imagery, CC-BY-SA, with required attribution.
3. **Mapillary** — only if a configured token exists and imagery license permits; treated as optional and disabled by default.

Scraper output is the primary tier; open providers add context (logos, street-level) without displacing it. Every provider response is cached with its license/attribution metadata; the UI renders attribution and a license link wherever open-source media is shown, and the offline cache stores attribution alongside URLs. `websitePhotosService.ts` and `tripadvisorService.ts` are retained in coordination with `broaden-traffic-and-media-sources`, which also retains the scraper; `poiEnricher` keeps its Wikidata logo path (already a Commons URL).

- Alternative: replace website scraping with Wikimedia Commons — rejected per owner decision: Commons is not an acceptable substitute for place photos, so the scraper stays primary and open sources are purely supplementary.
- Alternative: bundle imagery in region packs — deferred; Panoramax/Commons are queried and only metadata + thumbnails are cached.

### 4. Review photos: schema, local storage, P2P replication, moderation

Model: extend `Review` with `media?: ReviewMedia[]` where `ReviewMedia = { id, reviewId, contentHash, thumbHash, mime, width, height, status, createdAt }`. Schema: new `review_media` table (one row per photo; FK to `reviews.id`) rather than a JSON column, so status/moderation and hashes are queryable; `init.ts` migration adds the table idempotently.

Storage pipeline:

- On attach, downscale to a bounded longest edge (e.g. 1600 px) plus a thumbnail, strip EXIF/GPS via the image library, and write to the app documents directory.
- Publish is opt-in. When published, the bytes are content-addressed (`contentHash`) and replicated over the existing Hypercore/Hyperdrive path; Gun holds the review record + media metadata; ATProto reviews carry media references only if the PDS/blob path is available (open question). Anonymous reviews keep local-only photos unless the user shares the list/place over P2P.
- Display reads local files first, then the replicated cache; failures fall back to a placeholder, never a broken image.

Moderation: `status` transitions `local → published | reported | hidden`. A client-side report action records the hash and hides it immediately for the reporter; hidden/reported media is not re-published. No server-side moderation exists, so the guarantee is user-controlled visibility plus report-and-hide, not central takedown.

- Alternative: single `media` JSON column on `reviews` — rejected: no per-photo status/reporting, harder P2P reconciliation.
- Alternative: upload to a CDN — rejected: violates the no-corporate-cloud model.

### 5. Offline place details: snapshot cache plus optional region-pack embed

New `place_detail_cache` table keyed by `poi_uuid`: serialized snapshot of the merged `EnrichedPoiData` + `ParsedPoi`-relevant fields (hours, phone, address, website, menuUrl), media metadata (URLs + attribution, not bytes), a reviews snapshot, `cachedAt`, and `sourceVersion`. `placeDetailCache.ts` provides `getPlaceDetail(uuid)`, `putPlaceDetail(...)`, `evictPlaceDetail(uuid)`, with an LRU bound (e.g. 500 entries) in SQLite. The read path prefers live network data; on failure it serves the snapshot.

Staleness is explicit: the card shows "Last updated …" from `cachedAt` and an offline indicator when the snapshot is being served, consistent with the constitution's "offline states MUST be visually distinguishable". Region packs optionally embed a `region_place_details` payload during generation/import; when present it seeds/refreshes the cache without overriding fresher live data (compare `sourceVersion`/`cachedAt`).

- Alternative: rely on OS-level HTTP cache — rejected: does not cover merged MapKit/reviews/media metadata and cannot express freshness.
- Alternative: cache raw media bytes — deferred to avoid unbounded storage; metadata only until size budgets are measured.

### 6. Collaborative lists: Gun CRDT semantics with explicit tombstones

`listSyncService.ts` mirrors a shared list into a Gun namespace keyed by `listId`:

- List metadata (name, emoji, `isPrivate`, membership) is last-write-wins with a Lamport-style `clock` and `updatedAt`; ties break by `authorPubkey` for determinism.
- Places are stored as a set keyed by a stable `placeKey` (canonical poi uuid, else name+coordinate hash). Each entry carries `updatedAt` + `authorPubkey`; removal writes a **tombstone** (`deleted: true`, `deletedAt`) rather than `null`, so a concurrent add on another device cannot resurrect an entry silently and merges are deterministic.
- Concurrent edits to the same key resolve LWW by `(clock, authorPubkey, updatedAt)`; the local store reconciles by applying a pure `mergeList(local, remote)` function, which is unit-tested for convergence with shuffled/tied inputs.

Privacy and membership: lists stay `isPrivate: true` until the owner explicitly enables sharing. Sharing creates a signed invite (owner keypair) carrying the `listId` and a symmetric room key; only peers that can decrypt the Gun room see entries. The owner can revoke by rotating the room key (re-share), and unshared lists are never written to Gun. All P2P messages are signed by the author pubkey and encrypted in transit per the constitution.

- Alternative: Automerge/Yjs operation logs — rejected: extra dependency and persistence complexity for a small list set; Gun's CRDT plus tombstones and explicit tie-breakers is sufficient and contract-testable.
- Alternative: Hypercore append-only log per list — kept as the replication channel for media/attachments if Gun payload size becomes a problem; not required for text place entries.

### 7. Universal links: iOS-only with scheme fallback

Add a `plugins/withUniversalLinks.ts` config plugin that writes the `Associated Domains` entitlement (`applinks:polarismaps.com`) and the `app.json` plugin entry; the matching `apple-app-site-association` is served from the existing `polarismaps.com` host (out-of-repo infra task). Links have the shape `https://polarismaps.com/p/<poiUuid>` (falling back to coordinates/name for places without a uuid). Routing uses Expo Router deep-link handling to open the place detail/`POIInfoCard`. Because only the app is in scope here, Android App Links (`intentFilters`) are explicitly deferred; the `polaris-maps://place/...` custom scheme is the cross-platform fallback. `shareService.ts` produces the universal link and passes it to `Share.share`, replacing the plain-text message.

- Alternative: ship Android App Links now — rejected: needs `.well-known/assetlinks.json` and fingerprint management; separate scope.

### 8. Voice search in the floating panel

Reuse the speech recognition already used by `SearchBar` in a small `useVoiceSearch` hook; `FloatingSearchPanel` renders a mic button while the search input is focused and idle, fills the input with the transcript, and degrades to the keyboard when permission is denied or the recognizer is unavailable. Permission is requested just-in-time with an explanation (constitution). No new native module is introduced.

## Risks / Trade-offs

- [Filters fight staged re-ranking and rows jump] → filters/sorts are pure functions on stable keys, re-sorts throttled to one per frame, and changing a filter re-applies the accumulated set before any refetch.
- [Category filter changes recall but not sources] → feed the category into `deriveQueryContext`/gating so source selection stays coherent; sparse-source eval fixtures from `improve-place-search` are extended with filtered variants.
- [Media providers are unreliable or sparse] → the retained website scraper stays primary, open providers are supplementary with ordered fallbacks, cached metadata, attribution rendered for any open-source media, and a deliberate empty state; Mapillary is off unless licensed/configured.
- [Review photo abuse or unbounded storage] → EXIF stripping, size/edge caps, per-review photo limits, LRU eviction, report-and-hide status, opt-in publication, and private-by-default lists.
- [CRDT tombstones grow and revoke is imperfect] → periodic compaction of settled tombstones, room-key rotation on revoke, and contract tests asserting merge convergence and non-resurrection.
- [Universal links need domain + entitlement control] → scheme fallback keeps sharing functional without the AASA file; iOS-only scope is explicit.
- [Offline snapshots go stale and mislead] → always show `cachedAt` + offline indicator, refresh on view when online, never silently replace fresher live data.
- [Pagination re-sorts across page boundaries] → dedupe `loadMore()` by canonical key and recompute the cursor from the current ranked order; UI keeps the visible anchor row stable.

## Migration Plan

1. **View layer (no schema change)**: filter/sort services, rich rows, pagination, voice search. Reversible code-only; default behaviour (no filters, relevance sort) matches today.
2. **Media providers**: add `placeMediaService` layering the optional open providers over the retained `websitePhotosService`/`tripadvisorService`, then surface the merged media in `POIInfoCard`/rows in coordination with `broaden-traffic-and-media-sources`. Reversible by disabling the supplementary providers and falling back to the scraper alone.
3. **Reviews/photos**: add `review_media` migration (idempotent additive table), model fields, upload/display, then P2P replication behind an opt-in flag. Reversible; orphan table drops cleanly.
4. **Offline details**: additive `place_detail_cache` table + read-path fallback; region-pack embed is opt-in and versioned. Reversible.
5. **Sharing/lists**: `shareService` + universal-link plugin (iOS), export, then `listSyncService` behind an explicit "Share list" toggle. Rollback disables the toggle and leaves local lists intact; published Gun data is deleted on disable.

Rollback: steps 1–2 are code-only; steps 3–4 are additive tables and can remain unused; step 5 is feature-flagged, and revoking a shared list rotates the room key and removes the Gun namespace.

## Open Questions

- Does the ATProto PDS allow blob uploads for review photos in this app's scope, or are ATProto reviews text-only with photos local/P2P?
- Is a Mapillary token available and are its imagery licenses acceptable, or should Mapillary be omitted?
- Does Panoramax have adequate coverage in target regions, and should it be ranked above Commons for street-level context?
- Menu rendering: open the external URL in the system browser, or embed in a webview (menu is often a webpage or PDF)? Does `broaden-traffic-and-media-sources` already mandate removing embeds?
- Should helpful votes be local-only or replicated over P2P with the same identity model as reviews?
- Region-pack schema: bump the pack version to carry `region_place_details`, or ship offline details as a cache-only feature first?
- Android App Links: schedule now or after iOS universal links prove out the server-side AASA/assetlinks setup?
