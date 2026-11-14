/**
 * Pack-origin default drift guard.
 *
 * Three places independently describe where a shipped build looks for its data:
 *
 *   src/constants/config.ts          REGION_CATALOG_URL, REGION_DATA_BASE_URL
 *   src/services/config/remoteConfig.ts  REMOTE_CONFIG_URL
 *   scripts/verify-pack-origins.mjs  the preflight that fails the release
 *
 * If they disagree, the preflight can pass against one origin while the app
 * fetches another — which is exactly the failure it exists to catch. The
 * script is plain ESM and cannot import the TypeScript constants, so the
 * agreement is pinned here instead.
 *
 * Context: these defaults previously pointed at `cdn.example.com` and
 * `app.polarismaps.app`, neither of which serves anything. The app therefore
 * shipped with no downloadable packs and an unreachable kill-switch document,
 * and no build failed. That is what this test is for.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REGION_CATALOG_URL,
  REGION_DATA_BASE_URL,
  REGION_DATA_TAG,
} from '../../src/constants/config';
import { REMOTE_CONFIG_URL } from '../../src/services/config/remoteConfig';

const PREFLIGHT = readFileSync(resolve(__dirname, '../../scripts/verify-pack-origins.mjs'), 'utf8');

/** Values the preflight script derives, read straight out of its source. */
function preflightDefaults(): { tag: string; base: string } {
  const tag = /const DATA_TAG = '([^']+)'/.exec(PREFLIGHT)?.[1];
  const repo = /EXPO_PUBLIC_REGION_DATA_REPO \?\? '([^']+)'/.exec(PREFLIGHT)?.[1];
  if (!tag || !repo) throw new Error('preflight defaults not found in verify-pack-origins.mjs');
  return { tag, base: `https://github.com/${repo}/releases/download/${tag}` };
}

describe('pack origin defaults', () => {
  it('agrees with the release preflight', () => {
    const { tag, base } = preflightDefaults();
    expect(REGION_DATA_TAG).toBe(tag);
    expect(REGION_DATA_BASE_URL).toBe(base);
  });

  it('derives the catalog and config from the same release tag', () => {
    expect(REGION_CATALOG_URL).toBe(`${REGION_DATA_BASE_URL}/catalog.json`);
    expect(REMOTE_CONFIG_URL).toBe(`${REGION_DATA_BASE_URL}/config.json`);
  });

  it('does not point at a placeholder host', () => {
    // The regression this replaces: `cdn.example.com` and `app.polarismaps.app`
    // are not origins the project operates, so every build shipped dead links.
    for (const url of [REGION_CATALOG_URL, REMOTE_CONFIG_URL]) {
      expect(url).not.toMatch(/example\.(com|net|org)/);
      expect(new URL(url).protocol).toBe('https:');
    }
  });

  it('pins a fixed release tag rather than `latest`', () => {
    // `releases/latest` resolves to the newest release of any kind, so an iOS
    // release published after a data refresh would point every install at a
    // release with no packs in it.
    expect(REGION_DATA_TAG).not.toBe('latest');
    expect(REGION_DATA_TAG).toMatch(/^map-data/);
  });
});
