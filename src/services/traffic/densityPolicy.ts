/**
 * Mesh density policy.
 *
 * Pure decisions shared by the topic manager and tests. Kept separate from the
 * NetInfo/Hyperswarm imports so the policy can be exercised without native
 * modules.
 */

/** Geohash4 cells joined on an unmetered link (center + 8 neighbours). */
export const MAX_TRAFFIC_TOPICS = 9;
/** Geohash4 cells joined on a metered link (center only). */
export const MAX_TRAFFIC_TOPICS_METERED = 1;

/**
 * True when the link should run the mesh client-only: cellular, or a Wi-Fi
 * network the OS flags as expensive (hotspot / metered tethering).
 */
export function isMeteredConnection(
  type: string | null | undefined,
  isConnectionExpensive?: boolean,
): boolean {
  return type === 'cellular' || isConnectionExpensive === true;
}

/**
 * Pick the cells to join. The center cell is always first, so a metered link
 * degrades to the cell the user is actually looking at instead of dropping
 * coverage entirely.
 */
export function selectTrafficCells(cells: readonly string[], metered: boolean): string[] {
  return cells.slice(0, metered ? MAX_TRAFFIC_TOPICS_METERED : MAX_TRAFFIC_TOPICS);
}
