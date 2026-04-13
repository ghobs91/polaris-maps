# Navigation & Routing

Turn-by-turn navigation with Valhalla routing, GPS snap-to-route, off-route detection, traffic-aware rerouting, and park-and-ride suggestions.

## Overview

The routing service provides:

1. **Valhalla routing** — online route computation with maneuver-level turn instructions and precision-6 encoded polyline geometry
2. **Route snap** — GPS position snapped to nearest polyline point with bearing computation, remaining distance tracking, and off-route detection (50m threshold)
3. **Park-and-ride** — detects when the user is >20 min walk from a rail/subway station and suggests a combined drive + transit trip
4. **Route history** — persisted navigated routes in SQLite for recall and analysis

Traffic-aware ETA and automatic rerouting are handled by the [traffic service](../traffic/README.md).

## Files

| File                     | Description                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routingService.ts`      | Valhalla API client — computes routes with maneuver-level turn instructions, encoded polyline geometry, and time/distance summaries. Error responses are truncated and API keys redacted. |
| `parkAndRideService.ts`  | Determines if user is >20 min walk from a rail/subway station. Computes combined drive-to-station + transit trip as a park-and-ride suggestion.                                           |
| `routeHistoryService.ts` | SQLite CRUD for the `route_history` table — save, list, get, and delete navigated routes.                                                                                                 |

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
    rerouteService.ts → auto-reroute if ≥25% congestion delay
    ↓
NextTurnBanner + EtaDisplay + ManeuverList
```

## Related Files

- [`src/utils/routeSnap.ts`](../../utils/routeSnap.ts) — GPS-to-polyline snap, bearing, remaining distance, off-route detection (50m)
- [`src/utils/polyline.ts`](../../utils/polyline.ts) — Valhalla precision-6 encoded polyline decoder
- [`src/stores/navigationStore.ts`](../../stores/navigationStore.ts) — Active route, maneuvers, step index, ETA, rerouting state, route preview
- [`src/components/navigation/`](../../components/navigation/) — NextTurnBanner, EtaDisplay, ManeuverList, RoutePreview UI
- [`src/services/traffic/rerouteService.ts`](../traffic/rerouteService.ts) — Congestion-triggered automatic rerouting
- [`src/hooks/useTrafficEta.ts`](../../hooks/useTrafficEta.ts) — Periodic traffic-adjusted ETA during navigation
- [`app/(tabs)/navigation.tsx`](<../../../app/(tabs)/navigation.tsx>) — Navigation tab with GPS tracking, heading-up camera, keep-awake
