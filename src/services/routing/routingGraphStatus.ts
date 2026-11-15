/**
 * Why offline routing had no graph to use.
 *
 * Two independent steps can leave the on-device tier with nothing to load:
 *
 * 1. *Install* — a region download never put a Valhalla graph on disk (no
 *    matching metro, untrustworthy pack bounds, or a failed fetch).
 * 2. *Selection* — graphs exist, but none covers this route, or the native
 *    engine refused to load the one that does.
 *
 * Both used to be swallowed (`catch {}` on install, `return false` on
 * selection), so the only visible symptom was the routing badge silently
 * degrading to a network tier. This module is the leaf that both sides write
 * to and the cascade reads from — it deliberately imports nothing, so
 * `routingService` (which reports the reason) and `offlineRouting` /
 * `routingGraphs` (which produce it) stay free of import cycles.
 */

/** Outcome of one region download's attempt to install routing graphs. */
export interface RoutingGraphInstallStatus {
  /** Epoch ms of the attempt. */
  at: number;
  /** Region whose download triggered the attempt. */
  regionId: string;
  /** Catalog ids the downloader tried to install. */
  requested: string[];
  /** Catalog ids present on disk afterwards. */
  installed: string[];
  /** Attempts that ended without a graph, with the failure that caused it. */
  failed: Array<{ id: string; reason: string }>;
  /** Set when targeting produced no candidates at all. */
  skipped?: 'untrusted-pack-bounds' | 'no-metro-coverage';
}

/** Why the last route could not be routed on-device despite the cascade trying. */
export interface RoutingGraphSelectionStatus {
  at: number;
  reason: string;
}

let installStatus: RoutingGraphInstallStatus | null = null;
let selectionStatus: RoutingGraphSelectionStatus | null = null;

export function recordRoutingGraphInstallStatus(
  status: Omit<RoutingGraphInstallStatus, 'at'>,
): RoutingGraphInstallStatus {
  installStatus = { ...status, at: Date.now() };
  return installStatus;
}

export function getRoutingGraphInstallStatus(): RoutingGraphInstallStatus | null {
  return installStatus;
}

/** Record why a graph could not be selected or loaded for a route. */
export function recordRoutingGraphSelectionFailure(reason: string): void {
  selectionStatus = { at: Date.now(), reason };
}

/** Drop the selection failure — the engine loaded a graph for the last route. */
export function clearRoutingGraphSelectionFailure(): void {
  selectionStatus = null;
}

export function getRoutingGraphSelectionStatus(): RoutingGraphSelectionStatus | null {
  return selectionStatus;
}

/**
 * One-line explanation for the routing badge, or null when there is nothing to
 * report (a graph is on disk and loaded, or nothing has been attempted yet).
 *
 * Prefers the selection failure: it describes the route in front of the user,
 * while an install note may refer to some other region downloaded earlier.
 */
export function summarizeRoutingGraphProblem(): string | null {
  if (selectionStatus) return selectionStatus.reason;
  if (!installStatus) return null;

  const { regionId, failed, skipped } = installStatus;
  if (failed.length > 0) {
    const [first] = failed;
    if (failed.length === 1) return `graph install failed for ${first.id}: ${first.reason}`;
    return `graph install failed for ${regionId}: ${first.id}: ${first.reason} (+${
      failed.length - 1
    } more)`;
  }
  if (skipped) {
    return `no routing graph for ${regionId} (${skipped === 'untrusted-pack-bounds' ? 'pack bounds too wide to target metros' : 'pack covers no metro graph'})`;
  }
  if (installStatus.requested.length === 0) {
    return `no metro graph applies to ${regionId}`;
  }
  return null;
}

/** Reset for tests and for a full routing dispose. */
export function resetRoutingGraphStatus(): void {
  installStatus = null;
  selectionStatus = null;
}
