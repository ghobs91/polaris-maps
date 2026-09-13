## 1. Native Live Activity (attributes, widget, bridge)

- [x] 1.1 Add `plugins/native/PolarisMaps/DownloadAttributes.swift` with `DownloadAttributes` / `ContentState` (`percent`, `regionCount`, `label`, `stage`, `isComplete`) per design D2
- [x] 1.2 Add `plugins/native/PolarisMapsLiveActivity/DownloadLiveActivity.swift`: Lock Screen view (progress bar + label + percent + stage) and Dynamic Island compact/expanded/minimal regions
- [x] 1.3 Add `DownloadLiveActivity()` to `PolarisMapsLiveActivityBundle.swift`
- [x] 1.4 Extend `PolarisLiveActivity.swift` with `currentDownloadActivity` and `startDownloadActivity` / `updateDownloadActivity` / `endDownloadActivity(immediate:)` per design D7; keep navigation methods untouched
- [x] 1.5 Add the matching `RCT_EXTERN_METHOD` declarations to `PolarisLiveActivity.m`
- [x] 1.6 Extend `plugins/withLiveActivities.js`: add `DownloadAttributes.swift` to `NATIVE_FILES`, `DownloadLiveActivity.swift` to `EXTENSION_FILES`, register both targets, and add `PolarisMaps/DownloadAttributes.swift` to the extension sources

## 2. TypeScript native wrapper & aggregate helper

- [x] 2.1 Extend `src/native/liveActivity/index.ts` with `startDownloadActivity`, `updateDownloadActivity`, `endDownloadActivity(immediate)` and a typed `DownloadLiveActivityState`
- [x] 2.2 Add optional `regionName?: string` to `DownloadProgress` in `downloadService.ts`
- [x] 2.3 In `downloadManager.startBackgroundDownload`, wrap `emit` per region to attach `region.name`
- [x] 2.4 Create `src/services/regions/downloadLiveActivity.ts` with the pure `computeDownloadAggregate(progressByRegion, activeIds)` helper returning `{ percent, regionCount, label, stage, isComplete } | null` (design D3)

## 3. Lifecycle service

- [x] 3.1 In `downloadLiveActivity.ts`, implement `initDownloadLiveActivity()`: idempotent app-global initializer that subscribes to `AppState` and `useRegionDownloadStore`
- [x] 3.2 Start on `inactive` and retry on `background` when an aggregate exists and the native module is present; guard against duplicate starts and log-silence failures (design D5)
- [x] 3.3 Throttle progress updates to ≤1/second and only when `percent`/`label`/`stage` change while the activity is active
- [x] 3.4 End immediately on `active`; on aggregate becoming `null` while active, update `isComplete` and call `endDownloadActivity(false)` for a short completion dismissal
- [x] 3.5 Call `initDownloadLiveActivity()` once from `app/_layout.tsx`
- [x] 3.6 No-op cleanly on non-iOS / when Live Activities are unauthorized (never throw into download paths)

## 4. Tests

- [x] 4.1 Unit tests for `computeDownloadAggregate`: single region, multiple regions (mean percent, "N regions" label), terminal stages excluded, `null` when none active, percent clamping
- [x] 4.2 Unit tests for lifecycle decisions using an injected fake snapshot + mocked native module: background with active download → start; foreground → end; completion while backgrounded → end non-immediate; unavailable → no calls
- [x] 4.3 Run the new suites and confirm no regressions in related download tests: `pnpm test -- __tests__/unit`

## 5. Native rebuild & device verification

- [ ] 5.1 `pnpm prebuild && pnpm ios:pods` (requires user go-ahead — prebuild wipes `ios/`) and build to device
- [ ] 5.2 Verify: start a region download, background the app → Lock Screen + Dynamic Island show aggregate progress; return to foreground → activity dismissed
- [ ] 5.3 Verify: multiple concurrent downloads aggregate into one activity and the label reads "N regions"
- [ ] 5.4 Verify: completion/error/cancel in the background grace window ends the activity correctly; no activity appears when downloading in the foreground only
- [ ] 5.5 Verify navigation Live Activity is unaffected (start/stop navigation, confirm unchanged behavior)

## 6. Quality gates

- [x] 6.1 Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`
- [x] 6.2 Run the relevant test suites and report actual results (pre-existing failures documented as a known issue)
