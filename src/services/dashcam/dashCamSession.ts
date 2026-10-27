import { useSettingsStore } from '../../stores/settingsStore';
import { useDashCamStore } from '../../stores/dashCamStore';
import { pruneDashCamClips } from './dashCamQueue';

/**
 * Start the rolling dash-cam buffer.
 *
 * Pruning at start clears anything left over the configured budget by a
 * previous run. Stills and video use separate VisionCamera outputs, so the
 * dash cam can run alongside street-imagery capture.
 */
export async function requestDashCamStart(): Promise<void> {
  const store = useDashCamStore.getState();
  if (store.recording) return;
  const { maxMinutes, maxBytes } = useSettingsStore.getState().dashCam;
  await pruneDashCamClips({ maxMinutes, maxBytes }).catch(() => 0);
  store.start();
}

export function stopDashCam(): void {
  useDashCamStore.getState().stop();
}
