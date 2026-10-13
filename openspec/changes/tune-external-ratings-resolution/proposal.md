## Why

A place with no `polaris:<provider>` tag and no website — e.g. an OSM restaurant whose
only tags are `amenity` and `name` — can only be resolved through the provider **search**
stage, which was the one path that needed two sequential hidden-WebView stages. Against a
single 15 s pass deadline shared by both providers and an 8 s per-stage clock, that path
could not finish: TripAdvisor's search + listing alone can exceed the pass budget, Yelp was
queued behind TripAdvisor through the single WebView and starved, and the collectors
retried for 10 s against an 8 s stage clock, so their own verdict (including the challenge
classification) was never posted. Any failure — including a plain timeout — was then
remembered for 10 minutes, so one slow load made the place read "no ratings yet" on every
reopen.

## What Changes

- **Fetch-first for a search-derived listing**: once the search stage picks a candidate,
  try the plain fetch (which parses the listing's JSON-LD) before spending a second
  hidden-WebView stage on the same page; keep the WebView listing stage as the fallback
  when the fetch is challenged or empty. Identity is re-confirmed from the listing's own
  address/`geo`, so a sibling chain branch is still rejected.
- **Per-provider budgets** replace the shared pass deadline: each WebView stage keeps its
  own clock and each provider gets a whole-pipeline budget armed when it first becomes
  active, so a provider queued behind another still gets its full turn. Plain-fetch phases
  get their own bound, so a fetch-only pipeline settles even with no stage clock running.
- **Retryable failures versus remembered verdicts**: only a provider page that actually
  rendered and answered (challenge, identity mismatch, no rating data) is remembered as a
  miss; timeouts, budgets, network errors, and empty search pages stay retryable.
- **Collector pacing fits the stage clock**: `COLLECTOR_MAX_ATTEMPTS × COLLECTOR_RETRY_INTERVAL_MS`
  is held below the stage budget so the collector posts its verdict instead of being
  pre-empted, which also restores challenge detection on slow pages.
- **A search candidate that leaves the provider allowlist is rejected** instead of being
  mounted and left to time out.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `headless-browse-policy`: add requirements for bounded per-provider resolution (no
  provider starved by another; fetch before a second browse when the page allows it) and
  for the distinction between a remembered verdict and a retryable failure.

## Impact

- **Controller**: `src/hooks/useExternalRatings.ts` — `PROVIDER_BUDGET_MS`,
  `FETCH_PHASE_TIMEOUT_MS`, per-provider budget/verdict `fail(id, kind)`, fetch-first
  search resolution, challenge handling on the search stage.
- **Services**: `externalRatings/index.ts` (`fetchAndParseRating` gains
  `confirmIdentity`), `externalRatings/core.ts` (`COLLECTOR_RETRY_INTERVAL_MS`,
  `COLLECTOR_MAX_ATTEMPTS`), both providers use the shared pacing.
- **Tests**: new `__tests__/unit/externalRatingsResolution.test.ts` (pacing invariant,
  identity confirmation) and updated `__tests__/integration/useExternalRatings.test.tsx`
  (fetch-first, fetch fallback, per-provider settlement, fetch-phase bound,
  retryable-vs-verdict memoization).
- **Unchanged**: at most one hidden WebView at a time, per-host pacing and cool-down,
  no CAPTCHA solving, no proxy/IP rotation, no fingerprint spoofing.
