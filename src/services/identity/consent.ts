import { storage } from '../storage/mmkv';
import { useSettingsStore } from '@/stores/settingsStore';

const CONSENT_COMPLETE_KEY = 'privacy_consent_complete';
const CONSENT_VERSION_KEY = 'privacy_consent_version';
const CURRENT_CONSENT_VERSION = 1;

export interface ConsentChoices {
  locationEnabled: boolean;
  trafficTelemetryEnabled: boolean;
  poiContributionsEnabled: boolean;
  imagerySharingEnabled: boolean;
}

const DEFAULT_CHOICES: ConsentChoices = {
  locationEnabled: false,
  trafficTelemetryEnabled: false,
  poiContributionsEnabled: false,
  imagerySharingEnabled: false,
};

export function hasCompletedConsent(): boolean {
  const version = storage.getNumber(CONSENT_VERSION_KEY);
  return version === CURRENT_CONSENT_VERSION;
}

export function applyConsentChoices(choices: ConsentChoices): void {
  useSettingsStore.getState().setPermissions(choices);
  storage.set(CONSENT_COMPLETE_KEY, 'true');
  storage.set(CONSENT_VERSION_KEY, CURRENT_CONSENT_VERSION);
}

export function getDefaultConsentChoices(): ConsentChoices {
  return { ...DEFAULT_CHOICES };
}

export function resetConsent(): void {
  storage.delete(CONSENT_COMPLETE_KEY);
  storage.delete(CONSENT_VERSION_KEY);
}
