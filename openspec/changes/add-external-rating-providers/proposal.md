## Why

Polaris Maps already surfaces an external aggregate rating for a POI from a single
provider (TripAdvisor) using the on-device headless browser — but only when the POI
already carries a `polaris:tripadvisor` tag or its own website links to a listing.
Most POIs have neither, and Yelp is not supported at all. Users opening a restaurant
or venue expect both ratings, and the existing hidden-WebView machinery
(`TripadvisorRatingCard` + injected JS + `react-native-webview`) can obtain them with
no API, no key, and no paid service — fully compatible with the app's
`data-source-policy` (core functionality requires no paid/metered API).

## What Changes

- **Generalize** the single-provider TripAdvisor service (`tripadvisorService.ts`) into
  a provider registry shared by two providers: **TripAdvisor** and **Yelp**. Each
  provider owns its host allowlist, listing-URL parsing, search-URL construction,
  fetch-path HTML parsing, injected WebView JS, and message parsing.
- **Add a Yelp provider** mirroring the TripAdvisor safety shape (host allowlist,
  JSON-LD-first parsing, challenge detection, transient results).
- **Add address-based listing discovery**: when no explicit `polaris:*` tag and no
  website `sameAs` link exists, resolve a listing by loading the provider's own search
  page with the POI **name + assembled address** and selecting the best candidate.
  This is the only new network path and is attempted only as a last resort.
- **Harden identity matching**: accept a candidate only when the listing name matches
  the POI name **and** an address or `geo` proximity signal confirms it, so a chain
  location never displays another branch's rating.
- **Introduce a bounded on-device browse policy** for third-party listing pages:
  genuine non-incognito WebView with a persistent cookie store, one hidden WebView at
  a time, per-host serialization with a minimum interval + jitter, and challenge
  detection that triggers a host cool-down + exponential backoff followed by a silent
  give-up. **Explicitly out of scope**: CAPTCHA solving, proxy/IP rotation,
  fingerprint (TLS/WebGL/canvas) spoofing, auth/login-wall bypass, and background bulk
  harvesting of many POIs.
- **Replace `TripadvisorRatingCard`** with an `ExternalRatingsSection` that renders
  independent Yelp and TripAdvisor rows (provider name, rating, exact count, observed
  time, source link). Either provider may be absent; failures never block the card.
- **Keep ratings transient and device-local** — never written to SQLite, Gun, ATProto,
  OSM, or search ranking. No review **text** is fetched or displayed; only the
  aggregate rating number, count, listing identity, and source URL.

## Capabilities

### New Capabilities

- `external-ratings`: Resolve, validate, and display validated aggregate ratings for a
  POI from TripAdvisor and Yelp via on-device headless browsing, with address-based
  listing discovery, name+address/geo identity matching, attribution, and transient
  device-local results.
- `headless-browse-policy`: The bounded envelope for on-device headless browsing of
  third-party pages — allowed provider hosts, pacing/serialization, challenge
  detection with cool-down/backoff and graceful give-up, and an explicit prohibition on
  circumvention beyond the bounded tier (no CAPTCHA solving, no proxy/IP rotation, no
  fingerprint spoofing, no auth-wall bypass, no bulk harvesting).

### Modified Capabilities

None — `openspec/specs/` currently has no external-ratings or browse-policy
capability. The in-flight `broaden-traffic-and-media-sources` change establishes
`data-source-policy`; this change is consistent with it (no paid providers, no keys)
and does not modify it.

## Impact

- **Services**: `src/services/poi/tripadvisorService.ts` (refactor into provider;
  retain a compatibility re-export), new
  `src/services/poi/externalRatings/{types,provider,index,search,antiBot}.ts`,
  new `src/services/poi/externalRatings/yelpProvider.ts` and
  `.../tripadvisorProvider.ts`, new `src/services/poi/poiAddress.ts`.
- **UI**: `src/components/map/TripadvisorRatingCard.tsx` (replaced by / superseded by
  `ExternalRatingsSection.tsx`), `src/components/map/POIInfoCard.tsx` (mount the new
  section), new `src/hooks/useExternalRatings.ts`.
- **Tests**: `__tests__/unit/tripadvisorService.test.ts` and
  `__tests__/integration/TripadvisorRatingCard.test.tsx` (extend to a two-provider,
  two-stage search→listing flow); new unit tests for the Yelp provider, address
  assembly, search parsing, identity matching, and anti-bot pacing/cool-down.
- **Config/docs**: provider host allowlists are code constants (no env vars, no keys);
  update `src/services/poi/README.md` and `src/components/map/README.md`.
- **Dependencies**: none added — `react-native-webview` is already a dependency.
- **Out of scope**: review **text** extraction, review write/submission, Android
  parity, and any Yelp/TripAdvisor API or paid service.
