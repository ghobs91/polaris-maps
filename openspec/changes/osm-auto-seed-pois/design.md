## Context

Currently, the OSM login flow is embedded inside the `/poi/osm-edit` screen — users can only sign in or view their OSM account status when they navigate to edit/create a POI. There is no standalone OSM account management in Settings.

The "Add to OpenStreetMap" flow is entirely manual: the user taps a POI badge → opens the POIInfoCard → scrolls to the "Add to OpenStreetMap" button → navigates to the edit form → edits fields → taps submit. Overture-sourced POIs visible on the map that are not in OSM can only be contributed one at a time through this manual flow.

Overture Maps (`2026-04-15.0` release) regularly provides POIs not yet in OSM. The app already fetches these via PMTiles, stores them in SQLite, and renders them on the map with `polaris:source=overture` tags and synthetic negative IDs.

## Goals / Non-Goals

**Goals:**

- Add an OSM Account section to the existing Settings UI with login, logout, and account status display
- When not authenticated, redirect users to Settings from `/poi/osm-edit` instead of showing an inline login screen
- Implement automatic background submission of Overture-sourced POIs to OSM at ~10-second intervals while the user browses the map with POIs visible
- Each auto-submission creates a real OSM node using the existing OSM API v0.6 create workflow
- Respect `poiContributionsEnabled` setting and OSM auth status as gates for auto-seeding
- Provide unobtrusive visual feedback that auto-seeding is active

**Non-Goals:**

- Editing auto-seeded POIs before submission (users can still use the manual flow for that)
- Auto-seeding Nominatim, Apple Maps, or existing OSM-sourced POIs — only Overture-sourced
- Batch-uploading or bulk changeset operations beyond the 10-second throttle
- Persisting auto-seed state across app restarts (session-scoped)
- Custom OSM changeset tags for auto-seed (will annotate with `source=Overture Maps` in tags)
- Cross-device or shared changeset state

## Decisions

### 1. Auto-seed timer lives in a custom hook on the MapView

**Decision**: Create a `useOsmAutoSeed` hook consumed inside `MapView.tsx`.

**Rationale**: MapView already orchestrates POI fetching and has access to the full lifecycle (mount/unmount, zoom changes, region changes). The hook subscribes to `osmPoiStore` for visible POIs, `osmAuthStore` for auth state, and `settingsStore` for the `poiContributionsEnabled` flag. Keeping it as a hook avoids coupling to specific component trees and makes it testable.

**Alternatives considered**:

- Putting the timer in POILayer: would have narrower access to the lifecycle and redundant re-renders
- A global background task: over-engineered for this scope; React Native background tasks are unreliable on iOS

### 2. One changeset per auto-seed session

**Decision**: Open a single OSM changeset when auto-seed starts, reuse it for all auto-submissions during that browser session, and close it when the user leaves the map view or disables auto-seed.

**Rationale**: This mirrors OSM community best practices (one changeset per logical edit session), reduces API calls (no per-node changeset create/close), and better respects rate limits. The changeset comment will read: `Adding POIs from Overture Maps via Polaris Maps`.

**Alternatives considered**:

- Per-node changesets: wastes API calls and looks spammy in OSM history
- Per-region changesets: adds complexity with minimal benefit for this use case

### 3. In-memory Set for duplicate prevention

**Decision**: Track already-seeded POI IDs in an in-memory `Set<number>` within the auto-seed hook.

**Rationale**: Simple, fast lookups, and the scope is intentionally session-only. When the user moves to a new area, new Overture POIs become visible and eligible. The Set resets on map component unmount.

**Alternatives considered**:

- SQLite tracking: persistent but adds unnecessary complexity; re-submitting a POI in a later session is harmless
- Flag on the Place model: would require schema migration and conflates data model with UI state

### 4. `setTimeout` chain instead of `setInterval`

**Decision**: Use a recursive `setTimeout` chain that starts the next timer only after the current submission completes (or fails), with a minimum 10-second gap between submissions.

**Rationale**: This avoids overlapping submissions if the API is slow, naturally adapts to network conditions, and guarantees the 10-second floor between OSM API calls. If a submission takes 3 seconds, the next fires in 7 seconds; if it takes 15 seconds, the next fires immediately.

### 5. Headless submission via new `submitPlaceAuto` function

**Decision**: Add a `submitPlaceAuto(place: Place, accessToken: string)` function to `osmEditService.ts` that accepts a Polaris `Place` directly, converts tags via `placeToOsmTags()`, and runs the full create workflow without UI interaction. No form state, no navigation.

**Rationale**: The existing `submitOsmNodeCreate()` ties into React state (form fields, changeset comment). The auto-seed flow needs the same API operations but driven by a Place model rather than form inputs. Extracting the core workflow into a shared function avoids duplicating the XML generation and API call logic.

### 6. Visual feedback via a small counter badge

**Decision**: Render a small, non-intrusive badge in the `FloatingMenuPanel` (or as a floating pill on the map) showing "Auto-seeding: X POIs added today" with a subtle pulse animation on each successful submission.

**Rationale**: Users need to know auto-seeding is active (trust) but shouldn't be distracted. A persistent counter is more informative than transient toasts. Location in FloatingMenuPanel keeps it accessible but not in the way of map interaction.

## Risks / Trade-offs

- **[Data quality]** Auto-seeded POIs may have incomplete or inaccurate tags (Overture data quality varies) Users can still use the manual flow for POIs they want to verify first.
- **[Rate limiting]** OSM API may return 429 if the 10-second throttle is insufficient → Mitigation: Detect 429 responses and exponentially back off (double the interval, max 5 minutes). Show a warning indicator.
- **[Accidental submissions]** User may not intend to seed POIs to OSM → Mitigation: Auto-seed only activates when `poiContributionsEnabled` is ON (default is true after onboarding) AND user is signed into OSM. Add a dedicated "Auto-Seed" toggle in Settings (separate from the general contributions flag) for explicit opt-in. The first time auto-seed activates, show a one-time consent dialog.
- **[Changeset sprawl]** If the user keeps the map open for hours, one changeset could grow very large → Mitigation: Close and reopen the changeset after 1000 nodes or 1 hour of session time, whichever comes first.
- **[Duplicate submissions across users]** Two Polaris Maps users in the same area could submit the same Overture POI → Mitigation: OSM's existing duplicate detection is basic but the OSM community regularly deduplicates. Adding `ref:overture=<id>` tag helps automated tools detect duplicates.

## Open Questions

- Should the auto-seed changeset be closed on app backgrounding or left open? → Default to closing on background to avoid orphaned changesets.
