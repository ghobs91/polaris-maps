/**
 * Region catalog service.
 *
 * With OpenFreeMap providing global vector tiles online, the app no longer
 * needs a hardcoded city catalog. Map tiles stream on-demand from
 * OpenFreeMap for any location in the world.
 *
 * The regions table is still used to track user-saved offline areas.
 * `seedCatalog()` is now a no-op kept for backward compatibility.
 */

/**
 * No-op — the hardcoded catalog has been removed.
 * Tiles now come from OpenFreeMap globally.
 */
export async function seedCatalog(): Promise<void> {
  // Intentionally empty — online tile source covers the entire planet.
}

/** No bundled catalog IDs — regions are user-defined. */
export function getCatalogIds(): string[] {
  return [];
}
