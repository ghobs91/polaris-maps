import { hasCompletedConsent } from '../identity/consent';
import { initCarPlay } from './carPlayManager';

/**
 * Initialise the CarPlay manager at JS bundle-load time, before React mounts.
 *
 * A CarPlay cold launch — the phone app closed, phone display off — creates only
 * the CarPlay scene: there is no phone window. React Native still loads and runs
 * the bundle, but React passive effects and `setImmediate`/`InteractionManager`
 * callbacks wait on the phone's display link, which does not tick without a
 * window. So `initCarPlay()` from `app/_layout.tsx` never fires and the native
 * CarPlay template stays without a JS subscriber (search, routing and favorites
 * dead) until the phone app is opened and its window starts the display link.
 *
 * Calling it here, synchronously during bundle evaluation, subscribes the
 * manager with no window requirement. Gated on consent (the same gate
 * `app/_layout.tsx` uses) and idempotent: `initCarPlay` is a no-op after the
 * first call, and `_layout.tsx` re-runs it once a fresh consent flow completes
 * with the phone UI mounted.
 */
export function bootCarPlay(): void {
  if (!hasCompletedConsent()) return;
  initCarPlay();
}
