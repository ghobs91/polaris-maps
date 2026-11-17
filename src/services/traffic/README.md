# Traffic & ETA

Real-time traffic flow overlay with multi-source fusion, P2P probe collection, crowd-reported incidents, dynamic ETA adjustment, and smart rerouting.

## Overview

The traffic system prefers crowd-sourced speed probes from Polaris Maps peers (Hyperswarm) and free open traffic feeds, falling back to an optional TomTom cold-start bridge only when neither resolves a cell and a TomTom key is configured. Probes are aggregated in a 5-minute rolling window, merged with external data using haversine proximity matching (~30m threshold), and visualized as color-coded congestion overlays on the map. Probe contribution is consent-gated (traffic telemetry permission) and foreground-only. The coverage source (P2P, open feed, cold-start, on-device, stale, or no-data) is surfaced in the UI, together with a per-source cell breakdown in developer mode.

Provenance is kept strict: the weekly condition index is the **on-device flow history** and only ever receives probe-derived observations (own probes, P2P aggregates, peer condition answers). Upstream batches (open feeds, TomTom) answer requests from a bounded, 15-minute in-memory seed cache instead — they are never blended into the weekly profiles, and a cached answer is still labelled `cold-start`/`open-feed`, never `on-device`.

Flow the device has already seen for the current weekday + hour is answered from **saved flow** (`trafficSavedFlowStore`) for up to a month, ranked above the mesh, the free feeds **and** the paid bridge — so a repeat request in the same hour block costs no provider call. See "Saved flow" below for the granularity and age rules.

During active navigation, the ETA is continuously adjusted using geohash6-indexed traffic segments matched to route geometry. When a traffic-aware candidate route is at least two minutes faster than the active route's remaining time, the system surfaces a dismissible in-navigation suggestion instead of rerouting silently; the user accepts or dismisses it, and a two-minute anti-thrash cooldown limits repeat prompts.

Crowd-reported incidents (accident, road closure, hazard, construction, police, other) are Schnorr-signed and shared over the same P2P transports, then rendered on the map and announced ahead during navigation.

## Architecture

```
probeCollectionCoordinator.ts → probeCollector.ts ──→ topicManager.ts (geohash4 topics)
    ↓                                             ↓
hyperswarmBridge.ts ←─────────→ backend/traffic-swarm.mjs (Bare worklet)
    ↓                                  ↓
nostrFallback.ts ←──────────→ Nostr relays (probes kind 20100, incidents kind 20101)
nostrProfileExchange.ts ←──→ Nostr relays (stored weekly + holiday traffic profiles, kind 30110)
nostrRelayDirectory.ts (health-probes and ranks the relay pool)
    ↓
trafficAggregator.ts (5min rolling window)
    ↓
trafficCascade.ts (6 tiers: local fresh → local history (incl. holiday rows) → saved flow for this weekday+hour → P2P swarm + Nostr profiles → open feeds → TomTom)
    ↓ (tiers 1–3 write into the index; upstream answers are cached by trafficSeedCache and saved per weekday+hour in trafficSavedFlowStore)
trafficHistorySqlite.ts (weekly EMA profiles + separate holiday table, probe-sample provenance per row)
trafficSeedCache.ts (bounded 15-min in-memory cache for open-feed / TomTom answers)
trafficSavedFlowStore.ts (SQLite, weekday × hour buckets, ≤1 month, upstream flow + granularity)
    ↓
trafficMerger.ts (+ TomTom + peer probes)
    ↓
trafficFlowService.ts → trafficStore (Zustand)
    ↓
routeTrafficService.ts → etaCalculator.ts → navigationStore
    ↓
rerouteService.ts (traffic-aware faster-route suggestion, 2 min cooldown)

incidentReportService → incidentExchangeService ──→ hyperswarmBridge / nostrFallback
    ↓
trafficStore.incidents → IncidentLayer / IncidentAheadBanner
```

## Files

| File                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trafficFlowService.ts`         | Top-level orchestrator — resolves traffic through the cascade, merges with P2P probes, pushes to Zustand store on debounced refresh interval. Exports `initTrafficP2P`/`disposeTrafficP2P`/`suspendTrafficP2P`/`resumeTrafficP2P`.                                                                                                                                                                                                                                                                  |
| `tomtomFetcher.ts`              | TomTom Traffic Flow API v4 client — fetches speed/freeflow data for a bounding box, normalizes to `NormalizedTrafficSegment`.                                                                                                                                                                                                                                                                                                                                                                       |
| `trafficHolidayCalendar.ts`     | Pure major-holiday calendar (US federal-style set + eves) driving the holiday flag on time buckets. Deliberately excludes floating regional/religious observances — a wrong "holiday" flag splits a cell's data across keys.                                                                                                                                                                                                                                                                        |
| `openTrafficFeed.ts`            | Free open-feed adapters (511 / DATEX II / NDW): fetches a bbox, normalizes to `NormalizedTrafficSegment[]`, and fails closed to no data. Configured via `EXPO_PUBLIC_OPEN_TRAFFIC_FEEDS`.                                                                                                                                                                                                                                                                                                           |
| `trafficCoverage.ts`            | Pure mapping from a cascade resolve source to an explicit coverage status (P2P, open-feed, cold-start, on-device, stale, no-data), plus the one-line per-source breakdown used by the developer-mode badge and settings.                                                                                                                                                                                                                                                                            |
| `trafficSeedCache.ts`           | Bounded in-memory cache (geohash5 cell → segments, 15-minute TTL, 5-minute negative TTL) for upstream bootstrap data. Makes repeated refreshes reuse an open-feed/TomTom answer without writing licensed content into the weekly probe index, and stops no-data cells from being re-queried on every refresh.                                                                                                                                                                                       |
| `trafficSavedFlowStore.ts`      | Saved upstream flow, keyed by weekday × 1-hour block: the rows that make a repeat request free for up to a month. Records each observation's granularity (`segment` vs `tile`), keeps the provider's own observation time as its age, and stays local — never republished, never counted as probe samples.                                                                                                                                                                                          |
| `trafficSavedFlowSqlite.ts`     | SQLite backend (`saved_flow` table in `traffic-aged.db`): PK `(cell, day_of_week, hour, kind, segment_id)`, bucket index for cheap coverage lookups, corrupt coordinate blobs dropped instead of failing the cascade, retention/cap enforced with row counts returned for diagnostics.                                                                                                                                                                                                              |
| `trafficSavedFlowIndex.ts`      | Singleton + wiring: `recordSavedFlow` (fire-and-forget, bucket = now), `readSavedFlow` / `readSavedFlowCoverage` (never throw into the cascade), `hasSavedFlowForRoute` (skips a paid route-ETA preview when the device already covers the route), and the request→bucket mapping.                                                                                                                                                                                                                  |
| `savedFlowBucket.ts`            | Pure weekday × 1-hour bucket math (`savedFlowBucketFor`, `currentSavedFlowBucket`, half-hour → hour rounding) shared by the store, the cascade and the overlay gate.                                                                                                                                                                                                                                                                                                                                |
| `trafficMerger.ts`              | Merges P2P `AggregatedTrafficState` and external `NormalizedTrafficSegment[]` using haversine proximity matching (~30m). P2P data takes priority when both sources cover the same road.                                                                                                                                                                                                                                                                                                             |
| `trafficAggregator.ts`          | Ingests individual `TrafficProbe` messages into a 5-minute rolling window per road segment. Computes rolling average speed, congestion level, and sample count with validation guards.                                                                                                                                                                                                                                                                                                              |
| `probeCollectionCoordinator.ts` | Starts/stops probe collection based on consent (`trafficTelemetryEnabled` + completed privacy consent) and `AppState`; mirrors state into `trafficStore.isCollectingProbes`.                                                                                                                                                                                                                                                                                                                        |
| `probeCollector.ts`             | Collects the device's GPS location, encodes it as a `TrafficProbe` with a rotating probe ID, and publishes to Hyperswarm (primary) or Nostr (fallback) via `selectProbeTransport`.                                                                                                                                                                                                                                                                                                                  |
| `topicManager.ts`               | Manages Hyperswarm + Nostr topic subscriptions based on the user's viewport. Joins/leaves geohash4 cells (~39 km) as the map pans.                                                                                                                                                                                                                                                                                                                                                                  |
| `hyperswarmBridge.ts`           | React Native ↔ Bare worklet IPC bridge via `bare-rpc`. Sends join/leave/publish/incident commands and dispatches probe, aggregate, condition, tile, and incident callbacks.                                                                                                                                                                                                                                                                                                                         |
| `nostrFallback.ts`              | Nostr relay bridge (probes kind 20100, incidents kind 20101, `g` geohash tag, `expiration` tag). Activates when Hyperswarm peer count < 3. Full Schnorr verification on incoming events. Exports the shared NIP-01 sign/verify/send plumbing used by the profile exchange.                                                                                                                                                                                                                          |
| `nostrRelayDirectory.ts`        | Healthy public-relay directory: probes the candidate pool (connect → REQ → EOSE round-trip), ranks by latency, persists the last-known-good set in MMKV, and re-probes on a 6-hour cycle so the active list never goes stale. `EXPO_PUBLIC_NOSTR_RELAYS` prepends to the pool.                                                                                                                                                                                                                      |
| `publishBudget.ts`              | Hard per-device daily publish budget (probes and profiles counted separately, UTC rollover, persisted in MMKV) plus the scale-safe publish gate: ≥20 probe samples **and** observations spanning more than one day, so a single drive past a cell is never broadcast as a weekly pattern.                                                                                                                                                                                                           |
| `nostrProfileExchange.ts`       | "Polaris traffic flow segments": weekly traffic profiles (geohash5 × day-of-week × 30-min EMA aggregates) published as stored NIP-33 parameterized-replaceable events (kind 30110, `d` = `<cell>:<dow>:<hh>`, `g` = cell) and pulled from relays on demand. Publishing is gated to probe-dominant rows (`probeSamples` ≥ threshold) — licensed upstream seeds (TomTom) and open-feed rows are never republished. Full event verification + range checks on receive; entries dedupe by sample count. |
| `incidentWire.ts`               | Compact incident envelope (`t:'i'`) + canonical Schnorr signing payload; encode/decode/verify and the shared type labels/icons. Pure, shared by both transports.                                                                                                                                                                                                                                                                                                                                    |
| `incidentReportService.ts`      | Builds and Schnorr-signs a `TrafficIncident`. No transport imports, so it is unit-testable in isolation.                                                                                                                                                                                                                                                                                                                                                                                            |
| `incidentExchangeService.ts`    | Broadcasts reports (Hyperswarm → Nostr → offline queue), verifies/dedupes/rate-limits/persists received incidents, runs the TTL sweep, and populates `trafficStore.incidents`.                                                                                                                                                                                                                                                                                                                      |
| `congestionAhead.ts`            | Pure route-projected congestion evaluator used by the rerouter.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `incidentAhead.ts`              | Pure route-projected selector for incidents ahead on the active route (nav banner).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `reroutePolicy.ts`              | Pure reroute timing/improvement policy (check interval, full-compare interval, minimum saving, anti-thrash cooldown).                                                                                                                                                                                                                                                                                                                                                                               |
| `routeTrafficService.ts`        | Fetches traffic data specifically for the active navigation route's bounding box. Feeds segments into `etaCalculator`.                                                                                                                                                                                                                                                                                                                                                                              |
| `rerouteService.ts`             | Monitors the active route and, on congestion ahead or a periodic compare interval, scores traffic-aware candidate routes against the remaining time and surfaces a dismissible faster-route suggestion (never silently swaps the route).                                                                                                                                                                                                                                                            |
| `tomtomRouteEta.ts`             | Direct TomTom Route API ETA query for comparison/validation against the local traffic-adjusted calculation. Answers are cached for 5 minutes in memory and mirrored into MMKV so a relaunch cannot re-ask for the same route.                                                                                                                                                                                                                                                                       |
| `tilePixelSampler.ts`           | Decodes TomTom flow raster tiles and reads the flow colour at each point along a route. Reads the shared on-disk tile cache before calling the provider and writes fetched tiles back, so route sampling never pays twice for the same tile.                                                                                                                                                                                                                                                        |
| `trafficTileDiskCache.ts`       | The durable tile directory (`<cache>/traffic-tiles/z/x/y.png`): read/write helpers, freshness-checked reads, and base64 ↔ ArrayBuffer conversion shared by the raster overlay and the route sampler.                                                                                                                                                                                                                                                                                                |
| `rpcCommands.ts`                | Shared numeric RPC command ID constants used between the Bare worklet and React Native.                                                                                                                                                                                                                                                                                                                                                                                                             |

## Key Constants

| Constant                          | Value   | Description                                                                     |
| --------------------------------- | ------- | ------------------------------------------------------------------------------- |
| `PUBLISH_INTERVAL_MS`             | 5,000   | GPS probe collection frequency                                                  |
| `AGGREGATION_WINDOW_MS`           | 300,000 | 5-minute rolling window for probe averaging                                     |
| `MIN_PEER_THRESHOLD`              | 3       | Peer count below which Nostr fallback activates                                 |
| `CONGESTION_CHECK_INTERVAL_MS`    | 30,000  | How often the monitor ticks on the active route                                 |
| `FULL_ROUTE_COMPARE_INTERVAL_MS`  | 120,000 | Longest gap between candidate comparisons without congestion                    |
| `MIN_FASTER_ROUTE_SAVING_SECONDS` | 120     | Minimum saving before a faster route is suggested                               |
| `SUGGESTION_TIMEOUT_MS`           | 20,000  | Auto-dismiss a suggestion the driver hasn't acted on                            |
| `REROUTE_COOLDOWN_MS`             | 120,000 | Anti-thrash window after a dismissed/expired suggestion                         |
| `MERGE_PROXIMITY_M`               | 30      | Haversine distance for matching multi-source segments                           |
| `HISTORICAL_MAX_AGE_DAYS`         | 31      | Weekly-profile rows up to this age are served (and preferred over the provider) |
| `HOLIDAY_MAX_AGE_DAYS`            | 400     | Holiday-profile rows are served up to this age (recurs yearly)                  |

## Density controls

A launch spike concentrates peers in a few geohash4 cells, so the worklet bounds
the mesh instead of scaling linearly with the crowd:

- **Connections**: at most 64 total, 24 per geohash4 topic, split 32 client /
  32 server. Inbound connections beyond the cap are rejected; Hyperswarm's own
  `maxPeers`/`maxClientConnections` handle the outbound side.
- **Fanout**: messages go to a rotating subset rather than every peer — probes
  12, incidents 16, condition requests 8, tile requests 4 (tile responses are
  large, so they get the smallest sample).
- **Metered links**: cellular/hotspot connections run client-only and join the
  center cell only; Wi-Fi joins the full 3×3 neighbourhood.
- **Nostr fallback**: relays open only after an 8 s grace period if the swarm
  stays sparse, and probes are sampled to one publish per 30 s to protect the
  public relays.

## TomTom cold-start bridge

TomTom is optional and last in the cascade. The key is inlined at build time
(`EXPO_PUBLIC_TOMTOM_API_KEY`) and is therefore extractable; caching limits
normal spend but cannot make it confidential. Guard rails:

- only the geohash5 cells the earlier tiers missed are queried (one point per
  cell, capped at 25), not the whole viewport grid. The viewport request now
  derives its cells from the sample points it will actually draw, so no cell
  is permanently left out of the capped query and re-asked on every refresh;
- answers (`cold-start` or `open-feed`) are held by `trafficSeedCache` for 15
  minutes per cell, and cells TomTom had no data for are negative-cached for 5
  minutes — repeated refreshes inside either window make no request. Free open
  feeds opt out of negative caching so a transient feed outage does not hand
  their cells to the paid bridge;
- flow raster tiles resolve disk → P2P → TomTom, with a 15-minute TTL and a
  2,000-tile cap. The disk cache (`trafficTileDiskCache`) is the single durable
  copy: the route sampler reads it before it ever calls the provider, and
  writes back whatever it fetches, so the same z/x/y PNG is never downloaded
  twice — not by the overlay and the sampler in one session, and not again
  after a relaunch inside the freshness window;
- route ETA answers (`calculateRoute`) are cached for 5 minutes in memory and
  mirrored into MMKV, so reopening the app and re-requesting the same route
  inside that window costs no request either;
- a per-session budget of 400 requests stops runaway loops;
- HTTP 403/429 opens a 30-minute breaker; repeated 5xx/network failures open a
  10-minute breaker (both logged to diagnostics);
- the signed `tomtomBridge` remote flag disables the bridge without a release.

## Saved flow (why a repeat request is free)

If you asked for traffic on a road at 3:00pm and ask again at 3:25pm the same
day, the second request must not reach TomTom. Every upstream answer is written
to `trafficSavedFlowStore` under the **weekday + 1-hour block** it was observed
in, and a later request in that same block is answered from those rows.

- **Ranked above the paid bridge.** `saved-flow` sits after local fresh / local
  history and before the mesh, the open feeds and TomTom, so a saved block
  short-circuits every provider call. The label names the most authoritative
  tier that answered; `summarizeTrafficBreakdown` also prints
  `requests N` — the count of provider requests the resolution actually issued,
  which is the only honest way to show `tomtom 14 · requests 0`.
- **One month, one rule.** A saved block answers for up to
  `SAVED_FLOW_MAX_AGE_DAYS` (31) days, the same window as the weekly profile.
  Separate 15-minute tile/seed TTLs still exist for _rendering_ freshness, but
  they no longer decide whether the provider is called.
- **Granularity is respected.** Rows record `SavedFlowKind`: `segment` (road
  segment with speed + free-flow) or `tile` (a point sample with a ratio only).
  A road-segment request is never answered with tile samples; tile samples
  answer ratio-level requests (route colouring, cell coverage).
- **Honest age.** The row's age is the provider observation time, never the
  write time, so re-saving a replay cannot make old data look current.
- **Local only.** Saved upstream rows are never published through
  Nostr/Hyperdrive and never counted as probe samples — licensed upstream
  content stays on the device.
- **The overlay obeys the same rule.** `seedTrafficTilesForViewport` skips the
  TomTom seed for tiles whose area already has saved flow for the current block
  (at zooms where a tile is no larger than a geohash5 cell), so the map cannot
  quietly re-buy tiles on its 15-minute clock behind a saved resolution.
- **Route ETA previews too.** The post-routing preview goes through
  `fetchRouteTrafficEtaIfUnsaved`, which skips the Calculate Route call when
  `hasSavedFlowForRoute` finds the route mostly covered; `useTrafficEta` keeps
  the 10%-coverage rule for the in-navigation ETA (`prefersRouteApiEta`).

## Related Files

- [`backend/traffic-swarm.mjs`](../../backend/traffic-swarm.mjs) — Bare worklet managing Hyperswarm connections, probe/tile/condition exchange, and the incident channel
- [`src/utils/etaCalculator.ts`](../utils/etaCalculator.ts) — Geohash6-indexed route-to-traffic segment matching for dynamic ETA
- [`src/utils/geohash.ts`](../utils/geohash.ts) — Geohash encode/decode/neighbors for spatial indexing
- [`src/stores/trafficStore.ts`](../stores/trafficStore.ts) — Zustand store for traffic segments, peer counts, traffic mode, and incidents
- [`src/components/map/IncidentLayer.tsx`](../../src/components/map/IncidentLayer.tsx) — Map markers for accepted incidents
- [`src/components/navigation/IncidentAheadBanner.tsx`](../../src/components/navigation/IncidentAheadBanner.tsx) — In-navigation incident warnings
- [`src/components/navigation/FasterRouteBanner.tsx`](../../src/components/navigation/FasterRouteBanner.tsx) — In-navigation faster-route suggestion (phone and CarPlay companion)
- [`src/hooks/useTrafficEta.ts`](../hooks/useTrafficEta.ts) — Periodic traffic-adjusted ETA refresh during navigation
