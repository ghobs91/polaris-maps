import { useSettingsStore } from '../../stores/settingsStore';
import { useDashCamStore } from '../../stores/dashCamStore';
import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { pruneDashCamClips } from './dashCamQueue';

/**
 * Start the rolling dash-cam buffer.
 *
 * The camera can only serve one output at a time, so this refuses to start
 * while street-imagery stills are being captured. Pruning at start also clears
 * anything left over the configured budget by a previous run.
 */
export async function requestDashCamStart(): Promise<void> {
  const store = useDashCamStore.getState();
  if (store.recording) return;
  if (useStreetViewCaptureStore.getState().session) {
    throw new Error(
      'Stop street imagery capture first — the camera can only record or take photos at one time.',
    );
  }
  const { maxMinutes, maxBytes } = useSettingsStore.getState().dashCam;
  await pruneDashCamClips({ maxMinutes, maxBytes }).catch(() => 0);
  store.start();
}

export function stopDashCam(): void {
  useDashCamStore.getState().stop();
}
