# Map Rendering

MapLibre-based map with custom dark style, traffic overlays, POI badges, transit lines, and layer management.

## Overview

The map layer is built on MapLibre React Native with OpenFreeMap vector tiles and a custom Apple Maps–inspired dark style. Key features:

1. **Vector tile rendering** — MapLibre GL with offline tile support via a native tile server module
2. **Traffic overlay** — color-coded GeoJSON line layers for congestion (green → yellow → orange → red → dark-red)
3. **POI layer** — `MarkerView`-based pill badges with icon circle + label, category-colored backgrounds, spatial filtering for density control
4. **Transit layer** — always-mounted GeoJSON layers for route lines and stops with visibility toggling (no GPU re-upload on toggle, empty GeoJSON singletons for stable initial state)
5. **Navigation mode** — heading-up camera, route polyline rendering, position tracking
6. **Layer control** — traffic, satellite, transit, and POI layers toggled via the map store

## Key Components

| File                    | Description                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `MapView.tsx`           | Core map component — viewport management, POI fetching (3-phase strategy), deduplication, zoom tracking, layer composition.         |
| `TrafficOverlay.tsx`    | GeoJSON congestion visualization with 5-level color coding based on speed/freeflow ratio.                                           |
| `TrafficRouteLayer.tsx` | Route-specific traffic overlay for the active navigation route.                                                                     |
| `POILayer.tsx`          | POI pill badge rendering — MarkerView per filtered POI, PoiBadge with icon + label, spatial filtering via `filterPoisForDisplay()`. |
| `TransitLayer.tsx`      | Transit route lines and stop markers — always-mounted, visibility toggled via style property.                                       |

## POI Rendering Pipeline

```
Viewport change (zoom ≥ 14)
    ↓
3-phase fetch:
  Phase 1: Local SQLite (instant)
  Phase 2: Overpass + online Overture (parallel, skip if ≥20 local)
  Phase 3: Nominatim fallback
    ↓
Deduplication (30m spatial grid, O(n))
    ↓
poiSpatialFilter.ts:
  - Web Mercator pixel projection
  - Category-diverse round-robin interleaving
  - Greedy pixel-exclusion with PlacementGrid
  - Zoom-adaptive caps (80–300 POIs)
    ↓
POILayer.tsx → MarkerView per POI → PoiBadge (pill)
```

## Related Files

- [`src/services/map/tileService.ts`](../../services/map/tileService.ts) — Local tile server management and style URL generation
- [`src/constants/darkMapStyle.ts`](../../constants/darkMapStyle.ts) — Custom Apple Maps–inspired dark style JSON
- [`src/constants/theme.ts`](../../constants/theme.ts) — Theme colors
- [`src/stores/mapStore.ts`](../../stores/mapStore.ts) — Viewport, layer toggles, camera control
- [`src/utils/poiSpatialFilter.ts`](../../utils/poiSpatialFilter.ts) — Zoom-adaptive density filtering
- [`src/utils/poiCategories.ts`](../../utils/poiCategories.ts) — Icon/color mappings for POI badges
