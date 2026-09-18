# Street-Level Imagery

Crowd-sourced street imagery capture, privacy-preserving blur, P2P sharing via Hypercore, and spatial browsing.

## Overview

The imagery service enables users to contribute street-level photos to the decentralized map:

1. **Capture** — camera viewfinder with configurable interval (5s default), each image stamped with GPS coordinates, heading, geohash, and a Schnorr signature from the user's keypair
2. **Privacy blur** — placeholder face/license-plate detection (designed for future on-device ML) that re-saves images via expo-image-manipulator
3. **Upload pipeline** — blur → compute hash → append to Hypercore feed → sign metadata → publish to Gun.js for peer discovery
4. **Browse** — query stored imagery by spatial proximity (lat/lng + radius), geohash, or ID from the `street_imagery` SQLite table

## Files

| File                   | Description                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `captureService.ts`    | Captures street-level imagery with GPS/heading/geohash metadata and Schnorr signature. Stores images in the app's captures directory.                                                                                      |
| `blurService.ts`       | Placeholder privacy blur service — re-saves images via expo-image-manipulator. Designed to be replaced with on-device ML face/plate detection.                                                                             |
| `uploadService.ts`     | Orchestrates the upload pipeline: blur → hash → append to Hypercore feed → sign metadata → publish to Gun.js for peer discovery.                                                                                           |
| `browseService.ts`     | Queries locally stored street imagery by spatial proximity (lat/lng + radius), geohash prefix, or ID from the `street_imagery` SQLite table.                                                                               |
| `streetViewService.ts` | Online street-level 3D panorama lookup, separate from the P2P feed: open **Panoramax** (always) + **Mapillary** (token-gated via `EXPO_PUBLIC_MAPILLARY_TOKEN`). Merges/dedupes 360° panoramas by distance for the viewer. |

## Pipeline

```
Camera viewfinder (5s interval)
    ↓
captureService.ts
    ↓ GPS + heading + geohash + Schnorr signature
blurService.ts
    ↓ face/plate detection (placeholder)
uploadService.ts
    ↓ hash → Hypercore feed → Gun.js metadata
Available to peers for discovery
    ↓
browseService.ts ← spatial query (nearby imagery)
```

## Street View 3D (online supplement)

The P2P `street_imagery` feed stays the primary, offline-capable source. The
`Street View 3D` viewer (`app/imagery/street-view.tsx`) adds online coverage:

- **Panoramax** — open, CC-BY-SA, no token; always queried.
- **Mapillary** — explicit opt-in exception to the no-corporate-cloud rule:
  hidden without `EXPO_PUBLIC_MAPILLARY_TOKEN`, online-only, never cached for
  offline, and never used as a primary source.
- Rendering: `PanoramaViewer` projects the equirectangular image with a real
  WebGL perspective shader (drag to look, pinch/wheel to zoom), with a flat
  fallback if WebGL or the texture upload is unavailable.

## Related Files

- [`src/components/imagery/`](../../components/imagery/) — Camera viewfinder, image viewer, 3D panorama viewer, and upload queue UI
- [`app/imagery/capture.tsx`](../../../app/imagery/capture.tsx) — Capture screen with interval controls and queue counter
- [`src/services/identity/signing.ts`](../identity/signing.ts) — Schnorr signature for image metadata
- [`src/services/sync/feedSyncService.ts`](../sync/feedSyncService.ts) — Hypercore feed management for image uploads
