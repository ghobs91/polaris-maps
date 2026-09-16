import { useNavigationStore } from '../../stores/navigationStore';
import { startRerouteMonitor, stopRerouteMonitor } from './rerouteService';

let unsubscribe: (() => void) | null = null;
let monitoring = false;

/**
 * Start/stop the congestion reroute monitor with the navigation lifecycle.
 * The monitor is only useful while a route is active, so it is not started
 * until navigation begins and is torn down as soon as it ends.
 */
export function initRerouteMonitor(): void {
  if (unsubscribe) return;

  monitoring = useNavigationStore.getState().isNavigating;
  if (monitoring) startRerouteMonitor();

  unsubscribe = useNavigationStore.subscribe((state) => {
    if (state.isNavigating === monitoring) return;
    monitoring = state.isNavigating;
    if (monitoring) {
      startRerouteMonitor();
    } else {
      stopRerouteMonitor();
    }
  });
}

export function disposeRerouteMonitor(): void {
  unsubscribe?.();
  unsubscribe = null;
  monitoring = false;
  stopRerouteMonitor();
}
