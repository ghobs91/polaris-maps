## ADDED Requirements

### Requirement: Capture is opt-in and tied to an active drive

The system SHALL capture street imagery only while turn-by-turn navigation is
active and the user has explicitly started a capture session (or has enabled
automatic start in settings). The system MUST show a persistent recording
indicator while capture is active and MUST stop capture when navigation ends.

#### Scenario: User starts capture mid-drive

- **WHEN** navigation is active and the user taps the street-imagery action
- **THEN** the app shows the consent explainer on first use, starts a drive
  session, displays a recording indicator, and begins capturing according to
  the configured cadence

#### Scenario: Navigation ends

- **WHEN** navigation is stopped manually, by arrival, or by auto-end
- **THEN** capture stops, the session is finalized, and the user is offered the
  end-of-drive upload sheet if any photos were captured

#### Scenario: User never opts in

- **WHEN** the user has not enabled the feature and has not tapped the action
- **THEN** no camera frames are captured during navigation

#### Scenario: First driving navigation after enabling

- **WHEN** the user has enabled the feature but has not yet answered the
  auto-start question, and starts a driving route
- **THEN** the app asks once whether to start capture automatically on future
  drives, persists the answer, and does not prompt again

#### Scenario: Auto-start is enabled

- **WHEN** auto-start is on and the user starts a driving route
- **THEN** capture starts automatically with the recording indicator visible

#### Scenario: Auto-start is off

- **WHEN** auto-start is off and the user starts a driving route
- **THEN** no capture starts until the user taps the camera action

### Requirement: Capture is gated by movement, distance, and camera readiness

The system SHALL capture at most one frame per configured distance interval,
with a minimum time between frames and a minimum speed, and MUST skip a frame
rather than queue a backlog when the camera is busy or a capture fails.

#### Scenario: Driving at speed

- **WHEN** the vehicle is moving above the minimum speed and has travelled the
  configured distance since the last capture
- **THEN** one JPEG is captured and the next eligible fix is scheduled

#### Scenario: Stopped at a light

- **WHEN** the vehicle speed is below the minimum threshold
- **THEN** no frames are captured until the vehicle moves again

#### Scenario: Camera busy

- **WHEN** a capture trigger fires while the previous `takePictureAsync` call is
  still in flight
- **THEN** the trigger is skipped and the next eligible fix is considered

### Requirement: Captures carry platform-acceptable metadata and geometry

Each captured JPEG SHALL use the camera host's 16:9 frame, SHALL contain GPS
latitude, longitude, and capture time in EXIF, and SHALL contain a camera
heading when a reliable heading is available. When the device is mounted
landscape, the captured image SHALL be landscape so it is eligible for
Mapillary. The system MUST NOT post-process the image in a way that strips
these tags.

#### Scenario: Capture on a moving vehicle

- **WHEN** a frame is captured with a valid GPS fix
- **THEN** the stored file contains GPS coordinates, a UTC/local capture time,
  and (when available) `GPSImgDirection` with a true-north reference

#### Scenario: Heading unavailable

- **WHEN** the GPS heading is invalid and no navigation bearing is available
- **THEN** the image is stored without a direction tag rather than with a
  fabricated one

#### Scenario: Portrait capture on a Mapillary-targeted drive

- **WHEN** a captured image is portrait rather than landscape
- **THEN** it remains eligible for Panoramax but is excluded from Mapillary
  upload and the exclusion is reported to the user

### Requirement: Capture mode can bias toward 3D-friendly overlap

The system SHALL offer a Standard capture mode and an optional 3D-friendly
capture mode. Standard mode uses the default wide lens, ~20 m spacing, and
1080p stills. 3D-friendly mode SHALL use a denser spacing (~8 m), higher
resolution/quality, and — on iOS devices that expose an ultra-wide lens — SHALL
select that lens. The system MUST NOT use the `zoom` prop to approximate 0.5×.

#### Scenario: 3D-friendly mode on an iPhone with ultra-wide

- **WHEN** the user selects 3D-friendly mode and the device exposes an
  ultra-wide lens
- **THEN** captures use the ultra-wide lens, full-resolution stills, and the
  denser spacing, and the UI warns about storage use

#### Scenario: 3D-friendly mode on a device without ultra-wide

- **WHEN** the user selects 3D-friendly mode on an Android device or an iPhone
  without an ultra-wide lens
- **THEN** captures use the default wide lens and the denser spacing, and the
  UI explains that ultra-wide is unavailable

#### Scenario: Standard mode

- **WHEN** the user selects Standard mode
- **THEN** captures use the default wide lens, ~20 m spacing, and 1080p stills

### Requirement: Captures survive process death and are queued per drive

The system SHALL persist each capture's file and metadata locally before
considering it captured, and SHALL maintain per-drive and per-platform upload
state that survives app termination and restart.

#### Scenario: App killed after capture

- **WHEN** the app is terminated after photos have been captured but before
  upload
- **THEN** the next launch lists the pending drive and can resume summary/upload
  without re-capturing

#### Scenario: Partial upload

- **WHEN** some files upload successfully and the app is terminated
- **THEN** successfully uploaded files are not re-uploaded and remaining files
  are retried

### Requirement: End-of-drive summary is the upload consent gate

The system SHALL present an end-of-drive sheet summarizing the captured photos,
their size, and the available platforms. No photo SHALL be uploaded until the
user confirms a target (unless automatic upload has been explicitly enabled).
The sheet SHALL offer "Delete all"; per-photo review is not required.

#### Scenario: User confirms and uploads

- **WHEN** the drive ends with captured photos and the user taps Upload
- **THEN** only the selected platforms receive the photos, and progress is shown
  per platform

#### Scenario: User deletes all

- **WHEN** the user chooses "Delete all" on the end-of-drive sheet
- **THEN** the local files and queue rows are removed and nothing is uploaded

#### Scenario: Deferred upload

- **WHEN** the user chooses "Not now"
- **THEN** the drive remains in the pending list and can be uploaded later from
  Settings or the next app launch

### Requirement: Panoramax upload uses an upload set with per-file overrides

The system SHALL upload a drive to Panoramax by creating an upload set, sending
each JPEG with `override_latitude`, `override_longitude`,
`override_capture_time`, a preassigned `picture_id`, and `isBlurred=false`,
then completing the upload set and polling its status.

#### Scenario: Choosing an instance

- **WHEN** the user opens the Panoramax instance picker
- **THEN** the app shows a searchable list populated from the federated catalog
  at `https://api.panoramax.xyz/api/instances`, and the selected instance is
  validated as a Panoramax API over HTTPS

#### Scenario: Successful Panoramax upload

- **WHEN** the user selects a connected Panoramax instance and taps Upload
- **THEN** an upload set is created, all selected JPEGs are sent, the set is
  completed, and the resulting collection link/status is shown

#### Scenario: Duplicate picture id

- **WHEN** Panoramax rejects a file because its `picture_id` already exists
- **THEN** the file is treated as already uploaded rather than as a failure

#### Scenario: Unauthorized instance

- **WHEN** the Panoramax instance returns 401 for upload set creation
- **THEN** the account is marked disconnected, the files are kept, and the user
  is prompted to reconnect

### Requirement: Mapillary upload uses a user OAuth token and EXIF metadata

The system SHALL upload to Mapillary only when a user access token with the
`upload` scope is connected. It SHALL obtain that token through a dedicated
upload-scoped OAuth client whose id/secret are embedded at build time, SHALL
upload JPEGs with GPS and capture time in EXIF, SHALL obtain file handles from
the resumable upload service, SHALL submit an image manifest, and SHALL call
`finish_upload`.

#### Scenario: Successful Mapillary upload

- **WHEN** the user selects Mapillary and taps Upload with a connected account
- **THEN** each landscape JPEG is uploaded, a manifest is submitted, the upload
  is finished, and the UI reports "processing" rather than a final image link

#### Scenario: Expired token

- **WHEN** Mapillary returns 401 during upload
- **THEN** the app refreshes the token if possible, otherwise marks the account
  disconnected, keeps the local queue, and prompts the user to reconnect

#### Scenario: Mapillary not configured

- **WHEN** no Mapillary client/token-exchange configuration is present in the
  build
- **THEN** the Mapillary target is disabled with an explanation, and Panoramax
  remains available

### Requirement: Account credentials are stored securely and are revocable

Panoramax JWTs and Mapillary user tokens SHALL be stored in the platform secure
store, never in plain settings storage or logs. Disconnecting a Panoramax
account SHALL revoke its token when the instance supports it.

#### Scenario: Disconnect Panoramax

- **WHEN** the user disconnects a Panoramax account
- **THEN** the app calls the token revocation endpoint (best effort) and deletes
  the local credential

#### Scenario: Disconnect Mapillary

- **WHEN** the user disconnects Mapillary
- **THEN** the local token is deleted and no further uploads target Mapillary

### Requirement: Uploads respect network, storage, and battery limits

The system SHALL default to Wi-Fi-only uploads, SHALL show the size of a
pending upload before a cellular upload, and SHALL stop capture when storage is
low or the configured queue cap is reached.

#### Scenario: Cellular network with Wi-Fi-only enabled

- **WHEN** the drive ends on a cellular connection and Wi-Fi-only is on
- **THEN** the upload is queued and the user is told it will wait for Wi-Fi

#### Scenario: Storage cap reached

- **WHEN** the local queue exceeds the configured cap or free disk space falls
  below the safety margin
- **THEN** capture stops with a visible warning and the existing queue remains
  uploadable

### Requirement: Capture pauses when the app is not active

The system SHALL pause frame capture when the app is backgrounded or the device
is locked and resume when the app becomes active. The session MAY remain
logically active and MUST indicate that capture is paused.

#### Scenario: Phone locked mid-drive

- **WHEN** the device is locked while navigation and capture are active
- **THEN** no camera frames are taken, navigation continues via the existing
  background location session, and the recording indicator shows paused when the
  app returns

#### Scenario: App returns to foreground

- **WHEN** the app becomes active again during the same drive
- **THEN** capture resumes from the next eligible GPS fix without restarting the
  drive session

### Requirement: Capture and upload do not alter existing P2P imagery behavior

The system SHALL keep the existing P2P `street_imagery` feed, its consent flag,
and its standalone capture screen independent from third-party uploads.

#### Scenario: P2P sharing disabled, Panoramax connected

- **WHEN** the user has P2P imagery sharing disabled but uploads to Panoramax
- **THEN** the photos are sent only to Panoramax and are not appended to the P2P
  feed

#### Scenario: Existing capture screen

- **WHEN** the user opens the standalone imagery capture screen
- **THEN** it continues to behave as before and is not silently switched to the
  external upload pipeline
