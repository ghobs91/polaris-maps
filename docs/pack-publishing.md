# Publishing region packs

Polaris runs no CDN. The packs, the region catalog and the signed kill-switch
document are all published as assets on a **GitHub Release** with the fixed tag
`map-data-latest`.

This is the single origin every install depends on for offline data, and the
only mechanism that can turn a third-party service off without an App Store
release. If the release does not exist, the app still builds and runs — it just
streams live third-party tiles and geocoders for every user, which is the load
profile packs exist to remove.

## What must be on the release

| Asset                       | Produced by                            | Consumed by            |
| --------------------------- | -------------------------------------- | ---------------------- |
| `catalog.json`              | `scripts/update-region-asset-urls.mjs` | `catalogService.ts`    |
| `config.json`               | `scripts/sign-remote-config.mjs`       | `remoteConfig.ts`      |
| `<regionId>-tiles.pmtiles`  | planetiler (`build-region-data.yml`)   | `downloadService.ts`   |
| `<regionId>-routing.tar`    | Valhalla (`build-region-data.yml`)     | `routingGraphs.ts`     |
| `<regionId>-geocoding…`     | `build-region-bundle.sh` / CI          | geocoding importer     |
| `<regionId>-search…`        | `scripts/osm-to-search-sqlite.py`      | `localPoiIndex.ts`     |
| `<regionId>-transit…`       | `scripts/osm-to-search-sqlite.py`      | `localTransitIndex.ts` |
| `<regionId>-checksums.json` | CI                                     | delta download         |

`catalog.json` and `config.json` are what the app looks for at startup; the rest
are referenced by URL from the catalog.

## Why a fixed tag, not `latest`

GitHub's `releases/latest` resolves to the most recent release of **any** kind.
An iOS build published after a data refresh would silently redirect every
install to a release with no packs in it. `map-data-latest` is re-published in
place by the data workflow instead.

## Procedure

1. **Build the data.** Either run the workflow (Actions → _Build region map
   data_) or build one region locally:

   ```bash
   bash scripts/generate-region-data.sh us/new-york
   # or, for the search/transit indices alone:
   python3 scripts/osm-to-search-sqlite.py clipped.osm.pbf us-ny-new-york out/
   ```

2. **Stamp the catalog** with the asset URLs and sizes:

   ```bash
   node scripts/update-region-asset-urls.mjs \
     --tag map-data-latest \
     --sizes sizes.json \
     --assets assets.json \
     --out catalog.json
   ```

3. **Sign the config.** The flags default to "on" when a flag is absent, so only
   list the ones you want to change:

   ```bash
   cat > config.json <<'JSON'
   { "version": 1, "issuedAt": "2026-11-13T00:00:00.000Z", "flags": { "transitousPlan": false } }
   JSON
   POLARIS_CONFIG_PRIVATE_KEY=<64-hex> \
     node scripts/sign-remote-config.mjs config.json > signed-config.json
   ```

   The payload field order must match `FLAG_ORDER` in
   `src/services/config/remoteConfig.ts`; `remoteConfigSignature.test.ts` runs
   this script and verifies its output, so drift fails CI.

4. **Upload** `catalog.json` and `signed-config.json` (as `config.json`) to the
   `map-data-latest` release, alongside the region assets.

5. **Verify before shipping:**

   ```bash
   pnpm packs:verify
   ```

   It probes the catalog, the config, a region asset and the tile origin, and
   prints the exact remedy for whatever is missing.

## The release gate

`ios-testflight.yml` runs `verify-pack-origins.mjs` on every build, so the state
of the origins is visible in the log. It only **fails** the build when the
repository variable `POLARIS_REQUIRE_PACK_ORIGINS` is `1`.

Set it on release lanes. Leave it unset for development builds, where
unpublished packs are expected.

## Defaults

`REGION_CATALOG_URL` and `REMOTE_CONFIG_URL` derive from `REGION_DATA_REPO` and
`REGION_DATA_TAG` in `src/constants/config.ts`. Override either with
`EXPO_PUBLIC_REGION_CATALOG_URL` / `EXPO_PUBLIC_REMOTE_CONFIG_URL` to self-host
the same files.

`__tests__/unit/packOriginsDefaults.test.ts` pins those defaults to the ones
`verify-pack-origins.mjs` uses, so the preflight cannot pass against one origin
while the app fetches another.
