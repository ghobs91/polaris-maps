## ADDED Requirements

### Requirement: Background-only download Live Activity

While at least one offline region download is active, the system SHALL present a Live Activity (including Dynamic Island and Lock Screen) **only while the app is backgrounded or the device is locked**, and MUST NOT present it while the app is foregrounded. The activity SHALL be started as the app resigns active (using the `inactive` transition, with `background` as a retry) and ended when the app returns to `active`.

#### Scenario: Backgrounding during an active download

- **WHEN** the app resigns active (`inactive`/`background`) while at least one region download is in progress and Live Activities are authorized
- **THEN** a download Live Activity is started showing current progress

#### Scenario: Returning to the foreground dismisses the activity

- **WHEN** the download Live Activity is showing and the user brings Polaris back to the foreground
- **THEN** the activity ends immediately and is removed from the Lock Screen / Dynamic Island

#### Scenario: No activity while foregrounded

- **WHEN** a region download runs entirely in the foreground without the app being backgrounded
- **THEN** no download Live Activity is started

### Requirement: Aggregate progress for concurrent downloads

The download Live Activity SHALL represent all active region downloads as a single aggregate: a combined percentage (equal weight per active region), the number of active regions, the human-readable stage of the current work, and the region name when exactly one download is active. Regions that have reached a terminal stage (`complete`/`error`) SHALL NOT count toward the aggregate.

#### Scenario: Single active region

- **WHEN** exactly one region download is active when the app backgrounds
- **THEN** the activity shows that region's name, its percentage, and its current stage

#### Scenario: Multiple active regions

- **WHEN** two or more region downloads are active when the app backgrounds
- **THEN** the activity shows a single combined percentage, a count label (e.g. "2 regions"), and the current stage

#### Scenario: A region completes while another continues

- **WHEN** one of several active downloads completes while others are still running
- **THEN** the completed region is excluded and the aggregate percentage/count reflect only the remaining active downloads

### Requirement: Lifecycle tied to download and app state

The download Live Activity SHALL reflect download progress while it is active, updating as progress advances (throttled to at most approximately one update per second and only when the displayed values change). When the aggregate becomes empty because all downloads completed, errored, or were cancelled, the system SHALL end the activity with a short completion dismissal. The activity MUST NOT remain after no downloads are active.

#### Scenario: Progress advances in the background

- **WHEN** download progress changes while the activity is active
- **THEN** the activity is updated with the new aggregate (subject to throttling) and never more often than approximately once per second

#### Scenario: All downloads finish while backgrounded

- **WHEN** the last active download completes, errors, or is cancelled while the activity is showing
- **THEN** the activity is updated to a completed state and ends with a short dismissal delay

#### Scenario: Download cancelled by the user

- **WHEN** the user cancels an in-flight download and no other download is active
- **THEN** the aggregate becomes empty and the activity is ended

### Requirement: Graceful no-op when Live Activities are unavailable

On platforms or devices where Live Activities are unsupported, disabled, or unauthorized — and on non-iOS platforms — the system SHALL perform no Live Activity operations and MUST NOT affect the download flow. Start/update/end failures SHALL be caught and MUST NOT throw into download or UI code paths.

#### Scenario: User has Live Activities disabled

- **WHEN** a download is active and the app backgrounds but `isSupported()` is false
- **THEN** no activity is requested and the download proceeds normally

#### Scenario: Activity start is rejected by the OS

- **WHEN** the OS rejects the start request issued during the `inactive`/`background` transition
- **THEN** the failure is logged and swallowed, and the download continues unaffected

### Requirement: Navigation Live Activity remains independent

The existing turn-by-turn navigation Live Activity SHALL be unaffected. The download activity SHALL use a distinct activity type so that a navigation activity and a download activity can coexist without interfering with each other's lifecycle.

#### Scenario: Navigation activity unaffected

- **WHEN** navigation is active and the user also backgrounds during a region download
- **THEN** the navigation Live Activity continues to update with guidance and the download activity is managed independently
