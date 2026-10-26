# Research notes: navigation capture → Mapillary / Panoramax

This file records the facts the design relies on. It is not a spec. Endpoints
marked **unofficial** are implemented by Mapillary's own BSD-licensed
`mapillary_tools` but are not part of the public API documentation, so they
need a contract test and a feature flag.

## 1. What the repo already has

| Area                                            | Current state                                                                                           | Gap for this feature                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/services/imagery/captureService.ts`        | 5 s interval signal, `getCurrentPositionAsync`, copies JPEG to `document/captures/`, signs P2P metadata | No distance/speed gating, no EXIF writing, no drive session, P2P-specific                |
| `src/services/imagery/uploadService.ts`         | Placeholder P2P pipeline: blur → hash → fake Hypercore append → Gun.js → SQLite                         | No external upload; not reusable                                                         |
| `src/services/imagery/blurService.ts`           | Re-saves at q0.85 and returns `blurred: true` without detection                                         | **Must not** be used for third-party uploads; it strips EXIF and misrepresents blur      |
| `app/imagery/capture.tsx`                       | Standalone full-screen capture screen                                                                   | Not tied to navigation; timer cleanup is not stored                                      |
| `src/services/imagery/streetViewService.ts`     | Read-only Mapillary + Panoramax lookup; Mapillary client token via `EXPO_PUBLIC_MAPILLARY_TOKEN`        | No write/upload support                                                                  |
| `src/services/navigation/trackingService.ts`    | Full GPS pipeline (snap, reroute, ETA); `processFix(location)` receives the raw fix                     | Does not expose the raw fix to a capture controller                                      |
| `src/stores/navigationTrackingStore.ts`         | Publishes snapped `navPosition`, bearing, speed, distance-to-turn                                       | No raw GPS lat/lng/accuracy/heading                                                      |
| `src/services/navigation/arrivalCoordinator.ts` | Detects arrival/waypoint advance and auto-ends navigation                                               | Natural end-of-drive hook                                                                |
| `src/services/database/init.ts`                 | `street_imagery` table for the P2P feed                                                                 | No capture/upload queue tables                                                           |
| `src/stores/settingsStore.ts`                   | `permissions.imagerySharingEnabled` for P2P                                                             | No third-party contribution consent, density, Wi-Fi, or auto-upload settings             |
| `app.json`                                      | Camera permission + `expo-camera` plugin; portrait locked                                               | Usage copy should mention voluntary street imagery; camera capture only while app active |
| Installed packages                              | `expo-camera`, `expo-file-system`, `expo-secure-store`, `expo-web-browser`, `expo-image`, NetInfo       | No new core dependency needed                                                            |

Key constraint: the app is **portrait locked** (`app.json` `orientation:
"portrait"`). Mapillary wants landscape images. The camera can still produce a
landscape frame if the preview view is 16:9 (iOS crops to the preview aspect
ratio), but this needs a device spike on both OSes. See §4.

## 2. Mapillary

### 2.1 Read API (already used)

- Entity root: `https://graph.mapillary.com`
- Auth: client token or user token, header `Authorization: OAuth <token>`.
- Images: `GET /images?fields=...&bbox=...`.

### 2.2 Upload API (unofficial, from `mapillary_tools`)

Reference implementation: <https://github.com/mapillary/mapillary_tools>
(`upload_api_v4.py`, `uploader.py`, `api_v4.py`). BSD-2-Clause.

The current flow for image sequences is:

1. **Upload each JPEG** to the resumable upload service:

   ```
   POST https://rupload.facebook.com/mapillary_public_uploads/{session_key}
   Authorization: OAuth <user_access_token>
   Offset: 0
   X-Entity-Name: <session_key>
   Content-Type: application/octet-stream
   <raw JPEG bytes>
   ```

   Response: `{ "h": "<file_handle>" }`.

   `session_key` is arbitrary; `mapillary_tools` uses the file MD5 (or a UUID
   with `--noresume`). A UUID is simplest for us. Resuming requires reading the
   current offset with `GET` on the same URL and uploading the remaining bytes.

2. **Upload a manifest** as a `.json` file to the same service:

   ```json
   { "version": "1", "upload_type": "images", "image_handles": ["<h1>", "<h2>"] }
   ```

   Response is another file handle.

3. **Finish the upload**:

   ```
   POST https://graph.mapillary.com/finish_upload
   Authorization: OAuth <user_access_token>
   Content-Type: application/json

   { "file_handle": "<manifest_handle>", "file_type": "mly_bundle_manifest" }
   ```

   Response includes `cluster_id`. Images are processed asynchronously
   (typically 24–48 h), and faces/plates are blurred server-side.

An alternative is to zip a whole sequence and call `finish_upload` with
`file_type: "zip"`. That needs a zip implementation in RN and gives up
per-image progress, so the manifest path is preferred. A zip/export fallback
can be added later for users who do not want to connect an account.

### 2.3 Authentication

- Authorization endpoint: `GET https://www.mapillary.com/connect`
  - `client_id`, `redirect_uri`, `response_type=code`, `scope=upload`, `state`
- Token exchange: `POST https://graph.mapillary.com/token`
  - Header `Authorization: OAuth <client_secret>`
  - JSON `{ grant_type: "authorization_code", code, client_id, redirect_uri }`
  - Response `{ access_token, expires_in, token_type }`
- Refresh: same endpoint with
  `{ grant_type: "refresh_token", refresh_token: <current access token>, client_id }`
- Scopes: `read`, `write`, `upload`. Upload needs a **user** access token.
- Access tokens expire (`expires_in` ≈ 9000 s in the docs), so refresh before
  expiry.

**Security finding:** the token exchange requires the application's client
secret. A mobile app cannot keep that secret. The repo already embeds a
Mapillary client token (`MLY|client_id|client_secret`) via
`EXPO_PUBLIC_MAPILLARY_TOKEN`, so a direct exchange is technically possible,
but enabling upload scope on that token turns the embedded read credential into
an upload credential. **Decision:** ship a dedicated upload-scoped registration
with its client id/secret embedded (`EXPO_PUBLIC_MAPILLARY_CLIENT_ID`,
`EXPO_PUBLIC_MAPILLARY_CLIENT_SECRET`), keep it separate from the read token,
and treat it as extractable. A token broker is the future upgrade path (D9).

### 2.4 Image requirements

From Mapillary Help:

- JPEG with GPS latitude/longitude and capture time in EXIF.
  `DateTimeOriginal` / `DateTimeDigitized` / `DateTime` / GPS date-time are
  accepted.
- **Landscape orientation**; portrait is not supported.
- Maximum 108 MP.
- Sequences should have enough overlap for smooth transitions.
- Processing and blurring happen server-side; expect 24–48 h.

The app can write EXIF at capture time with `expo-camera`'s `additionalExif`
(see §4), so no post-processing step is needed.

### 2.5 Caveats

- The upload endpoints are not in the public API documentation. Pin the flow
  behind a feature flag and contract tests; keep a zip/export fallback path.
- No documented per-sequence image cap today. Mapillary removed the historical
  1,000-image guidance; keep batches bounded for memory/retry reasons, not
  because of a platform limit.
- No documented upload-service rate limit; back off on 429/5xx.
- `finish_upload` returns a cluster id, not a sequence/image id. The UI should
  say "uploaded, processing" and not promise an immediate viewer link.

## 3. Panoramax

### 3.1 Upload API (official)

Docs: <https://docs.panoramax.fr/backend/api/api/>
OpenAPI: each instance exposes `/api/docs/specs.json` (Swagger at
`/api/docs/swagger`).

Flow:

1. **Create an upload set**:

   ```
   POST {instance}/api/upload_sets
   Authorization: Bearer <jwt>
   Content-Type: application/json

   { "title": "Polaris drive 2026-10-21", "estimated_nb_files": 420,
     "sort_method": "time-asc" }
   ```

   Response contains the upload set `id` (also in the `Location` header).

   Useful optional fields: `split_distance`, `split_time`, `visibility`
   (`anyone` | `logged-only` | `owner-only`), `duplicate_distance`,
   `duplicate_rotation`, `relative_heading`, `semantics`, `metadata`.

2. **Upload each JPEG**:

   ```
   POST {instance}/api/upload_sets/{id}/files
   Authorization: Bearer <jwt>
   Content-Type: multipart/form-data

   file=<jpeg>
   override_latitude=<lat>
   override_longitude=<lng>
   override_capture_time=<ISO 8601>
   picture_id=<uuid>
   isBlurred=false
   ```

   The API accepts `override_latitude`, `override_longitude`,
   `override_capture_time` and `extra_exif` alongside the file, so the app does
   not have to rely solely on EXIF. `picture_id` is a preassigned UUID; a
   conflict is a rejection, which we can treat as "already uploaded".
   `isBlurred` must stay `false` because we are not blurring locally.

3. **Complete** the set:

   ```
   POST {instance}/api/upload_sets/{id}/complete
   ```

   Completion is required when the number of files is unknown or fewer than
   `estimated_nb_files` were sent.

4. **Poll status**:

   ```
   GET {instance}/api/upload_sets/{id}
   ```

   `items_status` gives prepared/preparing/rejected counts; `ready` is true when
   collections are created and pictures are served. `associated_collections`
   carries the collection ids/links. `GET /api/upload_sets/{id}/files` lists
   per-file status and rejection reasons.

The server dispatches pictures into collections (sequences) by time/distance,
deduplicates stopped-at-a-light shots, and blurs server-side unless
`isBlurred` is true. Sort order can be `time-asc` so UUID filenames do not
scramble the sequence.

### 3.2 Metadata requirements

Docs: <https://docs.panoramax.fr/pictures-metadata/>

- Required: GPS position and capture time.
- Read from standard EXIF (`GPSLatitude`/`GPSLongitude`,
  `DateTimeOriginal`, `GPSDateStamp`/`GPSDateTime`, etc.), Mapillary tags, or
  upload overrides.
- Optional but useful: `GPSImgDirection` / `GPSTrack` (heading),
  `GPano:ProjectionType` (360°), make/model, focal length, altitude.
- Flat and 360° pictures are both accepted. This change only does flat.

### 3.3 Authentication

Docs: <https://docs.panoramax.fr/backend/api/api/#authentication>

Mobile-friendly token claim flow:

1. `POST {instance}/api/auth/tokens/generate` (unauthenticated) returns a token
   object with `jwt_token`, `id`, and a `links` entry with `rel: "claim"`.
2. Open the claim URL in the browser (`expo-web-browser`). The user logs in via
   the instance's OAuth provider; the token is associated with the account.
3. Poll `GET {instance}/api/users/me` with
   `Authorization: Bearer <jwt_token>` until it returns 200 (or timeout).
4. Store the JWT and token id in `expo-secure-store`.
5. Disconnect with `DELETE {instance}/api/users/me/tokens/{token_id}`.

The example JWT has no `exp` claim and the docs describe saving it long-term;
treat it as a long-lived credential, store it in SecureStore, and revoke on
disconnect. Some instances may not require authentication; a 401 on upload set
creation should trigger the connect flow rather than failing silently.

### 3.4 Instance selection

There is no single Panoramax server. `https://api.panoramax.xyz/api/instances`
returns the harvested catalog (name + `url`). Each instance has its own
account and API. The app should require the user to choose/enter an instance
(HTTPS only) and connect an account there; there is no safe global default that
will have the user's account.

## 4. Expo/native capabilities

Verified against Expo SDK 57 source/docs:

### 4.1 Camera EXIF

`CameraView.takePictureAsync({ exif: true, additionalExif: {...} })` writes
extra EXIF tags at capture time.

- iOS `CameraPhotoCapture.swift` builds a GPS dictionary from
  `GPSLatitude`, `GPSLongitude`, `GPSAltitude`, `GPSSpeed`, `GPSImgDirection`,
  `GPSImgDirectionRef`, `GPSDateStamp`, `GPSTimeStamp`, and merges the remaining
  keys into the EXIF dictionary.
- Android `ResolveTakenPicture.kt` maps `additionalExif` keys through
  `androidx.exifinterface.media.ExifInterface` tags (`GPSLatitude`,
  `GPSLongitude`, `GPSImgDirection`, `GPSDateStamp`, `GPSTimeStamp`,
  `DateTimeOriginal`, etc.) and uses `setLatLong`.
- `exif: true` must be set for `additionalExif` to be useful.

This avoids a JS EXIF library for the happy path. Device verification is still
required because the JS-facing key format is only documented as
`Record<string, any>`.

Suggested tag set:

```
GPSLatitude, GPSLongitude, GPSAltitude, GPSAltitudeRef,
GPSImgDirection, GPSImgDirectionRef = "T",
GPSDateStamp, GPSTimeStamp,
DateTimeOriginal, SubSecTimeOriginal,
Make, Model
```

CoreGraphics expects `GPSTimeStamp` as an array of three numbers, while
Android's `ExifInterface` path expects a string. The implementation writes
`[hours, minutes, seconds]`: iOS consumes it, Android ignores the array and
falls back to `DateTimeOriginal`. `GPSDateStamp` remains a string on both. If
device testing shows any issue, write `DateTimeOriginal` plus `GPSDateStamp`
only; both platforms accept capture time from `DateTimeOriginal`/GPS date-time.

### 4.2 Orientation and crop

- iOS: `responsiveOrientationWhenOrientationLocked` lets the camera follow the
  physical device orientation even when the app is locked portrait.
- iOS `takePicture` crops the full-resolution photo to the **preview's aspect
  ratio** (`CameraPhotoCapture.currentPreviewSize`), not the preview's pixel
  size. A 16:9 preview therefore yields a 16:9 full-resolution crop; a 1×1
  hidden view would yield a useless square crop.
- Android uses `OrientationEventListener` to set ImageCapture target rotation
  and does not crop to the preview aspect ratio.
- The app is portrait locked, so the capture host should render a small **16:9**
  preview (e.g. 96×54) even while the phone is mounted portrait. Whether the
  resulting image is landscape in every mount orientation must be verified on a
  device. If not, Mapillary uploads are gated on landscape captures and
  Panoramax accepts the rest.

### 4.3 Upload transport

`expo-file-system/legacy` `uploadAsync` supports:

- `uploadType: BINARY_CONTENT` with custom headers (Mapillary raw JPEG upload).
- `uploadType: MULTIPART` with `fieldName` + `parameters` (Panoramax file +
  override fields).
- `sessionType: BACKGROUND` on iOS, so an upload can continue when the app is
  backgrounded (JS completion handling may be delayed).

One camera preview can be active at a time; the capture host should be a single
global component, not one per screen.

### 4.4 Background limits

Both iOS and Android suspend camera capture when the app is not active/locked.
There is no Expo background-camera API, and adding an Android foreground service
with camera type is out of scope. The capture session must pause on
`AppState !== 'active'` and resume on return. CarPlay trips where the phone is
locked therefore cannot capture.

### 4.5 3D-friendliness and lens selection

What Google Street View does: **360° panoramas stitched from overlapping
cameras + LiDAR-derived depth/geometry** to pick the best panorama as you move.
A single flat phone lens cannot reproduce that. Mapillary and Panoramax present
flat images as flat photos; Mapillary additionally runs Structure-from-Motion
(SfM) over overlapping images to build point clouds and its "combined panning"
viewer. Panoramax is a flat/360 viewer, not a photogrammetric 3D walkthrough.

What actually helps SfM / a Street-View-like browsing experience:

- **Overlap/density.** Mapillary's own iPhone app captures roughly one image
  every **3 m**; Mapillary says "as long as you capture imagery every few
  meters" there is enough overlap, and video creates more overlap (and better
  3D reconstructions) than stills. A phone still camera can sustain about one
  frame every 0.5–1 s, which is ~7–14 m at 50 km/h. A 20 m cadence is a
  browsing/coverage cadence, not a reconstruction cadence.
- **Wider FOV.** Ultra-wide (0.5×) covers more scene and more shared features
  per frame, which helps overlap, but reduces pixel density per degree, adds
  distortion, and hurts low light. Accurate intrinsics matter more.
- **Rig stability and accurate heading.** A rigid, level mount with correct
  `GPSImgDirection` is easier for SfM than a hand-held phone with changing
  roll/pitch.
- **Resolution/quality.** Full-resolution stills give SfM more features than
  1080p; 1080p is a storage compromise for standard coverage.
- **Video.** Mapillary explicitly says video creates more overlap and better 3D
  reconstructions. The real path to ~3 m spacing is video capture + frame
  extraction (native FFmpeg) or a 360 camera, not faster stills.
- **LiDAR/depth.** iPhones with LiDAR can capture depth, but neither Mapillary
  nor Panoramax ingests depth maps. It is not useful for these uploads; it
  could only power a future local 3D viewer.

Expo Camera lens selection:

- iOS only: `selectedLens` prop + `getAvailableLensesAsync()` +
  `onAvailableLensesChanged`. The prop selects an `AVCaptureDevice` lens; Apple's
  device types include `builtInUltraWideCamera`, `builtInWideAngleCamera`,
  `builtInTelephotoCamera`, and virtual multi-camera devices.
- The implementation compares against `AVCaptureDevice.localizedName` (e.g.
  "Ultra Wide Camera"), **not** the stable device-type identifier. The docs'
  default `'builtInWideAngleCamera'` is inconsistent with that implementation.
  Match defensively on the returned strings and verify the selected lens/FOV on
  a device; a tiny native selector may be needed for non-English locales.
- The `zoom` prop is `0..1` of the device's maximum zoom and the native code
  clamps `minZoom = 1.0`; it cannot go below the wide lens. Do not try
  `zoom={0.5}` for 0.5×.
- Android: `selectedLens` is iOS-only; `expo-camera` does not expose ultra-wide
  selection. Use the default wide lens unless a native module is added.

### 4.6 Video capture and frame extraction

**Expo recording.** `CameraView.recordAsync(options)` records to the cache
directory and returns `{ uri }` when stopped by `stopRecording`, `maxDuration`,
`maxFileSize`, or the preview stopping. `videoQuality` supports `2160p`,
`1080p`, `720p`, `480p`, `4:3`; `videoBitrate` and `videoStabilizationMode` are
available. Videos are rotated to match device orientation; flipping the camera
stops the recording. Audio can be muted on the view. There is no frame-rate
control and no frame extraction API.

**Frame extraction.** `expo-video-thumbnails.getThumbnailAsync(uri, { time })`
returns one thumbnail per call; it is fine for previews, not for thousands of
frames (each call opens/seeks the asset). A real implementation needs a native
sequential decoder:

- iOS: `AVAssetReader` + `AVAssetReaderTrackOutput` (sequential decode) or
  `AVAssetImageGenerator` with zero tolerance for sparse frames; convert the
  `CMSampleBuffer` to `UIImage`/`CIImage` and JPEG-encode with metadata.
- Android: `MediaExtractor` + `MediaCodec` with an `ImageReader`/`Surface`, or
  `MediaMetadataRetriever.getFrameAtTime` for sparse frames (too slow for
  thousands).
- A maintained FFmpeg wrapper is an alternative, at the cost of binary size,
  licensing, and another dependency. Native AVFoundation/MediaCodec avoids
  that.

**GPS/time sync.** Video frames carry presentation timestamps relative to the
recording start, not GPS positions. The app would keep a timestamped GPS track
(the navigation pipeline already has one) and interpolate position/heading for
each selected frame. A 1 s sync error is ~14 m at 50 km/h. The robust approach
records the host time of the first video sample in a native module; an
app-level `Date.now()` before `recordAsync` has a startup latency of a few
hundred milliseconds. A constant offset is less damaging than random jitter
because the whole sequence shifts together, but it should be calibrated.

**Metadata.** Extracted frames have no useful EXIF. Mapillary requires GPS +
capture time in EXIF; Panoramax accepts `override_latitude`,
`override_longitude`, and `override_capture_time` alongside the file, so only
Mapillary strictly needs an EXIF writer. A native writer is fast; `piexifjs` is
a pure-JS fallback.

**Platform support.** Mapillary's direct video upload accepts telemetry-rich
formats — GPMF (GoPro), CAMM, and BlackVue — not a generic phone MP4.
`mapillary_tools` samples generic video locally with FFmpeg (default one frame
every 3 m) and then uploads JPEGs. Panoramax accepts JPEG only. So for a phone
MP4, frame extraction must happen on-device (or via a desktop export); there is
no "upload the MP4 and let the platform sample it" endpoint.

**Storage/volume math.**

- 1080p30 H.264 ≈ 8–10 Mbps ≈ 3.6–4.5 GB/hour; HEVC roughly half.
- 4K30 HEVC ≈ 15–20 GB/hour.
- 3 m at 50 km/h ≈ 16,700 frames/hour; at ~250 KB/frame ≈ 4 GB of JPEGs.
- 5 m ≈ 10,000 frames/hour ≈ 2.5 GB; 10 m ≈ 5,000 frames/hour ≈ 1.25 GB.
- Peak storage is video + extracted frames until the video is deleted; a
  30-minute drive at 5 m is roughly 1.5–2.5 GB.

**Recording lifecycle.** Segment recordings (2–5 min) limit loss from a crash,
thermal shutdown, or incoming call; an interrupted MP4 may not finalize its
moov atom. Store the segment start time and duration with each file. Mute audio
for privacy. Process segments after the drive, with resumable per-segment
state; do not decode video while also driving/rendering the map.

**Alternative: dense stills.** A one-frame-per-0.5 s loop using the existing
`takePictureAsync` pipeline gives ~4–7 m at city speeds with per-frame EXIF and
no native extraction. It is camera/thermal-heavy and cannot reach 3 m at
highway speed, but it is a much smaller step than video.

## 5. Platform comparison

| Question                     | Mapillary                                                                                    | Panoramax                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Upload API documented?       | No (reference: `mapillary_tools` source)                                                     | Yes (OpenAPI per instance)                                   |
| Auth for upload              | User OAuth token, `upload` scope; exchange needs client secret                               | Instance token claim → JWT bearer; no app secret             |
| Image requirements           | JPEG + GPS + capture time EXIF; landscape; ≤108 MP                                           | JPEG + position + capture time; flat or 360°                 |
| Metadata overrides on upload | No (EXIF is the contract)                                                                    | Yes (`override_*`, `extra_exif`)                             |
| Idempotency key              | Session key + file handle; no picture UUID                                                   | `picture_id` UUID                                            |
| Sequence model               | One manifest/cluster per upload; server groups                                               | Upload set → server splits into collections by time/distance |
| Dedup/stop-light handling    | Server processing                                                                            | Server dedup + `duplicate_distance`                          |
| Blur                         | Server-side                                                                                  | Server-side unless `isBlurred`                               |
| Processing visibility        | 24–48 h; no immediate image ids                                                              | `upload_sets/{id}` status + collection ids                   |
| Public/private control       | Public                                                                                       | `visibility` per upload set                                  |
| 3D                           | SfM point clouds + combined panning from overlap; no Street-View-grade 3D from sparse stills | Flat/360 viewer; no reconstruction pipeline                  |
| Rate limits                  | Graph API documented; upload service not                                                     | Per-instance; follow headers/backoff                         |
| Native app secret needed     | Yes for OAuth exchange                                                                       | No                                                           |

## 6. Sources

- Mapillary API docs: <https://www.mapillary.com/developer/api-documentation>
- Mapillary upload imagery help: <https://help.mapillary.com/hc/en-us/articles/115001472029>
- Mapillary tools: <https://github.com/mapillary/mapillary_tools>
- Mapillary FAQ on portrait/sequences: <https://blog.mapillary.com/product/2017/03/17/mapillary-faq.html>
- Mapillary computer vision / SfM: <https://help.mapillary.com/hc/en-us/articles/115001770329>
- Mapillary video support (overlap/3D): <https://blog.mapillary.com/update/2023/01/26/video-support.html>
- Google Street View how it works (360 + LiDAR): <https://www.google.co.uk/streetview/how-it-works>
- Panoramax HTTP API: <https://docs.panoramax.fr/backend/api/api/>
- Panoramax picture metadata: <https://docs.panoramax.fr/pictures-metadata/>
- Panoramax OpenAPI (example instance): <https://panoramax.ign.fr/api/docs/specs.json>
- Panoramax instance catalog: <https://api.panoramax.xyz/api/instances>
- Expo Camera: <https://docs.expo.dev/versions/latest/sdk/camera/>
- Expo FileSystem uploads: <https://docs.expo.dev/versions/latest/sdk/filesystem-legacy/>
