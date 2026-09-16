## Context

Polaris Maps is designed as a peer-to-peer (DePIN) mapping app: every device contributes anonymous speed probes and seeded map data over an encrypted P2P mesh. Despite that framing, the shipped default path still leans on commercial and non-open sources. Traffic has TomTom touch points — `tomtomFetcher.ts` (Flow Segment API, sampled in a grid), `trafficTileService.ts` (TomTom raster flow tiles seeded behind the P2P tile cache) and `tilePixelSampler.ts` (decodes those TomTom raster tiles to synthesize route segments), plus `tomtomRouteEta.ts` called from `useTrafficEta.ts` when local traffic coverage is sparse; `TrafficOverlay.tsx` falls back to a TomTom raster URL template when the local tile server is unavailable. HERE exists as unwired dead code (`hereFetcher.ts`, `hereApiKey`, `HERE_FLOW_BASE_URL`) that the traffic README and map legend still describe as merged. POI place media is sourced on-device from a place's own website (OpenGraph/`<img>` scraping in `websitePhotosService.ts`) and from a hosted MapKit JS `PlaceDetail` embed backed by the paid Apple Maps Server API and a MapKit JS token. The satellite basemap renders non-open-licensed Esri World Imagery.

The owner decisions are authoritative. Traffic MUST become P2P + free open feeds (US DOT 511 / DATEX II / NL NDW) FIRST. TomTom is retained as a documented, lower-priority, optional, time-boxed cold-start bridge so traffic works before the P2P network is dense; it is never a hard requirement and degrades gracefully. On-device website photo scraping is retained as the primary place-media source; Wikimedia Commons is not an acceptable replacement for place photos. Android is out of scope; iOS ships.

This change is the policy and source-replacement counterpart to `activate-p2p-core`, which builds the P2P probe/tile network that must eventually carry traffic on its own.

## Goals / Non-Goals

**Goals:**

- Guarantee the app builds and runs without requiring any paid or metered API key.
- Make P2P probes and peer-shared traffic tiles the primary traffic source, bootstrap coverage with optional free open feeds, and retain TomTom only as an optional, config-gated, lowest-priority, time-boxed cold-start bridge with a documented exit criterion (P2P density + feed coverage).
- Replace non-open imagery (Esri World Imagery) with free/open sources (Sentinel-2 cloudless, NAIP) and required attribution.
- Retain on-device website photo scraping as the primary place-media source, remove the paid MapKit JS embed and Apple Maps Server API, and keep native MapKit enrichment optional on iOS.
- Make degraded coverage explicit and user-visible everywhere a source can be missing.
- Delete retired paid web services (MapKit JS embed, Apple Maps Server API) and HERE dead code entirely (not flag-disabled), removing orphaned constants, env vars, docs, and tests.

**Non-Goals:**

- Android support (out of scope; iOS ships).
- Removing TomTom in this change — it stays as a tracked cold-start bridge with a retirement exit criterion.
- Replacing website photo scraping with Wikimedia Commons or another third-party media provider.
- Requiring free street imagery (Panoramax); it may be added later.
- Building a new place-media carousel/UX — that belongs to `deepen-search-and-places`.
- Implementing the full P2P probe density improvements — that belongs to `activate-p2p-core`; this change consumes it.
- Self-hosting a traffic aggregator or raster tile pipeline in this change (allowed, but a follow-up).
- Preserving feature-for-feature parity with HERE/Esri. Coverage will change; that is accepted and surfaced.

## Decisions

### Decision 1: Traffic precedence — local cache → peers → open feed → TomTom cold-start → no-data

The existing `resolveTrafficConditions` cascade already implements ordered tiers (local fresh → local historical → P2P → TomTom). This change keeps the tiering mechanism, inserts an **optional open-feed tier** above TomTom, and demotes TomTom to an **optional, config-gated cold-start tier** below it, then a terminal **no-data** state. The cascade stops consulting a later tier for any cell an earlier tier resolved.

```
traffic tile request
  → local disk cache (fresh)
  → local historical index
  → P2P peers (probes + peer-shared tiles)
  → open feed (511 / DATEX II / NDW)     [only if configured & covers viewport]
  → TomTom cold-start bridge              [only if configured; lowest priority]
  → no-data (explicit UI coverage state)
```

**Rationale:** P2P stays authoritative, free feeds bootstrap coverage, and TomTom keeps traffic usable during the cold-start window without being required. The change is mostly source substitution and policy, which minimizes rewrite risk.

**Alternative considered:** Remove TomTom immediately. Rejected per owner decision — traffic must work before the P2P network is dense; removing it now trades a policy win for a broken cold-start experience.

### Decision 2: Open feeds are adapters, not a hard dependency; TomTom is a cold-start adapter

Government/open traffic feeds are regionally fragmented and heterogeneous (US DOT 511 vendors differ by state, DATEX II differs by publisher, NL NDW has its own schema). The design uses a small normalized adapter interface — fetch a bounding box, emit `NormalizedTrafficSegment[]` — with one adapter per feed. Feeds are optional: absence of a feed for a region is normal, not an error. Free-keyed feeds (e.g. a state 511 key) are permitted because they are government/open and do not bill after a quota. The TomTom cold-start bridge is modeled as the lowest-priority adapter, gated by its own config key, and is skippable without error.

**Rationale:** A pluggable adapter keeps regional churn out of the cascade and lets coverage grow without touching core logic. It also lets the app ship with no feeds and no TomTom key and still function.

**Alternative considered:** One global commercial-like aggregator. Rejected — most aggregators are paid or impose quota billing.

### Decision 3: Traffic coverage is a first-class UI state

The traffic store already tracks `lastResolveSource` and traffic mode. Extend that into an explicit coverage status (P2P, open-feed, cold-start, stale, no-data) and render it in the traffic legend/overlay. When no tier resolves the viewport, show a no-data state rather than an empty or stale overlay.

**Rationale:** The constitution (UX Principle III) mandates that degraded/offline states be visually distinguishable and never silent. Distinguishing cold-start bootstrap traffic from P2P and open-feed traffic makes the migration legible.

**Alternative considered:** Silent fallback to stale data. Rejected — it masks coverage gaps and violates the UX principle.

### Decision 4: Satellite imagery via Sentinel-2 cloudless + NAIP, with attribution

Replace the Esri `World_Imagery` raster source with free/open raster sources: the EOx **Sentinel-2 cloudless** mosaic for global coverage and **USGS NAIP** for high-resolution US coverage (NAIP is public domain / US government open data). Keep the OpenFreeMap vector label overlay. Source attribution is carried on the MapLibre source and surfaced in the map attribution control.

**Trade-off:** Sentinel-2 cloudless is ~10 m/pixel global; Esri World Imagery aggregates sub-meter commercial imagery in many areas. Sentinel-2 will look coarser at high zoom. NAIP (~0.6–1 m, US) recovers detail where available.

**Rationale:** These are the established free/open alternatives already adjacent to the project's Overture/Geofabrik/GeoNames stack, and licensing is compatible with shipping.

**Alternative considered:** Keep Esri because it is "freely available for non-commercial use". Rejected — the license is not open and does not meet the owner constraint for a shipping app.

### Decision 5: Place media keeps on-device website scraping; the paid MapKit JS embed is removed

Retain the on-device website scraper (`src/services/poi/websitePhotosService.ts`) and its carousel (`WebsitePhotosCarousel.tsx`) as the primary place-media source, extracting OpenGraph and `<img>` photos from a place's own website with an explicit empty state when nothing is found. Remove the paid MapKit JS `PlaceDetail` embed (portal token, Apple Developer membership, MapKit JS quota, hosted Netlify page) and the paid Apple Maps Server API client (`mapkitFetcher.ts`) plus the `EXPO_PUBLIC_APPLE_MAPKIT_TOKEN` server-JWT plumbing. Keep the **native on-device Apple MapKit module** (`src/native/mapkit/`, `poiEnricher.ts`) as optional iOS enrichment — it is free on-device and degrades gracefully.

**Rationale:** Website scraping is owner-approved and already works on-device; native MapKit is free and additive. Removing the web APIs eliminates both the paid dependency and the hosted-broker surface.

**Alternative considered:** Replace website scraping with Wikimedia Commons. Rejected per owner decision — Commons is not an acceptable substitute for place photos.

**Alternative considered:** Build the full new place-media carousel now. Rejected — deferred to `deepen-search-and-places` to keep this change surgical.

### Decision 6: TomTom cold-start bridge is tracked and time-boxed

The TomTom bridge is not permanent. It ships behind a config gate (absent by default is fine), is consumed only as the lowest-priority traffic tier, and is governed by a documented exit criterion: retire it once P2P probe/tile density and open-feed coverage make it redundant. That threshold is tracked with `activate-p2p-core` and reviewed using the coverage state, which explicitly labels cold-start-sourced traffic.

**Rationale:** The owner wants P2P + free feeds to win without breaking traffic during bootstrap; an explicit exit criterion prevents the bridge from becoming a silent permanent dependency.

**Alternative considered:** Keep TomTom indefinitely as a hidden fallback. Rejected — it would quietly contradict the P2P-first target state.

### Decision 7: Delete retired paid web services, don't disable

Every retired paid web service and dead commercial path is deleted: the MapKit JS embed URL builder, the embed component, the hosted page, the embed token constant, the Apple Maps Server API client, the token script, the HERE fetcher, their constants/env vars, and their tests. No `if (paidEnabled)` branches remain. TomTom is the sole deliberate exception, and it is explicitly config-gated and tracked.

**Rationale:** The constitution's Code Quality principle ("Dead code... MUST NOT exist... Remove rather than comment out") requires deletion, and it prevents accidental re-enablement of retired endpoints.

## Migration Plan

Phased so each step leaves the app buildable, and so coverage changes are communicated as they happen. Each phase is a separate atomic commit/PR per the constitution.

1. **Policy + config groundwork.** Add the data-source-policy spec, remove HERE and retired MapKit web-service env vars/constants from `config.ts`, `env.d.ts`, and `.env.example` (keep the TomTom key as the documented cold-start bridge), and update the README architecture diagram/tech-stack so docs describe reality. Verify: `pnpm typecheck` passes with no HERE/retired-embed constants referenced.
2. **Traffic sources.** Delete `hereFetcher.ts`; add the open-feed tier to the cascade; keep TomTom as the lowest-priority config-gated tier (retain `useTrafficEta.ts` fallback and the `TrafficOverlay.tsx` cold-start raster path); add the coverage UI state. Verify: with no feeds and no TomTom key, traffic renders P2P data and an explicit no-data state elsewhere; HERE is gone.
3. **Open traffic feed adapters.** Add the normalized adapter interface and the first feed(s) (e.g. NL NDW, a US 511/DATEX II source), wired above the cold-start tier. Verify: feed only queried for unresolved cells; a region without a feed degrades cleanly.
4. **Open imagery.** Replace `satelliteStyle.ts` with Sentinel-2 cloudless/NAIP sources and attribution; verify attribution renders and no `arcgisonline.com` source remains.
5. **Paid MapKit web services + place media.** Remove the MapKit JS embed and Apple Maps Server API paths and the hosted page; retain the website-photo scraper and native MapKit enrichment; update the POI README. Verify: place card shows scraped media or an explicit empty state, and no paid web request occurs.
6. **Cleanup + docs + tests.** Delete orphaned modules/tests, update service READMEs, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and relevant Jest suites.

**Rollback strategy:** Retired paid web services are deleted rather than flagged, so rollback is by `git revert` of the phase commits (the phases are ordered so each reverts independently). The design deliberately keeps the tiered cascade, the store shape, and the TomTom cold-start tier stable, so reverting any phase restores the previous behavior without data-model changes. Track coverage via the coverage state so a revert can be triggered on user-visible evidence rather than guesswork.

## Risks / Trade-offs

- **Cold-start bridge must be retired when P2P/feed coverage suffices.** TomTom remains a commercial dependency until P2P density and open-feed coverage can replace it; if the exit criterion is never applied, the bridge becomes permanent. → Mitigation: track the exit criterion with `activate-p2p-core`, label cold-start traffic distinctly in the coverage UI, and schedule a periodic retirement review against measured P2P/feed coverage.
- **Regional fragmentation of open feeds.** 511/DATEX II/NDW differ by publisher; some regions have no feed at all. → Mitigation: per-feed adapters, feature-detect coverage, no hard dependency; the no-data state covers gaps and the cold-start bridge can fill in until retirement.
- **Sentinel-2 resolution vs Esri.** ~10 m global imagery is visibly coarser than Esri at high zoom. → Mitigation: NAIP for high-res US coverage, keep vector labels for legibility, avoid over-promising detail at max zoom, and document the resolution difference.
- **Attribution/licensing obligations.** Sentinel-2 cloudless (CC BY-SA / EOx terms) and NAIP (public domain). → Mitigation: encode required attribution on sources, surface it in the map attribution control and an About/licenses screen, and verify each source's terms before enabling.
- **Place media coverage is uneven.** The on-device website scrape yields nothing when a place has no resolvable website or no OpenGraph/`<img>` images. → Mitigation: explicit empty media state, keep native MapKit enrichment, defer the richer UX to `deepen-search-and-places`.
- **Feed URL / service instability.** Community and government endpoints move or rate-limit. → Mitigation: adapters fail closed to the no-data state, never surface raw errors, and URLs live in config for quick updates.
- **Hidden coupling to removed constants.** `TrafficOverlay.tsx`, `trafficTileService.ts`, and tests import HERE/MapKit constants directly. → Mitigation: deletion phase includes test updates and a repo-wide check for retired provider names.

## Open Questions

- What measurable P2P density and open-feed coverage threshold retires the TomTom cold-start bridge, and who reviews it?
- Which open traffic feeds ship first, and do we prioritize a single high-coverage feed (NL NDW) or a US 511/DATEX II adapter? Is a federated DATEX II aggregator viable without paid infrastructure?
- Does the open-feed tier persist observations into the local history index (as TomTom seeding did) to build long-term historical coverage, or remain read-only for the current request?
- NAIP is conterminous-US (with limited AK/HI coverage); what is the global high-zoom fallback — Sentinel-2 only, or another open source?
- Should the native MapKit enrichment remain default-on or become an opt-in setting now that web MapKit is gone?
- How do we measure and publish P2P traffic coverage so users can see the migration improving (ties to `activate-p2p-core`)?
