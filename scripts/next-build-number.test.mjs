/**
 * Unit tests for the build-number resolver's pure helpers.
 * Run: node --test scripts/next-build-number.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bundleIdFromAppConfig,
  buildNumberFromPbxproj,
  maxBuildNumber,
  pickNextBuild,
} from './next-build-number.mjs';

test('maxBuildNumber ignores non-numeric and empty values', () => {
  assert.equal(maxBuildNumber(['328', '336', '', 'n/a', undefined]), 336);
});

test('maxBuildNumber of an empty list is 0', () => {
  assert.equal(maxBuildNumber([]), 0);
});

test('pickNextBuild starts at 1 for a fresh app', () => {
  assert.equal(pickNextBuild({ ascMax: 0, localCurrent: 0 }), 1);
});

test('pickNextBuild follows ASC when it is ahead of the project', () => {
  // The bug this fixes: the project said 328, ASC had 336.
  assert.equal(pickNextBuild({ ascMax: 336, localCurrent: 328 }), 337);
});

test('pickNextBuild never goes backwards when ASC lags the project', () => {
  // ASC is eventually consistent right after an upload; the local value is the
  // floor so the same number is never handed out twice.
  assert.equal(pickNextBuild({ ascMax: 335, localCurrent: 336 }), 337);
});

test('buildNumberFromPbxproj takes the highest of several configurations', () => {
  const pbxproj = `
    CURRENT_PROJECT_VERSION = 327;
    CURRENT_PROJECT_VERSION = 328;
  `;
  assert.equal(buildNumberFromPbxproj(pbxproj), 328);
});

test('buildNumberFromPbxproj returns 0 when the key is absent', () => {
  assert.equal(buildNumberFromPbxproj('MARKETING_VERSION = 1.0;'), 0);
});

test('bundleIdFromAppConfig reads the Expo config', () => {
  assert.equal(
    bundleIdFromAppConfig({ expo: { ios: { bundleIdentifier: 'com.polarismaps.app' } } }),
    'com.polarismaps.app',
  );
  assert.equal(bundleIdFromAppConfig({ expo: {} }), null);
  assert.equal(bundleIdFromAppConfig(null), null);
});
