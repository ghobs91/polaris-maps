import type { PlaceList, SavedPlace } from '../../models/placeList';

/**
 * Merge two replicas of a shared place list deterministically.
 *
 * - List metadata (name/emoji/isPrivate) uses last-write-wins on `updatedAt`;
 *   ties break by list id (lexicographically greater wins) for determinism.
 * - Places merge with last-write-wins on `updatedAt` (falling back to
 *   `addedAt`), grouped by coordinate + name so concurrent adds of the same
 *   place (even with different ids) collapse to one entry.
 * - Tombstones (`deleted: true`) win over older live entries and are dropped
 *   from the result, so a deleted place is never resurrected.
 *
 * `mergeList(a, b)` and `mergeList(b, a)` produce the same list.
 */

function placeTimestamp(place: SavedPlace): number {
  return place.updatedAt ?? place.addedAt ?? 0;
}

function placeKey(place: SavedPlace): string {
  return `${place.lat.toFixed(5)},${place.lng.toFixed(5)}|${place.name.trim().toLowerCase()}`;
}

/** Pick the surviving entry from equivalent edits, deterministically. */
function pickWinner(group: SavedPlace[]): SavedPlace {
  return [...group].sort((a, b) => {
    const byTime = placeTimestamp(b) - placeTimestamp(a);
    if (byTime !== 0) return byTime;
    // Newest ties: prefer live over deleted, then larger id for stability.
    if (!!a.deleted !== !!b.deleted) return a.deleted ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  })[0];
}

export function mergeList(local: PlaceList, remote: PlaceList): PlaceList {
  const localWins =
    local.updatedAt > remote.updatedAt ||
    (local.updatedAt === remote.updatedAt && local.id > remote.id);
  const meta = localWins ? local : remote;

  const groups = new Map<string, SavedPlace[]>();
  for (const place of [...local.places, ...remote.places]) {
    const key = placeKey(place);
    const group = groups.get(key);
    if (group) group.push(place);
    else groups.set(key, [place]);
  }

  const merged = new Map<string, SavedPlace>();
  for (const group of groups.values()) {
    const winner = pickWinner(group);
    if (winner.deleted) continue; // tombstone — do not resurrect
    merged.set(winner.id, winner);
  }

  return {
    id: meta.id,
    name: meta.name,
    emoji: meta.emoji,
    isPrivate: meta.isPrivate,
    places: [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}
