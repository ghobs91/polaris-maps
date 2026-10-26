# Design: capture while navigating, upload at the end of the drive

## Context

Polaris is a navigation app with a full GPS pipeline that runs for the whole
trip, a camera permission, and an arrival coordinator that already knows when a
drive ends. It also has a P2P street-imagery prototype, but that pipeline is
signed/Hypercore-oriented, uses a 5 s timer, and has a placeholder "blur" that
only re-saves the file. It cannot be pointed at Mapillary or Panoramax as-is.

Both platforms accept ordinary geotagged JPEGs from a phone. The interesting
work is therefore not the HTTP calls; it is:

1. deciding **when** to capture without flooding storage or duplicating
   stopped-at-a-light frames,
2. producing **correct metadata** (GPS, heading, capture time) and landscape
   geometry from a portrait-locked navigation UI,
3. surviving app kills, backgrounding, and flaky networks with a **local
   queue**,
4. giving the user a **summary and consent** moment before photos become public,
5. handling the two platforms' very different **auth** models.

## Goals / Non-Goals

**Goals**

- Opt-in capture during an active drive, with a clear recording indicator and a
  one-tap stop.
- Landscape 16:9 JPEGs with GPS, heading, and capture time that both platforms
  accept without post-processing.
- A crash-safe per-drive queue; end-of-drive summary; per-platform upload with
  progress, retry, and Wi-Fi-only defaults.
- Panoramax upload fully in-app, including instance connect and token claim.
- Mapillary upload in-app behind a user OAuth connection, with a secure
  production token-exchange path.
- No new camera/location permission prompts beyond what the app already asks
  for; no background camera.
- Keep the P2P imagery feature independent and unchanged.

**Non-goals**

- 360°/equirectangular capture, external 360 cameras, or panorama stitching.
- Video capture and on-device frame extraction.
- Capturing while the phone is locked or the app is backgrounded.
- Android foreground-service camera work.
- Routing the new captures into the P2P `street_imagery` feed.
- A full photo editor or manual EXIF editing UI.

## Decisions

### D1: A separate external-contribution pipeline, not an extension of the P2P uploader

Create `src/services/imagery/streetView*` (capture, EXIF, queue, Panoramax and
Mapillary clients) and new SQLite tables. Leave `captureService`,
`uploadService`, `blurService`, `browseService`, and `app/imagery/capture.tsx`
alone.

Rationale: the P2P model is built around Schnorr signatures, geohash indexing,
Hypercore feed keys, and Gun.js discovery. External platforms need EXIF,
landscape geometry, OAuth, and per-platform remote ids. Forcing both through
one model would make the P2P contract hang on third-party fields and risk
breaking existing signature/feed consumers. The two paths can share the camera
component and the capture screen later if that becomes worthwhile.

Alternative rejected: extend `uploadService` with a `target` parameter. It
would still need every one of the new tables and clients, and the existing
`blurred: true` placeholder would leak into third-party uploads.

### D2: Session lifecycle follows navigation; camera host is global

A `streetViewCapture` coordinator subscribes to `navigationStore`:

- `isNavigating` false → true and capture is armed → start a drive session.
- `isNavigating` true → false → finalize the session, stop the camera, and
  offer the upload sheet.
- `stopNavigation` from any surface (nav screen, CarPlay, arrival auto-end)
  ends the session the same way.

The camera lives in one `CaptureHost` mounted in `app/_layout.tsx`, not in
`app/(tabs)/navigation.tsx`. The host renders a small 16:9 preview + red dot +
count whenever a session is active, and owns the `CameraView` ref and capture
loop.

Rationale: Expo Router tabs and the CarPlay companion can leave the navigation
screen unmounted; a screen-owned camera would silently stop capturing. Expo
Camera also allows only one active preview, so a single host is the safest
shape.

The host pauses on `AppState !== 'active'` and resumes on return. The session
stays logically active (the indicator says "Paused — app in background") but no
frames are taken. This is a hard platform limit, not a bug.

### D3: Trigger from the raw GPS fix, gated by distance, speed, and a minimum interval

Extend `trackingService.processFix` to publish the raw fix (lat, lng, altitude,
accuracy, heading, speed, timestamp) to a new field on
`navigationTrackingStore`. The capture host subscribes to that store.

Pure `shouldCapture(previous, fix, config)` logic:

- Ignore fixes with poor accuracy (e.g. > 50 m) or no valid position.
- Ignore when speed < 4 m/s (~14 km/h): avoids duplicate frames at lights,
  car parks, and traffic jams; the platforms dedupe but we should not spend
  storage on them.
- Require distance since the last accepted capture ≥ configured spacing
  (default 20 m; options 10/20/40 m).
- Require at least 1.2 s since the last accepted capture (camera pipeline
  limit) and no capture currently in flight.
- On camera-busy or capture error, skip this fix and try the next one; never
  queue a backlog of shots.

At 50 km/h, 20 m ≈ 1.44 s, which is near the camera limit; at 100 km/h the
1.2 s floor raises effective spacing to ~33 m. That is the honest trade-off for
stills; video sampling would be denser but requires frame extraction and is out
of scope.

### D4: Capture geometry and metadata

- Render the preview at **16:9** even when small. On iOS the still is cropped to
  the preview's aspect ratio; a 1×1 hidden view would produce a square photo.
- Request a 1920×1080 `pictureSize` when available; fall back to the default
  and accept the larger file. Quality 0.8.
- `exif: true` + `additionalExif` with:
  `GPSLatitude`, `GPSLongitude`, `GPSAltitude`, `GPSAltitudeRef`,
  `GPSImgDirection`, `GPSImgDirectionRef: "T"`, `GPSDateStamp`,
  `GPSTimeStamp`, `DateTimeOriginal`, `SubSecTimeOriginal`.
- Heading: use the raw GPS heading when speed is high enough and the value is
  finite; otherwise fall back to the snapped navigation bearing; otherwise
  omit direction rather than write a wrong one.
- Do **not** run `expo-image-manipulator` after capture; it strips EXIF. Copy
  the temporary camera file into `document/streetview/{driveId}/{id}.jpg`
  unchanged.
- `shutterSound: false`, `animateShutter: false` to avoid a click every 1.5 s.
- If the resulting image is portrait, keep it for Panoramax but exclude it from
  Mapillary (which requires landscape) and tell the user at upload time. The
  Phase 0 spike decides whether a 16:9 preview + orientation props can always
  produce landscape on both OSes; if yes, this fallback is rarely used.

Alternative rejected: post-process/rotate portrait images into landscape. It
does not add field of view and produces a sideways scene; it would fail the
platform's quality bar.

### D5: Local queue in SQLite, per-target state on each capture

New tables (names illustrative; final schema in implementation):

```
streetview_drives
  id, started_at, ended_at, status, capture_count, bytes, last_error

streetview_captures
  id (UUID, also filename/picture_id), drive_id, local_uri,
  lat, lng, altitude, heading, speed_mps, captured_at,
  width, height, bytes, image_hash, blurred,
  panoramax_status, panoramax_instance, panoramax_picture_id,
  mapillary_status, mapillary_file_handle, mapillary_image_id,
  attempts, last_error, created_at

streetview_uploads
  id, drive_id, target, remote_batch_id, status,
  total, uploaded, failed, created_at, updated_at, last_error
```

Why SQLite instead of a JSON sidecar: the queue must survive process kills,
partial uploads, and app upgrades; the repo already uses SQLite for similar
state. Local files remain the source of truth for bytes; rows are the index.

Idempotency:

- Panoramax: `picture_id` = capture UUID. A duplicate/conflict is treated as
  already uploaded.
- Mapillary: store the returned file handle immediately; if it is missing on a
  retry, upload with a fresh session key (the old session becomes an orphan).
  Duplicate bytes are preferable to a stuck queue. Mapillary may dedupe
  server-side.

### D6: End-of-drive summary is the consent gate

When a session finalizes, the app sets `pendingDriveReview` and the root layout
renders a `DriveUploadSheet`:

- summary: count, MB, drive duration/distance;
- per-platform checkboxes (only connected platforms are selectable);
- "Upload", "Not now", "Delete all";
- Wi-Fi-only and "always upload" preferences.

No photo leaves the device until the user taps Upload (or has explicitly
enabled auto-upload). This is the privacy moment: the user sees how much was
captured and chooses the destination. MVP intentionally has no per-photo review
grid; "Delete all" is the escape hatch. A thumbnail grid can be added later
without changing the queue or upload contracts.

Automatic upload, if enabled, still respects the Wi-Fi-only setting and shows a
notification/progress surface.

### D7: Panoramax client — one upload set per drive, per-file overrides

```
POST {instance}/api/upload_sets
  { title, estimated_nb_files, sort_method: "time-asc" }
→ id

for each capture (time-asc):
  POST {instance}/api/upload_sets/{id}/files  (multipart)
    file={jpeg}
    override_latitude, override_longitude
    override_capture_time = ISO 8601
    picture_id = capture UUID
    isBlurred = false

POST {instance}/api/upload_sets/{id}/complete
GET  {instance}/api/upload_sets/{id}   (poll until ready)
```

Rationale: the overrides make the upload robust even if a device fails to write
EXIF, and `picture_id` gives us idempotency. The server handles sequence
splitting, stopped-at-light dedupe, and blurring. Store
`associated_collections` for "View on Panoramax" links.

The client should first `GET {instance}/api/configuration` (or simply attempt
the upload set and handle 401) and require an HTTPS instance URL. On 401, mark
the account disconnected and keep the queue.

Alternative rejected: create a collection and post items directly
(`POST /api/collections/{id}/items`). It is more code and bypasses the upload
set's dedupe/split/status features.

### D8: Mapillary client — raw uploads + manifest, one cluster per drive segment

```
for each capture (time-asc):
  POST https://rupload.facebook.com/mapillary_public_uploads/{uuid}.jpg
    Authorization: OAuth <user token>
    Offset: 0
    X-Entity-Name: <uuid>.jpg
    <raw JPEG>
  → { h: fileHandle }

POST https://rupload.facebook.com/mapillary_public_uploads/{uuid}.json
  <manifest { version:"1", upload_type:"images", image_handles:[...] }>
→ { h: manifestHandle }

POST https://graph.mapillary.com/finish_upload
  { file_handle: manifestHandle, file_type: "mly_bundle_manifest" }
→ { cluster_id }
```

One cluster per drive (split at ~2,000 images or a >10 min gap only for
manageability). Mapillary processing is asynchronous; the UI reports
"Uploaded — Mapillary is processing (typically 24–48 h)".

Rationale: no zip dependency, per-image progress and retry, and it follows the
official `mapillary_tools` implementation. The upload service is unofficial;
feature-flag it and keep a contract test.

Alternative considered: zip + `file_type: "zip"`. Fewer requests, but requires
a zip library and loses per-image resume/progress. Keep as a fallback/export
path if the manifest flow breaks.

If a capture is portrait, skip it for Mapillary and report it; do not upload a
file the platform will reject.

### D9: Auth — Panoramax claim flow; embedded Mapillary upload client secret

**Panoramax:**

1. user enters/chooses an HTTPS instance;
2. `POST /api/auth/tokens/generate` → `{ jwt_token, id, links[rel=claim] }`;
3. open the claim URL in `expo-web-browser`;
4. poll `GET /api/users/me` with the JWT until 200;
5. store JWT + token id in `expo-secure-store`; store username/instance in
   settings (non-secret);
6. disconnect → `DELETE /api/users/me/tokens/{id}`.

No app registration or secret is required. Users without an account can create
one on the instance; users on an instance that allows anonymous upload can skip
connect if the API accepts the upload set.

**Mapillary — embedded upload client (decided):**

Use a **dedicated Mapillary app registration with the `upload` scope** and
embed its client id/secret at build time:

```dotenv
EXPO_PUBLIC_MAPILLARY_CLIENT_ID=<client id>
EXPO_PUBLIC_MAPILLARY_CLIENT_SECRET=<client secret>
```

Do not reuse the read-only `EXPO_PUBLIC_MAPILLARY_TOKEN` for the upload
exchange; keeping a separate registration limits the blast radius if the
embedded upload secret is extracted.

Flow:

1. open
   `https://www.mapillary.com/connect?client_id=<id>&redirect_uri=polaris-maps://mapillary-callback&response_type=code&scope=upload&state=<state>`;
2. catch the custom-scheme redirect with the authorization code;
3. `POST https://graph.mapillary.com/token` with
   `Authorization: OAuth <client secret>` and
   `{ grant_type: "authorization_code", code, client_id, redirect_uri }`;
4. store the returned user access token in SecureStore; show the account via
   `GET https://graph.mapillary.com/me?fields=id,username`;
5. refresh with the same endpoint using
   `{ grant_type: "refresh_token", refresh_token: <current access token>, client_id }`.

**Security trade-off:** this is a public-client OAuth flow with a secret that
ships in the JS bundle. It is extractable and must be treated as compromised by
design. The read token already has this property, but the upload secret is more
sensitive because it can act on a user's account. Mitigations: dedicated
upload-only registration, `upload` scope only, never log it, rotate it if
abused, and keep the Mapillary target feature-flaggable. A token broker remains
the safer alternative if the project later wants to remove the secret from the
bundle.

Mapillary access tokens expire (~9000 s); refresh before expiry. Store user
tokens in SecureStore, never in MMKV or logs. The app should still function if
Mapillary is not configured: hide/disable the Mapillary target and keep
Panoramax available.

### D10: Privacy and blur

- Mapillary blurs faces/plates server-side. Panoramax instances blur when the
  instance has a blur service enabled; that is an instance policy, not a
  guarantee. We upload originals and send `isBlurred: false` to Panoramax. Do
  not reuse the placeholder blur.
- One-time explainer before the first capture: what is captured, where it goes,
  that location/time are embedded, that imagery is public under the platform's
  licence, and that the user must not capture private spaces.
- Persistent recording indicator with a one-tap stop; capture pauses when the
  app is not active.
- Review-before-upload: a count/size summary with a "Delete all" action. MVP
  does not provide per-photo deletion; that is a later addition.
- No capture below the speed threshold; no capture when the drive is not
  active.
- Wi-Fi-only upload by default; show the estimated MB before a cellular upload.
- Store tokens in SecureStore; never log image bytes, tokens, or precise
  coordinates.
- Update the privacy policy and store data-safety labels: photos + precise
  location shared with Mapillary (Meta) and/or the user-selected Panoramax
  instance.

### D11: Failure, retry, and storage policy

- Upload one file at a time per target (concurrency 2 max across targets) using
  native `uploadAsync`; show per-target progress.
- Retry network/5xx/429 with exponential backoff (e.g. 2 s, 10 s, 1 min, 5 min,
  then park). Cap automatic attempts (e.g. 5); "Retry" is always available.
- 401 → disconnect the account, keep files, prompt reconnect.
- 400/422 (missing metadata/rejected) → mark that capture failed with a reason;
  do not retry forever; surface the count.
- 409/duplicate picture_id → success.
- Queue resumes on app start and on network regain; if the app was killed
  mid-upload, resume from the per-file status.
- Storage: warn at 1 GB, hard-stop capture at 2 GB or when free disk < 500 MB;
  show usage in Settings. Delete originals only after every selected target
  succeeds; "Delete anyway" is explicit.
- Uploads use `sessionType: BACKGROUND` on iOS where possible, but the product
  does not promise completion while the app is killed; the queue makes it
  resumable.

### D12: UX entry points

- Navigation HUD right rail: camera button (start/stop). It is the explicit
  per-drive choice; the first tap shows the explainer.
- Settings → Street imagery:
  - master "Allow capture while navigating" (default off);
  - "Start automatically on driving routes" (default off; only honored when
    master is on);
  - first-time prompt on the first driving navigation after enabling: "Start
    capturing automatically on future drives?" with "Not now" / "Turn on".
    The answer is persisted; the prompt is not shown again. The per-drive
    camera button remains available either way.
  - capture mode: **Standard** (1× wide, 20 m, 1080p) or **3D-friendly**
    (ultra-wide on supported iPhones, full-res, ~8 m; see D13);
  - "Upload at end of drive" (prompt / automatic / off);
  - "Wi-Fi only" (default on);
  - storage used + pending drives + retry;
  - Mapillary connect/disconnect/account;
  - Panoramax instance picker (curated list from the federated catalog),
    connect/disconnect, visibility.
- End-of-drive sheet appears after `stopNavigation`/arrival dismissal. It does
  not cover the arrival summary; it comes after it.
- If capture was started for a drive and the user ends navigation early, the
  same sheet appears (the drive is whatever was recorded).

Avoid the "Street View" brand in the UI for these contributions; call it
"Street imagery" (Google Street View is a trademark, and the imagery goes to
other platforms).

### D13: 3D-friendliness — overlap first, ultra-wide as an option

Google Street View's 3D feel comes from **360° stitched panoramas plus a
LiDAR-derived depth/geometry model**, not from a single phone photo. Mapillary
and Panoramax ingest flat (and, for Panoramax, 360°) images. Mapillary runs SfM
over overlapping flat images to build point clouds and its "combined panning"
viewer, but a phone still sequence does not become a Street View-grade
walkthrough. The design should be honest about that and optimize for the things
that _do_ help SfM and the viewers:

1. **Overlap/density is the biggest lever.** Mapillary's own iPhone app captures
   roughly one image every 3 m. The Standard 20 m cadence is a browsing/coverage
   cadence, not a reconstruction cadence. A still camera can only sustain about
   one frame every 0.5–1 s, which is ~7–14 m at 50 km/h, so even a dense still
   mode cannot match Mapillary's 3 m. The true 3 m path is video capture + frame
   extraction (native FFmpeg), which is out of scope for this change.
2. **Ultra-wide (0.5×) helps context and overlap, but is not a 3D switch.** A
   wider FOV captures more of the scene and more shared features between frames,
   at the cost of pixel density per degree, more distortion, and worse low light.
   Accurate camera intrinsics become more important. Use it in a dedicated
   "3D-friendly" mode, not as the default for every drive.
3. **Keep the mount rigid and level, and write accurate heading.** SfM assumes a
   stable camera rig; a hand-held phone with changing roll/pitch is much harder.
   `GPSImgDirection` and a level horizon matter more than a slightly wider lens.
4. **Prefer higher resolution/quality in 3D mode.** 1080p is a storage compromise
   for Standard mode; the 3D preset should use the sensor's full-resolution
   still and quality ~0.9, and should write focal length / 35 mm-equivalent
   EXIF if the camera does not already provide it.
5. **iPhone LiDAR/depth is not usable for these platforms.** Mapillary and
   Panoramax do not ingest depth maps. It could power a future local 3D viewer,
   but it is irrelevant to this upload feature.

Implementation:

- **Standard mode (default):** back wide lens (`selectedLens` unset / default),
  20 m, 1920×1080, quality 0.8.
- **3D-friendly mode:** on iOS, call `getAvailableLensesAsync()` and select the
  ultra-wide lens when one is exposed (`builtInUltraWideCamera` in Apple's
  device types; Expo returns localized lens names, so match defensively and
  fall back to the default lens). On Android, `expo-camera` has no ultra-wide
  selector; use the wide lens. Full-resolution stills, quality ~0.9, spacing
  ~8 m, and a storage warning.
- **Do not use the `zoom` prop for 0.5×.** Expo's `zoom` is 0..1 of the
  device's maximum zoom and clamps at 1× (`minZoom = 1.0`); it cannot go below
  the wide lens. Lens selection is `selectedLens` / `getAvailableLensesAsync`
  (iOS only).
- If Expo's localized lens names prove unreliable, add a tiny native patch to
  select `AVCaptureDevice.DeviceType.builtInUltraWideCamera` by type. The
  Phase 0 spike must verify which lens was actually used and that the EXIF
  focal length matches it; otherwise SfM will misjudge scale.

Recommendation to the 0.5× question: default the **3D-friendly preset** to
0.5× on iPhones that expose it, but keep **Standard** at 1×. Making 0.5× the
global default would trade map-feature detail and reconstruction intrinsics for
context on every drive, which is the wrong default for a mapping product.

**Future option (not this change): video + on-device frame extraction.** If
Mapillary-grade 3 m overlap is a goal, record video while navigating and sample
frames by distance after the drive:

1. `CameraView.recordAsync` records muted 1080p/4K segments (e.g. 2–5 min) to
   the app's document directory; keep the segment start timestamp.
2. The navigation pipeline stores a timestamped GPS/heading track (already
   available at ~1 Hz; optionally 5 Hz while recording).
3. After the drive, a native module sequentially decodes each video
   (`AVAssetReader` on iOS, `MediaExtractor` + `MediaCodec` on Android), picks
   the frame nearest each 3–5 m step along the GPS track, and writes a JPEG.
4. Each JPEG gets GPS/heading/capture-time EXIF (native writer, or a JS writer
   as a slower fallback) and enters the same `streetview_captures` queue used by
   stills.
5. Delete the video segment after its frames are extracted; upload the frames to
   Mapillary and Panoramax as usual.

Why it is the only real 3 m path: at 50 km/h, 3 m is 0.216 s; a still camera
needs ~0.5–1 s per frame, while 30 fps video has 6–7 frames per 3 m. Video is
also more storage-efficient than thousands of JPEGs, and Mapillary explicitly
says video produces better 3D reconstructions.

Why it is a separate change:

- It needs a **native module** (sequential decode + JPEG encode) and probably a
  native EXIF writer; `expo-video-thumbnails` seeks per frame and is not viable
  for thousands of frames.
- **GPS/time sync** must be accurate. Video PTS must be anchored to the device
  clock; a 1 s error is 14 m at 50 km/h. The robust version records the host
  time of the first sample buffer natively. A constant offset is less harmful
  than random error but still needs calibration.
- **Volume**: 3 m at 50 km/h is ~16,700 frames/hour (several GB of JPEGs).
  Practical defaults should be 5–10 m with a cap, not 3 m for every drive.
- **Processing**: extracting a 1-hour video takes minutes and is best done on a
  charger/foreground; it needs resumable per-segment state.
- **Platform limits**: Mapillary's direct video upload only accepts telemetry
  formats (GPMF/CAMM/BlackVue), not a generic phone MP4; Panoramax accepts only
  JPEG. Sampling must happen on-device (or via a desktop export).
- **Quality trade-off**: extracted 1080p frames are ~2 MP, less detailed than
  12 MP stills; 4K video improves detail but multiplies storage.

A cheaper interim option is **dense stills** (e.g. one frame every 0.5 s while
moving, using the existing still pipeline). At city speeds that is ~4–7 m
spacing, with accurate per-frame EXIF and no native extraction. It is heavier on
camera/thermal than video and cannot reach 3 m at highway speed, but it can ship
without a native module. Test it before committing to the video path.

The other true-3D route is a **360 camera** (equirectangular video/photo), which
both platforms accept and which gives a Street-View-like field of view. That is
hardware-dependent and out of scope here.

## Risks / Trade-offs

- **Mapillary upload API is undocumented.** The manifest flow is reverse
  engineered from `mapillary_tools`; it can change without notice. Mitigate
  with a feature flag, contract tests, a clear "Mapillary upload unavailable"
  state, and a zip/export fallback.
- **Mapillary OAuth needs a client secret.** The chosen embedded-secret flow
  ships an extractable upload credential. Mitigate with a dedicated
  upload-scoped registration, rotation, no logging, and a feature flag. A token
  broker remains the upgrade path if this becomes unacceptable.
- **Camera geometry on a portrait-locked app.** iOS crops to the preview aspect
  ratio; orientation props differ per OS. A Phase 0 device spike must prove
  landscape 16:9 output and correct EXIF before the rest is built. If it fails,
  Mapillary is gated to landscape-mounted drives and Panoramax remains
  available.
- **3D expectations.** Ultra-wide and denser stills improve overlap, but they
  do not produce Google-Street-View-grade 3D; true 3D needs 360 capture or
  video/frame extraction. Set expectations in the UI ("better for Mapillary
  reconstruction", not "3D Street View").
- **Ultra-wide lens selection.** Expo returns localized lens display names, not
  stable device-type identifiers; matching "Ultra Wide" can fail on non-English
  devices or future iOS versions. A Phase 0 spike must verify the selected lens
  and EXIF focal length; a tiny native selector may be needed.
- **3D-mode density is camera-limited.** At 50 km/h, even an 8 m target becomes
  ~10–14 m because a phone still takes ~0.5–1 s per frame. Do not promise 3 m
  without video capture.
- **Performance/thermal.** Map + camera + GPS + screen-on is heavy. Use a tiny
  16:9 preview, 1080p stills in Standard mode, distance gating, and a stop on
  low storage. 3D mode's full-resolution stills are much heavier; test on a
  mid-range Android device, not only an iPhone.
- **No background capture.** Locked phones and CarPlay-with-phone-locked cannot
  capture. The UI must say so, not silently produce gaps.
- **Storage.** A dense hour can be >1 GB. Default 20 m, warn early, cap, and
  delete after upload.
- **Privacy/app review.** Continuous camera use while driving invites scrutiny.
  Emphasize opt-in, visible indicator, review, no interaction while driving,
  server-side blur, and store disclosures. Do not auto-enable capture.
- **Platform rejection/processing.** Missing EXIF, portrait images, or blur
  disagreements can cause rejected uploads. Verify with a short real sequence
  on both platforms before rollout; keep per-file rejection reasons.
- **Panoramax instance fragmentation.** Users need an account on the instance
  they choose; there is no global default. Make instance selection explicit and
  surface errors clearly.
- **EXIF writer reliability.** `additionalExif` is lightly documented for GPS.
  If device tests fail, fall back to a pure-JS EXIF writer (`piexifjs`) or a
  small native module; Panoramax overrides still make its uploads correct.

## Migration Plan

1. **Phase 0 — spikes (no product code):**
   - iOS/Android: capture a 16:9 1080p JPEG from a 96×54 preview with the app
     portrait-locked and the phone mounted portrait/landscape; verify dimensions,
     orientation, and EXIF (`GPSLatitude`, `GPSLongitude`, `GPSImgDirection`,
     `DateTimeOriginal`).
   - iOS lens spike: `getAvailableLensesAsync()` on an iPhone with an
     ultra-wide; verify the returned identifiers, select the ultra-wide, and
     confirm the output FOV and EXIF focal length. Decide whether a native
     selector is needed.
   - Mapillary: with a test account, upload 5 images via raw + manifest +
     `finish_upload`; verify processing and `compass_angle`; verify the embedded
     OAuth exchange and refresh.
   - Panoramax: on a test/local instance, create an upload set, upload 5 JPEGs
     with overrides + `picture_id`, complete, poll; verify collection/status.
2. **Phase 1 — foundation:** models, DB tables, capture settings/store, pure
   trigger/EXIF helpers + unit tests.
3. **Phase 2 — capture:** raw-fix publication, global CaptureHost, nav HUD
   action, auto-start prompt, lens/mode selection, pause/resume, storage guards,
   device test.
4. **Phase 3 — summary/queue:** finalize on nav end, DriveUploadSheet with
   summary + Delete all, persistence/resume.
5. **Phase 4 — Panoramax:** curated instance picker, connect flow, client,
   upload orchestrator, status, retry, tests; ship first.
6. **Phase 5 — Mapillary:** embedded-secret OAuth, client, upload flow, tests;
   feature-flagged.
7. **Phase 6 — hardening/rollout:** real short-sequence verification, privacy
   copy/store listings, performance/battery pass, docs.

Rollback: the feature is opt-in and isolated behind settings/flags. Disabling
the master setting stops capture and hides the upload targets; existing queued
files remain readable/deletable. No existing table or feed is modified, so a
revert does not affect navigation or P2P imagery.

## Resolved Decisions

1. **Mapillary auth:** embedded upload client secret, in a dedicated
   upload-scoped app registration (D9).
2. **Capture start:** both a per-drive tap and an "auto-start on driving
   routes" setting. The setting defaults off and the app asks once, on the
   first driving navigation, whether to turn it on (D12).
3. **Panoramax instance:** curated picker populated from the federated catalog
   (`https://api.panoramax.xyz/api/instances`), not a hardcoded list (D12).
4. **Review depth:** MVP uses a count/size summary plus "Delete all"; no
   per-photo grid (D6).
5. **3D-friendliness:** Standard mode stays 1×/20 m; a 3D-friendly preset uses
   ultra-wide on supported iPhones, full-res, ~8 m. 0.5× is not the global
   default (D13).

## Remaining Questions

1. **P2P overlap:** should captured imagery also be offered to the P2P
   `street_imagery` feed later, or stay external-only for now?
2. **Platform order:** confirm Panoramax ships first (it has no client secret),
   with Mapillary in the same release only if the embedded OAuth flow passes
   the Phase 0 spike.
3. **Catalog fallback:** if the federated catalog is unreachable, should the
   instance picker offer a free-text HTTPS URL, or only cached entries?
4. **3D preset default:** should 3D-friendly be offered as an advanced setting,
   or surfaced in the first-capture explainer so users know it exists?
