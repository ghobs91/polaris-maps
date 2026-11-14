/**
 * The Geofabrik tree, minus the areas a published pack already covers.
 *
 * The tree exists for places with no pack: its entries download raw tiles from
 * OpenFreeMap, hard-capped at 50 MB per download, so large areas fail outright.
 * Offering a tree entry for an area that also has a pack asks the user to pick
 * between the good download and the capped one for the same place, which is
 * not a choice worth presenting.
 *
 * Matching is by id — the same id the tree's download handler uses
 * (`geoNodeToRegion(node).id`) and the same one the generated catalog keys on,
 * so a pack for a leaf hides exactly that leaf.
 */

import { geoNodeToRegion, type GeoNode } from '../../constants/geofabrikCatalog';

/**
 * Leaves with a pack of their own are dropped; a branch survives only while
 * something under it is still uncovered, so a fully covered continent
 * disappears instead of collapsing to an empty header.
 *
 * A curated metro pack (`us-ny-new-york`) covers part of the `new-york` state
 * leaf but is not that leaf, so the state stays listed: the rest of it is still
 * only reachable through the tile path.
 */
export function uncoveredTree(nodes: GeoNode[], packIds: ReadonlySet<string>): GeoNode[] {
  const kept: GeoNode[] = [];

  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      const children = uncoveredTree(node.children, packIds);
      if (children.length > 0) kept.push({ ...node, children });
      continue;
    }
    if (!packIds.has(geoNodeToRegion(node).id)) kept.push(node);
  }

  return kept;
}

/** Every node in the tree, flattened — for counts and tests. */
export function flattenTree(nodes: GeoNode[]): GeoNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenTree(node.children) : [])]);
}
