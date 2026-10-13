import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/**
 * Open an http(s) link in an in-app browser — SFSafariViewController on iOS, a
 * Chrome Custom Tab on Android — instead of switching the user out to their
 * default browser.
 *
 * Used for the website-style actions on place cards and place details (website,
 * menu, social profiles, provider listings). Falls back to the system browser
 * when the in-app browser is unavailable, and resolves `false` only when
 * neither could open the link.
 */
export async function openInAppBrowser(url: string): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      dismissButtonStyle: 'done',
    });
    return true;
  } catch {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }
}
