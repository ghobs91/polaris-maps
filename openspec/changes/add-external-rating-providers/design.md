## Context

Polaris Maps surfaces an external aggregate rating for a POI through an on-device
"headless browser" — a hidden `react-native-webview` (0×0, `opacity: 0`) that loads a
third-party listing and runs injected ES5 JS, which `postMessage`s a structured rating
back to TypeScript.

Current state (`src/services/poi/tripadvisorService.ts` + `.../TripadvisorRatingCard.tsx`):

1. Plain `fetch` of the listing HTML, parsing JSON-LD `aggregateRating`; hidden-WebView
   fallback for JS-rendered or fetch-blocked pages.
2. Direct listing references only, an exact host allowlist (`tripadvisor.com`,
   `www.tripadvisor.com`), and `detectChallenge` for Datadome/Akamai/PerimeterX/Cloudflare.
3. `validateExternalRating` enforces rating ∈ [0,5], an exact non-negative integer
   count, a listing name, and a loose `namesMatch` against the POI name.
4. Results are transient and device-local — never written to SQLite, Gun, ATProto, OSM,
   or search ranking — and no review text is stored.
5. Resolution is limited to an explicit `polaris:tripadvisor` tag or a TripAdvisor link
   discovered from the POI website's anchors (`discoverTripadvisorFromWebsiteHtml`).
   There is **no** search step, and **no Yelp support**.

The POI model carries enough address data to identify a listing: `OsmPoi.tags` includes
`addr:housenumber`, `addr:street`, `addr:city`, `addr:state`, `addr:postcode`,
`addr:country`, and MapKit enrichment can supply `formattedAddress`
(`poiEnricher.ts:86-89`). `poi.lat`/`poi.lng` are always present.

The in-flight `broaden-traffic-and-media-sources` change adds a `data-source-policy`
requiring core functionality without paid/metered APIs and forbidding new paid
providers; it explicitly retains TripAdvisor scraping. This design adds no API, key, or
paid service, so it is consistent with that policy.

## Goals / Non-Goals

**Goals:**

- Resolve and display validated aggregate ratings from **both** TripAdvisor and Yelp
  for a POI, using only the on-device headless browser (no APIs, no keys).
- Discover a listing by **name + address** when the POI has no explicit provider tag and
  its website does not link one.
- Guarantee identity: never show a rating for a different business, even a sibling
  branch of the same chain.
- Bound the on-device browse footprint so it behaves like a normal user: serialized,
  paced, backed off on challenge, and never a bulk harvester.
- Keep every rating transient and device-local; never fetch or display review **text**.
- Fail independently per provider; one provider's failure never blocks the place card.

**Non-Goals:**

- Review text extraction, review submission, or any user-generated content beyond the
  aggregate number + count.
- CAPTCHA solving, proxy/IP rotation, TLS/WebGL/canvas fingerprint spoofing, login/auth
  wall bypass, or any circumvention beyond the bounded tier in `headless-browse-policy`.
- Yelp/TripAdvisor APIs (Fusion, Content API) or any paid/metered dependency.
- Persisting ratings to SQLite/Gun/ATProto/OSM or feeding them into search ranking.
- Android parity (iOS ships; Android is out of scope, consistent with the repo).
- Replacing or extending the existing `polaris:tripadvisor` tag semantics.

## Decisions

### Decision 1: Provider registry over a shared core, not duplicated logic

Introduce `src/services/poi/externalRatings/` with a small `ExternalRatingProvider`
interface and two implementations. Each provider owns: `id`, allowed hosts,
`parseListingUrl`, `buildSearchUrl`, `parseRatingFromHtml`, `injectedJs`,
`parseMessage`, and `matchIdentity`. A shared core holds the code that is genuinely
common: fetch-with-timeout, JSON-LD `aggregateRating` parsing, name normalization,
challenge detection, validation, caching, and the browse scheduler.

`tripadvisorService.ts` is refactored onto this core and keeps thin re-exports
(`TRIPADVISOR_RATING_JS`, `extractRatingFromWebViewMessage`, `resolveRatingSource`,
`validateExternalRating`, clear-cache) so existing imports and tests keep working
during migration.

**Alternatives considered:** (a) copy `tripadvisorService` to `yelpService` —
rejected: duplicates the challenge/validation/caching logic in the ~3rd location,
violating the constitution's duplication rule and drifting the safety contract.
(b) One generic service keyed by a config object — rejected: search and DOM parsing are
genuinely provider-specific; an interface keeps each provider readable.

### Decision 2: Resolution order — explicit → website link → search (last resort)

For each provider, in order:

1. **Explicit tag** — `polaris:tripadvisor` (existing) or new `polaris:yelp`.
2. **Website `sameAs`/anchor link** — reuse `discoverTripadvisorFromWebsiteHtml`'s
   anchor scan for both hosts (many restaurant sites link both).
3. **Provider search** — only if 1 and 2 miss. Load the provider's own search URL built
   from the POI name + assembled address, parse candidate listings, and select the best
   identity match. This is the highest-risk network path and is attempted once.

**Rationale:** Direct listing loads are the lowest anti-bot risk and already work. Search
is where bot defense is strongest, so it is a fallback, not the default. It also keeps
the common case (a POI whose website links Yelp/TA) cheap.

### Decision 3: Address assembly and identity matching

New `poiAddress.ts` exports `assemblePoiAddress(tags, enrichedFormattedAddress?)` that
prefers structured OSM `addr:*` tags and falls back to the enriched formatted address.
Providers receive the POI `{ name, lat, lng, address }`.

A candidate listing is accepted only when **all** hold:

- `namesMatch(candidate.name, poi.name)` — reuse the existing loose matcher, and
- an address or proximity confirmation: normalized `housenumber + street` + city match,
  **or** JSON-LD `geo` within ~50 m of the POI coordinates.

**Rationale:** Name-only matching cross-links chain branches (the highest-severity
failure — a wrong rating is worse than no rating). Requiring a second signal makes
false positives rare. `geo` is preferred when present because it is unambiguous.

### Decision 4: Two-stage hidden-WebView flow, fresh WebView per stage

Injected JS runs once per document load, so the flow is modeled as sequential stages,
each with its own hidden WebView keyed by URL (matching the current card's lifecycle):

1. **Resolve** (JS/TS): choose explicit tag / website link, else proceed.
2. **Search stage** (only if needed): load provider search URL → injected JS posts
   `{ stage: 'search', candidates: [{ url, name, address, geo }] }` → pick the winner
   with Decision 3's matcher.
3. **Listing stage**: load the winning listing → injected JS posts
   `{ type: 'external-rating', provider, ldRating, ldCount, ldName, ldAddress, geo,
challenge }` (existing TripAdvisor script, extended with `geo`) → validate → display.

Each stage is time-boxed (as `WEBVIEW_TIMEOUT_MS` is today) and aborts silently.

**Alternative considered:** navigate the search WebView to the listing in place and
re-inject `injectedJavaScriptForMainFrameOnly={false}` on each load. Rejected: harder to
reason about, and a fresh mount per stage mirrors the existing, tested lifecycle.

### Decision 5: Fetch-first for TripAdvisor, WebView-primary for Yelp

TripAdvisor listing pages reliably expose JSON-LD `aggregateRating`, so the plain-fetch
path stays first. Yelp's rating is JS-rendered, so the WebView is the primary path for
Yelp; a cheap pre-parse of Yelp's embedded `__NEXT_DATA__`/Apollo state script is added
as a fetch-path optimization before falling back to the WebView.

### Decision 6: Bounded on-device browse policy (`headless-browse-policy`)

**Allowed (the reasonable tier):**

- Genuine, non-incognito WebView with the **native mobile user agent** (no spoofing —
  a desktop UA on iOS WebKit is itself anomalous) and a **persistent cookie store**
  (`sharedCookiesEnabled`) so Datadome/Cloudflare clearance cookies accumulate like a
  real browser.
- **One hidden WebView at a time**, single-flight per host, a minimum interval between
  requests to the same host (target 3–8 s) with random jitter.
- Load → settle → small incremental scroll → dwell before collecting, so lazy rating
  widgets render (also functionally required).
- On `detectChallenge`, set a per-host cool-down and exponential backoff, then give up
  silently. Honor `Retry-After`/429.
- Ratings fetched only on demand when a place card is opened; no background prefetch
  over the POI set.

**Prohibited (outside the tier):** CAPTCHA solving, proxy/IP rotation, TLS/JA3 or
canvas/WebGL fingerprint spoofing, forging `navigator.webdriver`/permissions, login or
auth-wall bypass, and bulk harvesting.

**Rationale:** A real device WebView passes most checks because IP, TLS, and browser
fingerprint are genuine; the residual failures are best handled by pacing and backing
off rather than by defeating the defense — which also keeps the app shippable and
consistent with the data-source policy.

### Decision 7: Transience and failure isolation

Ratings remain in an in-memory TTL cache and are never persisted. `ExternalRatingsSection`
renders each provider independently with attribution (provider name, rating, exact
count, observed time, source link); a provider that fails or is absent renders nothing.
No review text is requested, parsed, or stored.

### Decision 8 (addendum): Warm-session browsing, calibrated challenge classification, inline search-card ratings

Live probing changed the picture:

- **Yelp's DataDome default mode is a JS interstitial that auto-resolves**, not a hard CAPTCHA. A warmed browser session fetched a real business page with complete JSON-LD (`rating 4.2`, `9,206 reviews`, name, address) after the interstitial cleared.
- **DataDome script tags appear inside valid content pages.** A marker match alone is therefore _not_ a challenge verdict; the old "markers → discard" rule threw away good data.
- **TripAdvisor `/Search` serves an interactive DataDome CAPTCHA** (`geo.captcha-delivery.com`) and stays out of scope per policy.

Changes that follow:

1. **Retriable collectors (`core.buildCollectorScript`).** Injected scripts no longer latch on the first empty read; they re-collect on an interval (5 attempts, 1–2.5 s apart) until data appears or attempts run out, so an interstitial is absorbed rather than fatal.
2. **Calibrated challenge classification (`pageIsChallenge`).** Markers are fatal only when nothing was extracted. The generated collectors fold this in-page (`challenge = markers && !hasData`).
3. **Inline search-card ratings.** A search candidate carrying rating + count _and_ a confirmation signal (address or `geo`) is validated and displayed without navigating to the listing — one request instead of two, avoiding the most-protected endpoint (Yelp biz pages). Name-only candidates still load the listing for identity confirmation, as before.
4. **Session persistence.** WebViews use `sharedCookiesEnabled` so DataDome clearance cookies survive provider switches within the app run; the single-active-WebView serialization in `ExternalRatingsSection` is unchanged.

**Decision 4 amendment:** the "fresh WebView per stage" model remains for controller simplicity, but stages may short-circuit (inline) and every stage's collector is retriable; cookie persistence across remounts is the session continuity mechanism.

### Decision 9: Combined aggregate and provider pills

When both providers return a rating, the card shows one combined aggregate rather
than two rows: the rating is the **review-count-weighted mean** and the count is
the **sum** of the exact counts (`combineExternalRatings` in `combine.ts`). A
single provider's combined values equal its own. Each contributing provider is
surfaced as a clickable pill that opens that provider's listing; a provider
without a rating shows no pill. This puts the number a user cares about up front
while keeping per-provider attribution (and the "no review text" boundary)
intact. Weighted mean is used because summing raw star ratings would let a
3-review source outweigh a 9,000-review source.

## Risks / Trade-offs

- **DOM churn breaks search parsing** (Yelp `data-testid`/`__NEXT_DATA__`, TripAdvisor
  `data-automation`) → Mitigation: prefer JSON-LD and structured embedded state over
  class names; keep all selectors isolated in the provider; unit-test parsers against
  saved fixtures; a failed parse degrades to "no rating," never an error.
- **Anti-bot challenges are intermittent, not constant** → Mitigation: challenge
  detection + cool-down + backoff + silent give-up (Decision 6); never retry in a loop;
  the UI simply omits that provider.
- **Wrong-business match** → Mitigation: Decision 3 requires name **and** address/geo;
  reject rather than guess.
- **Hidden WebView cost (CPU/memory/battery)** → Mitigation: one at a time, on demand,
  time-boxed, capped 0×0 view; no bulk prefetch. Watch the constitution's 300 MB
  memory ceiling in testing.
- **ToS / legal exposure rises with volume** → Mitigation: the bounded tier behaves like
  a single user browsing one listing at a time; only the factual aggregate number is
  taken, not copyrighted review text; results are transient. This is a deliberate policy
  choice recorded in `headless-browse-policy`.
- **Search path may be blocked outright** → Mitigation: search is a last-resort fallback
  after explicit tag and website link; when it fails, the existing direct-link path is
  unaffected.

## Migration Plan

1. Refactor `tripadvisorService` onto the shared core + provider interface; keep
   re-exports; existing unit/integration tests stay green.
2. Add `poiAddress.ts` + identity matcher with unit tests.
3. Add the browse scheduler (`antiBot.ts`) with pacing/cool-down unit tests.
4. Add the Yelp provider + fixtures.
5. Add the search stage to the controller and the routing order.
6. Replace `TripadvisorRatingCard` with `ExternalRatingsSection`; mount it in
   `POIInfoCard.tsx`.

**Rollback:** the new section can be reverted to `TripadvisorRatingCard` in one mount
change; provider modules are additive. No persistence schema changes, so there is no
data migration.

## Open Questions

- Exact, durable Yelp search-result selectors / `__NEXT_DATA__` shape — needs a live
  inspection and fixture capture before the parser is finalized.
- Does Yelp's address-based search reliably reach a results page without a challenge,
  or is name-only search sometimes required?
- Should the feature ship behind a user-visible toggle given the ToS sensitivity, or
  remain always-on with per-provider silent failure?
- What are acceptable on-device timing bounds for the two-stage flow (search + listing)
  so it never competes with map interaction?
