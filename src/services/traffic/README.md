# Traffic & ETA

Real-time traffic flow overlay with multi-source fusion, P2P probe collection, crowd-reported incidents, dynamic ETA adjustment, and smart rerouting.

## Overview

The traffic system prefers crowd-sourced speed probes from Polaris Maps peers (Hyperswarm) and free open traffic feeds, falling back to an optional TomTom cold-start bridge only when neither resolves a cell and a TomTom key is configured. Probes are aggregated in a 5-minute rolling window, merged with external data using haversine proximity matching (~30m threshold), and visualized as color-coded congestion overlays on the map. Probe contribution is consent-gated (traffic telemetry permission) and foreground-only. The coverage source (P2P, open feed, cold-start, on-device, stale, or no-data) is surfaced in the UI.

During active navigation, the ETA is continuously adjusted using geohash6-indexed traffic segments matched to route geometry. When a traffic-aware candidate route is at least two minutes faster than the active route's remaining time, the system surfaces a dismissible in-navigation suggestion instead of rerouting silently; the user accepts or dismisses it, and a two-minute anti-thrash cooldown limits repeat prompts.

Crowd-reported incidents (accident, road closure, hazard, construction, police, other) are Schnorr-signed and shared over the same P2P transports, then rendered on the map and announced ahead during navigation.

## Architecture

```
probeCollectionCoordinator.ts → probeCollector.ts ──→ topicManager.ts (geohash4 topics)
    ↓                                             ↓
hyperswarmBridge.ts ←─────────→ backend/traffic-swarm.mjs (Bare worklet)
    ↓                                  ↓
nostrFallback.ts ←──────────→ Nostr relays (probes kind 20100, incidents kind 20101)
    ↓
trafficAggregator.ts (5min rolling window)
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

| File                            | Description                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trafficFlowService.ts`         | Top-level orchestrator — fetches TomTom data, merges with P2P probes, pushes to Zustand store on debounced refresh interval. Exports `initTrafficP2P`/`disposeTrafficP2P`/`suspendTrafficP2P`/`resumeTrafficP2P`.                        |
| `tomtomFetcher.ts`              | TomTom Traffic Flow API v4 client — fetches speed/freeflow data for a bounding box, normalizes to `NormalizedTrafficSegment`.                                                                                                            |
| `openTrafficFeed.ts`            | Free open-feed adapters (511 / DATEX II / NDW): fetches a bbox, normalizes to `NormalizedTrafficSegment[]`, and fails closed to no data. Configured via `EXPO_PUBLIC_OPEN_TRAFFIC_FEEDS`.                                                |
| `trafficCoverage.ts`            | Pure mapping from a cascade resolve source to an explicit coverage status (P2P, open-feed, cold-start, on-device, stale, no-data).                                                                                                       |
| `trafficMerger.ts`              | Merges P2P `AggregatedTrafficState` and external `NormalizedTrafficSegment[]` using haversine proximity matching (~30m). P2P data takes priority when both sources cover the same road.                                                  |
| `trafficAggregator.ts`          | Ingests individual `TrafficProbe` messages into a 5-minute rolling window per road segment. Computes rolling average speed, congestion level, and sample count with validation guards.                                                   |
| `probeCollectionCoordinator.ts` | Starts/stops probe collection based on consent (`trafficTelemetryEnabled` + completed privacy consent) and `AppState`; mirrors state into `trafficStore.isCollectingProbes`.                                                             |
| `probeCollector.ts`             | Collects the device's GPS location, encodes it as a `TrafficProbe` with a rotating probe ID, and publishes to Hyperswarm (primary) or Nostr (fallback) via `selectProbeTransport`.                                                       |
| `topicManager.ts`               | Manages Hyperswarm + Nostr topic subscriptions based on the user's viewport. Joins/leaves geohash4 cells (~39 km) as the map pans.                                                                                                       |
| `hyperswarmBridge.ts`           | React Native ↔ Bare worklet IPC bridge via `bare-rpc`. Sends join/leave/publish/incident commands and dispatches probe, aggregate, condition, tile, and incident callbacks.                                                              |
| `nostrFallback.ts`              | Nostr relay bridge (probes kind 20100, incidents kind 20101, `g` geohash tag, `expiration` tag). Activates when Hyperswarm peer count < 3. Full Schnorr verification on incoming events.                                                 |
| `incidentWire.ts`               | Compact incident envelope (`t:'i'`) + canonical Schnorr signing payload; encode/decode/verify and the shared type labels/icons. Pure, shared by both transports.                                                                         |
| `incidentReportService.ts`      | Builds and Schnorr-signs a `TrafficIncident`. No transport imports, so it is unit-testable in isolation.                                                                                                                                 |
| `incidentExchangeService.ts`    | Broadcasts reports (Hyperswarm → Nostr → offline queue), verifies/dedupes/rate-limits/persists received incidents, runs the TTL sweep, and populates `trafficStore.incidents`.                                                           |
| `congestionAhead.ts`            | Pure route-projected congestion evaluator used by the rerouter.                                                                                                                                                                          |
| `incidentAhead.ts`              | Pure route-projected selector for incidents ahead on the active route (nav banner).                                                                                                                                                      |
| `reroutePolicy.ts`              | Pure reroute timing/improvement policy (check interval, full-compare interval, minimum saving, anti-thrash cooldown).                                                                                                                    |
| `routeTrafficService.ts`        | Fetches traffic data specifically for the active navigation route's bounding box. Feeds segments into `etaCalculator`.                                                                                                                   |
| `rerouteService.ts`             | Monitors the active route and, on congestion ahead or a periodic compare interval, scores traffic-aware candidate routes against the remaining time and surfaces a dismissible faster-route suggestion (never silently swaps the route). |
| `tomtomRouteEta.ts`             | Direct TomTom Route API ETA query for comparison/validation against the local traffic-adjusted calculation.                                                                                                                              |
| `rpcCommands.ts`                | Shared numeric RPC command ID constants used between the Bare worklet and React Native.                                                                                                                                                  |

## Key Constants

| Constant                          | Value   | Description                                                  |
| --------------------------------- | ------- | ------------------------------------------------------------ |
| `PUBLISH_INTERVAL_MS`             | 5,000   | GPS probe collection frequency                               |
| `AGGREGATION_WINDOW_MS`           | 300,000 | 5-minute rolling window for probe averaging                  |
| `MIN_PEER_THRESHOLD`              | 3       | Peer count below which Nostr fallback activates              |
| `CONGESTION_CHECK_INTERVAL_MS`    | 30,000  | How often the monitor ticks on the active route              |
| `FULL_ROUTE_COMPARE_INTERVAL_MS`  | 120,000 | Longest gap between candidate comparisons without congestion |
| `MIN_FASTER_ROUTE_SAVING_SECONDS` | 120     | Minimum saving before a faster route is suggested            |
| `SUGGESTION_TIMEOUT_MS`           | 20,000  | Auto-dismiss a suggestion the driver hasn't acted on         |
| `REROUTE_COOLDOWN_MS`             | 120,000 | Anti-thrash window after a dismissed/expired suggestion      |
| `MERGE_PROXIMITY_M`               | 30      | Haversine distance for matching multi-source segments        |

## Related Files

- [`backend/traffic-swarm.mjs`](../../backend/traffic-swarm.mjs) — Bare worklet managing Hyperswarm connections, probe/tile/condition exchange, and the incident channel
- [`src/utils/etaCalculator.ts`](../utils/etaCalculator.ts) — Geohash6-indexed route-to-traffic segment matching for dynamic ETA
- [`src/utils/geohash.ts`](../utils/geohash.ts) — Geohash encode/decode/neighbors for spatial indexing
- [`src/stores/trafficStore.ts`](../stores/trafficStore.ts) — Zustand store for traffic segments, peer counts, traffic mode, and incidents
- [`src/components/map/IncidentLayer.tsx`](../../src/components/map/IncidentLayer.tsx) — Map markers for accepted incidents
- [`src/components/navigation/IncidentAheadBanner.tsx`](../../src/components/navigation/IncidentAheadBanner.tsx) — In-navigation incident warnings
- [`src/components/navigation/FasterRouteBanner.tsx`](../../src/components/navigation/FasterRouteBanner.tsx) — In-navigation faster-route suggestion (phone and CarPlay companion)
- [`src/hooks/useTrafficEta.ts`](../hooks/useTrafficEta.ts) — Periodic traffic-adjusted ETA refresh during navigation
