# Street-Level Imagery

Crowd-sourced street imagery capture, privacy-preserving blur, P2P sharing via Hypercore, and spatial browsing.

## Overview

The imagery service enables users to contribute street-level photos to the decentralized map:

1. **Capture** — camera viewfinder with configurable interval (5s default), each image stamped with GPS coordinates, heading, geohash, and a Schnorr signature from the user's keypair
2. **Privacy blur** — placeholder face/license-plate detection (designed for future on-device ML) that re-saves images via expo-image-manipulator
3. **Upload pipeline** — blur → compute hash → append to Hypercore feed → sign metadata → publish to Gun.js for peer discovery
4. **Browse** — query stored imagery by spatial proximity (lat/lng + radius), geohash, or ID from the `street_imagery` SQLite table

## Files

| File                    | Description                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captureService.ts`     | Captures street-level imagery with GPS/heading/geohash metadata and Schnorr signature. Stores images in the app's captures directory.                                                                                                                                                                          |
| `blurService.ts`        | Placeholder privacy blur service — re-saves images via expo-image-manipulator. Designed to be replaced with on-device ML face/plate detection.                                                                                                                                                                 |
| `uploadService.ts`      | Orchestrates the upload pipeline: blur → hash → append to Hypercore feed → sign metadata → publish to Gun.js for peer discovery.                                                                                                                                                                               |
| `browseService.ts`      | Queries locally stored street imagery by spatial proximity (lat/lng + radius), geohash prefix, or ID from the `street_imagery` SQLite table.                                                                                                                                                                   |
| `streetViewService.ts`  | Online street-level 3D panorama lookup, separate from the P2P feed: **Google Street View** (default-on, no key), open **Panoramax** (always) + **Mapillary** (token-gated via `EXPO_PUBLIC_MAPILLARY_TOKEN`). Merges/dedupes 360° panoramas, leading with Google, then Mapillary, then Panoramax newest-first. |
| `streetlevelService.ts` | Google Street View protocol client (lookup + tile/thumbnail URLs). A TypeScript implementation of the requests documented by [`sk-zk/streetlevel`](https://github.com/sk-zk/streetlevel) (MIT) — no streetlevel code is bundled.                                                                               |

## Pipeline

```
Camera viewfinder (5s interval)
    ↓
captureService.ts
    ↓ GPS + heading + geohash + Schnorr signature
blurService.ts
    ↓ face/plate detection (placeholder)
uploadService.ts
    ↓ hash → Hypercore feed → Gun.js metadata
Available to peers for discovery
    ↓
browseService.ts ← spatial query (nearby imagery)
```

## Navigation street-imagery contribution (external)

A separate, opt-in pipeline captures stills while turn-by-turn navigation is
active and uploads them to external platforms. It is deliberately independent of
the P2P `street_imagery` feed above.

| File                                                  | Description                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streetViewCaptureLogic.ts`                           | Pure capture gating (distance/speed/interval/accuracy) and EXIF payload builder for a raw GPS fix.                                                            |
| `streetViewQueue.ts`                                  | SQLite-backed per-drive capture queue, per-platform status, upload batches, crash recovery, and local-file cleanup.                                           |
| `streetViewSession.ts`                                | Start/finalize/discard a drive session; consent gate is applied by `requestStreetViewStart`.                                                                  |
| `panoramaxService.ts`                                 | Panoramax instance catalog, token-claim auth, upload-set creation, multipart JPEG upload with overrides + `picture_id`, completion, and secure token storage. |
| `mapillaryService.ts`                                 | Mapillary embedded-secret OAuth, token refresh, raw JPEG upload + manifest + `finish_upload`, portrait exclusion, and secure token storage.                   |
| `streetViewConsent.ts`                                | One-time consent explainer and the first-run auto-start question.                                                                                             |
| `../../components/imagery/CaptureHost.tsx`            | Global 16:9 camera preview and capture trigger; uses the raw GPS fix and writes EXIF at capture.                                                              |
| `../../components/imagery/DriveUploadSheet.tsx`       | End-of-drive summary, target selection, upload progress, Delete all, and deferred uploads.                                                                    |
| `../../components/imagery/StreetViewContribution.tsx` | Root-mounted coordinator for navigation start/end, auto-start, and crash recovery.                                                                            |
| `../../components/settings/StreetViewSettings.tsx`    | Settings section: master opt-in, mode (Standard/3D), auto-start, Wi-Fi-only, pending drives, Panoramax account.                                               |

Flow:

```
Navigation raw GPS fix (trackingService)
    ↓ distance/speed/interval gate
CaptureHost (global 16:9 CameraView)
    ↓ EXIF: GPS + heading + capture time
streetViewQueue (SQLite + document/streetview/<drive>/)
    ↓ navigation ends
DriveUploadSheet (summary, consent, Delete all)
    ├─ Panoramax upload set + per-file overrides
    │      → Panoramax instance
    └─ Mapillary raw upload + manifest + finish_upload
           → Mapillary cluster (processing)
```

The existing `captureService`/`uploadService`/`blurService` pipeline is **not**
used here: it is P2P-specific, has no EXIF writing, and its placeholder blur
strips metadata. Mapillary blurs server-side; Panoramax instances blur only
when the instance has a blur service enabled.

## Street View 3D (online supplement)

The P2P `street_imagery` feed stays the primary, offline-capable source. The
`Street View 3D` viewer (`app/imagery/street-view.tsx`) adds online coverage:

- **Google Street View** — default-on, no API key. Queried through Google's
  internal ("streetlevel") endpoints, online-only, never cached. Leads the
  lookup wherever it has coverage; every result shows the `© Google`
  copyright line. The imagery is served as 512×512 tiles, which the viewer
  stitches on a canvas (2048×1024 preview first, then 4096×2048).
- **Panoramax** — open, CC-BY-SA, no token; always queried, shown after
  Google and Mapillary, ordered most-recently-captured first.
- **Mapillary** — explicit opt-in exception to the no-corporate-cloud rule:
  hidden without `EXPO_PUBLIC_MAPILLARY_TOKEN`, online-only, never cached for
  offline. Follows Google wherever it has coverage.
- **Viewer** — opens on the most recent capture from any source
  (`sortPanoramasByRecency`), with a top timeline dropdown to step back through
  earlier captures at the same spot.
- **Coverage overlay** (`StreetViewCoverageLayer`) — only advertises viewable
  360° imagery (Panoramax `type = equirectangular`, Mapillary `is_pano = true`)
  and draws every source in one unified colour, so a covered street reads as a
  single green line and a tap always has imagery to open. (Google coverage is
  not drawn yet — tapping a Google-only street is a future overlay.)
- Rendering: `PanoramaViewer` projects the equirectangular image with a real
  WebGL perspective shader (drag to look — the scene follows the finger,
  pinch/wheel to zoom), with a flat fallback if WebGL or the texture upload is
  unavailable.

The Google protocol client lives in `streetlevelService.ts`; the request and
response shapes were mapped from the MIT-licensed
[`sk-zk/streetlevel`](https://github.com/sk-zk/streetlevel) project (no
streetlevel code is bundled or executed — it is Python).

## Related Files

- [`src/components/imagery/`](../../components/imagery/) — Camera viewfinder, image viewer, 3D panorama viewer, and upload queue UI
- [`app/imagery/capture.tsx`](../../../app/imagery/capture.tsx) — Capture screen with interval controls and queue counter
- [`src/services/identity/signing.ts`](../identity/signing.ts) — Schnorr signature for image metadata
- [`src/services/sync/feedSyncService.ts`](../sync/feedSyncService.ts) — Hypercore feed management for image uploads
