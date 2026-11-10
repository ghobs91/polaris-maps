# Site assets

Static assets used by `/index.html`. Everything here is pre-generated — Netlify
builds nothing (`netlify.toml`: `publish = "."`), so files must be committed.

## Screenshots (`shots/*.webp`)

Derived from the App Store captures in the repo (not committed — see
`.gitignore`: `screenshots/raw/`, `screenshots/out/`).

| File         | Source                                    | Width |
| ------------ | ----------------------------------------- | ----- |
| `navigation` | `screenshots/raw/navigation.png`          | 760   |
| `traffic`    | `screenshots/raw/live-traffic.png`        | 620   |
| `transit`    | `screenshots/raw/transit.png`             | 620   |
| `place`      | `screenshots/raw/place-details.png`       | 620   |
| `regions`    | `screenshots/raw/regions.png`             | 620   |
| `street`     | `screenshots/raw/street-level-google.png` | 620   |

Regenerate (macOS, Pillow installed):

```python
from PIL import Image
jobs = [
    ("navigation", "navigation", 760),
    ("live-traffic", "traffic", 620),
    ("transit", "transit", 620),
    ("place-details", "place", 620),
    ("regions", "regions", 620),
    ("street-level-google", "street", 620),
]
for src, dest, width in jobs:
    im = Image.open(f"screenshots/raw/{src}.png").convert("RGB")
    im.resize((width, round(im.height * width / im.width)), Image.LANCZOS).save(
        f"netlify-deploy/assets/shots/{dest}.webp", "WEBP", quality=84, method=6
    )
```

## Icons

`icon-192.png` (header, footer and download card), `apple-touch-icon.png` (180)
and `favicon.png` (64) are downscales of `assets/icon.png` (the app icon).

## Badges (`badges/`)

Apple's official "Download on the App Store" artwork, downloaded from
`https://tools.applemediaservices.com/api/badges/download-on-the-app-store/white/en-us`.
The white variant is the only one the (dark) page uses. Do not edit or recolour
it — Apple's marketing guidelines apply.

## `og.png`

1200×630 social preview (app icon, wordmark, headline, navigation screenshot).
Regenerate when the tagline or hero screenshot changes.
