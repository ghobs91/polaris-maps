# speedLimits

Posted speed limits sourced from **Mapillary traffic-sign detections**.

The routing engine (Valhalla / MapKit) already supplies `speed_limit` where OSM
has `maxspeed`. This service exists for the roads where it doesn't — the normal
case across most of the US — by reading speed-limit signs that Mapillary detected
in street-level imagery.

## Contract

`mapillarySpeedSigns.ts` exports pure data functions plus one small cache:

| Export                                      | Purpose                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `parseMaxspeedSignValue(objectValue)`       | Posted number from a sign's `object_value`, in the sign's own unit  |
| `normalizeSpeedLimitSigns(payload, unit)`   | `/map_features` response → `SpeedLimitSign[]`, **converted to mph** |
| `speedUnitForCountry(code)`                 | `mph` for US/GB/LR/MM, `km/h` otherwise                             |
| `countryCodeFromRegionId(id)`               | `us-ny-new-york` → `US`; null when the id isn't `<iso2>-…`          |
| `fetchSpeedLimitSigns(bbox, unit)`          | One box, best-effort; never throws                                  |
| `findNearestSpeedLimitMph(signs, lng, lat)` | Nearest sign within 25 m, or null                                   |
| `SpeedLimitSignCache`                       | Per-trip in-memory box fetcher + matcher                            |

Everything returned across the module boundary is **mph**, matching the rest of
the app. Values are deliberately not rounded — see
`src/native/routeMapping.ts` for why rounding corrupts metric displays.

## API constraints (Mapillary Graph API v4, verified 2026-10)

- `bbox` queries against `/map_features` must be **smaller than 0.01° square**.
  A whole-route corridor query is rejected, which is why the cache fetches a
  ~800 m box ahead of the car every 400 m instead.
- The numeric value carries **no unit**. A "50" is 50 mph in the US and 50 km/h
  in Germany, so the caller must supply the country convention. Never derive it
  from the user's display preference: a US user driving in Europe would then read
  a 50 km/h zone as 50 mph.
- Only `regulatory--maximum-speed-limit-<N>--g<k>` counts. Advisory plates
  (`complementary--…`) and minimum-speed signs are rejected on purpose.

## Licence and attribution

Detections are **CC-BY-SA**. The credit is rendered by `SpeedCluster` itself
(`attribution` prop → a small "Limits © Mapillary" chip under the plate), and
`app/(tabs)/navigation.tsx` only passes it when the displayed number actually
came from a detection — a credit for data that isn't on screen is noise. The
token is the existing `EXPO_PUBLIC_MAPILLARY_TOKEN`; without it everything here
is a no-op.

CarPlay deliberately does **not** use this fallback: `toCarPlaySpeedLimit` is fed
only by the routing engine's data, so no credit is owed on the head unit. Wiring
it there would need a native attribution surface first.

## Wiring

`useSpeedLimitSignFallback(enabled)` in `src/hooks/` owns the cache and the
unit resolution for one trip. `app/(tabs)/navigation.tsx` consults it only when
`resolveSpeedLimitMph` (the routing engine's own data) returns null, and feeds the
result to both `SpeedCluster` and the over-speed sampler.

The chain is deliberately conservative at every step:

1. **Country at the current position** — `countryCodeForPosition(lat, lng)` reads
   the `regions` table's bounds and takes the smallest containing extract's
   `<iso2>` prefix. Outside every downloaded region it returns null.
2. **No country means no sign.** The unit of a "50" plate is unknowable without
   it, and 50 mph in a 50 km/h zone is a citation-grade error, so the fallback
   stays silent rather than guessing. Resolved once per trip.
3. **Persistence** — the cache is memory-only by design. Persisting detections
   would need an eviction policy and a licence note for data we do not own.

## Measured coverage (2026-10, 6 boxes in Berlin/Munich/Hamburg/NYC/LA)

Of 881 traffic-sign features returned, only ~10% carried a specific
classification at all — the rest arrive as the generic
`object--traffic-sign--front`. Just four were speed limits:

```
regulatory--maximum-speed-limit-30--g1
regulatory--maximum-speed-limit-25--g1
regulatory--end-of-speed-limit-zone--g1     (correctly ignored)
regulatory--speed-limit-zone--g1            (correctly ignored: no number)
```

Treat this as a **gap-filler in well-imaged areas, not a replacement for
`maxspeed`**. It will not make the sign appear on most US roads today.
