import { useStreetViewCaptureStore } from '../../stores/streetViewCaptureStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useDashCamStore } from '../../stores/dashCamStore';
import { confirmStreetViewConsent } from './streetViewConsent';
import {
  createDrive,
  deleteDrive,
  finalizeDrive,
  getActiveDrive,
  listCaptures,
  recoverInterruptedDrives,
} from './streetViewQueue';

/**
 * Start a capture drive. Any drive left in `recording` by a previous process
 * is closed first so two sessions can never own the same rows.
 */
/**
 * Consent gate + drive creation. Used by the navigation action and the
 * auto-start coordinator.
 */
export async function requestStreetViewStart(startedBy: 'manual' | 'auto'): Promise<boolean> {
  if (useDashCamStore.getState().recording) {
    throw new Error(
      'Stop the dash cam first — the camera can only record or take photos at one time.',
    );
  }
  const accepted = await confirmStreetViewConsent();
  if (!accepted) return false;
  // An explicit per-drive start also opts the master switch back in, so the
  // setting and the action cannot disagree about whether capture is allowed.
  useSettingsStore.getState().setStreetView({ enabled: true });
  await beginStreetViewSession(startedBy);
  return true;
}

export async function beginStreetViewSession(startedBy: 'manual' | 'auto'): Promise<string | null> {
  const store = useStreetViewCaptureStore.getState();
  if (store.session) return store.session.driveId;

  await recoverInterruptedDrives();
  const stale = await getActiveDrive();
  if (stale) {
    await finalizeDrive(stale.id);
  }

  const drive = await createDrive(Date.now());
  useStreetViewCaptureStore.getState().startSession(drive.id, drive.startedAt, startedBy);
  return drive.id;
}

/** Finalize the active drive and surface its end-of-drive summary. */
export async function endStreetViewSession(): Promise<string | null> {
  const store = useStreetViewCaptureStore.getState();
  const session = store.session;
  if (!session) return null;

  const captures = await listCaptures(session.driveId).catch(() => []);
  if (captures.length === 0) {
    store.clearSession();
    await deleteDrive(session.driveId);
    return null;
  }

  await finalizeDrive(session.driveId);
  store.finalizeSession();
  return session.driveId;
}

/**
 * Drop a drive that never captured anything (e.g. camera permission denied)
 * so it does not appear as a pending upload.
 */
export async function discardStreetViewSession(): Promise<void> {
  const store = useStreetViewCaptureStore.getState();
  const session = store.session;
  if (!session) return;
  store.clearSession();
  await deleteDrive(session.driveId);
}
