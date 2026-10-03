/**
 * Select and load the offline routing graph covering a set of route points.
 *
 * Graphs are not tied to one downloaded region: a metro graph downloaded with a
 * state pack is shared by every route inside its bounds. Returns false when no
 * graph covers the points, leaving callers to fall back to online/MapKit.
 */

import { selectRoutingGraph, type LatLng } from '../../utils/routingGraphSelect';
import { listInstalledRoutingGraphs } from './routingGraphs';
import { getInitializedPath, initRouting, isRoutingInitialized } from './routingService';

let inFlight: Promise<boolean> | null = null;

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
      if (!chosen) return false;
      if (isRoutingInitialized() && getInitializedPath() === chosen.dir) return true;
      await initRouting(chosen.dir);
      return true;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
