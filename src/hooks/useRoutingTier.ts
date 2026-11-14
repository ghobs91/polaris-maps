import { useSyncExternalStore } from 'react';
import {
  getRoutingTierState,
  subscribeRoutingTier,
  type RoutingTierState,
} from '../services/routing/routingService';

/**
 * Subscribe to the routing cascade's last-used tier.
 *
 * Returns `null` until the first route has been computed. The snapshot is a
 * stable object that only changes when the tier actually changes, so this does
 * not re-render on every navigation tick.
 */
export function useRoutingTier(): RoutingTierState | null {
  return useSyncExternalStore(subscribeRoutingTier, getRoutingTierState, getRoutingTierState);
}
