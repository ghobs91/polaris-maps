## REMOVED Requirements

### Requirement: Panoramax upload uses an upload set with per-file overrides

Panoramax is no longer an upload target. The instance catalog, per-instance token-claim
sign-in, upload-set creation, per-file overrides, and completion calls are removed.

#### Scenario: End-of-drive sheet offers one target

- **WHEN** the user finishes a drive with pending captures
- **THEN** the sheet offers Mapillary only, with no instance picker or Panoramax account row

#### Scenario: Settings has no Panoramax section

- **WHEN** the user opens Settings → Street Imagery
- **THEN** no Panoramax instance, account, or sign-out row is shown

## MODIFIED Requirements

### Requirement: Account credentials are stored securely and are revocable

Only the Mapillary user token is stored, in the platform secure store, and never in plain
settings storage or logs. Disconnecting Mapillary clears the stored token and the account
label.

#### Scenario: Disconnect Mapillary

- **WHEN** the user signs out of Mapillary
- **THEN** the stored token is cleared and uploads stop until the user signs in again

### Requirement: Capture and upload do not alter existing P2P imagery behavior

Capture and Mapillary upload remain independent of the P2P `street_imagery` feed: disabling
P2P sharing does not block a Mapillary upload, and a Mapillary upload never appends rows to
the P2P feed.

#### Scenario: P2P sharing disabled, Mapillary connected

- **WHEN** the user has P2P imagery sharing disabled but uploads a drive to Mapillary
- **THEN** the photos are sent only to Mapillary and are not appended to the P2P feed
