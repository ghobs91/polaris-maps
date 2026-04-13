# CarPlay Integration

CarPlay dashboard for navigation state, search, and maneuver display.

## Overview

The CarPlay manager bridges the app's navigation and search capabilities to the CarPlay interface:

1. **Navigation sync** — mirrors active route maneuvers, ETA, and step progress to CarPlay templates in real time
2. **Search forwarding** — CarPlay search queries are routed through the unified search pipeline (`src/services/search/unifiedSearch.ts`) and results displayed in CarPlay list templates
3. **Lifecycle management** — handles CarPlay connect/disconnect events and template state transitions

## Files

| File                | Description                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `carPlayManager.ts` | CarPlay integration manager. Syncs navigation state (maneuvers, ETA) to CarPlay templates, forwards search queries through the unified search pipeline, and handles connect/disconnect lifecycle. |

## Related Files

- [`src/services/search/unifiedSearch.ts`](../search/unifiedSearch.ts) — Search pipeline used for CarPlay queries
- [`src/stores/navigationStore.ts`](../../stores/navigationStore.ts) — Active route, maneuvers, ETA
- [`src/services/routing/routingService.ts`](../routing/routingService.ts) — Valhalla routing for CarPlay directions
