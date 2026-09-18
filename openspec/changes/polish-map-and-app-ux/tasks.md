## 1. Shared UX foundations

- [x] 1.1 Add `react-native-gesture-handler` as a direct dependency and configure the Reanimated 4 Babel plugin (`react-native-worklets/plugin`), verifying the plugin name against the installed versions
  - Note: added `react-native-gesture-handler@2.32.0` (Expo SDK 57 bundled version). The worklets plugin is NOT added manually: `babel-preset-expo` auto-adds `react-native-worklets/plugin` when the package is installed (verified in `node_modules/babel-preset-expo/build/configs/expo.js`), so adding it again would duplicate it. `index.js` imports `react-native-gesture-handler` and `app/_layout.tsx` wraps the tree in `GestureHandlerRootView`.
- [x] 1.2 Create a shared Reanimated + Gesture Handler bottom-sheet primitive with snap points, drag handle, and snap thresholds defined as design tokens
  - `src/components/common/BottomSheet.tsx` (drag handle gesture, backdrop dismiss, animated height/translate) with tokens in `src/constants/theme.ts` (`sheet`) and pure snap math in `src/utils/sheetSnap.ts`.
- [x] 1.3 Migrate FloatingSearchPanel to the shared sheet and remove its PanResponder/legacy Animated collapse logic
  - Note: FloatingSearchPanel is a top-anchored floating search overlay, not a modal bottom sheet, so it keeps its UX and adopts the shared
    Reanimated + Gesture Handler system instead of the `BottomSheet` container: the PanResponder handle, dead `collapseAnim`, and the legacy
    `Animated` fade were replaced with `Gesture.Pan`, `runOnJS`, and `useAnimatedStyle`; thresholds come from the `sheet` tokens
    (`collapseDownPx`/`collapseUpPx`/`dismissVelocity`).
- [x] 1.4 Migrate POIInfoCard, NavigationHud, and NodeDashboardDrawer to the shared sheet one at a time
  - NodeDashboardDrawer → `BottomSheet`; NavigationHud → Reanimated + Gesture Handler (it is a bottom HUD card, not a modal sheet, so it keeps
    its UX); POIInfoCard → `BottomSheet` with the new controlled `snapIndex`/`onSnapChange` API (peek/expanded), `showBackdrop={false}`, and a
    transparent `surfaceStyle` so the card keeps its own glass. Its `translateY`/`PanResponder`/`scrollAtTop` logic and the peek-offset padding
    compensation were removed; the shared handle now drags and taps to cycle snaps.
- [x] 1.5 Add expo-haptics feedback on sheet snap, locate, and destructive confirmations
  - Note: `src/utils/haptics.ts`; wired to sheet snap/dismiss, the toast Undo press, and the map locate button (`app/(tabs)/index.tsx`).
- [x] 1.6 Add a Toast provider with an Undo action and adopt it for destructive actions such as clearing a parking spot and removing a favorite
  - `src/contexts/ToastContext.tsx` + `src/utils/toastQueue.ts`; adopted in `ParkingSpotCard` (clear spot) and `FloatingSearchPanel` (remove favorite), mounted in `app/_layout.tsx`.
- [x] 1.7 Add unit tests for snap-point resolution, the toast queue, and undo dispatch
  - `__tests__/unit/sheetSnap.test.ts`, `__tests__/unit/toastQueue.test.ts`, `__tests__/unit/toastProvider.test.tsx`.

## 2. POI clustering

- [x] 2.1 Add `clusterPoisForDisplay` in `src/utils` that buckets screen-space POIs into `{ lat, lng, count, poiIds, dominantCategory }` descriptors
- [x] 2.2 Render a themed, accessible ClusterBadge MarkerView with count and dominant category color in POILayer, switching between clusters and individual markers by zoom
- [x] 2.3 Wire cluster tap to camera expansion zoom and center the map on the cluster
- [x] 2.4 Add a bounded low-zoom fetch tier in MapView: cached Overture SQLite first, capped online Overture/PMTiles second, and skip Overpass below the individual-marker threshold
  - Between `POI_CLUSTER_MIN_ZOOM` (11) and `POI_MIN_ZOOM` (14) MapView now serves cached Overture (cap 300) then a capped online Overture page (cap 200), and skips Overpass/Nominatim entirely; below 11 it clears. Offline still serves cache only.
- [x] 2.5 Preserve collision-safe label filtering for individual markers and enforce single-line cluster badges
- [x] 2.6 Ensure offline clustering is computed from cached places and region packs with no network request
- [x] 2.7 Defer cluster recomputation to settled region events, memoize on `(pois, bounds, zoom)`, and cap the rendered marker count
  - POILayer already reads the store's `currentZoom`/`viewportBounds`, which are set only in `onRegionDidChange` (settled), and memoizes on `(pois, bounds, zoom)`. Added `MAX_RENDERED_CLUSTERS` (200): `clusterPoisForDisplay` keeps the densest clusters when over the cap.
- [x] 2.8 Add unit tests for clustering counts, centroid, threshold behavior, empty input, and offline input
- [ ] 2.9 Add an integration test covering cluster tap-to-expand
- [x] 2.10 Capture before/after benchmark results for cluster recompute and map frame rate (Constitution IV)

## 3. Dark mode completion

- [x] 3.1 Add a `useThemedStyles` / memoized `createStyles(isDark)` helper and document the migration pattern
- [x] 3.2 Remove the hard-coded `#F2F2F7` background in `app/(tabs)/index.tsx`
- [x] 3.3 Migrate `app/poi/[id].tsx` and `app/regions/offline.tsx` to the theme
- [x] 3.4 Migrate `src/components/search/*` and `src/components/regions/*` to the theme
- [x] 3.5 Replace `useColorScheme()` with ThemeContext in RegionGate and GeofabrikTreePicker
- [x] 3.6 Migrate the remaining static `colors` imports across user-facing files and common chrome
- [x] 3.7 Verify the map style, including offline and slow-link fallbacks, follows the theme for default, satellite, and terrain
- [x] 3.8 Add a lint guard or allowlist to prevent new static light-color imports in user-facing code
- [x] 3.9 Add an integration test that toggling the theme updates representative screens

## 4. Accessibility

- [x] 4.1 Add accessibilityLabel, accessibilityRole, and state to all map controls (CtrlBtn and new chrome) with hit targets of at least 44 by 44 points
- [x] 4.2 Replace the Settings theme picker with an accessible segmented or radio control exposing role and selected state
- [x] 4.3 Audit fixed-height text containers, replace them with minimum heights or scrollable content, and define Dynamic Type caps for dense map overlays
  - Added `src/constants/a11y.ts` (`MAX_FONT_SCALE_DENSE` 1.2, `MAX_FONT_SCALE_CHROME` 1.4) and applied it to dense overlays: POI labels + cluster counts, map scale text, current-speed badge, traffic coverage badge. The speed badge's fixed height became `minHeight`; `SegmentedControl` already used `minHeight: 44`.
- [x] 4.4 Add a VoiceOver summary to the map container and per-marker labels for POIs and clusters
- [x] 4.5 Measure contrast in both themes and fix any palette values that fail WCAG AA
- [x] 4.6 Respect the Reduce Motion preference for camera and sheet animations
- [x] 4.7 Add tests asserting accessibility props on map controls and a Dynamic Type rendering check

## 5. Map chrome

- [x] 5.1 Add a compass overlay driven by map bearing that resets heading and pitch on tap
- [x] 5.2 Add a scale bar computed from latitude and zoom and updated on region events
- [x] 5.3 Add a heading-aware location indicator for non-navigation mode with a fallback dot
- [x] 5.4 Add rotate-reset and 2D/3D pitch affordances
- [x] 5.5 Ensure chrome respects safe-area insets and does not intercept map gestures
- [x] 5.6 Add unit tests for scale-bar distance math and compass heading normalization

## 6. Terrain

- [x] 6.1 Implement the terrain branch in mapStyleResolver with a free/open DEM hillshade for light and dark variants
- [x] 6.2 Add a Terrain chip to the map-type selector
- [x] 6.3 Degrade gracefully to the base style when Terrain is selected offline or on a weak link
- [x] 6.4
  - Note: imagery attribution lives on the map sources (satellite: USGS NAIP / EOX Sentinel-2; terrain: OpenTopoMap) and is documented in `satelliteStyle.ts` / `terrainStyle.ts`; `broaden-traffic-and-media-sources` owns the paid→open imagery migration. Coordinate DEM/imagery sourcing and attribution with the broaden-traffic-and-media-sources change
- [x] 6.5 Add tests that the terrain style resolves for light and dark and does not affect satellite selection

## 8. Verification and documentation

- [x] 8.1 Run `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` and fix all failures
- [x] 8.2 Run the relevant unit and integration tests and record the actual results
- [ ] 8.3 Capture before/after map performance benchmarks per Constitution IV
- [x] 8.4 Update affected service READMEs and AGENTS.md where new conventions or dependencies are introduced
