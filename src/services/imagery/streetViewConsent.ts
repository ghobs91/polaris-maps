import { Alert } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * One-time explainer before the first capture. Resolves true when the user has
 * accepted; the master opt-in is enabled as part of accepting.
 */
export function confirmStreetViewConsent(): Promise<boolean> {
  const settings = useSettingsStore.getState().streetView;
  if (settings.consentAccepted) return Promise.resolve(true);

  return new Promise((resolve) => {
    Alert.alert(
      'Capture street imagery?',
      'Polaris can capture street-level photos while you navigate and upload them to Mapillary after the drive. Photos include GPS position, heading, and capture time. Mapillary blurs faces and licence plates on its servers. Published imagery is public under the platform licence. Only capture public streets, mount the phone before you start driving, and do not interact with it while driving.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'I understand',
          onPress: () => {
            useSettingsStore.getState().setStreetView({
              consentAccepted: true,
              enabled: true,
            });
            resolve(true);
          },
        },
      ],
      { cancelable: false },
    );
  });
}

/** Ask once whether future driving routes should start capture automatically. */
export function askAutoStartPreference(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Start capture automatically?',
      'On future drives, Polaris can start capturing street imagery as soon as turn-by-turn navigation begins. You can still stop it from the navigation screen, and change this later in Settings.',
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: () => {
            useSettingsStore.getState().setStreetView({ autoStartPromptAnswered: true });
            resolve(false);
          },
        },
        {
          text: 'Turn on',
          onPress: () => {
            useSettingsStore.getState().setStreetView({
              autoStart: true,
              autoStartPromptAnswered: true,
            });
            resolve(true);
          },
        },
      ],
      { cancelable: false },
    );
  });
}
