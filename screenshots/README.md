# App Store screenshots

Automated pipeline that captures the app on a 6.9" iOS simulator and composes
App Store cards in the Polaris marketing style (purple card, title, icon, phone
bezel, callout bubble).

## Layout

| Path                    | What                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `raw/`                  | Full-resolution 1320×2868 simulator captures (gitignored)                    |
| `out/`                  | Composed 1320×2868 cards + `_contact-sheet.png` (gitignored) — the 6.9" slot |
| `out/iphone-1206x2622/` | Same 7 cards downscaled for the 6.3" (iPhone 16/17 Pro) slot                 |
| `out/iphone-1179x2556/` | Same 7 cards downscaled for the 6.1"/6.3" (iPhone 15/16 Pro) slot            |
| `compose.py`            | Renders each card from a raw capture, then writes the extra size sets        |
| `contact_sheet.py`      | Builds the dark multi-card preview sheet                                     |

App Store Connect rejects a card whose pixel size does not match the display
slot you drop it into ("File dimensions are invalid"). 1320×2868 is only valid
for the 6.9" slot; `compose.py` therefore also writes 1206×2622 and 1179×2556
set folders, downscaled from the same composition (never upsampled). Drag the
folder that matches the slot ASC is showing you.

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

## iPad (2064×2752)

`ios.supportsTablet` is `true`, so an iPad set is required. `compose_ipad()`
renders the same card style on a 2064×2752 canvas; `IPAD_CARDS` currently has one
card (`ipad-01-explore.png`) from `raw/ipad-map.png`. Add more entries as needed.
