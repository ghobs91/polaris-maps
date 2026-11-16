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

## Two tags, and why

| Tag                  | Carries                                                | Mutability                                 |
| -------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `map-data-<YYYY-MM>` | the packs, routing graphs, indices and their checksums | immutable once published                   |
| `map-data-latest`    | `catalog.json` only                                    | republished in place on every data refresh |

The app reads the catalog from `map-data-latest`. The catalog's asset URLs point
at the dated tag, so a refresh never overwrites bytes a device may be part-way
through downloading.

The pointer is a fixed tag rather than GitHub's `releases/latest` because
`latest` resolves to the most recent release of **any** kind — an iOS build
published after a data refresh would silently redirect every install to a
release with no packs in it.

`config.json` is **not** published by CI: it is signed with a private key the
workflow does not hold. Upload it to `map-data-latest` by hand after signing
(step 3).

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

## Mirrors

GitHub Releases is the required origin and, until a mirror is listed, the only
one. Its ceiling is discretionary: the Acceptable Use Policies reserve the right
to throttle file hosting at "significantly excessive" bandwidth, which is not a
number anyone can plan against. A mirror does not reduce bytes — it makes the
throttle survivable.

The client already handles mirrors end to end (`assets[].mirrors`,
`assetBaseUrls`, rotation and failure cooldowns in `mirrorHealth.ts`, per-origin
md5 verification in `downloadService.ts`). Publishing one is configuration, not
code.

### Internet Archive

The Internet Archive is the correct first mirror because it is an institution
with a mandate to host public data, not an individual's donation budget. Use one
item per dated release and keep the same number of items as
`prune-map-data-releases.mjs` keeps releases.

**Layout.** `<item>/<tag>/<asset>`, which is what both the catalog builder and
the uploader assume:

```
polaris-maps-map-data-2026-11/
  map-data-2026-11-a/us-ny-new-york-tiles.pmtiles
  map-data-2026-11-f/de-berlin-search.sqlite
```

**The tag must come from `scripts/pack-release-tag.mjs`.** Packs are split across
six sibling tags (`-a` … `-f`, ~59 regions each) because a release holds at most
1,000 assets. The catalog stamps each asset's mirror URL as
`${base}/${regionTag}/${asset}`, so mirroring to the bare month tag puts every
byte at a path no client requests — 100% of mirrored regions 404 while the
upload reports success. This is why the workflow computes `TAG` with the script
rather than `date +%Y-%m`.

**Enable it in two phases.** Uploading and _advertising_ are separate switches,
and they are set in this order — advertising first means the first catalog after
the switch lists an origin that may still be ingesting.

| GitHub name                 | Kind     | Value                                             | Phase         |
| --------------------------- | -------- | ------------------------------------------------- | ------------- |
| `IA_ITEM`                   | secret   | the item id, e.g. `polaris-maps-map-data-2026-11` | 1 — upload    |
| `IA_ACCESS_KEY_ID`          | secret   | from archive.org/account/s3.php                   | 1 — upload    |
| `IA_SECRET_ACCESS_KEY`      | secret   | from archive.org/account/s3.php                   | 1 — upload    |
| `POLARIS_PACK_MIRRORS`      | variable | `true`                                            | 1 — upload    |
| `POLARIS_PACK_MIRROR_BASES` | variable | `https://archive.org/download/<item>`             | 2 — advertise |

The workflow maps the three secrets onto the `RCLONE_CONFIG_IA_*` variables
rclone reads, so the names above are what to type in the GitHub UI — not the
`RCLONE_` ones. `POLARIS_PACK_MIRROR_BASES` is what makes the catalog _advertise_
the mirror (comma-separated, one base per origin); without it the bytes are
uploaded and never requested.

`RCLONE_CONFIG_IA_DISABLE_CHECKSUM` is pinned to `false` in the workflow. rclone
defaults it to `true`, which uploads without computing an md5 and therefore never
asks the Archive to verify the object — a mirror serving a corrupt file nobody
can detect at either end.

**Verify before shipping.** Never publish a catalog listing a mirror that does
not serve the bytes: `mirrorHealth` will rotate devices onto it and demote it
only after they have paid the failure.

```bash
node scripts/verify-pack-mirrors.mjs --catalog catalog.json
```

It probes every advertised URL with a one-byte ranged GET, compares the reported
size against `sizeBytes`, and on archive.org cross-checks the item's own md5
against the catalog's (no 27 GB download). A missing item answers `503`, not
`404` — both are reported as "not served".

**Two operational notes.**

- Rotation is uniform: once a mirror is in the catalog it takes roughly _half_
  of all first attempts, with no warm-up share. That is fine for an origin that
  has been verified and bad for one that has not, which is what the check above
  is for.
- Uploads are not instantly servable — the Archive runs ingestion and derivation
  before `/download/` is stable. Publish the catalog after verification, not
  immediately after the upload finishes.

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
