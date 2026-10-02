# Map Rendering

MapLibre-based map with custom dark style, traffic overlays, POI badges, transit lines, and layer management.

## Overview

The map layer is built on MapLibre React Native with OpenFreeMap vector tiles and a custom Apple Maps–inspired dark style. Key features:

1. **Vector tile rendering** — MapLibre GL with offline tile support via a native tile server module
2. **Traffic overlay** — color-coded GeoJSON line layers for congestion (green → yellow → orange → red → dark-red)
3. **POI layer** — `MarkerView`-based badges: a category-colored icon circle with a name pill tucked behind it to the right, spatial filtering for density control
4. **Transit layer** — always-mounted GeoJSON layers for route lines and stops with visibility toggling (no GPU re-upload on toggle, empty GeoJSON singletons for stable initial state)
5. **Navigation mode** — heading-up camera, route polyline + destination-flag rendering, position tracking (map-plane 3D nav puck with a soft outer glow, matching CarPlay). The basemap switches to a derived _navigation focus_ style (see `navFocusStyle.ts`) — context labels hidden, drivable roads drawn ~35% heavier and lifted in tone — the route ribbon widens to cover the carriageway (see `routeRibbon.ts`), and POI badges unmount, so the route is the only high-chroma object on screen.
6. **Layer control** — traffic, satellite, transit, and POI layers toggled via the map store

## Known limitation: 3D buildings at navigation zoom

OpenFreeMap declares `building` at **minzoom 13 / maxzoom 14**, and the tileset's own `maxzoom` is 14. Navigation runs at zoom 17, so buildings are overzoomed from a z14 tile — and z14 applies an area filter that drops small structures.

Measured on the live tileset: a 3×3 block of z14 tiles around Levittown, NY (≈15 × 15 km, covering Hempstead Tpke / Division Ave / Schoolhouse Rd) contains **19 building features in total**, all 4–11 m tall. The housing stock is simply not in the tiles. `render_height` / `render_min_height` are present in the schema, so the `building-3d` extrusion layer is correct — there is just almost nothing for it to extrude.

Style changes cannot fix this. Showing buildings at navigation zoom the way Google does needs a high-zoom building source (a second vector source, or a build with buildings at z15–16), which is a tile-infrastructure decision rather than a map-style one.

## Key Components

| File                    | Description                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MapView.tsx`           | Core map component — viewport management, POI fetching (3-phase strategy), deduplication, zoom tracking, layer composition.                                       |
| `TrafficOverlay.tsx`    | GeoJSON congestion visualization with 5-level color coding based on speed/freeflow ratio.                                                                         |
| `TrafficRouteLayer.tsx` | Route-specific traffic overlay for the active navigation route.                                                                                                   |
| `POILayer.tsx`          | POI badge rendering — MarkerView per filtered POI, PoiBadge with an icon circle anchoring a right-hand name pill, spatial filtering via `filterPoisForDisplay()`. |
| `TransitLayer.tsx`      | Transit route lines and stop markers — always-mounted, visibility toggled via style property.                                                                     |

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
  - Mid-zoom: category-diverse round-robin interleaving
  - Street-level: near-building clustering so adjacent storefronts can all render
  - Greedy pixel-exclusion with PlacementGrid
  - Zoom-adaptive caps (80–300 POIs)
    ↓
POILayer.tsx → MarkerView per POI → PoiBadge (pill)
```

## Related Files

- [`src/services/map/tileService.ts`](../../services/map/tileService.ts) — Local tile server management and style URL generation
- [`src/services/map/navFocusStyle.ts`](../../services/map/navFocusStyle.ts) — Derives the navigation-focus variant of a resolved style (hidden context labels, heavier and lighter carriageways, brighter dark-mode water)
- [`src/components/map/routeRibbon.ts`](../../components/map/routeRibbon.ts) — Route ribbon band widths, including the navigation widening that keeps the ribbon over its own carriageway
- [`src/constants/darkMapStyle.ts`](../../constants/darkMapStyle.ts) — Custom Apple Maps–inspired dark style JSON
- [`src/constants/theme.ts`](../../constants/theme.ts) — Theme colors
- [`src/stores/mapStore.ts`](../../stores/mapStore.ts) — Viewport, layer toggles, camera control
- [`src/utils/poiSpatialFilter.ts`](../../utils/poiSpatialFilter.ts) — Zoom-adaptive density filtering
- [`src/utils/poiCategories.ts`](../../utils/poiCategories.ts) — Icon/color mappings for POI badges
