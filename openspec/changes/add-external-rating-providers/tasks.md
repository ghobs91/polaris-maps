## 1. Provider core and TripAdvisor migration

- [x] 1.1 Create `src/services/poi/externalRatings/types.ts` — `ExternalRatingProviderId` (`'tripadvisor' | 'yelp'`), `ExternalRatingSummary` (provider, listingUrl, listingName, listingAddress, rating, reviewCount, observedAt), `RawExternalRating`
- [x] 1.2 Create `src/services/poi/externalRatings/provider.ts` — `ExternalRatingProvider` interface (id, allowedHosts, parseListingUrl, buildSearchUrl, parseRatingFromHtml, injectedJs, parseMessage, matchIdentity)
- [x] 1.3 Extract shared core into `src/services/poi/externalRatings/core.ts` — fetch-with-timeout, JSON-LD `aggregateRating` parsing, name normalization, `detectChallenge`, `validateExternalRating`
- [x] 1.4 Create `src/services/poi/externalRatings/tripadvisorProvider.ts` and move TripAdvisor-specific logic (host allowlist, `parseTripadvisorListingUrl`, injected JS, message parsing) behind the interface
- [x] 1.5 Reduce `src/services/poi/tripadvisorService.ts` to re-exports of the refactored core/provider so existing imports (`TRIPADVISOR_RATING_JS`, `extractRatingFromWebViewMessage`, `resolveRatingSource`, `validateExternalRating`, clear-cache) keep working
- [x] 1.6 Run `__tests__/unit/tripadvisorService.test.ts` and `__tests__/integration/TripadvisorRatingCard.test.tsx` — confirm green after the refactor

## 2. Address assembly and identity matching

- [x] 2.1 Create `src/services/poi/poiAddress.ts` — `assemblePoiAddress(tags, enrichedFormattedAddress?)` preferring `addr:*` tags with enriched fallback
- [x] 2.2 Add `normalizeAddress` (housenumber + street + city) and `matchIdentity(candidate, poi, { expectedName })` implementing name + (address OR geo ≤ ~50 m)
- [x] 2.3 Unit tests for address assembly (structured, enriched-only, neither) and identity matching (name+address, name+geo, chain-branch reject, name-mismatch reject)

## 3. Bounded browse policy

- [x] 3.1 Create `src/services/poi/externalRatings/antiBot.ts` — per-host request queue with single-flight, minimum interval + jitter, one active browse at a time
- [x] 3.2 Implement challenge/rate-limit handling — per-host cool-down, exponential backoff, `Retry-After`/429 honoring, silent give-up
- [x] 3.3 Unit tests for pacing (serialization, min interval + jitter), cool-down/backoff, and 429/`Retry-After` behavior
- [x] 3.4 Confirm the browse context uses native UA + non-incognito persistent cookies (`sharedCookiesEnabled`) and document the prohibited tier in code comments

## 4. Yelp provider

- [x] 4.1 Create `src/services/poi/externalRatings/yelpProvider.ts` — Yelp host allowlist, listing URL canonicalization, search URL builder
- [x] 4.2 Implement Yelp fetch-path parsing — prefer embedded `__NEXT_DATA__`/Apollo state; fall back to JSON-LD `aggregateRating`; detect challenges
- [x] 4.3 Implement `YELP_RATING_JS` injected script (ES5) reading JSON-LD + embedded state, posting `{ type: 'external-rating', provider: 'yelp', ... }` with `geo`
- [x] 4.4 Extend the TripAdvisor injected script with `geo` capture (keeping it ES5-compatible) and update `extractRatingFromWebViewMessage`
- [x] 4.5 Unit tests with saved Yelp fixtures — rating extraction (JSON-LD, embedded state, DOM fallback), challenge detection, malformed input

## 5. Resolution order and search stage

- [x] 5.1 Create `src/services/poi/externalRatings/index.ts` — provider registry + `resolveExternalRatings(poi, enriched?)` iterating providers independently
- [x] 5.2 Implement resolution order: explicit `polaris:<provider>` tag → website anchor discovery → provider search (last resort)
- [x] 5.3 Create `src/services/poi/externalRatings/search.ts` — parse candidate listings `{ url, name, address, geo }` from each provider's search page HTML
- [x] 5.4 Add the search stage to the controller: load search URL → parse candidates → select via `matchIdentity` → proceed to listing stage
- [x] 5.5 Unit tests for resolution order (tag beats link beats search) and search candidate parsing/scoring

## 6. UI

- [x] 6.1 Create `src/hooks/useExternalRatings.ts` — per-provider state machine (resolve → search → listing → rating) with time-boxed stages and independent failure
- [x] 6.2 Create `src/components/map/ExternalRatingsSection.tsx` — independent TripAdvisor and Yelp rows (provider, rating, exact count, observed time, source link); renders nothing per failed provider
- [x] 6.3 Mount `ExternalRatingsSection` in `src/components/map/POIInfoCard.tsx`, replacing the `TripadvisorRatingCard` mount
- [x] 6.4 Keep the hidden WebView 0×0/`pointerEvents="none"` with a 20s timeout and abort-on-unmount, as today
- [x] 6.5 Update `__tests__/integration/TripadvisorRatingCard.test.tsx` into a two-provider, two-stage (search → listing) integration test simulating `onMessage`

## 7. Docs and verification

- [x] 7.1 Update `src/services/poi/README.md` with the provider registry, resolution order, and the bounded browse policy
- [x] 7.2 Update `src/components/map/README.md` for the new section
- [x] 7.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the relevant unit/integration suites; report actual results
- [ ] 7.4 Manual on-device check: open a place with an explicit tag, one with a website link, and one requiring search; verify each provider's row, attribution link, and silent degradation when challenged
- [x] 7.5 Confirm no rating data is written to any persistent store and no review text is parsed or displayed
