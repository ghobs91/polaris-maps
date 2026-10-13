const mockOpenBrowserAsync = jest.fn();

jest.mock('expo-web-browser', () => ({
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

import { Linking } from 'react-native';
import { openInAppBrowser } from '../../src/utils/inAppBrowser';

describe('openInAppBrowser', () => {
  beforeEach(() => {
    mockOpenBrowserAsync.mockReset();
    jest.restoreAllMocks();
  });

  it('opens the link in the in-app browser', async () => {
    mockOpenBrowserAsync.mockResolvedValue({ type: 'dismiss' });

    await expect(openInAppBrowser('https://example.com')).resolves.toBe(true);

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ presentationStyle: 'pageSheet' }),
    );
  });

  it('falls back to the system browser when the in-app browser rejects', async () => {
    mockOpenBrowserAsync.mockRejectedValue(new Error('in-app browser unavailable'));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    await expect(openInAppBrowser('https://example.com')).resolves.toBe(true);

    expect(openURL).toHaveBeenCalledWith('https://example.com');
  });

  it('resolves false when neither browser can open the link', async () => {
    mockOpenBrowserAsync.mockRejectedValue(new Error('in-app browser unavailable'));
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('cannot open'));

    await expect(openInAppBrowser('https://example.com')).resolves.toBe(false);
  });
});
