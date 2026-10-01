## Why

Overture Maps provides a richer POI dataset than OpenStreetMap in many regions, but users currently must manually tap "Add to OpenStreetMap" on each Overture-sourced POI to contribute it back. This friction limits the throughput of community contributions. By adding an OSM account management section in Settings and introducing automatic background seeding, users can passively contribute Overture POIs to OSM just by browsing the map.

## What Changes

- Add an **OSM Account** section to Settings, allowing users to log in, view account status, view recent OpenStreetMap contributions (stats on number of places added + latest contributions list), and log out of OpenStreetMap without navigating to the OSM edit screen
- Remove the separate "Sign in to OpenStreetMap" screen from the `/poi/osm-edit` flow — redirect to Settings instead when credentials are missing
- Introduce **auto-seed mode**: when the user is logged into OSM and viewing the map with POIs visible, a random visible Overture-sourced POI (not already in OSM) is submitted to `/poi/osm-edit` every ~10 seconds for automatic node creation
- Each auto-submission mirrors the existing manual flow: extract tags from the Place model, create an OSM changeset, create the node, and close the changeset — transparently and without user interaction
- Throttle submissions to one per ~10 seconds to stay within OSM API rate limits
- Provide visual feedback (e.g., a subtle badge or indicator) so the user knows auto-seeding is active
- Respect the existing `poiContributionsEnabled` setting — auto-seed only runs when contributions are enabled and the user is signed into OSM

## Capabilities

### New Capabilities

- `osm-account-settings`: OSM login/logout/status management accessible from the Settings screen, independent of the POI edit flow
- `osm-auto-seed`: Automatic, throttled submission of visible Overture-sourced POIs to OpenStreetMap during map browsing

### Modified Capabilities

_None — no existing capability requirements change._

## Impact

- **Settings UI** (`src/components/settings/SettingsContent.tsx`): new OSM Account section with login/logout buttons and account status display
- **OSM Auth Store** (`src/stores/osmAuthStore.ts`): may need additional derived state for account display name / profile picture
- **Map View + POI Layer** (`src/components/map/MapView.tsx`, `src/components/map/POILayer.tsx`): new auto-seed timer and POI selection logic
- **POI Info Card** (`src/components/map/POIInfoCard.tsx`): existing manual "Add to OpenStreetMap" flow remains unchanged
- **OSM Edit Screen** (`app/poi/osm-edit.tsx`): redirect to Settings when not authenticated, support headless (no-UI) submission mode for auto-seed
- **Settings Store** (`src/stores/settingsStore.ts`): auto-seed respects existing `poiContributionsEnabled` flag
- **OSM Edit Service** (`src/services/osm/osmEditService.ts`): reusable submission logic called by both manual and auto-seed flows
