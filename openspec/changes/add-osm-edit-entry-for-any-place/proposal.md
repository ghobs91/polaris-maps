## Why

A place's edit affordance ("Update Place Info" → `/poi/osm-edit`) is rendered only when the
tapped POI carries a positive id, which was meant to mean "this is a real OSM element". In
practice that gate is both too narrow and too wide:

- **Too narrow**: most map pins are not raw OSM nodes. Overture places, saved places, and
  search/geocode results are converted with a synthetic negative id
  (`placeToOsmPoi` / `savedPlaceToOsmPoi`), so no edit option appears at all — even for a
  place the user just seeded into OSM moments earlier, and even when signed in. That is the
  reported symptom: "why isn't there an option to edit a place when I'm logged in to OSM?"
  Being signed in was never part of the condition.
- **Too wide**: the same gate lets two foreign id spaces through as if they were OSM node
  ids. Nominatim POIs are rendered with their Nominatim `place_id`, and Overpass ways are
  rendered with a way id; both would be handed to the node-only editor, which fetches
  `/api/0.6/node/<id>.json` and fails.

## What Changes

- **Resolve on tap**: the edit affordance is shown for every selected place. A genuine OSM
  node edits directly (unchanged); anything else has its OSM element resolved by name +
  proximity (the same Overpass query and scoring the seed dedupe already uses) and is then
  edited, reported as mapped-as-a-way/relation, or — for an Overture-sourced place —
  offered for creation. The button shows a "Checking OpenStreetMap…" state while resolving.
- **Keep id spaces apart**: Overpass POIs are tagged with their element type
  (`polaris:osmType`) and Nominatim POIs with `polaris:source: 'nominatim'`, and
  `isOsmNodePoi()` only reports true for a real node id. This is what stops a `place_id` or
  a way id from reaching the node editor.
- **Share the matching rules**: `checkPoiExistsInOsm` and the new `findOsmPlaceMatch` run
  the same query and classification, so "already mapped" means the same thing to the seed
  guard and to the editor.
- **Unchanged**: the manual "Add to OpenStreetMap" button and the auto-seed flow, as the
  in-flight `selective-overture-seed` change requires.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `osm-account-settings`: add a requirement that the OSM edit entry point resolves the OSM
  element for any place, and that only a genuine OSM node id is ever passed to the node
  editor.

## Impact

- **UI**: `src/components/map/POIInfoCard.tsx` — the "Update Place Info" block becomes
  source-agnostic with a resolving state; alerts for mapped-as-other / not-mapped.
- **Services**: `src/services/poi/osmFetcher.ts` — `queryOsmMatches` extracted,
  `findOsmPlaceMatch` / `clearPlaceMatchCache` added, element-type and Nominatim source
  tags set.
- **Utils**: new `src/utils/osmEditAction.ts` (`resolveOsmEditAction`), and
  `isOsmNodePoi` in `src/utils/placeToOsmPoi.ts`.
- **Tests**: new `__tests__/unit/osmEditAction.test.ts`; `__tests__/unit/osmFetcher.test.ts`
  gains `findOsmPlaceMatch` and id-space tagging coverage.
- **Not touched**: `app/poi/[id].tsx` (the saved-place detail screen) has its own actions
  row; giving it the same affordance is a follow-up.
