## 1. Id-space tagging

- [x] 1.1 Tag Overpass POIs with their element type (`polaris:osmType`: `node` / `way`)
- [x] 1.2 Tag Nominatim POIs with `polaris:source: 'nominatim'`
- [x] 1.3 Add `isOsmNodePoi()` — true only for a genuine OSM node id

## 2. Element resolution

- [x] 2.1 Extract the shared Overpass query/scoring into `queryOsmMatches`, leaving `checkPoiExistsInOsm` semantics unchanged
- [x] 2.2 Add `findOsmPlaceMatch` (prefers a node, reports way/relation) with its own TTL cache and `clearPlaceMatchCache`
- [x] 2.3 Add the pure `resolveOsmEditAction(match, canCreate)` decision helper

## 3. Card affordance

- [x] 3.1 Render "Update Place Info" for every selected place
- [x] 3.2 Edit a genuine OSM node directly, without a lookup
- [x] 3.3 Resolve non-node places on tap (richer tags from the cached Place when available), with a resolving state
- [x] 3.4 Offer creation for an unmapped Overture place; report mapped-as-way/relation and not-mapped for the rest
- [x] 3.5 Keep the manual "Add to OpenStreetMap" button and auto-seed flow untouched

## 4. Verification

- [x] 4.1 `__tests__/unit/osmFetcher.test.ts` — node/way/relation resolution, node preference, caching, empty name, element-type and Nominatim tagging
- [x] 4.2 New `__tests__/unit/osmEditAction.test.ts` — edit / mapped-as-other / create / not-mapped decisions
- [x] 4.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the full Jest suite
- [ ] 4.4 On-device: mapped Overture place opens the editor on its existing node; unmapped one offers creation; way-mapped shop shows "already mapped"
