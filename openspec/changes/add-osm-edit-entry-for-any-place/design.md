## Context

`osm-account-settings` defines the OSM session and the `/poi/osm-edit` screen, which
redirects to Settings when unauthenticated. The entry point lived in `POIInfoCard` behind
`selectedPoi.id > 0`, an id-sign heuristic standing in for "is a real OSM node". Three id
spaces reach that check: Overpass nodes and ways (true OSM ids), Nominatim `place_id`s, and
synthetic negative ids for Overture/saved/geocode places.

## Goals / Non-Goals

**Goals**

- Any place the user can see can be edited in OSM when it is mapped, whether or not it was
  rendered from OSM.
- Never hand a non-node id to the node-only editor.
- Keep the seed dedupe guard (`checkPoiExistsInOsm`) semantically unchanged.

**Non-Goals**

- Editing ways/relations (the OSM client is node-only).
- Changing the manual "Add to OpenStreetMap" button or the auto-seed flow — the in-flight
  `selective-overture-seed` change requires both unchanged.
- Adding the same affordance to `app/poi/[id].tsx`; that screen keeps its Polaris
  "Suggest Edit" action for now.

## Decisions

### Decision 1: Resolve on tap, not on card open

Resolving eagerly would add an Overpass call to every card open. Instead the affordance is
always rendered and the lookup happens on tap, with the button showing
"Checking OpenStreetMap…" and a spinner while it runs. A rendered OSM node skips the lookup
entirely.

### Decision 2: One shared matcher for both consumers

`checkPoiExistsInOsm` and the new `findOsmPlaceMatch` now call the same
`queryOsmMatches` helper (identical Overpass clauses, radius, and `classifyOsmMatch`
scoring). The seed guard keeps its boolean cache and semantics; the resolver caches the
resolved element separately and prefers a matching node, falling back to reporting the
element type it did match.

### Decision 3: Make the id space explicit instead of inferred

Rather than guessing from the sign of the id, each producer records what it rendered:
Overpass POIs get `polaris:osmType` (`node` / `way`) and Nominatim POIs get
`polaris:source: 'nominatim'`. `isOsmNodePoi()` then answers the only question that matters
— "may this id go to the node editor?" — and the decision logic in
`resolveOsmEditAction(match, canCreate)` is a pure, testable function of the resolved match
and the place's source.

### Decision 4: Distinguish "not mapped" from "mapped as something else"

A place that matches a way/relation is reported as already mapped but not editable in the
app, with a link to open it on openstreetmap.org — never offered for creation, which would
risk a duplicate. Only an unmapped Overture-sourced place is offered for creation, matching
what the seed flow already treats as a contribution candidate.

## Risks / Trade-offs

- **One Overpass call per edit tap** (cached ~10 min, same as the seed guard). Bounded by
  the existing 15 s timeout and the client's min-interval throttle.
- **The resolve step can fail** (network/Overpass); the user is told OpenStreetMap could not
  be reached and no editor opens, rather than being sent to a broken screen.
- **`polaris:osmType` / `polaris:source` tags travel with the POI**: both are `polaris:*`
  keys, which `osmTagsFromPoi` already strips before any OSM submission.

## Migration Plan

1. Ship the tagging, resolver, and card changes together — the tagging is what makes the
   resolver's "not a node" verdict trustworthy.
2. Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the OSM suites.
3. On-device: open an Overture place that is already in OSM and confirm the editor opens on
   the existing node; open one that is not mapped and confirm the creation offer; open a
   way-mapped shop and confirm the "already mapped" message.

## Open Questions

- Should the affordance also appear on the saved-place detail screen (`app/poi/[id].tsx`),
  which currently offers only the Polaris-side "Suggest Edit"?
