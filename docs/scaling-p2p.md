# Scaling the P2P layers

Notes on how the traffic/mesh layers behave as the user base grows, and what is
in place to keep them from depending on infrastructure the project does not run.

## Traffic publish budget

Public Nostr relays are donation-funded. A device must never be able to flood
them, so publishing is bounded three ways:

| Bound                                                | Where                                 | Value                              |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------- |
| Probes only leave the mesh with **zero** swarm peers | `probeCollector.selectProbeTransport` | `PROBE_RELAY_MIN_PEERS = 1`        |
| Probe publishes per device per day                   | `publishBudget.ts`                    | `PROBE_BUDGET_PER_DAY = 240`       |
| Profile publishes per device per day                 | `publishBudget.ts`                    | `PROFILE_BUDGET_PER_DAY = 60`      |
| Profile throttle per cell                            | `nostrProfileExchange.ts`             | `PROFILE_PUBLISH_THROTTLE_MS = 6h` |

Counters are keyed to the UTC day and persisted in MMKV, so relaunching the app
does not reset the allowance. Probe and profile budgets are independent: profile
publishing can never starve live probes.

## Profile storage shape

Profiles are published as **one replaceable event per cell per week**
(`d = <geohash5>:week`, content version 2), carrying every bucket for that cell.
Stored relay events therefore grow with `devices × cells` instead of
`devices × cells × buckets` — up to 48× fewer per cell. Content version 1
(one bucket per event) is still parsed, so previously published profiles keep
working.

Publishing is gated on `qualifiesForPublish`:

- ≥ `MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED` (20) probe-derived samples,
- observations spanning more than one day (`MIN_OBSERVATION_SPAN_DAYS`),
- inside the retention window.

The multi-day requirement is what stops a single drive past a cell from being
broadcast as a weekly pattern.

## Relay policy

`nostrRelayDirectory.ts` probes the public pool (connect → `REQ` → `EOSE`
round-trip), ranks by latency, persists the last-known-good set, and re-probes
every 6 hours so the active list never goes stale.

`EXPO_PUBLIC_POLARIS_RELAY` optionally pins a **community-hosted** relay
(Transitous-style: run by the community, not by this project). A pinned relay
always ranks first and is never dropped by the limit, even when its probe looks
unhealthy — a transient probe failure must not remove the one relay the
community maintains. Polaris itself never operates a relay.

## Region pack downloads

`assetDownload.ts` provides resumable, mirror-aware, delta-aware downloads:

- **Resume** — partial transfers continue via HTTP Range; resume data is
  persisted next to the partial file so a killed app resumes after relaunch.
- **Mirrors** — the catalog may list fallback origins. Permanent failures
  (403/404) move to the next mirror; transient ones (429/5xx/network) retry with
  exponential backoff.
- **Delta** — when the catalog publishes a per-asset checksum
  (`assets[].md5`), a file whose native MD5 already matches is skipped, so a
  data refresh costs the changed bytes rather than the whole pack.

The catalog gains `assets[]` (name, url, mirrors, md5, sizeBytes) from
`scripts/update-region-asset-urls.mjs`; the CI workflow publishes a
`<region>-checksums.json` per region that the catalog job merges.

## Base-map packs (tiles)

Region packs ship a `tiles.pmtiles` archive built by planetiler. At install the
worklet expands it into the `{z}/{x}/{y}.pbf` tree the on-device tile server
already serves (`backend/pmtiles.mjs`, RPC `unpack-pmtiles`), then deletes the
archive so a pack is not stored twice.

Why it matters at scale: a downloaded region then renders with **zero**
third-party tile requests. Previously every install pulled ~3,000 tiles from the
shared OpenFreeMap servers, which is a donation-funded service — at a large user
base that is the single biggest external dependency in the app.

Expansion is capped at z12 (`UNPACK_MAX_ZOOM`), matching the zoom the previous
per-tile path fetched, which bounds both file count and disk use. Raising it
means many more files per region; the alternative is serving the archive
directly via HTTP range requests, which needs Range support in the native tile
server.

## Auto-download for the visible region

`autoRegionDownload.ts` + `autoRegionDownloadCoordinator.ts` download the pack
for whatever region the map is looking at, so a first open (panned to the user's
location) ends up rendering from local bytes without the user finding the region
list.

Guards (all in the pure `decideAutoDownload`): enabled in settings, point inside
a known region, not already downloaded/downloading, pack under
`AUTO_DOWNLOAD_MAX_BYTES` (150 MB — unknown size counts as too large), unmetered
unless the user opted into cellular, viewport settled for 4 s, and no retry
after a failure this session.

## Seeding measurement

iOS suspends backgrounded apps, so a phone is a weaker seed than a desktop
BitTorrent client. `sync/seedDiagnostics.ts` samples the Hyperdrive swarm once a
minute while foregrounded and records drives seeded, swarm connections, and the
fraction of samples where a drive had ≥1 peer (**seed availability**).

To measure real seeding behaviour, run the same region on two devices:

1. Device A downloads and seeds a region (`autoSeedRegion`).
2. Device B joins the same region while A is foregrounded, then again while A is
   backgrounded.
3. Compare `getSeedSummary()` on A for each case: `availability` near 0 while
   backgrounded confirms the iOS suspension limit, and tells you to treat P2P
   seeding as best-effort rather than a guaranteed origin.

## Volunteer and donated infrastructure

Every remaining third-party origin is somebody else's donation-funded server, so
the app treats them as optional and asks nothing of them at scale:

| Origin                 | Default                       | Why                                                                                                                                                                                                            |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenFreeMap (tiles)    | on, until a pack is installed | Unlimited requests, but ~150–300 MB per install of egress. Packs exist to remove it entirely (see above). Offline downloads stay inside their published 3,000-tile / 50 MB / 4-parallel budget.                |
| Overpass               | on, gap-filler only           | Volunteer mirrors. No hedging, sequential with cooldowns, one request in flight, and cooldowns **persist across launches** so a device that learned a mirror is down does not re-probe it.                     |
| Nominatim              | **off**                       | OSMF caps the whole _application_ at 1 req/s, so a shipped fallback cannot scale. Addresses come from the local index; the network path needs `EXPO_PUBLIC_NOMINATIM_FALLBACK=1` or `nominatimFallback: true`. |
| FOSSGIS Valhalla, OSRM | last-resort tiers             | Demo services. On-device Valhalla answers first (`fff7a1b`).                                                                                                                                                   |
| Transitous             | on                            | Community MOTIS instance, no published quota and no client-side budget yet.                                                                                                                                    |
| Nostr relays           | on, bounded                   | 240 probe + 60 profile publishes per device per day, and probes only leave the mesh when a device has zero swarm peers.                                                                                        |
| GitHub Releases        | primary pack origin           | Polaris runs no CDN. Packs, catalog and the signed config all live there.                                                                                                                                      |

Because none of these are ours, two things have to be true before a release
ships:

1. **The kill switches are published.** `https://app.polarismaps.app/config.json`
   is the only way to turn an origin off without an App Store release, and the
   Nominatim and Overpass policies both require that ability.
2. **The pack release exists.** Without a `map-data-<YYYY-MM>` release carrying
   `catalog.json`, every install streams live tiles — the load profile packs
   remove.

`pnpm packs:verify` (`scripts/verify-pack-origins.mjs`) checks both plus a pack
asset and the tile origin, and the iOS workflow runs it before the native build
whenever a catalog URL is configured.

## Geocoding

Geocoding is the clearest example of the per-query problem, because the corpus is
small and the query rate is high: at a million users, one address lookup per day
is ~12x OSMF's entire per-second allowance for the _application_.

It is answered at three levels, all of them local:

| Tier | Source                                                       | Covers                                                                        |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1    | `geocoding_data` via `geocoding_rtree`                       | The address or named feature at the point, from a downloaded pack             |
| 2    | `geocoding_rtree` widening 0.5 km → 100 km                   | A nearby address, then the nearest locality                                   |
| 3    | `src/constants/coarseGeocoder.json` (~310 kB, in the binary) | Country, first-level area and nearest city — cold install and out-of-coverage |

Reverse lookups walk the tiers in order; each is an R*Tree probe, so the cascade
costs a few index reads rather than a table scan over a metro's addresses. The
bundled tier means a pin always resolves to *something\* recognisable instead of
an empty row, which is what used to justify a network geocoder.

`reverseGeocode` never issues a request, and neither does address search: the
Nominatim fallback ships disabled (`nominatimPolicy.ts`) and only a build or a
signed config turns it on. The regression suite
(`__tests__/unit/geocodingStaysOffline.test.ts`) asserts `fetch` is never called.

Regenerate the bundled tier with `pnpm geo:coarse` (GeoNames `cities1000`,
CC BY 4.0). The output is committed so a normal build needs no network.

## Not yet done

Hyperdrive-seeded **profile** shards (writing weekly profiles into a seeded
drive and answering profile queries in the Bare worklet) would move the durable
profile store off relays entirely. It needs worklet changes, a `bare-pack`
rebuild, and device validation; the batching above already removes the
device-count-driven growth that motivated it.
