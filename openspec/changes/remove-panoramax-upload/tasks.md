# Tasks

## 1. Service removal

- [x] Delete `src/services/imagery/panoramaxService.ts` (catalog, token-claim auth, upload sets, secure token storage).
- [x] Delete `__tests__/unit/panoramaxService.test.ts`.

## 2. Upload path

- [x] `DriveUploadSheet.tsx`: remove the Panoramax destination, its auth probe, and its upload branch; Mapillary is the only target.
- [x] `streetViewQueue.ts`: remove `setCapturePanoramaxStatus` and `getPendingPanoramaxCaptures`.
- [x] `models/streetViewCapture.ts`: drop the `panoramax*` capture fields; `StreetViewUploadTarget = 'mapillary'`.
- [x] `database/init.ts`: stop creating `panoramax_status` / `panoramax_instance` / `panoramax_picture_id` and their index.

## 3. Settings

- [x] `StreetViewSettings.tsx`: remove the Panoramax group, instance picker, connect/disconnect handlers, and picker styles.
- [x] `settingsStore.ts`: remove `panoramaxInstanceUrl` and `panoramaxUsername`.
- [x] `streetViewConsent.ts`: consent copy describes Mapillary only.

## 4. Verification

- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm format:check`
- [x] `pnpm test` (2312 passed, 1 skipped, 0 failed)
- [ ] Device check: Settings shows no Panoramax section; end-of-drive sheet offers Mapillary only.
