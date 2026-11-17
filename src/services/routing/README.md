# Navigation & Routing

Turn-by-turn navigation with Valhalla routing, GPS snap-to-route, off-route detection, traffic-aware rerouting, and park-and-ride suggestions.

## Overview

The routing service provides:

1. **Valhalla routing** — online route computation with maneuver-level turn instructions and precision-6 encoded polyline geometry
2. **Route snap** — GPS position snapped to nearest polyline point with bearing computation, remaining distance tracking, and off-route detection (50m threshold)
3. **Park-and-ride** — detects when the user is >20 min walk from a rail/subway station and suggests a combined drive + transit trip
4. **Route history** — persisted navigated routes in SQLite for recall and analysis

Traffic-aware ETA and automatic rerouting are handled by the [traffic service](../traffic/README.md).

## Routing tiers

Every route and reroute walks the same cascade and stops at the first tier that
answers. A tier that throws is absorbed, so one slow endpoint cannot end a
navigation session.

| Tier | Engine                                                   | Network  | Notes                                                                                                               |
| ---- | -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | On-device Valhalla (`valhalla-mobile`, iOS)              | none     | Primary. Uses the region graph downloaded with the pack; traffic speeds pushed in via `updateTrafficSpeeds`         |
| 2    | OSRM (`osrmClient.ts`)                                   | required | Used when no graph is loaded or Valhalla cannot answer. No `transit` profile, so that mode skips straight to tier 3 |
| 3a   | Apple MapKit `MKDirections`                              | required | iOS only, network-backed                                                                                            |
| 3b   | FOSSGIS public Valhalla (`valhalla1/2.openstreetmap.de`) | required | Last resort; richest manoeuvres of the two                                                                          |

The tier that produced the route on screen is exposed through
`getRoutingTierState()` / `useRoutingTier()` and surfaced by
`RoutingTierBadge` in developer mode (`settingsStore.devMode`). The state also
carries a `reason` — the per-tier failure clauses explaining why the tiers above
the winner were skipped — so a degraded route says _why_ instead of just
degrading.

## Deviation reroutes

A reroute after the driver leaves the route has two extra rules on top of the
cascade, because the on-device tiers cannot take a start bearing:

- **It must leave in the direction of travel.** `reroute(..., {
preferForwardDeparture: true })` is set for an off-route deviation. If the
  winning route's departure bearing (`departureBearingDeg`, over the first ~25 m
  of geometry) opposes the GPS course by more than 100°, the heading-aware tiers
  are re-asked and their answer wins — they carry the course as OSRM `bearings`
  / MapKit's reroute bearing. Offline, or when they also reverse, the original
  answer stands. A wrong-way correction must **not** set the flag: there the
  reversal is the correct answer.
- **It is only adopted when the car is on it.** `trackingService` snaps the
  latest live fix onto the answer with the GPS course; if the car is still
  beyond the 50 m off-route threshold of it, the trip keeps the route it has and
  stays in the deviation state (live GPS puck, banner up) on the same
  exponential backoff a failed request gets. Adopting such an answer snapped the
  puck back onto the road the driver had left, cleared the deviation, and
  re-triggered the identical reroute ~3 s later — an endless "reloads the same
  route" loop with the puck facing down a road the car was not on.

## Offline graph install and selection

Tier 1 can only answer when a Valhalla graph is on disk, so the two halves that
decide that are worth knowing about:

- **Install** (`routingGraphs.ts`, called from the region downloader). Targets
  are metro catalog entries whose box the pack covers by ≥50%, ranked by
  coverage and capped at 4 — not every entry whose box merely intersects it. A
  pack whose bounds span ≥180° of longitude (island nations across the date
  line) is skipped entirely, because its bbox intersects dozens of metros it
  holds no data for; and a pack much larger than a metro must also _name_ it,
  because a rectangle can enclose a foreign metro (the New York state pack's
  rectangle contains Toronto). Each graph is fetched from the release tag the
  _pack's own_ assets were stamped under, falling back to the catalog-wide tag,
  and records a `polaris-graph.json` sidecar with the bounds it was published
  under.
- **Selection** (`offlineRouting.ts`) picks the installed graph covering the most
  route points, ties to the smaller box, and prefers the sidecar bounds unioned
  with the compiled-in catalog box — the published catalog and the bundled one
  disagree (New York Metro ends at -73.2° vs -73.7°), and the narrower box
  silently excludes routes.
- **Diagnosis** (`routingGraphStatus.ts`) records why an install or selection
  produced nothing. The cascade appends that to the tier failure, so the badge
  reads e.g. `on-device Valhalla: no region graph loaded — no routing graph
installed — download a region pack to route offline`.

## Files

| File                    | Description                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routingService.ts`     | Valhalla API client and the routing cascade — on-device → OSRM → MapKit / FOSSGIS. Computes routes with maneuver-level turn instructions, encoded polyline geometry, and time/distance summaries. Error responses are truncated and API keys redacted. |
| `osrmClient.ts`         | Tier-2 OSRM client. Normalises OSRM steps into the app's `ValhallaRoute` shape (synthesized instructions, step-accurate shape indices, toll/ferry flags) so downstream consumers stay engine-agnostic.                                                 |
| `offlineRouting.ts`     | Tier-1 graph selection and load. Chooses the installed graph covering the most route points and initialises the native engine; records why nothing could be selected.                                                                                  |
| `routingGraphs.ts`      | Tier-1 graph store. Downloads metro graphs for a region pack (coverage-ranked, tag-aware, size-capped), writes a bounds sidecar per graph, lists installed graphs, prunes unused ones.                                                                 |
| `routingGraphStatus.ts` | Leaf module recording install and selection outcomes, and summarising them onto the routing tier badge as a one-line reason.                                                                                                                           |
| `hassleTurns.ts`        | Prefers route candidates whose turns are managed by a stop sign or traffic light, using Mapillary detections only where imagery coverage exists. Never trades more than 5 min / 25% for a calmer route.                                                |
| `parkAndRideService.ts` | Determines if user is >20 min walk from a rail/subway station. Computes combined drive-to-station + transit trip as a park-and-ride suggestion.                                                                                                        |

## Navigation Flow

```
User requests directions
    ↓
routingService.ts → Valhalla API
    ↓
Route + maneuvers → navigationStore
    ↓
Navigation tab activates
    ↓
GPS tracking loop:
    routeSnap.ts → snap to polyline, compute bearing
    ↓ off-route? (>50m)
    routingService.ts → reroute via Valhalla
    ↓
    useTrafficEta.ts → traffic-adjusted ETA (every 60s)
    ↓
    rerouteService.ts → auto-reroute when significant congestion is detected ahead
    ↓
NextTurnBanner + EtaDisplay
```

## Related Files

- [`src/utils/routeSnap.ts`](../../utils/routeSnap.ts) — GPS-to-polyline snap, bearing, remaining distance, off-route detection (50m)
- [`src/utils/polyline.ts`](../../utils/polyline.ts) — Valhalla precision-6 encoded polyline decoder
- [`src/stores/navigationStore.ts`](../../stores/navigationStore.ts) — Active route, maneuvers, step index, ETA, rerouting state, route preview
- [`src/components/navigation/`](../../components/navigation/) — NextTurnBanner, EtaDisplay
- [`src/services/traffic/rerouteService.ts`](../traffic/rerouteService.ts) — Congestion-triggered automatic rerouting
- [`src/hooks/useTrafficEta.ts`](../../hooks/useTrafficEta.ts) — Periodic traffic-adjusted ETA during navigation
- [`app/(tabs)/navigation.tsx`](<../../../app/(tabs)/navigation.tsx>) — Navigation tab with GPS tracking, heading-up camera, keep-awake
