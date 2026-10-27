import { Alert } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';

export type DashCamStartPreference = 'every-drive' | 'manual';

/**
 * The one-time question, shown the first time the user starts active
 * navigation (phone or CarPlay — the coordinator sees both).
 *
 * "Not now" is permanent for the prompt: the record button stays available on
 * the navigation screen, and Settings → Dash cam has the auto-start switch.
 */
export function askDashCamStartPreference(): Promise<DashCamStartPreference> {
  return new Promise((resolve) => {
    Alert.alert(
      'Record your drives?',
      'Polaris can start the dash cam automatically every time navigation begins. ' +
        'Footage stays on this device — nothing is uploaded — and the oldest clips ' +
        'are deleted once the time or storage limit is reached. ' +
        'Change this anytime in Settings → Dash cam.',
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: () => {
            useSettingsStore.getState().setDashCam({
              autoStart: false,
              autoStartPromptAnswered: true,
            });
            resolve('manual');
          },
        },
        {
          text: 'Every drive',
          onPress: () => {
            useSettingsStore.getState().setDashCam({
              autoStart: true,
              autoStartPromptAnswered: true,
            });
            resolve('every-drive');
          },
        },
      ],
      { cancelable: false },
    );
  });
}
