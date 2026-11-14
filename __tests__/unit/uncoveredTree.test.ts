/**
 * The Geofabrik tree is the fallback for areas with no pack: its entries
 * download OpenFreeMap tiles, hard-capped at 50 MB. Showing a tree entry for an
 * area that has a pack offers the worse of two downloads for the same place.
 */

import { uncoveredTree, flattenTree } from '../../src/services/regions/uncoveredTree';
import type { GeoNode } from '../../src/constants/geofabrikCatalog';

const leaf = (path: string, name = path): GeoNode => ({ name, path });
const branch = (path: string, children: GeoNode[]): GeoNode => ({
  name: path,
  path,
  children,
});

const tree: GeoNode[] = [
  branch('north-america', [
    branch('north-america/us', [
      leaf('north-america/us/new-york'),
      leaf('north-america/us/vermont'),
    ]),
    leaf('north-america/canada'),
  ]),
  branch('europe', [leaf('europe/france'), leaf('europe/spain')]),
];

const ids = (nodes: GeoNode[]) => flattenTree(nodes).map((node) => node.path);

describe('uncoveredTree', () => {
  it('returns the whole tree when no pack exists', () => {
    expect(ids(uncoveredTree(tree, new Set()))).toEqual(ids(tree));
  });

  it('drops a leaf that has its own pack', () => {
    const result = uncoveredTree(tree, new Set(['north-america-us-vermont']));
    expect(ids(result)).toContain('north-america/us/new-york');
    expect(ids(result)).not.toContain('north-america/us/vermont');
  });

  it('drops a branch once everything under it is covered', () => {
    // Europe fully covered → the continent disappears rather than collapsing to
    // an empty header the user has to expand to discover nothing.
    const result = uncoveredTree(tree, new Set(['europe-france', 'europe-spain']));
    expect(ids(result)).not.toContain('europe');
    expect(ids(result)).toContain('north-america/canada');
  });

  it('keeps a branch while anything under it is uncovered', () => {
    const result = uncoveredTree(tree, new Set(['europe-france']));
    expect(ids(result)).toContain('europe');
    expect(ids(result)).toContain('europe/spain');
    expect(ids(result)).not.toContain('europe/france');
  });

  it('does not let a metro pack hide the state that contains it', () => {
    // `us-ny-new-york` is the curated metro; the state leaf is
    // `north-america-us-new-york`. The metro covers part of the state, so the
    // rest of the state is still only reachable through the tile path.
    const result = uncoveredTree(tree, new Set(['us-ny-new-york']));
    expect(ids(result)).toContain('north-america/us/new-york');
  });

  it('does not mutate the input tree', () => {
    const before = JSON.stringify(tree);
    uncoveredTree(tree, new Set(['europe-france']));
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('counts leaves only', () => {
    const result = uncoveredTree(tree, new Set(['europe-france', 'europe-spain']));
    const leaves = flattenTree(result).filter((node) => !node.children?.length);
    expect(leaves.map((node) => node.path)).toEqual([
      'north-america/us/new-york',
      'north-america/us/vermont',
      'north-america/canada',
    ]);
  });
});
