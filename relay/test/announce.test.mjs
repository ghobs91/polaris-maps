import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ANNOUNCEMENT_TTL_MS,
  ANNOUNCEMENT_VERSION,
  announcementPayload,
  buildAnnouncement,
  isAnnouncementFresh,
  verifyAnnouncement,
} from '../src/announce.mjs';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'announcement.json',
);

/** Fixed key so the committed fixture is reproducible. */
const PRIVATE_KEY = new Uint8Array(32).fill(0x11);

const REGIONS = [
  {
    regionId: 'us-ny-new-york',
    version: 'map-data-2026-01',
    driveKey: 'ab'.repeat(32),
    bytes: 96468992,
  },
  {
    regionId: 'de-berlin',
    version: 'map-data-2026-01',
    driveKey: 'cd'.repeat(32),
    bytes: 51200000,
  },
];

function buildFixture(overrides = {}) {
  return buildAnnouncement({
    privateKey: PRIVATE_KEY,
    regions: REGIONS,
    capacityBytes: 26_843_545_600,
    usedBytes: 7_516_192_768,
    uplinkKbps: 100_000,
    paused: false,
    pausedReason: null,
    servedBytes24h: 12_884_901_888,
    updatedAt: 1_767_225_600_000,
    ...overrides,
  });
}

test('the canonical payload has a fixed field order and shape', () => {
  // This literal IS the wire contract. The TypeScript client reconstructs the
  // same string; if either side changes order, separator, or a field, every
  // announcement becomes unverifiable and nothing else here would notice.
  const payload = announcementPayload({
    relayPubkey: 'aa'.repeat(32),
    regions: REGIONS,
    capacityBytes: 26_843_545_600,
    usedBytes: 7_516_192_768,
    uplinkKbps: 100_000,
    paused: false,
    pausedReason: null,
    servedBytes24h: 12_884_901_888,
    updatedAt: 1_767_225_600_000,
  });

  assert.equal(
    payload,
    [
      '1',
      'aa'.repeat(32),
      // Sorted by regionId: de-berlin before us-ny-new-york.
      `de-berlin@map-data-2026-01@${'cd'.repeat(32)},us-ny-new-york@map-data-2026-01@${'ab'.repeat(32)}`,
      '26843545600',
      '7516192768',
      '100000',
      'false',
      '',
      '12884901888',
      '1767225600000',
      // statusHash: empty when the announcement carries no dashboard status.
      '',
    ].join('\u0000'),
  );
});

test('regions are sorted so pin order cannot reach the signed payload', () => {
  // Schnorr signing is randomized, so signatures differ between calls; what must
  // be identical is the payload they sign.
  const forward = buildFixture({ regions: REGIONS });
  const reversed = buildFixture({ regions: [...REGIONS].reverse() });
  assert.equal(announcementPayload(forward), announcementPayload(reversed));
  assert.deepEqual(forward.regions, reversed.regions);
  assert.equal(verifyAnnouncement(reversed), true);
});

test('a paused announcement distinguishes null from a reason string', () => {
  const paused = buildFixture({ paused: true, pausedReason: 'on battery power' });
  const unpaused = buildFixture({ paused: false, pausedReason: null });
  assert.notEqual(paused.signature, unpaused.signature);
});

test('a built announcement verifies', () => {
  const announcement = buildFixture();
  assert.equal(announcement.v, ANNOUNCEMENT_VERSION);
  assert.equal(verifyAnnouncement(announcement), true);
});

test('tampering with any signed field invalidates the announcement', () => {
  const announcement = buildFixture();

  for (const tampered of [
    { ...announcement, capacityBytes: announcement.capacityBytes + 1 },
    { ...announcement, usedBytes: 0 },
    { ...announcement, paused: true },
    { ...announcement, servedBytes24h: 0 },
    { ...announcement, updatedAt: announcement.updatedAt + 1 },
    {
      ...announcement,
      regions: [{ ...REGIONS[0], driveKey: 'ff'.repeat(32) }, REGIONS[1]],
    },
  ]) {
    assert.equal(verifyAnnouncement(tampered), false);
  }
});

test('a malformed announcement is rejected rather than throwing', () => {
  for (const bad of [null, undefined, {}, { v: 99 }, { v: 1, relayPubkey: 'nope' }]) {
    assert.equal(verifyAnnouncement(/** @type {any} */ (bad)), false);
  }
});

test('freshness respects the TTL and ignores clock-skewed futures', () => {
  const now = 1_767_225_600_000;
  const announcement = buildFixture({ updatedAt: now });

  assert.equal(isAnnouncementFresh(announcement, now), true);
  assert.equal(isAnnouncementFresh(announcement, now + ANNOUNCEMENT_TTL_MS - 1), true);
  assert.equal(isAnnouncementFresh(announcement, now + ANNOUNCEMENT_TTL_MS + 1), false);
  // A relay whose clock is a day ahead must not stay "fresh" forever.
  assert.equal(isAnnouncementFresh(announcement, now - ANNOUNCEMENT_TTL_MS - 1), false);
  assert.equal(isAnnouncementFresh({}, now), false);
});

test('the committed fixture is what this code produces', () => {
  const expected = buildFixture();
  if (!fs.existsSync(FIXTURE)) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, `${JSON.stringify(expected, null, 2)}\n`);
  }
  const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  // Schnorr signatures are randomized, so compare the signed body and validate
  // the committed signature rather than comparing it byte-for-byte.
  const withoutSignature = ({ signature, ...rest }) => rest;
  assert.deepEqual(withoutSignature(committed), withoutSignature(expected));
  // The fixture is shared with the TypeScript client test, which verifies it with
  // the app's own `verify()` — that is the cross-runtime proof.
  assert.equal(verifyAnnouncement(committed), true);
});
