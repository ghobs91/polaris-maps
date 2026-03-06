import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { usePeerStore } from '../../stores/peerStore';

let unsubscribe: (() => void) | null = null;

export type ConnectionQuality = 'good' | 'poor' | 'none';

export interface ConnectivityState {
  isConnected: boolean;
  quality: ConnectionQuality;
  type: string | null;
}

let currentState: ConnectivityState = {
  isConnected: true,
  quality: 'good',
  type: null,
};

export function getConnectivity(): ConnectivityState {
  return currentState;
}

export function isOnline(): boolean {
  return currentState.isConnected;
}

export function startMonitoring(): void {
  if (unsubscribe) return;

  unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const connected = state.isConnected ?? false;
    const quality = deriveQuality(state);

    currentState = {
      isConnected: connected,
      quality,
      type: state.type,
    };

    usePeerStore.getState().setIsOnline(connected);
  });
}

export function stopMonitoring(): void {
  unsubscribe?.();
  unsubscribe = null;
}

function deriveQuality(state: NetInfoState): ConnectionQuality {
  if (!state.isConnected) return 'none';

  if (state.type === 'wifi' || state.type === 'ethernet') return 'good';

  if (state.type === 'cellular') {
    const details = state.details as { cellularGeneration?: string } | null;
    if (details?.cellularGeneration === '2g') return 'poor';
    return 'good';
  }

  return 'poor';
}
