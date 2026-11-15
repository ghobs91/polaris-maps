/**
 * Display order for the offline-pack list.
 *
 * The list mixes every pack state — the search has to find the one being
 * downloaded and the ones already on disk, not just the ones waiting. What
 * needs attention first is still obvious from the badge, so the order is by
 * urgency, alphabetical within a group.
 */

import type { Region } from '../../models/region';

const RANK: Record<Region['downloadStatus'], number> = {
  downloading: 0, // actively transferring — keep it in view
  failed: 1, // needs a decision (retry or delete)
  none: 2, // available to download
  complete: 3, // done; findable by search but out of the way
};

export function orderPacks(regions: Region[]): Region[] {
  return [...regions].sort((a, b) => {
    const byRank = RANK[a.downloadStatus] - RANK[b.downloadStatus];
    if (byRank !== 0) return byRank;
    return a.name.localeCompare(b.name);
  });
}

/** Case-insensitive filter over the name and id. */
export function filterPacks(regions: Region[], query: string): Region[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return regions;
  return regions.filter(
    (region) =>
      region.name.toLowerCase().includes(needle) || region.id.toLowerCase().includes(needle),
  );
}
