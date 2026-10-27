## Why

Street-imagery capture supports one upload target: Mapillary. Panoramax uploads required
picking a public instance from a federated catalog, then signing in separately per instance
(token-claim flow, instance-specific account rules, instance-specific blur availability).
That cost — an instance picker plus a second account model — outweighed the value of the
second target, and it made end-of-drive consent harder to explain.

Panoramax **read-only** usage is unaffected: the public STAC search endpoint needs no account
and stays in the 3D street-view viewer, the coverage layer, and place media carousels.

## What Changes

- **Remove Panoramax as an upload target**: delete `panoramaxService.ts` (instance catalog,
  token-claim auth, upload sets, multipart upload, secure token storage), drop the Panoramax
  branch from `DriveUploadSheet`, and make the sheet Mapillary-only.
- **Remove the Panoramax settings surface**: no instance picker, no instance/account rows, no
  `panoramaxInstanceUrl` / `panoramaxUsername` settings.
- **Drop Panoramax upload state** from the contribution queue: `StreetViewCapture` no longer
  carries `panoramaxStatus` / `panoramaxInstance` / `panoramaxPictureId`,
  `StreetViewUploadTarget` is `'mapillary'`, and `setCapturePanoramaxStatus` /
  `getPendingPanoramaxCaptures` are deleted.
- **Stop creating the Panoramax columns** in new databases. Existing installs keep the
  (now unused) columns; nothing reads them, and `CREATE TABLE IF NOT EXISTS` does not touch
  them.
- **Update the consent copy** to describe a single destination.

## Impact

- Deleted: `src/services/imagery/panoramaxService.ts`,
  `__tests__/unit/panoramaxService.test.ts`.
- Modified: `DriveUploadSheet.tsx`, `StreetViewSettings.tsx`, `streetViewQueue.ts`,
  `streetViewCapture.ts`, `settingsStore.ts`, `database/init.ts`, `streetViewConsent.ts`,
  `streetViewCaptureLogic.ts`, `mapillaryService.ts` (comment), plus two test fixtures.
- Unchanged: `streetViewService.ts`, `StreetViewCoverageLayer.tsx`, `placeMediaProviders.ts`,
  `placeMediaService.ts` (these read the keyless public Panoramax API).

## Non-goals

- Removing Panoramax imagery from the viewer, coverage layer, or place media.
- Renaming the existing read-only `EXPO_PUBLIC_MAPILLARY_TOKEN`.
