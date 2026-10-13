import type { OsmPlaceMatch } from '../services/poi/osmFetcher';

/** What the place card's "Update Place Info" affordance should do. */
export type OsmEditAction =
  | { kind: 'edit'; nodeId: number }
  | { kind: 'create' }
  | { kind: 'mapped-as-other'; type: 'way' | 'relation'; id: number }
  | { kind: 'not-mapped' };

/**
 * Decide what "Update Place Info" should do for a place that is not already a
 * known OSM node.
 *
 * A matching node is edited; a way/relation is reported as not editable here;
 * an unmapped place is only offered for creation when the caller says creating
 * is appropriate (an Overture-sourced place, as the seed flow does).
 */
export function resolveOsmEditAction(
  match: OsmPlaceMatch | null,
  canCreate: boolean,
): OsmEditAction {
  if (match?.type === 'node') return { kind: 'edit', nodeId: match.id };
  if (match) return { kind: 'mapped-as-other', type: match.type, id: match.id };
  return canCreate ? { kind: 'create' } : { kind: 'not-mapped' };
}
