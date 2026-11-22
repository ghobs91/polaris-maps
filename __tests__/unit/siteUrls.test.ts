/**
 * The site has two hosts and they are not interchangeable:
 *
 *   - `polarismaps.app` (apex) is the canonical *website* host: landing page,
 *     privacy policy, terms, and every URL the App Store listing points at.
 *   - `app.polarismaps.app` is the *app* host: universal links, the AT Protocol
 *     OAuth client id and the Mapillary callback are bound to it, by Apple
 *     entitlement and by third-party registration. Moving those to the apex
 *     breaks already-shared links and the OAuth client identity.
 *
 * These assertions exist because the site URL leaked into the app once as a
 * hardcoded `app.` string, and the fix is one careless find-and-replace away
 * from being undone in either direction.
 */

import {
  MAPILLARY_UPLOAD_REDIRECT_URI,
  PRIVACY_POLICY_URL,
  SITE_BASE_URL,
  TERMS_OF_SERVICE_URL,
} from '../../src/constants/config';

describe('site URLs', () => {
  it('canonicalises the site at the apex, not the app host', () => {
    expect(SITE_BASE_URL).toBe('https://polarismaps.app');
    expect(new URL(SITE_BASE_URL).hostname).toBe('polarismaps.app');
  });

  it('links the legal pages on the apex with a trailing slash', () => {
    expect(PRIVACY_POLICY_URL).toBe('https://polarismaps.app/privacy/');
    expect(TERMS_OF_SERVICE_URL).toBe('https://polarismaps.app/terms/');
  });

  it.each([PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL])('%s is absolute and secure', (url) => {
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('polarismaps.app');
    expect(url.endsWith('/')).toBe(true);
  });

  it('keeps the Mapillary callback on the app host', () => {
    // Registered in the Mapillary developer console; changing the host there
    // would strand the OAuth callback of every build already installed.
    expect(new URL(MAPILLARY_UPLOAD_REDIRECT_URI).hostname).toBe('app.polarismaps.app');
  });
});
