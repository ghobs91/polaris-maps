## ADDED Requirements

### Requirement: Combined aggregate across providers

The app SHALL resolve external aggregate ratings for a place from both
TripAdvisor and Yelp, independently, using only the on-device headless browser,
and SHALL display a single combined aggregate. The app SHALL NOT require an API
key, account, or paid service to obtain these ratings.

#### Scenario: Both providers resolve

- **WHEN** a place has valid, identity-matched ratings from both providers
- **THEN** the card displays one combined aggregate rating and total review count
- **AND** a clickable pill for each contributing provider

#### Scenario: One provider resolves

- **WHEN** only one provider yields a valid, identity-matched rating
- **THEN** the combined aggregate equals that provider's rating and count
- **AND** only that provider's pill is shown
- **AND** the unresolved provider contributes nothing

#### Scenario: No provider resolves

- **WHEN** neither provider yields a valid, identity-matched rating
- **THEN** the card renders without any external-rating content
- **AND** the rest of the place card remains fully usable

### Requirement: Combined aggregate calculation

When more than one provider contributes a rating, the combined rating SHALL be
the review-count-weighted mean of the contributing ratings and the combined
count SHALL be the sum of their exact counts. When only one provider
contributes, the combined values SHALL equal that provider's. When all
contributing counts are zero, the app SHALL fall back to an unweighted mean
rather than dividing by zero.

#### Scenario: Weighted mean and summed count

- **WHEN** TripAdvisor contributes 4.5 over 1000 reviews and Yelp 3.0 over 3000
- **THEN** the combined rating is 3.4 (weighted) and the combined count is 4,000

#### Scenario: Single provider

- **WHEN** only Yelp contributes 4.2 over 321 reviews
- **THEN** the combined rating is 4.2 and the combined count is 321

#### Scenario: Zero counts

- **WHEN** every contributing provider reports zero reviews
- **THEN** the combined rating is the unweighted mean
- **AND** no divide-by-zero occurs

### Requirement: Provider listing pills

For every provider contributing a rating, the app SHALL display a clickable pill
labelled with the provider name that opens that provider's listing URL. No pill
SHALL be shown for a provider that contributed no rating.

#### Scenario: Pill per contributing provider

- **WHEN** ratings from both providers are displayed
- **THEN** a Tripadvisor pill and a Yelp pill are both shown

#### Scenario: Press opens the listing

- **WHEN** the user presses a provider pill
- **THEN** the app opens that provider's listing URL

#### Scenario: No pill without a rating

- **WHEN** a provider contributed no rating
- **THEN** no pill is shown for that provider

### Requirement: Search-card inline extraction

The app SHALL use an inline aggregate rating and exact count from a provider
search-result card directly, without loading the listing page, but only when the
card's identity is confirmed (name matches AND an address or `geo` signal
matches). A card without a confirmation signal SHALL load the listing page for
confirmation before any rating is displayed.

#### Scenario: Confirmed card answers directly

- **WHEN** a search card shows a rating and count AND carries matching coordinates or address
- **THEN** the rating is validated and displayed without a listing navigation

#### Scenario: Unconfirmed card falls through

- **WHEN** a search card shows a rating but exposes neither matching coordinates nor address
- **THEN** the app loads the listing page for identity confirmation
- **AND** no rating is displayed until that confirmation succeeds

### Requirement: Listing resolution order

For each provider the app SHALL resolve a listing in this order: (1) an explicit
`polaris:<provider>` tag on the place, (2) a provider link discovered from the place
website's anchors, (3) a provider search using the place name and address. The search
step SHALL be attempted only when steps 1 and 2 yield nothing.

#### Scenario: Explicit tag wins

- **WHEN** the place carries a valid `polaris:tripadvisor` or `polaris:yelp` listing URL
- **THEN** the app loads that listing directly
- **AND** it does not perform a search

#### Scenario: Website link used before search

- **WHEN** the place has no explicit provider tag
- **AND** its website HTML contains a link to the provider listing
- **THEN** the app loads the discovered listing directly
- **AND** it does not perform a search

#### Scenario: Search only as last resort

- **WHEN** the place has no explicit tag and its website links no provider listing
- **THEN** the app MAY perform one provider search built from the place name and address
- **AND** it SHALL NOT retry the search in a loop on failure

### Requirement: Address-based listing discovery

When a provider search is performed, the app SHALL build the query from the place name
and an assembled address. The assembled address SHALL prefer structured OSM address tags
(`addr:housenumber`, `addr:street`, `addr:city`, `addr:state`, `addr:postcode`,
`addr:country`) and fall back to the enriched formatted address when structured tags are
absent.

#### Scenario: Structured tags available

- **WHEN** the place has `addr:street` and `addr:city` tags
- **THEN** the search query includes the assembled street address and city

#### Scenario: Only enriched address available

- **WHEN** the place has no structured address tags but an enriched formatted address
- **THEN** the search query uses the enriched formatted address

### Requirement: Listing identity matching

The app SHALL display a rating only when the listing name matches the place name
AND at least one confirmation signal is present: a normalized street-and-city
address match, or a `geo` coordinate within approximately 50 meters of the place
coordinates. A search candidate MAY be loaded on a name match alone, but its
rating SHALL be discarded unless the loaded listing confirms the match.

#### Scenario: Name and address match

- **WHEN** a candidate listing name matches the place name
- **AND** the candidate address matches the place address
- **THEN** the candidate is accepted

#### Scenario: Geo proximity confirms

- **WHEN** a candidate listing name matches the place name
- **AND** the candidate exposes a `geo` coordinate within approximately 50 meters of the place
- **THEN** the candidate is accepted

#### Scenario: Chain branch rejected

- **WHEN** a candidate listing name matches the place name
- **AND** neither the address nor the `geo` coordinate matches the place
- **THEN** the candidate is rejected
- **AND** no rating from that candidate is displayed

#### Scenario: Name mismatch rejected

- **WHEN** a candidate listing address matches the place address but the listing name does not
- **THEN** the candidate is rejected

#### Scenario: Name-only candidate is not confirmed

- **WHEN** a search candidate matches by name but the loaded listing exposes neither a matching address nor a nearby `geo` coordinate
- **THEN** the candidate's rating is discarded and not displayed

### Requirement: Rating validation

The app SHALL validate an extracted rating before display: the rating MUST be a finite
number in [0, 5], the review count MUST be an exact non-negative integer, the listing
MUST expose a name, and the listing MUST NOT be an anti-bot challenge page. An invalid
or challenged extraction SHALL be discarded rather than displayed.

#### Scenario: Valid rating displayed

- **WHEN** an extraction yields a rating in [0, 5] and an exact non-negative integer count
- **THEN** the rating is displayed

#### Scenario: Challenge page discarded

- **WHEN** the loaded page is detected as an anti-bot challenge
- **THEN** the extraction is discarded
- **AND** the provider shows no rating

#### Scenario: Approximate count rejected

- **WHEN** the review count cannot be parsed as an exact non-negative integer
- **THEN** the extraction is discarded

### Requirement: Reviews row placement and states

The reviews row SHALL appear above the place-photo carousel on the place card.
While ratings are being resolved it SHALL show a loading indicator, and when no
rating is found it SHALL show a write-the-first-review invitation that opens the
review-compose surface.

#### Scenario: Row above photos

- **WHEN** the place card renders
- **THEN** the reviews row appears above the photo carousel

#### Scenario: Loading indicator

- **WHEN** ratings are still resolving
- **THEN** the row shows a loading indicator

#### Scenario: No rating found

- **WHEN** resolution settles with no rating
- **THEN** the row shows a write-the-first-review invitation
- **AND** pressing it opens the review-compose surface

### Requirement: Combined rating attribution

The combined aggregate SHALL show the rating, the total exact review count, and
an observed-time label, and SHALL be attributed to the contributing providers
through their listing pills.

#### Scenario: Combined attribution rendered

- **WHEN** a combined aggregate is displayed
- **THEN** it shows the rating, the total exact review count, and an observed-time label
- **AND** the contributing providers are represented by their listing pills

#### Scenario: Source link opens the listing

- **WHEN** the user activates a provider pill
- **THEN** the app opens that provider's listing URL

### Requirement: Transient and device-local ratings

External ratings SHALL be transient and device-local. They MUST NOT be written to
SQLite, Gun, ATProto, OSM, or any persistent store, and MUST NOT influence search
ranking or any other feature.

#### Scenario: Rating not persisted

- **WHEN** a rating has been resolved and displayed
- **THEN** no rating data is written to any persistent store

#### Scenario: Rating does not affect ranking

- **WHEN** search results are ranked
- **THEN** external ratings are not an input to the ranking

### Requirement: Aggregate number only

The app SHALL request and parse only the aggregate rating number, the exact review
count, the listing identity, and the source URL. It SHALL NOT request, parse, store, or
display individual review text or reviewer identities.

#### Scenario: No review text requested

- **WHEN** a listing or search page is parsed
- **THEN** only the aggregate rating, count, listing identity, and source URL are extracted
- **AND** no individual review body or reviewer identity is extracted or stored
