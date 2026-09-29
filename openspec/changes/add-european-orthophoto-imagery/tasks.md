## 1. Research and live-verify European providers

- [x] 1.1 Nordic/Baltic survey: Denmark and Estonia usable; NO/FI/SE/LV/LT/IS initially excluded
- [x] 1.2 W/Central survey: Luxembourg, Belgium, German states NRW/Bavaria/Saxony usable; IE/UK/Andorra/Monaco/Liechtenstein excluded
- [x] 1.3 Central/East survey: Poland, Czechia, Hungary, Slovenia usable; Croatia/Bosnia/Romania excluded; Slovakia/Serbia unreachable
- [x] 1.4 South survey: Spain, Portugal usable; Italy/Greece/Malta/Cyprus excluded
- [x] 1.5 Second pass to add the excluded countries: pin free-key mechanisms and any 3857 option (Finland `api-key`; Iceland, Lithuania, Liechtenstein, Italy + Lazio, Greece, Malta, Cyprus, Bratislava, Croatia usable; Norway/Sweden/Latvia/Ireland/UK/Andorra/Monaco/Serbia/Bosnia/Romania impossible)
- [x] 1.6 Live-probe every candidate endpoint (200 + image content-type) and record template, auth, licence, resolution, maxzoom, bounds

## 2. Provider registry (28 entries)

- [x] 2.1 Add all verified providers to `REGIONAL_ORTHOPHOTO_SOURCES` with bounds, maxzoom, attribution
- [x] 2.2 Add optional `auth: Array<{ name, envVar }>` and register Denmark (`username`/`password`) and Finland (`api-key`) behind `EXPO_PUBLIC_*`
- [x] 2.3 Verify no committed template contains a credential literal
- [x] 2.4 Support WMS/Map/ArcGIS-export endpoints via `{bbox-epsg-3857}` alongside `{z}/{x}/{y}` (incl. `{z}/{y}/{x}` order)

## 3. Wire registry + auth into the satellite style

- [x] 3.1 Generate one raster source + layer per provider (bounds, scheme, maxzoom, tileSize, attribution)
- [x] 3.2 Implement `applyAuth`: read each param from `process.env`, skip the provider when any is unset, append params to tile URLs
- [x] 3.3 Order regional layers after global/NAIP and before labels; narrower providers listed after wider overlaps
- [x] 3.4 Correct `satellite-global` `maxzoom` to 14
- [x] 3.5 Leave `satellite-naip` and labels unchanged; `SATELLITE_STYLE_JSON` parses

## 4. Environment documentation

- [x] 4.1 Document optional Denmark credentials and the Finland API key in `.env.example`

## 5. Tests

- [x] 5.1 Per-provider source+layer with matching bounds/maxzoom/tileSize/attribution for every enabled provider
- [x] 5.2 Env-gated providers absent when env vars are unset
- [x] 5.3 Each template has `{z}/{x}/{y}` or `{bbox-epsg-3857}`
- [x] 5.4 No committed credential literals
- [x] 5.5 Enabled regional layers above global base, below all symbol layers
- [x] 5.6 `npx jest __tests__/unit/mapStyles.test.ts --runInBand` — 21 passed

## 6. End-to-end verification (requires a running device/simulator — not executed here)

- [ ] 6.1 Spot-check imagery + attribution per registered country
- [ ] 6.2 Set Finland/Denmark env vars → layer appears; unset → disappears
- [ ] 6.3 Confirm impossible/partial countries fall back to global with no errors
- [ ] 6.4 Confirm global base less blurry at city zoom than before the `maxzoom` fix
- [ ] 6.5 Confirm HTTP-only Italy/Greece load on Android and are silently skipped on iOS

## 7. Quality gates

- [x] 7.1 `pnpm typecheck` — clean
- [x] 7.2 `pnpm lint` — 0 errors (pre-existing warnings only)
- [x] 7.3 `pnpm format:check` — clean
- [x] 7.4 Update `satelliteStyle.ts` header comment for the expanded overlay behaviour
