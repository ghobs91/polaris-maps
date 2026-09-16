/**
 * Opportunistic startup download of the offline GeoNames city database.
 *
 * Kept separate from `globalGeocoderService` so the search module graph does
 * not pull in NetInfo/InteractionManager. The download is Wi-Fi preferred,
 * cancellable, and silently no-ops when no real database URL is configured.
 */

import { InteractionManager } from 'react-native';
import {
  ensureGeonamesDb,
  isGeonamesReady,
  isGeonamesUrlConfigured,
} from './globalGeocoderService';

export function scheduleGeonamesDownload(): () => void {
  if (!isGeonamesUrlConfigured() || isGeonamesReady()) return () => {};

  let cancelled = false;

  const attempt = () => {
    if (cancelled || isGeonamesReady()) return;
    void ensureGeonamesDb().catch(() => {
      // Silent no-op — a later session or Wi-Fi transition retries.
    });
  };

  const interaction = InteractionManager.runAfterInteractions(() => {
    void (async () => {
      try {
        const NetInfo = (await import('@react-native-community/netinfo')).default;
        const state = await NetInfo.fetch();
        if (state.isConnected && (state.type === 'wifi' || state.type === 'unknown')) attempt();
      } catch {
        attempt();
      }
    })();
  });

  let unsubscribe: (() => void) | null = null;
  void (async () => {
    try {
      const NetInfo = (await import('@react-native-community/netinfo')).default;
      if (cancelled) return;
      unsubscribe = NetInfo.addEventListener((state) => {
        if (!cancelled && state.isConnected && state.type === 'wifi') attempt();
      });
    } catch {
      // No connectivity listener available — the idle attempt still runs.
    }
  })();

  return () => {
    cancelled = true;
    interaction.cancel();
    unsubscribe?.();
  };
}
