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
