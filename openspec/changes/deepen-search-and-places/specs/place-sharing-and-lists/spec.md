## ADDED Requirements

### Requirement: Place sharing via deep link

The system SHALL share a place as a link rather than plain text. On iOS, the link SHALL be a universal link under a controlled domain; on all platforms the custom `polaris-maps` scheme SHALL work as a fallback. Opening a place link SHALL navigate to that place's detail.

#### Scenario: Share produces a link

- **WHEN** the user shares a place
- **THEN** the shared message SHALL contain a link that resolves to that place

#### Scenario: Universal link opens the place

- **WHEN** the user opens a place universal link and the app is installed
- **THEN** the app SHALL open the corresponding place detail

#### Scenario: Scheme fallback works

- **WHEN** a place link cannot be handled as a universal link
- **THEN** the custom scheme form of the link SHALL still open the place detail

#### Scenario: Place without a canonical id still shares

- **WHEN** a place has coordinates and a name but no canonical identifier
- **THEN** the share link SHALL encode enough information to resolve the place

### Requirement: List export

The system SHALL allow the user to export a saved list to a file in at least CSV and GeoJSON formats. Exported files SHALL be re-importable by the existing import service without loss of the place name and coordinates.

#### Scenario: Export a list to CSV

- **WHEN** the user exports a list as CSV
- **THEN** the file SHALL contain one row per saved place with at least name, latitude, and longitude

#### Scenario: Export round-trips through import

- **WHEN** an exported list file is imported
- **THEN** the imported list SHALL contain the same place names and coordinates as the original

### Requirement: Collaborative list sharing over P2P

The system SHALL allow the owner of a list to share it with other peers over the P2P transport so that accepted collaborators can view and edit the list. Sharing SHALL require explicit owner action, and list content SHALL be signed by the authoring identity and encrypted in transit.

#### Scenario: Owner shares a list

- **WHEN** the owner enables sharing for a list
- **THEN** an invitation SHALL be produced that a peer can accept to join the list

#### Scenario: Collaborator edit propagates

- **WHEN** a collaborator adds a place to a shared list while another collaborator is online
- **THEN** the addition SHALL propagate to the other collaborator's copy of the list

#### Scenario: Unshared list stays local

- **WHEN** the owner never enables sharing for a list
- **THEN** no content from that list SHALL be written to the P2P store

### Requirement: Private-by-default privacy controls

Lists SHALL be private by default. The system SHALL display the sharing state of every list, allow the owner to change it, and allow the owner to revoke shared access. Revoking access SHALL prevent further propagation to revoked peers while preserving the owner's local copy.

#### Scenario: New list is private

- **WHEN** a user creates a new list
- **THEN** the list SHALL be marked private and SHALL NOT be discoverable by other peers

#### Scenario: Owner revokes access

- **WHEN** the owner revokes shared access to a list
- **THEN** previously invited peers SHALL no longer be able to join or sync that list
- **AND** the owner's local list SHALL remain intact

#### Scenario: Sharing state is visible

- **WHEN** the user views a list
- **THEN** the list SHALL clearly indicate whether it is private or shared

### Requirement: Deterministic conflict resolution for shared lists

Concurrent edits to a shared list SHALL merge deterministically. Concurrent adds of the same place SHALL result in a single entry; a concurrent add and remove SHALL NOT silently resurrect a removed entry; concurrent renames SHALL resolve to a single value deterministically. Merge SHALL be a pure operation over local and remote state.

#### Scenario: Concurrent adds of the same place deduplicate

- **WHEN** two collaborators add the same place to a list at nearly the same time
- **THEN** the merged list SHALL contain exactly one copy of that place

#### Scenario: Remove survives a concurrent add

- **WHEN** one collaborator removes a place while another concurrently re-adds the same place
- **THEN** the merge SHALL resolve to a single deterministic outcome and SHALL NOT silently resurrect the removed entry

#### Scenario: Concurrent rename resolves

- **WHEN** two collaborators rename the same list simultaneously
- **THEN** all peers SHALL converge on the same resulting name

#### Scenario: Merge order does not matter

- **WHEN** the same set of edits is applied in different orders on two devices
- **THEN** both devices SHALL converge to the same list state
