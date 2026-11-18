import * as fs from 'fs';
import * as path from 'path';

import {
  ANNOUNCEMENT_TTL_MS,
  announcementPayload,
  isAnnouncementFresh,
  parseAnnouncement,
  parseRelayStatus,
  verifyAnnouncement,
  type RelayAnnouncement,
} from '../../src/services/relay/announcement';
import { relayCoverageFor } from '../../src/services/relay/coverage';

/**
 * The fixture is written by `relay/test/announce.test.mjs` and signed by the
 * relay's own code with a fixed key. Verifying it here is the cross-runtime
 * proof: the Node daemon and the React Native client must agree on the canonical
 * payload byte-for-byte, or every announcement is silently unverifiable and the
 * symptom looks like "no relays online".
 */
const FIXTURE_PATH = path.resolve(__dirname, '../../relay/test/fixtures/announcement.json');
const fixture = (): RelayAnnouncement => JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

describe('announcement payload parity with the relay', () => {
  it('serializes the shared fixture to the exact string the Node relay signs', () => {
    // This literal is produced by `relay/src/announce.mjs`; it is duplicated here
    // deliberately. If either side changes field order, separator, or a field,
    // this fails instead of shipping an unverifiable announcement.
    expect(announcementPayload(fixture())).toBe(
      '1\u00004f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa\u0000' +
        'de-berlin@map-data-2026-01@cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd,' +
        'us-ny-new-york@map-data-2026-01@abababababababababababababababababababababababababababababababab' +
        '\u000026843545600\u00007516192768\u0000100000\u0000false\u0000\u000012884901888\u00001767225600000' +
        // statusHash is empty in this fixture (no dashboard status attached).
        '\u0000',
    );
  });

  it('verifies a signature produced by the relay under Node', () => {
    expect(verifyAnnouncement(fixture())).toBe(true);
  });

  it('sorts regions so pin order cannot change the payload', () => {
    const original = fixture();
    const reversed = { ...original, regions: [...original.regions].reverse() };
    expect(announcementPayload(reversed)).toBe(announcementPayload(original));
  });
});

describe('verifyAnnouncement', () => {
  it('rejects every tampered signed field', () => {
    const original = fixture();
    const tampered: RelayAnnouncement[] = [
      { ...original, capacityBytes: original.capacityBytes + 1 },
      { ...original, usedBytes: 0 },
      { ...original, paused: true },
      { ...original, pausedReason: 'on battery power' },
      { ...original, servedBytes24h: 0 },
      { ...original, updatedAt: original.updatedAt + 1 },
      {
        ...original,
        regions: [{ ...original.regions[0], driveKey: 'ff'.repeat(32) }, original.regions[1]],
      },
    ];

    for (const record of tampered) {
      expect(verifyAnnouncement(record)).toBe(false);
    }
  });

  it('rejects a payload signed by a different key', () => {
    const original = fixture();
    expect(verifyAnnouncement({ ...original, relayPubkey: 'aa'.repeat(32) })).toBe(false);
  });
});

describe('parseAnnouncement', () => {
  it('accepts a well-formed record', () => {
    expect(parseAnnouncement(fixture())).not.toBeNull();
  });

  it('coerces numbers Gun may round-trip as strings without breaking the signature', () => {
    const original = fixture();
    const asStrings = {
      ...original,
      capacityBytes: String(original.capacityBytes),
      updatedAt: String(original.updatedAt),
    };
    // Gun stores numbers as strings and hands them back that way. The signed
    // payload is built from `String(n)`, so the coercion is lossless and the
    // signature must still verify — that is the whole reason numbers are
    // coerced instead of rejected.
    const parsed = parseAnnouncement(asStrings);
    expect(parsed).not.toBeNull();
    expect(verifyAnnouncement(parsed!)).toBe(true);
  });

  it('rejects a numeric field whose string form is not the value that was signed', () => {
    const original = fixture();
    const tampered = { ...original, capacityBytes: '2.68e10' };
    const parsed = parseAnnouncement(tampered);
    // Parses (it is a finite number) but re-serializes differently, so the
    // signature cannot verify.
    expect(parsed).not.toBeNull();
    expect(verifyAnnouncement(parsed!)).toBe(false);
  });

  it('rejects records with a bad shape or key', () => {
    expect(parseAnnouncement(null)).toBeNull();
    expect(parseAnnouncement({})).toBeNull();
    expect(parseAnnouncement({ ...fixture(), v: 99 })).toBeNull();
    expect(parseAnnouncement({ ...fixture(), relayPubkey: 'nope' })).toBeNull();
    expect(parseAnnouncement({ ...fixture(), capacityBytes: 'lots' })).toBeNull();
    expect(
      parseAnnouncement({
        ...fixture(),
        regions: [{ regionId: 'x', driveKey: 'not-a-key', bytes: 1, version: 'v' }],
      }),
    ).toBeNull();
  });
});

describe('isAnnouncementFresh', () => {
  const now = 1_767_225_600_000;

  it('accepts a record inside the TTL and rejects one outside it', () => {
    expect(isAnnouncementFresh({ updatedAt: now }, now)).toBe(true);
    expect(isAnnouncementFresh({ updatedAt: now }, now + ANNOUNCEMENT_TTL_MS)).toBe(true);
    expect(isAnnouncementFresh({ updatedAt: now }, now + ANNOUNCEMENT_TTL_MS + 1)).toBe(false);
  });

  it('rejects a clock-skewed future record', () => {
    expect(isAnnouncementFresh({ updatedAt: now + ANNOUNCEMENT_TTL_MS + 1 }, now)).toBe(false);
    expect(isAnnouncementFresh({ updatedAt: 0 }, now)).toBe(false);
    expect(isAnnouncementFresh({ updatedAt: Number.NaN }, now)).toBe(false);
  });
});

describe('relayCoverageFor', () => {
  const now = 1_767_225_600_000;
  const base = (): RelayAnnouncement => ({ ...fixture(), updatedAt: now });

  it('reports coverage for a listed region', () => {
    const coverage = relayCoverageFor([base()], 'us-ny-new-york', now);
    expect(coverage.covered).toBe(true);
    expect(coverage.healthy).toBe(true);
    expect(coverage.relayPubkey).toBe(base().relayPubkey);
  });

  it('reports no coverage for a region nobody announces', () => {
    const coverage = relayCoverageFor([base()], 'fr-paris', now);
    expect(coverage.covered).toBe(false);
    expect(coverage.healthy).toBe(false);
    expect(coverage.reason).toMatch(/no relay is advertising/);
  });

  it('does not count a stale announcement as coverage', () => {
    const stale = { ...base(), updatedAt: now - ANNOUNCEMENT_TTL_MS - 1 };
    expect(relayCoverageFor([stale], 'de-berlin', now).covered).toBe(false);
  });

  it('does not count a paused relay as coverage', () => {
    const paused = { ...base(), paused: true, pausedReason: 'on battery power' };
    const coverage = relayCoverageFor([paused], 'de-berlin', now);
    expect(coverage.covered).toBe(false);
    expect(coverage.reason).toBe('on battery power');
  });

  it('prefers a serving relay over a paused one', () => {
    const paused = { ...base(), relayPubkey: 'aa'.repeat(32), paused: true, updatedAt: now + 1000 };
    const coverage = relayCoverageFor([paused, base()], 'de-berlin', now);
    expect(coverage.healthy).toBe(true);
    expect(coverage.relayPubkey).toBe(base().relayPubkey);
  });

  it('does not count a relay that is out of storage', () => {
    const full = { ...base(), usedBytes: base().capacityBytes };
    const coverage = relayCoverageFor([full], 'de-berlin', now);
    expect(coverage.covered).toBe(false);
    expect(coverage.reason).toMatch(/storage budget/);
  });
});

describe('transport envelope', () => {
  it('parses and verifies a record as the relay actually publishes it', () => {
    // This is the shape that arrives from Gun: `{ body: "<json>", updatedAt }`.
    // Reading it as the record itself made every relay invisible on the phone
    // ("No relay found") while the relay was running and publishing fine.
    const published = {
      body: JSON.stringify(fixture()),
      updatedAt: fixture().updatedAt,
    };

    const parsed = parseAnnouncement(published);
    expect(parsed).not.toBeNull();
    expect(parsed?.relayPubkey).toBe(fixture().relayPubkey);
    expect(verifyAnnouncement(parsed!)).toBe(true);
    expect(parseRelayStatus(parsed!)).toBeNull();
  });

  it('still accepts a bare record from an older publisher', () => {
    expect(parseAnnouncement(fixture())).not.toBeNull();
  });

  it('rejects a record whose body does not parse', () => {
    expect(parseAnnouncement({ body: '{ broken', updatedAt: 1 })).toBeNull();
  });
});
