import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Throws when POI contributions are disabled. Called at the top of every
 * write path (edits, reviews, attestations) so declining the consent choice
 * blocks submission across the app, not just in one UI surface.
 */
export function assertPoiContributionEnabled(): void {
  if (!useSettingsStore.getState().permissions.poiContributionsEnabled) {
    throw new Error('POI contributions are disabled. Enable them in Settings to contribute.');
  }
}
