## 1. OSM Account Settings UI

- [x] 1.1 Add OSM Account section to `SettingsContent.tsx` with logged-out state ("Sign in to OpenStreetMap" button using `osmAuthStore.login()`)
- [x] 1.2 Add logged-in state to OSM Account section (display name, avatar, "Sign Out" button using `osmAuthStore.logout()`)
- [x] 1.3 Add `useOsmAuthStore` subscription in SettingsContent to reactively update when auth state changes
- [x] 1.4 Add "My OpenStreetMap Contributions" area showing total changesets/nodes count and session auto-seed count, fetched from OSM API (`/api/0.6/changesets.json` and `/api/0.6/user/details.json`)
- [x] 1.5 Add "View Latest Contributions" action that opens the user's OSM profile in the system browser
- [x] 1.6 Modify `/poi/osm-edit.tsx` to redirect unauthenticated users to the Settings screen instead of showing inline login prompt

## 2. Headless POI Submission

- [x] 2.1 Add `submitPlaceAuto(place, accessToken, changesetId?)` to `src/services/osm/osmEditService.ts` that creates an OSM node from a Place model without form/UI dependencies
- [x] 2.2 Call `placeToOsmTags()` inside `submitPlaceAuto` to convert Place fields to OSM-format tags
- [x] 2.4 Implement auto-seed changeset lifecycle: `createAutoChangeset()`, `closeAutoChangeset()`, changeset rotation at 1000 nodes or 1 hour

## 3. Auto-Seed Hook

- [x] 3.1 Create `useOsmAutoSeed` hook in `src/hooks/useOsmAutoSeed.ts` with activation gate checks (OSM auth, `poiContributionsEnabled`, zoom >= 14)
- [x] 3.2 Implement POI selection logic: filter visible POIs for Overture-sourced (`polaris:source === 'overture'`, negative ID), exclude already-seeded (in-memory `Set`)
- [x] 3.3 Implement submission timer using `setTimeout` chain with 10-second minimum gap between submissions
- [x] 3.4 Implement exponential backoff on HTTP 429 responses (10s → 20s → 40s → 80s → 160s, max 5 min; pause after 3 consecutive 429s)
- [x] 3.5 Clean up timer and close changeset on hook teardown (unmount, or when activation conditions become false)
- [x] 3.6 Close changeset on app background via `AppState` listener

## 4. Auto-Seed Visual Feedback

- [x] 4.1 Create `AutoSeedIndicator` component showing current seeded count as a small pill/badge
- [x] 4.2 Add pulse animation on successful POI submission
- [x] 4.3 Render `AutoSeedIndicator` in `MapView.tsx` when auto-seed is active
- [x] 4.4 Create one-time consent dialog component shown before first auto-seed activation
- [x] 4.5 Persist consent preference using MMKV (via settingsStore or dedicated key)

## 5. Integration

- [x] 5.1 Wire `useOsmAutoSeed` hook into `MapView.tsx`
- [x] 5.2 Verify manual "Add to OpenStreetMap" flow in POIInfoCard still works correctly alongside auto-seed
- [x] 5.3 Test end-to-end: OSM login in Settings → map browse → auto-seed submits POIs → indicator updates → OSM node appears on openstreetmap.org
- [x] 5.4 Verify rate limiting behavior by simulating 429 responses
- [x] 5.5 Verify changeset is properly closed on app background, sign out, and settings toggle off
