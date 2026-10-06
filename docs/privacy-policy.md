# Polaris Maps — Privacy Policy

**Status: ready to publish at https://app.polarismaps.app/privacy — pending legal review.**

_Last updated: <DATE>_
_Canonical URL: https://app.polarismaps.app/privacy_

Polaris Maps is a peer-to-peer mapping app. It is built so that your device can
contribute map and traffic data directly to other devices, without a corporate
cloud in the middle. This policy explains what leaves your device and why.

## Summary

- We run **no advertising, analytics, or cross-app tracking**.
- Location is used on-device for navigation. If you turn on **Traffic Telemetry**,
  your device also shares **anonymised speed probes** with nearby peers.
- Camera photos and reviews are shared only when you explicitly enable the
  relevant feature.
- Traffic and geocoding use a few third-party services (listed below) that
  receive the coordinates needed to answer a request.

## Information we process

### Location

- **On device:** your location is used to show your position, provide
  turn-by-turn guidance, and adjust ETAs. This stays on your device unless you
  enable Traffic Telemetry.
- **Traffic telemetry (opt-in, default on):** while the app is in the foreground
  and the permission is enabled, we derive an **anonymised speed probe**
  (geohash cell, speed, bearing, timestamp) and share it with nearby Polaris
  peers over a peer-to-peer network. Probes use a **random ID that rotates
  hourly** and are not linked to your account or device identity. Probes expire
  within minutes.
- **Third-party traffic (optional):** when configured, a TomTom traffic feed may
  be queried to seed traffic data. Requests include the map coordinates being
  viewed.

### Photos and imagery

- **Street-level imagery** is captured and shared only when **Imagery Sharing**
  is enabled.
- **Review photos** are uploaded only when **Review Photo Sharing** is enabled.

### Content you create

- **Place reviews** are published to the AT Protocol (Bluesky) under your
  Bluesky account when you sign in to leave a review.
- **Map edits** are submitted to OpenStreetMap under your OpenStreetMap account
  when you sign in to edit.
- **Incident reports** (e.g. accidents, hazards) are shared over the peer mesh;
  they are signed but not tied to your account.

### Third-party services

Depending on how you use the app, requests may be sent to:

| Service                              | Purpose                            | Data involved                       |
| ------------------------------------ | ---------------------------------- | ----------------------------------- |
| TomTom                               | Traffic flow / ETA seed (optional) | Map coordinates                     |
| OpenStreetMap / Overpass / Nominatim | Place + address data               | Bounding box / coordinates          |
| Photon / Overture Maps               | Geocoding / place data             | Search query / coordinates          |
| AT Protocol relays                   | Reviews                            | Review content, account handle      |
| OpenStreetMap API                    | Map edits                          | Edit content, account               |
| Nostr relays                         | Traffic fallback                   | Anonymised probes, signed incidents |
| Transit agencies                     | Transit schedules / departures     | Stop/route IDs                      |

## What we do not do

- No advertising identifiers, no third-party ad or analytics SDKs.
- No selling of personal data.
- No cross-app tracking.

## Your controls

- **Settings → Privacy** lets you turn off Location Access, Traffic Telemetry,
  POI Contributions, Imagery Sharing, and Review Photo Sharing at any time.
- Turning off Traffic Telemetry stops probe contribution immediately (the app
  pauses collection when offline or backgrounded).

## Data retention

- Traffic probes expire within minutes and are not stored by us.
- Incidents are wiped from your device after their TTL expires.
- Reviews and OSM edits live on the respective public networks under their
  terms.

## Children

Polaris Maps is not directed at children under 13.

## Contact

Questions or data requests: <CONTACT EMAIL>.

## Changes

We may update this policy; material changes will be reflected in the app.
