## Why

Offline region downloads already keep running after the user leaves the Regions screen or backgrounds the app (`downloadManager.ts` owns the AbortController and mirrors progress into `regionDownloadStore`), but while the app is backgrounded there is no visible indication that a download is still in progress. Users who lock the phone or switch apps have to reopen Polaris to check status, and it looks like the download may have stopped. Apple Maps, Google Maps, and other download-heavy apps surface ongoing background work in the Live Activity / Dynamic Island. Polaris already ships the Live Activity native stack for turn-by-turn navigation, so extending it to downloads is a small, symmetric addition.

## What Changes

- Add a **second Live Activity type** (`DownloadAttributes`) alongside the existing navigation one, rendered by a new `DownloadLiveActivity` widget in the same `PolarisMapsLiveActivity` extension.
- Add a **background-only lifecycle**: when the app resigns active (`inactive`/`background`) while one or more region downloads are active, start the download Live Activity; when the app returns to `active`, end it. No download Live Activity is shown while the app is foregrounded.
- Show **aggregate progress** for all active downloads in a single activity: a combined percentage, the number of regions downloading, the current stage label ("Downloading map tiles", "Downloading search index", …), and the region name when exactly one download is active.
- Update the activity as progress changes (throttled to ≤1 update/second, only while backgrounded) and mark it complete/end it when all downloads finish, error, or are cancelled.
- Reuse the existing `PolarisLiveActivity` native module and `NSSupportsLiveActivitiesFrequentUpdates`; add `regionName` to `DownloadProgress` so the activity can label a single region.
- Degrade gracefully: when Live Activities are disabled/unauthorized or on non-iOS platforms, everything is a no-op (downloads behave exactly as today).

iOS only — Dynamic Island / ActivityKit has no cross-platform equivalent, and background-only presentation is an iOS UX concept. Android is out of scope.

## Capabilities

### New Capabilities

- `download-live-activity`: Background-only Live Activity / Dynamic Island presentation of aggregate offline-region download progress.

### Modified Capabilities

_None — the existing navigation Live Activity contract is unchanged; downloads get a separate activity type._

## Impact

- **New files**: `src/services/regions/downloadLiveActivity.ts` (AppState + store-driven lifecycle, pure aggregate helper), `plugins/native/PolarisMaps/DownloadAttributes.swift`, `plugins/native/PolarisMapsLiveActivity/DownloadLiveActivity.swift`, `src/native/liveActivity` additions.
- **Modified**: `plugins/native/PolarisMaps/PolarisLiveActivity.swift` + `.m` (second activity), `plugins/native/PolarisMapsLiveActivity/PolarisMapsLiveActivityBundle.swift`, `plugins/withLiveActivities.js` (copy + register new sources), `src/native/liveActivity/index.ts`, `src/services/regions/downloadManager.ts` (populate `regionName`), `src/services/regions/downloadService.ts` (`DownloadProgress.regionName`), `app/_layout.tsx` (init the lifecycle).
- **No new dependencies.**
- **Native**: requires `expo prebuild` + pod install + rebuild to compile the new Swift/widget sources. No hand edits to generated `ios/`.
- **Testing**: unit tests for the pure aggregate helper and lifecycle decision logic (background + active downloads → start; foreground → end; manual verify on device for the widget itself).
