## 1. Shared UX foundations

- [ ] 1.1 Add `react-native-gesture-handler` as a direct dependency and configure the Reanimated 4 Babel plugin (`react-native-worklets/plugin`), verifying the plugin name against the installed versions
- [ ] 1.2 Create a shared Reanimated + Gesture Handler bottom-sheet primitive with snap points, drag handle, and snap thresholds defined as design tokens
- [ ] 1.3 Migrate FloatingSearchPanel to the shared sheet and remove its PanResponder/legacy Animated collapse logic
- [ ] 1.4 Migrate POIInfoCard, NavigationHud, and NodeDashboardDrawer to the shared sheet one at a time
- [ ] 1.5 Add expo-haptics feedback on sheet snap, locate, and destructive confirmations
- [ ] 1.6 Add a Toast provider with an Undo action and adopt it for destructive actions such as clearing a parking spot and removing a favorite
- [ ] 1.7 Add unit tests for snap-point resolution, the toast queue, and undo dispatch

## 2. POI clustering

- [x] 2.1 Add `clusterPoisForDisplay` in `src/utils` that buckets screen-space POIs into `{ lat, lng, count, poiIds, dominantCategory }` descriptors
- [x] 2.2 Render a themed, accessible ClusterBadge MarkerView with count and dominant category color in POILayer, switching between clusters and individual markers by zoom
- [x] 2.3 Wire cluster tap to camera expansion zoom and center the map on the cluster
- [ ] 2.4 Add a bounded low-zoom fetch tier in MapView: cached Overture SQLite first, capped online Overture/PMTiles second, and skip Overpass below the individual-marker threshold
- [x] 2.5 Preserve collision-safe label filtering for individual markers and enforce single-line cluster badges
- [x] 2.6 Ensure offline clustering is computed from cached places and region packs with no network request
- [ ] 2.7 Defer cluster recomputation to settled region events, memoize on `(pois, bounds, zoom)`, and cap the rendered marker count
- [x] 2.8 Add unit tests for clustering counts, centroid, threshold behavior, empty input, and offline input
- [ ] 2.9 Add an integration test covering cluster tap-to-expand
- [x] 2.10 Capture before/after benchmark results for cluster recompute and map frame rate (Constitution IV)

## 3. Dark mode completion

- [ ] 3.1 Add a `useThemedStyles` / memoized `createStyles(isDark)` helper and document the migration pattern
- [ ] 3.2 Remove the hard-coded `#F2F2F7` background in `app/(tabs)/index.tsx`
- [ ] 3.3 Migrate `app/poi/[id].tsx` and `app/regions/offline.tsx` to the theme
- [ ] 3.4 Migrate `src/components/search/*` and `src/components/regions/*` to the theme
- [ ] 3.5 Replace `useColorScheme()` with ThemeContext in RegionGate and GeofabrikTreePicker
- [ ] 3.6 Migrate the remaining static `colors` imports across user-facing files and common chrome
- [ ] 3.7 Verify the map style, including offline and slow-link fallbacks, follows the theme for default, satellite, and terrain
- [ ] 3.8 Add a lint guard or allowlist to prevent new static light-color imports in user-facing code
- [ ] 3.9 Add an integration test that toggling the theme updates representative screens

## 4. Accessibility

- [ ] 4.1 Add accessibilityLabel, accessibilityRole, and state to all map controls (CtrlBtn and new chrome) with hit targets of at least 44 by 44 points
- [ ] 4.2 Replace the Settings theme picker with an accessible segmented or radio control exposing role and selected state
- [ ] 4.3 Audit fixed-height text containers, replace them with minimum heights or scrollable content, and define Dynamic Type caps for dense map overlays
- [ ] 4.4 Add a VoiceOver summary to the map container and per-marker labels for POIs and clusters
- [ ] 4.5 Measure contrast in both themes and fix any palette values that fail WCAG AA
- [ ] 4.6 Respect the Reduce Motion preference for camera and sheet animations
- [ ] 4.7 Add tests asserting accessibility props on map controls and a Dynamic Type rendering check

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
- [ ] 6.4 Coordinate DEM/imagery sourcing and attribution with the broaden-traffic-and-media-sources change
- [x] 6.5 Add tests that the terrain style resolves for light and dark and does not affect satellite selection

## 7. iOS system integration

- [ ] 7.1 Define the App Group identifier and a versioned shared-state snapshot schema (destination, ETA, remaining distance, saved places, Home)
- [ ] 7.2 Write the shared-state snapshot from existing navigationStore and favorites through a single writer module
- [ ] 7.3 Add a config plugin that installs a WidgetKit extension and its Swift sources, mirroring withLiveActivities
- [ ] 7.4 Build the widget views for saved places and active-navigation ETA
- [ ] 7.5 Add an App Intents target with a navigate-home intent and an App Shortcut, deep-linking into the app
- [ ] 7.6 Ensure Live Activities, the widget, and App Intents all read the same shared state
- [ ] 7.7 Add App Group entitlements and Xcode project wiring through config plugins and verify a clean prebuild regenerates working targets
- [ ] 7.8 Verify the integration is device-only with no server or paid dependency and document the setup
- [ ] 7.9 Add tests for the JS shared-state writer and a manual device checklist for widget and intent behavior

## 8. Verification and documentation

- [ ] 8.1 Run `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` and fix all failures
- [ ] 8.2 Run the relevant unit and integration tests and record the actual results
- [ ] 8.3 Capture before/after map performance benchmarks per Constitution IV
- [ ] 8.4 Update affected service READMEs and AGENTS.md where new conventions or dependencies are introduced
