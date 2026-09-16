## ADDED Requirements

### Requirement: Satellite imagery comes only from free open providers

The satellite/aerial imagery layer SHALL be sourced only from free and open imagery providers, such as Sentinel-2 cloudless and USGS NAIP. Non-open-licensed imagery, including Esri World Imagery, MUST NOT be used.

#### Scenario: Satellite style uses open imagery

- **WHEN** the user selects the satellite base map
- **THEN** tiles are requested only from configured free/open imagery sources

#### Scenario: Esri source removed

- **WHEN** the change is complete
- **THEN** the satellite style contains no Esri World Imagery source and no Esri attribution
- **AND** no application code references the Esri imagery endpoint

#### Scenario: Imagery unavailable degrades visibly

- **WHEN** an imagery source is unreachable or returns no tiles for the viewport
- **THEN** the layer degrades to a visible limited-coverage or empty state
- **AND** no raw error is shown to the user

### Requirement: Imagery attribution is displayed

Every imagery layer SHALL carry the attribution required by its provider's license, and the app SHALL surface that attribution to the user.

#### Scenario: Attribution present on the source

- **WHEN** an imagery source is configured
- **THEN** its required attribution string is set on the map source
- **AND** the attribution is rendered in the map's attribution surface

#### Scenario: Attribution identifies the provider

- **WHEN** the Sentinel-2 cloudless source is active
- **THEN** the rendered attribution identifies Sentinel-2 cloudless
- **AND** when the NAIP source is active, the rendered attribution identifies USGS NAIP

### Requirement: Place photos come from on-device website photo scraping

The system SHALL retain the on-device website photo scraper (`src/services/poi/websitePhotosService.ts`) and its carousel (`WebsitePhotosCarousel.tsx`) as the primary place-media source, extracting OpenGraph and `<img>` photos from a place's own website. When no photo is found, the place card SHALL show an explicit empty media state. This on-device scrape MUST NOT be replaced by Wikimedia Commons or another third-party media provider.

#### Scenario: Photos sourced from the place website

- **WHEN** a place with a resolvable website is selected and the scrape returns photos
- **THEN** the place card renders the photos via the existing carousel
- **AND** no paid embed or external media provider is required

#### Scenario: No photo found

- **WHEN** the place has no website or the scrape returns no images
- **THEN** the place card shows an explicit empty media state
- **AND** no hosted embed or paid request is attempted

#### Scenario: Scraping remains on-device

- **WHEN** website photos are fetched
- **THEN** the fetch happens on the device against the place's own site
- **AND** no project-hosted page brokers the request

### Requirement: Free open street imagery may be added later

Free and open street-level imagery (for example Panoramax) MAY be added as a supplementary place-media source in a later change. It is not required by this change and MUST NOT be introduced in a way that displaces on-device website photo scraping.

#### Scenario: Street imagery is optional

- **WHEN** this change is implemented
- **THEN** no free street-imagery integration is required to be shipped
- **AND** website photo scraping remains the primary place-media source

### Requirement: Paid MapKit web services are removed

The paid Apple MapKit JS PlaceDetail embed and the Apple Maps Server API client SHALL be removed, including the embed URL builder, the embed component, the hosted place-detail page, the embed-token constant, the server-API client, and the token-generation script.

#### Scenario: MapKit JS embed removed

- **WHEN** the change is complete
- **THEN** the MapKit JS PlaceDetail embed URL builder, its embed component, the hosted place-detail page, and the embed token constant are removed
- **AND** no runtime code loads the MapKit JS embed

#### Scenario: Apple Maps Server API removed

- **WHEN** the change is complete
- **THEN** the Apple Maps Server API client module and its token-generation script are removed
- **AND** no request is made to the Apple Maps Server API

### Requirement: Native MapKit enrichment is optional on iOS

On-device native Apple MapKit enrichment MAY be retained on iOS to fill missing POI fields such as phone, website, address, hours, and logo. It SHALL degrade gracefully when the native module or OS support is unavailable. The paid Apple Maps Server API and the MapKit JS embed MUST NOT be used.

#### Scenario: Native enrichment available

- **WHEN** the app runs on a supported iOS device and native MapKit is available
- **THEN** native enrichment may fill missing POI fields

#### Scenario: Native enrichment unavailable

- **WHEN** the native MapKit module is unavailable, unsupported, or returns no match
- **THEN** the POI card renders with the data it already has
- **AND** no paid Apple web API request is made

### Requirement: Full place-media experience is deferred

The full place-media experience SHALL be deferred to the `deepen-search-and-places` change. This change only removes the paid MapKit web services, replaces satellite imagery, and preserves the existing place-photo contract.

#### Scenario: Deferred scope is respected

- **WHEN** this change is implemented
- **THEN** the place card is not redesigned into a new media experience
- **AND** the richer place-media UX is left to `deepen-search-and-places`
