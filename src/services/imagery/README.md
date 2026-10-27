# Street-Level Imagery

Crowd-sourced street imagery capture, privacy-preserving blur, P2P sharing via Hypercore, and spatial browsing.

## Overview

The imagery service enables users to contribute street-level photos to the decentralized map:

1. **Capture** — camera viewfinder with configurable interval (5s default), each image stamped with GPS coordinates, heading, geohash, and a Schnorr signature from the user's keypair
2. **Privacy blur** — placeholder face/license-plate detection (designed for future on-device ML) that re-saves images via expo-image-manipulator
3. **Upload pipeline** — blur → compute hash → append to Hypercore feed → sign metadata → publish to Gun.js for peer discovery
4. **Browse** — query stored imagery by spatial proximity (lat/lng + radius), geohash, or ID from the `street_imagery` SQLite table

## Files

| File                          | Description                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captureService.ts`           | Captures street-level imagery with GPS/heading/geohash metadata and Schnorr signature. Stores images in the app's captures directory.                                                                                                                                                                                                             |
| `blurService.ts`              | Placeholder privacy blur service — re-saves images via expo-image-manipulator. Designed to be replaced with on-device ML face/plate detection.                                                                                                                                                                                                    |
| `uploadService.ts`            | Orchestrates the upload pipeline: blur → hash → append to Hypercore feed → sign metadata → publish to Gun.js for peer discovery.                                                                                                                                                                                                                  |
| `browseService.ts`            | Queries locally stored street imagery by spatial proximity (lat/lng + radius), geohash prefix, or ID from the `street_imagery` SQLite table.                                                                                                                                                                                                      |
| `streetViewService.ts`        | Online street-level 3D panorama lookup, separate from the P2P feed: **Google Street View** (default-on, no key), open **Panoramax** (always) + **Mapillary** (token-gated via `EXPO_PUBLIC_MAPILLARY_TOKEN`). Merges/dedupes 360° panoramas, leading with Google, then Mapillary, then Panoramax newest-first.                                    |
| `streetlevelService.ts`       | Google Street View protocol client (lookup + tile/thumbnail URLs). A TypeScript implementation of the requests documented by [`sk-zk/streetlevel`](https://github.com/sk-zk/streetlevel) (MIT) — no streetlevel code is bundled.                                                                                                                  |
| `mapillaryTrafficControls.ts` | Mapillary **traffic-control map features**: stop signs (`regulatory--stop--*`) and traffic lights (`object--traffic-light--*`), with coverage-aware lookups and per-cell caching. Feeds the navigation-map icons (`TrafficControlLayer`) and the unmanaged-turn preference in routing (`hassleTurns.ts`). Token-gated like the rest of Mapillary. |

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

| File                                                  | Description                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `streetViewCaptureLogic.ts`                           | Pure capture gating (distance/speed/interval/accuracy) and EXIF payload builder for a raw GPS fix.                                                                                                                                                                                                                                   |
| `streetViewQueue.ts`                                  | SQLite-backed per-drive capture queue, Mapillary upload status, upload batches, crash recovery, and local-file cleanup.                                                                                                                                                                                                              |
| `streetViewSession.ts`                                | Start/finalize/discard a drive session; consent gate is applied by `requestStreetViewStart`.                                                                                                                                                                                                                                         |
| `mapillaryService.ts`                                 | Mapillary embedded-secret OAuth, token refresh, raw JPEG upload + manifest + `finish_upload`, portrait exclusion, drive segmentation into clusters, 429/5xx retry with backoff, refresh-and-retry on 401, and secure token storage.                                                                                                  |
| `streetViewConsent.ts`                                | One-time consent explainer for the street-imagery master switch and manual capture starts. Navigation start itself never prompts — street imagery is a Settings-only decision.                                                                                                                                                       |
| `../../components/imagery/CaptureHost.tsx`            | Global VisionCamera host: bottom-quarter live band on the navigation screen (compact pill elsewhere), street stills (wide + optional paired telephoto detail), and segmented dash-cam recording from one photo + video session.                                                                                                      |
| `../../components/imagery/DriveUploadSheet.tsx`       | End-of-drive summary, Mapillary upload, upload progress, Delete all, and deferred uploads.                                                                                                                                                                                                                                           |
| `../../components/imagery/StreetViewContribution.tsx` | Root-mounted coordinator for navigation start/end and crash recovery. Dash cam first: the first-ever navigation start asks once whether to record every drive ("Not now" keeps the record button and never asks again); an auto-started run stops with its navigation. Street imagery auto-starts silently when enabled in Settings. |
| `../../components/settings/StreetViewSettings.tsx`    | Settings section: master opt-in, mode (Standard/3D), detail frames, auto-start, Wi-Fi-only, pending drives, Mapillary account.                                                                                                                                                                                                       |

Flow:

```
Navigation raw GPS fix (trackingService)
    ↓ distance/speed/interval gate
CaptureHost (global 16:9 CameraView)
    ↓ EXIF: GPS + heading + capture time
streetViewQueue (SQLite + document/streetview/<drive>/)
    ↓ navigation ends
DriveUploadSheet (summary, consent, Delete all)
    └─ Mapillary raw upload + manifest + finish_upload
           → Mapillary cluster (processing)
```

The existing `captureService`/`uploadService`/`blurService` pipeline is **not**
used here: it is P2P-specific, has no EXIF writing, and its placeholder blur
strips metadata. Mapillary blurs faces and plates server-side.

### Detail stream (telephoto)

`streetView.detailStream` adds a second, paired perspective to some capture
points:

- Every 5th wide frame (≈100 m in standard mode) the camera switches to the
  telephoto lens — the lowest factor above 1× in
  `CameraDevice.zoomLensSwitchFactors` — captures one frame, then returns to
  1×. The detail row reuses the wide frame's GPS fix, speed and heading, and
  carries `stream = 'detail'` plus `pair_id` (the wide frame's id).
- The wide frame is always taken **first**, so `stream = 'wide'` remains the
  distance-accurate Mapillary sequence.
- Mapillary uploads the wide stream first and the detail stream second.
  `segmentCaptures` runs per stream and the segment lists are concatenated, so
  a cluster never mixes perspectives.
- Skipped on devices without a tele lens, while the dash cam is recording
  (the zoom change would appear in the footage), and in 3D mode (the
  ultra-wide input has no tele constituent).

Unverified: Mapillary may treat two frames captured ~0.5 s apart at the same
fix as duplicates. Check the published cluster coverage after the first real
drive before enabling detail upload by default.

**Why not concurrent:** iOS lets one `AVCaptureSession` own the camera devices
at a time, and VisionCamera owns the session that feeds the preview, the
stills and the dash-cam video. Opening a second `AVCaptureMultiCamSession`
would interrupt all three. Hardware-concurrent capture requires moving the
whole camera backend to `AVCaptureMultiCamSession`; the queue/manifest model
above stays the same, only the capture call site changes.

## Dash cam (local rolling buffer)

`src/services/dashcam/` records muted video in fixed-length segments while you
drive and keeps only the most recent footage. It is the capture feature users
are offered first: the first time active navigation starts (phone or CarPlay),
one alert asks whether to record every drive. "Not now" keeps the record
button on the navigation screen and the question never returns;
Settings → Dash cam → Start on every drive changes the answer later. An
auto-started run stops when its navigation ends, and `dashCamStartLogic.ts`
holds the decision so it stays testable.

Recording pipeline:

```
CaptureHost (VisionCamera: CameraPhotoOutput + CameraVideoOutput in one session)
    ↓ segmented recorder (maxDuration = clipSeconds), muted
dashCamQueue (SQLite + document/dashcam/<clipId>.mp4)
    ↓ after every segment
dashCamRetention.planDashCamPrune (time cap + size cap, oldest first)
    → app/dashcam/index.tsx (playback via expo-video, share via expo-sharing)
```

- **Opt-in and explicit**: recording only starts from the navigation action; it
  stops when the navigation screen is gone or the app is backgrounded/locked
  (the camera session ends, so the loop pauses and resumes with the next
  segment).
- **Two caps, whichever binds first**: `dashCam.maxMinutes` and
  `dashCam.maxBytes`. Changing either in Settings prunes immediately.
- **Muted**: `enableAudio: false`, so no microphone permission is requested.
- **Runs alongside stills**: VisionCamera connects a photo output and a video
  output to the same session, so a street-imagery still can be captured while a
  dash-cam segment is recording. (This replaced expo-camera, which binds either
  the photo or the movie output and forced the two features to be exclusive.)
- **EXIF**: stills get GPS latitude/longitude and capture time from
  VisionCamera's `location` tagging (`react-native-vision-camera-location`).
  `GPSImgDirection` is not written by VisionCamera; Mapillary derives the
  compass angle during processing. Restoring the heading tag needs an EXIF
  post-pass.

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
