# Traffic & ETA

Real-time traffic flow overlay with multi-source fusion, P2P probe collection, dynamic ETA adjustment, and smart rerouting.

## Overview

The traffic system combines commercial traffic data (TomTom, HERE) with crowd-sourced speed probes collected from Polaris Maps peers via Hyperswarm. Probes are aggregated in a 5-minute rolling window, merged with external data using haversine proximity matching (~30m threshold), and visualized as color-coded congestion overlays on the map.

During active navigation, the ETA is continuously adjusted using geohash6-indexed traffic segments matched to route geometry. If congestion adds ≥25% delay, the system triggers automatic rerouting through Valhalla with live traffic speeds as edge weights.

## Architecture

```
GPS Location
    ↓
probeCollector.ts  ──→  topicManager.ts (geohash4 topics)
    ↓                        ↓
hyperswarmBridge.ts ←──→ backend/traffic-swarm.mjs (Bare worklet)
    ↓                        ↓
nostrFallback.ts   ←──→ Nostr relays (kind 20100)
    ↓
trafficAggregator.ts (5min rolling window)
    ↓
trafficMerger.ts (+ TomTom + HERE)
    ↓
trafficFlowService.ts → trafficStore (Zustand)
    ↓
routeTrafficService.ts → etaCalculator.ts → navigationStore
    ↓
rerouteService.ts (≥25% delay → Valhalla reroute)
```

## Files

| File                     | Description                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trafficFlowService.ts`  | Top-level orchestrator — fetches TomTom data, merges with P2P probes, pushes to Zustand store on debounced refresh interval. Exports `initTrafficP2P`, `disposeTrafficP2P`, `suspendTrafficP2P`, `resumeTrafficP2P` lifecycle functions. |
| `tomtomFetcher.ts`       | TomTom Traffic Flow API v4 client — fetches speed/freeflow data for bounding box, normalizes to `NormalizedTrafficSegment`. Supports optional proxy URL.                                                                                 |
| `hereFetcher.ts`         | HERE Traffic Flow API v7 client — fetches flow items for bounding box, normalizes speed and jam factor to segments.                                                                                                                      |
| `trafficMerger.ts`       | Merges P2P `AggregatedTrafficState` and external `NormalizedTrafficSegment[]` using haversine proximity matching (~30m). P2P data takes priority when both sources cover the same road.                                                  |
| `trafficAggregator.ts`   | Ingests individual `TrafficProbe` messages into a 5-minute rolling window per road segment. Computes rolling average speed, congestion level, and sample count with validation guards.                                                   |
| `probeCollector.ts`      | Periodically collects the device's GPS location, encodes it as a `TrafficProbe` with a rotating probe ID, and publishes to Hyperswarm (primary) and Nostr (fallback).                                                                    |
| `topicManager.ts`        | Manages Hyperswarm + Nostr topic subscriptions based on the user's viewport. Joins/leaves geohash4 cells (~39 km) as the map pans.                                                                                                       |
| `hyperswarmBridge.ts`    | React Native ↔ Bare worklet IPC bridge via `bare-rpc`. Sends join/leave/publish commands and receives peer count + probe data callbacks.                                                                                                 |
| `nostrFallback.ts`       | Nostr relay bridge (kind 20100, `g` geohash tag, `expiration` tag). Activates when Hyperswarm peer count < 3. Full Schnorr signature verification on incoming events.                                                                    |
| `routeTrafficService.ts` | Fetches traffic data specifically for the active navigation route's bounding box. Feeds segments into `etaCalculator`.                                                                                                                   |
| `rerouteService.ts`      | Monitors active routes every 30s for ≥25% congestion slowdown. Triggers automatic Valhalla reroute with live traffic speeds as edge weights.                                                                                             |
| `tomtomRouteEta.ts`      | Direct TomTom Route API ETA query for comparison/validation against the local traffic-adjusted calculation.                                                                                                                              |
| `rpcCommands.ts`         | Shared numeric RPC command ID constants used between the Bare worklet and React Native.                                                                                                                                                  |
| `wakuBridge.ts`          | **Deprecated** — Waku v2 bridge placeholder. No files import from it.                                                                                                                                                                    |

## Key Constants

| Constant                    | Value   | Description                                           |
| --------------------------- | ------- | ----------------------------------------------------- |
| `PROBE_INTERVAL_MS`         | 10,000  | GPS probe collection frequency                        |
| `AGGREGATION_WINDOW_MS`     | 300,000 | 5-minute rolling window for probe averaging           |
| `MIN_PEER_THRESHOLD`        | 3       | Peer count below which Nostr fallback activates       |
| `REROUTE_CHECK_INTERVAL_MS` | 30,000  | How often to check for congestion on active route     |
| `REROUTE_DELAY_THRESHOLD`   | 0.25    | 25% slowdown triggers automatic reroute               |
| `MERGE_PROXIMITY_M`         | 30      | Haversine distance for matching multi-source segments |

## Related Files

- [`backend/traffic-swarm.mjs`](../../backend/traffic-swarm.mjs) — Bare worklet managing Hyperswarm connections, topic exchange, and protobuf probe messaging
- [`src/utils/etaCalculator.ts`](../utils/etaCalculator.ts) — Geohash6-indexed route-to-traffic segment matching for dynamic ETA
- [`src/utils/geohash.ts`](../utils/geohash.ts) — Geohash encode/decode/neighbors for spatial indexing
- [`src/stores/trafficStore.ts`](../stores/trafficStore.ts) — Zustand store for traffic segments, peer counts, traffic mode
- [`src/hooks/useTrafficEta.ts`](../hooks/useTrafficEta.ts) — Periodic traffic-adjusted ETA refresh during navigation
- [`src/hooks/useNavigationTrafficRefresh.ts`](../hooks/useNavigationTrafficRefresh.ts) — Route bounding-box traffic fetch on navigation start
