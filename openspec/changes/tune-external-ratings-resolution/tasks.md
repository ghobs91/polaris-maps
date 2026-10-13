## 1. Fetch-first resolution

- [x] 1.1 Add `confirmIdentity` to `fetchAndParseRating` — require the listing's own address/`geo` to confirm the place, and never cache an unconfirmed search hit
- [x] 1.2 In the search stage, reject candidates outside the provider allowlist without loading them
- [x] 1.3 Resolve a search-selected listing by plain fetch first; mount the WebView listing stage only when the fetch is challenged, empty, or times out
- [x] 1.4 Only apply a fetch result when the provider is still resolving the same candidate (guards against a stale continuation)

## 2. Budgets

- [x] 2.1 Replace the shared `OVERALL_TIMEOUT_MS` with a per-provider `PROVIDER_BUDGET_MS`, armed when the provider first becomes active
- [x] 2.2 Add `FETCH_PHASE_TIMEOUT_MS` and bound every plain-fetch phase so a fetch-only pipeline settles without a stage clock
- [x] 2.3 Clear stage and budget clocks when the place changes, and clear the budget when a provider settles

## 3. Verdicts versus retries

- [x] 3.1 `fail(id, kind)` — remember only rendered verdicts (challenge, identity mismatch, no rating data) as session misses
- [x] 3.2 Keep stage timeouts, provider budgets, WebView errors, and empty search pages retryable
- [x] 3.3 Report a challenge detected on the search stage to the browse scheduler (cool-down)

## 4. Collector pacing

- [x] 4.1 Export `COLLECTOR_RETRY_INTERVAL_MS` / `COLLECTOR_MAX_ATTEMPTS` from `core` and use them in both providers
- [x] 4.2 Size the collector's last attempt comfortably inside the stage clock

## 5. Verification

- [x] 5.1 New `__tests__/unit/externalRatingsResolution.test.ts` — pacing invariant, provider scripts ship the shared pacing, identity confirmation on/off
- [x] 5.2 Extend `__tests__/integration/useExternalRatings.test.tsx` — fetch-first load, fetch fallback to the listing stage, per-provider settlement, fetch-phase bound, retryable-vs-verdict memoization
- [x] 5.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the full Jest suite
- [ ] 5.4 On-device: read the `[externalRatings]` trace for a place with no tag and no website and confirm search → fetch resolution (and that ratings appear)
