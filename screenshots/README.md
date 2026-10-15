# App Store screenshots

Automated pipeline that captures the app on a 6.9" iOS simulator and composes
App Store cards in the Polaris marketing style (purple card, title, icon, phone
bezel, callout bubble).

## Layout

| Path               | What                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `raw/`             | Full-resolution 1320×2868 simulator captures (gitignored)              |
| `out/`             | Composed 1320×2868 App Store cards + `_contact-sheet.png` (gitignored) |
| `compose.py`       | Renders each card from a raw capture                                   |
| `contact_sheet.py` | Builds the dark multi-card preview sheet                               |

## Regenerate

1. Boot a 6.9" simulator and install a build (App Store dimensions require
   1320×2868):

   ```bash
   xcrun simctl boot <iPhone-17-Pro-Max-udid>
   xcrun simctl install <udid> /path/to/PolarisMaps.app
   ```

2. Drive the app to each screen and capture full-res:

   ```bash
   xcrun simctl io <udid> screenshot --type=png screenshots/raw/03-map.png
   ```

   (UI automation is done via the `agent-device` MCP in this repo's workflow.)

3. Compose and preview:

   ```bash
   python3 screenshots/compose.py
   python3 screenshots/contact_sheet.py
   ```

## Current set (iPhone 6.9", dark mode)

Live traffic (crowd-sourced) · Every mode, one trip (transit) · Satellite imagery
· Walk the street before you go (street-level, Panoramax + Mapillary) · The best
route, right now (navigation) · Rich details, without the clutter (place details)
· Download offline maps (North America → United States expanded).

**Pending:** CarPlay card (`08-carplay.png`) — needs a CarPlay view capture.

Raw sources live in `screenshots/raw/` (gitignored): `live-traffic.png`,
`transit.png`, `satellite.png`, `street-level.png`, `navigation.png`,
`place-details.png`, `regions.png`, `carplay.png`.

Edit the `CARDS` list in `compose.py` to change titles, icons, callouts, or the
raw screen each card uses.

## Still required

- **iPad 13" (2064×2752)** — `ios.supportsTablet` is `true`, so App Store Connect
  needs iPad screenshots too. Capture on an iPad simulator and add a
  `compose_ipad` variant (same card style, larger canvas).
