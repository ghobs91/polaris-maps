## ADDED Requirements

### Requirement: Review photo attachment

The system SHALL allow a user to attach photos to their own review. Attached photos SHALL be downscaled to a bounded maximum edge, stripped of EXIF and location metadata, and stored on the device. Each review SHALL be limited to a configured maximum number of photos.

#### Scenario: Attach a photo to a review

- **WHEN** the user attaches a photo while writing a review
- **THEN** the stored photo SHALL have EXIF and GPS metadata removed
- **AND** a thumbnail SHALL be generated for list display

#### Scenario: Photo limit enforced

- **WHEN** the user tries to attach more photos than the configured maximum for one review
- **THEN** the additional attachment SHALL be rejected with an explanatory message

### Requirement: Review photo publication and replication

Review photos SHALL be published only with explicit user consent. When published, the photo bytes SHALL be content-addressed and replicated over the P2P transport, and the review's media metadata SHALL be made available to peers. Deletion of a photo SHALL remove it from the local store and mark it deleted for peers.

#### Scenario: Opt-in required before publishing

- **WHEN** a user saves a review with photos but does not opt in to publication
- **THEN** the photos SHALL remain local to the device and SHALL NOT be replicated

#### Scenario: Published photo replicates by content hash

- **WHEN** a user publishes a review photo
- **THEN** the photo SHALL be addressable by its content hash
- **AND** a peer fetching the review SHALL be able to retrieve the photo by that hash

#### Scenario: Deleting a published photo

- **WHEN** the author deletes a published photo
- **THEN** the local copy SHALL be removed and the media metadata SHALL be marked deleted for peers

### Requirement: Review photo display

The system SHALL display review photos as a gallery with thumbnails and a full-size viewer, reading local files first and replicated copies second. A photo that cannot be loaded SHALL render a neutral placeholder rather than a broken image, and the surrounding review text SHALL remain readable.

#### Scenario: Gallery renders available photos

- **WHEN** a review with photos is opened
- **THEN** thumbnails SHALL be shown and tapping a thumbnail SHALL open the full-size photo

#### Scenario: Missing photo does not break the review

- **WHEN** a referenced photo cannot be loaded
- **THEN** a placeholder SHALL be shown and the review text and rating SHALL still display

### Requirement: Review and media moderation

The system SHALL let any user report a review or photo, SHALL hide reported media for the reporting user immediately, and SHALL prevent reported media from being re-published by that device. The system SHALL NOT falsely present reported content as removed for all peers.

#### Scenario: Reporting hides content for the reporter

- **WHEN** the user reports a review photo
- **THEN** that photo SHALL be hidden from the reporter's view immediately
- **AND** the report SHALL be recorded locally with the content hash

#### Scenario: Reported content is not re-published

- **WHEN** a device has reported a content hash
- **THEN** it SHALL NOT re-publish that content to peers

### Requirement: Merged ratings surfaced in the place card

The place detail card SHALL display a merged community rating and review count derived from local, P2P, and ATProto review sources, and SHALL distinguish the community rating from any third-party rating. The card SHALL provide a control to open the full review list.

#### Scenario: Community rating shown with count

- **WHEN** a place has community reviews from one or more sources
- **THEN** the card SHALL show the merged average rating and the total review count

#### Scenario: No reviews shows an invitation

- **WHEN** a place has no reviews
- **THEN** the card SHALL show an empty state inviting the user to write the first review

#### Scenario: Third-party rating is labelled

- **WHEN** an external rating is displayed alongside the community rating
- **THEN** the external source SHALL be labelled so the two are not conflated

### Requirement: Review sorting and filtering

The review list SHALL support sorting by newest, highest rating, lowest rating, and most helpful, and filtering by rating and by presence of photos.

#### Scenario: Sort by most helpful

- **WHEN** the user selects most-helpful sorting
- **THEN** reviews SHALL be ordered by descending helpful count with ties broken by recency

#### Scenario: Filter to reviews with photos

- **WHEN** the user enables the photos-only filter
- **THEN** only reviews that have at least one photo SHALL be listed

### Requirement: Review helpful voting

The system SHALL allow a user to mark a review as helpful at most once per identity per review and SHALL allow the vote to be withdrawn. Helpful counts SHALL be aggregated across local and replicated votes.

#### Scenario: Toggle a helpful vote

- **WHEN** the user marks a review helpful and then marks it again
- **THEN** the first action SHALL add one to the count and the second SHALL remove it

#### Scenario: One vote per identity

- **WHEN** the same identity votes helpful on the same review more than once
- **THEN** only one vote SHALL be counted

### Requirement: Place media sourcing

The system SHALL keep on-device website photo scraping as the primary place-media source and SHALL NOT be required to remove it. The system MAY supplement scraped media with openly licensed sources — Wikimedia Commons (Wikidata brand logos) and Panoramax street-level imagery, and Mapillary only where license permits. Every media item sourced from an open provider SHALL carry its license and attribution metadata. This retention of the scraper SHALL be coordinated with the `broaden-traffic-and-media-sources` change, which also retains it.

#### Scenario: Website scraping remains the primary source

- **WHEN** a place media list is assembled
- **THEN** on-device website photo scraping SHALL be kept as the primary source and SHALL NOT be removed
- **AND** the system SHALL NOT be required to replace it with an open provider

#### Scenario: Open provider media includes attribution and license

- **WHEN** a place media item is returned by an open provider
- **THEN** it SHALL include the source provider, license, license URL, and author attribution

#### Scenario: No media available returns empty media

- **WHEN** neither the website scrape nor any supplementary provider returns media for a place
- **THEN** the system SHALL return an empty media list and show a deliberate empty state

### Requirement: Media attribution and offline-safe fallbacks

Wherever media from an open provider is displayed, the system SHALL display the required attribution and a link to the license. When media cannot be fetched (offline or provider failure), the system SHALL use cached metadata and thumbnails when available and SHALL otherwise show a deliberate empty state.

#### Scenario: Attribution rendered with open-source media

- **WHEN** an open-source media item is displayed
- **THEN** its attribution and license link SHALL be visible or reachable from the media view

#### Scenario: Offline with cached media

- **WHEN** the device is offline and cached media metadata exists
- **THEN** the cached thumbnails and attribution SHALL be shown without an error

#### Scenario: No media available

- **WHEN** a place has no media and none is cached
- **THEN** the media section SHALL show a neutral empty state

### Requirement: Menu access and rendering

The system SHALL render the parsed menu URL for a place, opening the menu in a viewer that supports both web pages and document files, and SHALL handle missing or unreachable menus without an error.

#### Scenario: Menu link displayed when present

- **WHEN** a place has a menu URL
- **THEN** the place detail SHALL show a control that opens the menu

#### Scenario: Unreachable menu handled

- **WHEN** the menu URL cannot be opened
- **THEN** the system SHALL show an explanatory message and keep the rest of the place detail usable
