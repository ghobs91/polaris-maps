## 1. Add selective auto-seed trigger to POI detail page

- [x] 1.1 In `app/poi/[id].tsx`, add a `useEffect` on mount that checks if the loaded POI is Overture-sourced (`source === 'overture'`), user is OSM-authenticated (`accessToken`), and contributions are enabled (`poiContributionsEnabled`)
- [x] 1.2 Create an in-memory `Set<string>` outside the component for session-scoped dedup (keyed by normalized name + rounded lat/lng to ~11m precision)
- [x] 1.3 Before submitting, check the dedup Set — skip if already submitted this session
- [x] 1.4 Call `checkPoiExistsInOsm()` from `osmFetcher.ts` — skip if POI already exists in OSM
- [x] 1.5 On fail-open (Overpass error), proceed with submission rather than blocking
- [x] 1.6 Call `submitOsmNodeCreate()` with tags from `placeToOsmTags()` and changeset comment `"Added Overture Maps POI via Polaris Maps"`
- [x] 1.7 On success, add the POI key to the dedup Set
- [x] 1.8 On failure, surface error via `Alert.alert()` (existing pattern in the file)
- [x] 1.9 The auto-submit MUST be silent (no intermediate UI changes during submission) — only notify user if submission fails
- [x] 1.10 Guard the entire auto-submit behind a `useRef` flag to prevent double-submission from React Strict Mode double-mount

## 2. Remove periodic auto-seed infrastructure

- [x] 2.1 Delete `src/hooks/useOsmAutoSeed.ts` and its exports (`setAutoSeedCountCallback`, `setAutoSeedResultCallback`, `getAutoSeededCount`, `useOsmAutoSeed`)
- [x] 2.2 Delete `src/components/map/AutoSeedIndicator.tsx`
- [x] 2.3 Remove any import/render of `AutoSeedIndicator` from `MapView.tsx`, `FloatingSearchPanel.tsx`, or other components
- [x] 2.4 Remove invocation of `useOsmAutoSeed()` from `MapView.tsx` or wherever it is called
- [x] 2.5 Remove `autoSeedConsentGiven`, `setAutoSeedConsentGiven`, and the consent dialog from `src/stores/settingsStore.ts` and any UI that uses it
- [x] 2.6 Remove `autoSeedConsentGiven` from persisted settings (backward-compatible: the key is simply ignored on load)

## 3. Clean up osmEditService

- [x] 3.1 Remove `submitPlaceAuto()` function — no longer used
- [x] 3.2 Remove `submitOsmPoiAuto()` function — no longer used
- [x] 3.3 Remove `getOrCreateAutoChangeset()`, `closeAutoChangeset()`, `getActiveAutoChangesetId()` and associated module-level state (`activeAutoChangesetId`, `activeAutoChangesetCount`, `activeAutoChangesetStartTime`)
- [x] 3.4 Remove `AutoSeedResult` type export
- [x] 3.5 Remove `import { checkPoiExistsInOsm }` from this file (no longer needed here)

## 4. Verify and clean up

- [x] 4.1 Run `npx tsc --noEmit` and fix any TypeScript errors from removed imports/exports
- [x] 4.2 Run `npx jest` and fix any failing tests that reference removed functions
- [x] 4.3 Search codebase for any remaining references to: `useOsmAutoSeed`, `submitPlaceAuto`, `submitOsmPoiAuto`, `AutoSeedIndicator`, `AutoSeedResult`, `autoSeedConsentGiven`, `getOrCreateAutoChangeset`, `closeAutoChangeset`
- [ ] 4.4 Manually verify the app builds and runs — open a POI detail view for an Overture-sourced POI and confirm auto-submit behavior
- [ ] 4.5 Verify that the manual "Add to OpenStreetMap" button flow in `POIInfoCard.tsx` and `poi/[id].tsx` still works correctly
