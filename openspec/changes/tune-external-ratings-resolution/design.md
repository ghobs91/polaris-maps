## Context

`headless-browse-policy` requires serialized, paced browsing of third-party provider pages
with silent give-up. The controller implemented that as one 8 s clock per WebView stage plus
a single 15 s deadline for the whole pass, and it fetched a listing only when the place
carried an explicit tag or a website link. For a place with neither, resolution had to go
search (WebView) → listing (WebView): two stages, both inside the shared deadline, with the
second provider queued behind the first through the single mounted WebView.

## Goals / Non-Goals

**Goals**

- Maximise the share of places that resolve a rating, especially those reachable only
  through a provider search.
- Keep the card's settle guarantee (rating or "no ratings yet") without a shared deadline
  that starves a queued provider.
- Keep every bounded-browse guarantee: one WebView, per-host pacing and cool-down, silent
  give-up, no circumvention.

**Non-Goals**

- Changing how a listing's rating is parsed, or the identity rules themselves.
- Adding a second concurrent WebView, a proxy, a non-mobile UA/fingerprint override, or any
  CAPTCHA handling.
- Persisting ratings, listing URLs, or misses beyond the existing session-scoped memory.

## Decisions

### Decision 1: Fetch before a second browse stage

Provider listing pages are server-rendered and expose JSON-LD `aggregateRating` (verified
against a live listing: `ratingValue` + `reviewCount`), so a listing URL in hand is worth a
plain fetch before it is worth a WebView. The search stage therefore hands its chosen
candidate to `fetchAndParseRating(..., { confirmIdentity: true })` and mounts the WebView
listing stage only if that fetch is challenged, empty, or times out. The fetch path already
went through the shared scheduler, so pacing is unchanged.

### Decision 2: Identity is re-confirmed for search-derived listings

The trusted paths (explicit tag, website link) imply provenance, so name matching is enough
there. A search hit does not, so `fetchAndParseRating` gained an opt-in `confirmIdentity`
that requires the listing's own address or `geo` to match the place — preserving the
existing guarantee that a sibling chain branch's rating is never shown.

### Decision 3: Per-provider budgets instead of one pass deadline

Stage clocks bound each WebView stage; a per-provider budget bounds the whole pipeline and
is armed only when that provider first becomes active, so a queued provider does not spend
its budget waiting. Because every phase is now bounded — discovery fetch (4 s internal),
plain-fetch phase (`FETCH_PHASE_TIMEOUT_MS`), and each browse stage (`STAGE_TIMEOUT_MS`) —
the pass always settles without needing a shared deadline. The budget also covers the one
case a stage clock cannot: a fetch waiting on a host cool-down.

### Decision 4: Remember verdicts, retry failures

`fail(id, kind)` distinguishes `'verdict'` (remembered for the session: challenge, identity
mismatch, no rating data) from `'retry'` (not remembered: stage timeout, budget, WebView
error, empty search). An empty search page is deliberately retryable — it is a JS app and
may simply not have hydrated — while a detected challenge still cools the host down, which
is what bounds repeat cost.

### Decision 5: Collector pacing fits the stage clock

`COLLECTOR_MAX_ATTEMPTS = 15` at `COLLECTOR_RETRY_INTERVAL_MS = 500` puts the last attempt
at 7.0 s inside the 8 s stage, leaving ~1 s for the post to reach React. Previously
`20 × 500 ms = 10 s` could never complete, so a slow page was cut off by the stage clock and
its challenge classification was lost. A unit test asserts the invariant.

## Risks / Trade-offs

- **Two stages are still possible** when the plain fetch is blocked (challenged listing);
  that path is now bounded by the per-provider budget rather than the pass deadline.
- **A provider that never yields a verdict is retried on every card open** (up to one
  search stage each time). The 10-minute miss record still applies to real verdicts, and
  challenges cool the host down, so repeat cost stays bounded.
- **A stalled task holds the scheduler's serialized tail** until `fetchPageHtml` aborts at
  8 s; the phase bound keeps the provider itself from hanging.
- **iOS-only verification is still outstanding**: the win assumes the hydrated provider
  search page yields candidate links. If it does not, the `[externalRatings]` log shows
  `search results 0` and discovery needs a different route.

## Migration Plan

1. Ship the controller and service changes (no schema, no config, no data migration).
2. Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the ratings suites.
3. On-device: open a place with no tag and no website (e.g. an OSM restaurant) with Metro
   attached and read the `[externalRatings]` trace to confirm search → fetch resolution.

## Open Questions

- Should a resolved listing URL be cached per place for the session so repeat opens skip the
  search stage entirely? Deferred; it is a pure latency win, not a correctness one.
