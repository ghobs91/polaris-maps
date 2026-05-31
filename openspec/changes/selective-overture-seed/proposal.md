## Why

The current auto-seed mechanism blindly submits random visible Overture POIs to OpenStreetMap every 10 seconds. This has caused duplicate submissions — POIs already present in OSM are being re-created because the system never checked for existing OSM entries before submitting. Additionally, the timer-based approach lacks intent: it seeds POIs the user may never interact with, cluttering OSM with potentially unverified data. Replacing this with a selective, on-demand approach ensures only POIs the user has explicitly viewed (and thus implicitly reviewed) are submitted, and each submission is gated by a real OSM existence check.

## What Changes

- **Remove** the periodic timer-based auto-seed system entirely (`useOsmAutoSeed` hook, exponential backoff, random POI selection, consent dialog, auto-seed indicator)
- **Add** on-demand auto-seed: when a user opens the detail view for an Overture-sourced POI, the system checks if that specific POI already exists in OSM (by name + proximity via Overpass API)
- If the POI is not already in OSM, it is automatically submitted in a single changeset — no user interaction required for the submission itself
- OSM auth and `poiContributionsEnabled` setting remain as pre-conditions; no zoom gate or timer
- Each submission creates its own changeset (one POI per changeset), simplifying changeset lifecycle management
- The existing manual "Add to OpenStreetMap" button flow remains unchanged as a fallback

## Capabilities

### New Capabilities

- `selective-seed`: A POI-sourced from Overture is automatically submitted to OSM when the user opens its detail view, gated by an OSM existence check, OSM authentication, and the contributions-enabled setting

### Modified Capabilities

- `osm-auto-seed`: **BREAKING** — Replace the periodic timer-based auto-seed with the new selective on-demand behavior. Remove the timer, random selection, exponential backoff, auto-seed indicator, consent dialog, and changeset pooling. The activation gates change from (OSM auth + contributions + zoom ≥ 14 + timer) to (OSM auth + contributions + POI detail opened for an Overture source).

## Impact

- **Removed**: `src/hooks/useOsmAutoSeed.ts` (timer, selection, backoff logic), `src/components/map/AutoSeedIndicator.tsx` (visual badge), consent dialog in settings, `seededIds`/`seededCount` state tracking
- **Modified**: `app/poi/[id].tsx` (add existence check + auto-submit on mount for Overture POIs), `src/services/osm/osmEditService.ts` (simplify changeset management — one changeset per submission), `src/services/poi/osmFetcher.ts` (reuse existing `checkPoiExistsInOsm`)
- **Unchanged**: Manual "Add to OpenStreetMap" button in `POIInfoCard.tsx` and `poi/[id].tsx`, OSM auth flow, `placeToOsmTags`/`placeToOsmPoi` utilities
