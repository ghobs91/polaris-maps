## Context

The current auto-seed system (`useOsmAutoSeed`) runs a periodic timer that randomly selects visible Overture-sourced POIs and submits them to OSM every ~10 seconds. This was built on top of the existing `submitOsmPoiAuto()` and `submitPlaceAuto()` functions in `osmEditService.ts`. A recent fix added `checkPoiExistsInOsm()` to gate submissions against duplicates already in OSM.

However, the periodic timer approach has fundamental issues:

- Submits POIs the user never interacts with (unvetted data)
- Requires complex state management (backoff, changeset pooling, consent, indicator)
- The multi-POI changeset design complicates cleanup on app backgrounding

The new approach triggers submission only when the user opens a POI detail view — an intentional action that implies review — and gates it with the OSM existence check.

## Goals / Non-Goals

**Goals:**

- Replace periodic auto-seed with on-demand submission triggered by opening a POI detail view for an Overture-sourced POI
- Gate every submission with `checkPoiExistsInOsm()` to prevent duplicates
- Simplify changeset management to one-per-submission
- Remove all periodic-timer infrastructure: `useOsmAutoSeed` hook, `AutoSeedIndicator`, consent dialog, backoff state

**Non-Goals:**

- Changing the manual "Add to OpenStreetMap" button flow
- Adding user-facing prompts or confirmations before auto-submit (the POI detail view IS the review step)
- Persisting submission state across sessions (existence check handles this)
- Modifying the OSM edit form or the existing `submitOsmNodeCreate` flow

## Decisions

### 1. Trigger in POI detail page on mount

**Decision**: Add auto-seed logic to `app/poi/[id].tsx`, executed once on mount when the loaded POI is Overture-sourced, the user is OSM-authenticated, and contributions are enabled.

**Rationale**: The detail page is the natural point where a user has reviewed a POI. Triggering on mount ensures one submission per detail view open. The page already has access to the full Place model needed for submission and to auth/contributions state.

**Alternatives considered**:

- Triggering in `POIInfoCard`: would submit before user reaches the detail page; submits for every card open (frequent)
- Triggering on a dedicated button: adds friction; defeats the purpose of auto-seeding

### 2. One changeset per submission

**Decision**: Each auto-submission creates its own changeset via `submitOsmNodeCreate()` (the existing single-node creation function), rather than pooling nodes into a shared changeset.

**Rationale**: With on-demand triggering, submissions are infrequent (only when user opens detail views). The pooled changeset approach was designed for the high-frequency timer model where creating/ closing per-node would spam the API. Now that each submission is a singular, intentional event, a dedicated changeset is cleaner and avoids orphaned changesets on app backgrounding.

**Alternatives considered**:

- Reuse `getOrCreateAutoChangeset`: would leave an open changeset between submissions; cleanup complexity unnecessary for infrequent use

### 3. In-memory dedup Set for session-scoped prevention

**Decision**: Store successfully-submitted POI keys (name + rounded lat/lng) in an in-memory `Set<string>` scoped to the app session. Check both the Set and `checkPoiExistsInOsm()` before submitting.

**Rationale**: After a successful submission, OSM may not immediately reflect the new POI in Overpass queries (caching lag). The in-memory Set prevents the same POI from being submitted again if the user re-opens the detail view within the same session. The OSM existence check handles cross-session duplicates.

**Alternatives considered**:

- Relying solely on OSM existence check: risk of duplicate within session due to Overpass cache lag
- SQLite tracking: over-engineered for session-scoped prevention

### 4. Fail-open on existence check errors

**Decision**: If `checkPoiExistsInOsm()` throws (Overpass API down), proceed with submission rather than blocking.

**Rationale**: The cost of a duplicate submission (which the OSM community can deduplicate) is lower than the cost of silently dropping a valid contribution. This matches the behavior already implemented in `submitOsmPoiAuto()`.

### 5. Remove the entire periodic auto-seed infrastructure

**Decision**: Delete `useOsmAutoSeed.ts`, `AutoSeedIndicator.tsx`, the one-time consent dialog, and the auto-seed changeset pooling (`getOrCreateAutoChangeset`, `closeAutoChangeset`, `getActiveAutoChangesetId`).

**Rationale**: These components exist solely to support the timer-based approach. Removing them eliminates ~200 lines of state management and an entire visual component. The `submitPlaceAuto` and `submitOsmPoiAuto` functions are also removed since the new flow uses `submitOsmNodeCreate` directly.

**Alternatives considered**:

- Keeping the components but disabling them: leaves dead code; violates YAGNI

## Risks / Trade-offs

- **[Lower throughput]** Moving from periodic (every 10s) to on-demand (per detail view open) will submit fewer POIs overall. This is intentional — quality over quantity.
- **[Duplicate within session]** If OSM caching lags and the in-memory Set is cleared (app restart), a POI submitted in a previous session could be re-submitted before it appears in Overpass queries. Mitigation: The OSM community deduplicates; this is a rare edge case.
- **[Unexpected submission]** Users who open a POI detail view may not expect it to be auto-submitted to OSM. Mitigation: Auto-seed only activates when the user has explicitly signed into OSM and enabled contributions. The detail page shows "This data comes from Overture Maps. Review and adjust before submitting" — the user is aware they're viewing external data.

## Migration Plan

1. Add auto-seed trigger to `app/poi/[id].tsx` (new code, no existing behavior change)
2. Remove `useOsmAutoSeed.ts`, `AutoSeedIndicator.tsx`, auto-seed changeset functions
3. Remove `submitPlaceAuto` and `submitOsmPoiAuto` from `osmEditService.ts`
4. Remove auto-seed consent dialog from settings (if implemented)
5. Clean up any remaining references to auto-seed types/exports
6. No data migration needed; no API changes; existing manual submission flow unchanged

## Open Questions

_None — all design decisions are resolved._
