/**
 * Select and load the offline routing graph covering a set of route points.
 *
 * Graphs are not tied to one downloaded region: a metro graph downloaded with a
 * state pack is shared by every route inside its bounds. Returns false when no
 * graph covers the points, leaving callers to fall back to online/MapKit — and
 * records why, so the routing badge can say more than "no region graph loaded".
 */

import { selectRoutingGraph, type LatLng } from '../../utils/routingGraphSelect';
import { listInstalledRoutingGraphs } from './routingGraphs';
import { getInitializedPath, initRouting, isRoutingInitialized } from './routingService';
import {
  clearRoutingGraphSelectionFailure,
  recordRoutingGraphSelectionFailure,
} from './routingGraphStatus';

let inFlight: Promise<boolean> | null = null;

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * Ensure the native Valhalla engine is loaded with a graph covering `points`.
 * Concurrent calls share the same in-flight attempt.
 */
export function ensureOfflineRoutingForPoints(points: LatLng[]): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const candidates = await listInstalledRoutingGraphs();
      const chosen = selectRoutingGraph(candidates, points);
      if (!chosen) {
        recordRoutingGraphSelectionFailure(
          candidates.length === 0
            ? 'no routing graph installed — download a region pack to route offline'
            : `no installed graph covers this route (${candidates.length} graph${
                candidates.length === 1 ? '' : 's'
              } on device)`,
        );
        return false;
      }
      if (!isRoutingInitialized() || getInitializedPath() !== chosen.dir) {
        await initRouting(chosen.dir);
      }
      // Either way the engine now serves a graph for this route, so any reason
      // recorded for an earlier one no longer applies.
      clearRoutingGraphSelectionFailure();
      return true;
    } catch (err) {
      recordRoutingGraphSelectionFailure(`graph load failed: ${describeError(err)}`);
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
