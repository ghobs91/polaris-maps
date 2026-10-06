### Requirement: Calibrated challenge classification

Anti-bot markers (DataDome/Cloudflare/Akamai script tags or frames) SHALL NOT
alone classify a page as a challenge, because valid content pages carry them. A
page SHALL be classified as a challenge only when markers are present and no
usable rating data was extracted from it.

#### Scenario: Markers with valid data are served normally

- **WHEN** a listing page embeds DataDome scripts AND exposes a complete JSON-LD aggregate rating
- **THEN** the rating is extracted and displayed
- **AND** the page is not treated as a challenge

#### Scenario: Markers without data are a challenge

- **WHEN** a page carries anti-bot markers and yields no rating data
- **THEN** it is classified as a challenge and the host enters cool-down

### Requirement: Retriable in-page collection

Injected collectors SHALL re-read the page on an interval until data is
available or a bounded number of attempts is exhausted, so a page briefly
presenting an anti-bot interstitial is re-read once it clears. A collector SHALL
post exactly once per page.

#### Scenario: Interstitial clears during collection

- **WHEN** the first collection pass finds nothing because a DataDome interstitial is presenting
- **THEN** the collector re-reads on the retry interval
- **AND** posts the result once data appears, without remounting the WebView

#### Scenario: Attempts exhausted

- **WHEN** no data is found after the bounded attempts
- **THEN** the collector posts its final (empty/challenge) state once
- **AND** the provider degrades silently

## ADDED Requirements

### Requirement: Allowed provider hosts only

On-device headless browsing SHALL load pages only from an explicit per-provider host
allowlist (`tripadvisor.com`, `www.tripadvisor.com`, and the Yelp hosts), using http(s)
only. Redirects or sub-resources that leave the allowlist MUST be rejected, and
non-web schemes (`data:`, `blob:`, `file:`) MUST never be loaded.

#### Scenario: Allowed host loads

- **WHEN** a listing or search URL resolves to a host in the provider allowlist
- **THEN** the page is loaded on-device

#### Scenario: Off-allowlist redirect rejected

- **WHEN** a load redirects to a host outside the provider allowlist
- **THEN** the load is rejected
- **AND** no extraction occurs

#### Scenario: Non-web scheme rejected

- **WHEN** a URL uses a scheme other than http(s)
- **THEN** it is not loaded

### Requirement: Genuine on-device browser context

Headless browsing SHALL use the genuine platform WebView with the native mobile user
agent and a persistent, non-incognito cookie store, so that normal provider session or
clearance cookies persist as they would in a user's browser. A user agent or browser
fingerprint SHALL NOT be spoofed.

#### Scenario: Native context used

- **WHEN** a provider page is loaded
- **THEN** the WebView uses the platform's native user agent and a persistent cookie store
- **AND** no desktop user agent or fingerprint override is applied

### Requirement: Paced, serialized browsing

The app SHALL run at most one hidden browsing WebView at a time, SHALL serialize
requests per host, and SHALL enforce a minimum interval between requests to the same
host with random jitter. Ratings SHALL be fetched only on demand when a place card is
opened; the app SHALL NOT prefetch ratings across the POI set in the background.

#### Scenario: Single hidden WebView

- **WHEN** two providers must be resolved for the same place
- **THEN** their loads are serialized, not run concurrently

#### Scenario: Minimum interval enforced

- **WHEN** a second request to the same host is issued shortly after a first
- **THEN** it waits at least the minimum interval (with jitter) before loading

#### Scenario: No background bulk prefetch

- **WHEN** the map or a list of places is displayed without opening a place card
- **THEN** no provider listing is loaded in the background

### Requirement: Challenge detection with backoff and graceful give-up

On detecting an anti-bot challenge, the app SHALL set a per-host cool-down, apply
exponential backoff, honor a `Retry-After` header or HTTP 429, and then give up
silently for that provider. The app SHALL NOT retry a challenged host in a tight loop.

#### Scenario: Challenge triggers cool-down

- **WHEN** a loaded page is detected as an anti-bot challenge
- **THEN** the host enters a cool-down
- **AND** the provider renders no rating for that place

#### Scenario: Rate limit honored

- **WHEN** a provider responds with HTTP 429 or a `Retry-After` header
- **THEN** the app waits at least the indicated interval before the next request to that host

#### Scenario: Silent give-up

- **WHEN** a provider remains challenged after backoff
- **THEN** the app stops attempting that provider and surfaces no error to the user

### Requirement: Bounded circumvention

Headless browsing SHALL NOT use circumvention beyond behaving like a normal single user.
The app MUST NOT solve CAPTCHAs, rotate proxies or IP addresses, spoof TLS/WebGL/canvas
fingerprints, forge `navigator.webdriver` or permission state, bypass login or auth
walls, or harvest listings in bulk.

#### Scenario: No CAPTCHA solving

- **WHEN** a provider presents a CAPTCHA or interactive challenge
- **THEN** the app does not attempt to solve it and gives up for that provider

#### Scenario: No proxy or IP rotation

- **WHEN** a provider blocks a request
- **THEN** the app does not retry through a proxy or alternate IP address

#### Scenario: No fingerprint spoofing or auth bypass

- **WHEN** a page is loaded
- **THEN** no fingerprint override is applied and no login or auth wall is bypassed
