# Map accessibility crash (MapLibre, iOS)

Status: **diagnosed, not fixed**. Tracked here so it is not lost; needs a product
decision before any code changes.

## Symptom

The app aborts (SIGABRT) while UIKit enumerates the map's accessibility tree.
Observed 4× on 2026-10-29 against a Release build (350) on an iOS 27.0 simulator,
always while an automation/accessibility pass walked the map, never while the app
was idle.

Crash report stack (abridged, all four crashes identical):

```
libc++abi  __cxa_throw
libc++abi  std::__terminate / demangling_terminate_handler()
libobjc    _objc_terminate
MapLibre   (3 frames, stripped local symbols)
UIAccessibility  -[NSObject(AXPrivCategory) accessibilityEnumerateContainerElementsWithOptions:usingBlock:]
UIAccessibility  -[NSObjectAccessibility automationElements]
```

MapLibre native is `MapLibre.framework` 6.17.1, pulled in by
`@maplibre/maplibre-react-native` 10.4.2.

## What the accessibility path does

`MLNMapView` is a `UIAccessibilityContainer`. From maplibre-native
`platform/ios/src/MLNMapView.mm` (identical in 6.17.1 → 6.20.0):

- `accessibilityElementCount` = compass + user location + `accessibilityAnnotationCount`
  - `visiblePlaceFeatures.count` + `visibleRoadFeatures.count` + attribution button
- `accessibilityElementAtIndex:` **re-queries** those collections and then indexes them:

```objc
std::vector<MLNAnnotationTag> visibleAnnotations = [self annotationTagsInRect:self.bounds];
NSRange visibleAnnotationRange = NSMakeRange(NSMaxRange(userLocationAnnotationRange),
                                             visibleAnnotations.size());
...
NSUInteger annotationIndex = index - visibleAnnotationRange.location;
MLNAnnotationTag annotationTag = visibleAnnotations[annotationIndex];   // no bounds check
```

`visiblePlaceFeatures` / `visibleRoadFeatures` are the same pattern over
`visibleFeaturesInRect:inStyleLayersWithIdentifiers:`, which calls into
mbgl's `queryRenderedFeatures`.

The count and the element lookup are two separate queries against a live map.
Anything that changes rendered content between them — tiles arriving, a viewport
POI refresh, a camera animation, a style swap — makes the recorded index stale.
The code has no bounds check in either branch, so the stale index either
mis-indexes the vector (undefined behaviour) or overruns the array; the resulting
failure surfaces as an uncaught C++ exception and an abort.

This matches the observed trigger pattern: every crash followed content churn
(POI refresh after a camera jump, style switch to satellite, search typing).

## Why the app is exposed

- POIs are drawn with `ShapeSource` + `SymbolLayer`/`CircleLayer`, so the AX
  container reports rendered _features_ (potentially thousands at world zoom),
  not a handful of annotations.
- The map reloads viewport POIs on every camera change
  (`loadViewportPois` in `src/components/map/MapView.tsx`), so the feature set is
  almost always in flux while a VoiceOver pass is running.
- `MapView.tsx:837` also calls `queryRenderedFeaturesAtPoint` on every tap. That
  is the same native query family that
  [maplibre-react-native#1118](https://github.com/maplibre/maplibre-react-native/issues/1118)
  reports crashing on iOS 10.x; it was fixed for MLRN 11.0.0-alpha.16, but the
  accessibility container in MapLibre native itself is unchanged through 6.20.0.

## Options (need a decision)

1. **Upgrade `@maplibre/maplibre-react-native` 10.4.2 → 11.x.**
   Fixes the JS-facing `queryRenderedFeatures` crash (#1118), which is the tap
   handler's path. Does **not** fix the AX container, which is MapLibre native
   code that 11.x also ships. Major version bump, new architecture, and the
   existing `patches/@maplibre__maplibre-react-native.patch` has to be reconciled.
2. **Build MapLibre native from source with the AX container patched** (bounds
   checks + snapshot the element list once per AX pass). Correct fix, largest
   effort: local podspec, native build in CI.
3. **Hide the map from accessibility** (`accessibilityElementsHidden` on a wrapper
   view around `MapView`). One-line mitigation, removes the crash surface
   immediately, but VoiceOver users lose the only element that names visible
   places and roads — an accessibility regression that App Review may notice.
4. **Do nothing.** Crash surface is VoiceOver/automation-only; sighted users are
   unaffected. Cheapest, but leaves a likely crash for screen-reader users.

Recommendation: 2 for correctness, with 3 as a stopgap only if a release has to
ship before 2 lands. Option 1 alone does not fix this crash.

## Reproducing

Best effort: run a Release build in an iOS 27 simulator, enable VoiceOver
(Settings → Accessibility → VoiceOver), and pan/zoom so POIs refresh while
VoiceOver walks the map. It is intermittent — 4 crashes out of dozens of passes
today; rapid style toggles alone did not reproduce it.

The console also prints a runtime warning that is worth keeping in mind when
interpreting simulator-only crashes:

```
Class UIAccessibilityLoaderWebShared is implemented in both .../WebKit.axbundle/WebKit
and .../WebCore.axbundle/WebCore. This may cause spurious casting failures and
mysterious crashes.
```

That warning is unrelated to this app, but it means some accessibility-stack
crashes on the iOS 27 simulator runtime are not app bugs. The stack above points
at MapLibre, not at the duplicated WebKit/WebCore classes.
