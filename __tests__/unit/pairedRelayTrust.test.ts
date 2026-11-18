import {
  addPairedRelay,
  getPairedRelays,
  isPairedRelay,
  removePairedRelay,
  __resetPairedRelaysForTest,
} from '../../src/services/relay/pairedRelays';

/**
 * Pairing is the trust root for relay-published manifests.
 *
 * The catalog advertises no signed manifests, so a relay acts as the publisher for
 * the packs it holds and signs with its **own** identity. That key cannot be in the
 * app's compiled-in allowlist, so the trust has to come from the pairing gesture —
 * which makes "which relays are paired" security-relevant state, not a preference.
 */
describe('paired relays', () => {
  beforeEach(() => __resetPairedRelaysForTest());

  const relayA = 'aa'.repeat(32);
  const relayB = 'bb'.repeat(32);

  it('starts empty', () => {
    expect(getPairedRelays()).toEqual([]);
  });

  it('records a paired relay and answers for it', () => {
    addPairedRelay(relayA);
    expect(getPairedRelays()).toEqual([relayA]);
    expect(isPairedRelay(relayA)).toBe(true);
    expect(isPairedRelay(relayB)).toBe(false);
  });

  it('is idempotent and case-insensitive', () => {
    addPairedRelay(relayA);
    addPairedRelay(relayA.toUpperCase());
    expect(getPairedRelays()).toEqual([relayA]);
  });

  it('refuses anything that is not a 64-hex key', () => {
    addPairedRelay('not-a-key');
    addPairedRelay('');
    addPairedRelay('ab'.repeat(16));
    expect(getPairedRelays()).toEqual([]);
  });

  it('revokes a relay', () => {
    addPairedRelay(relayA);
    addPairedRelay(relayB);
    removePairedRelay(relayA);
    expect(getPairedRelays()).toEqual([relayB]);
  });

  it('keeps the list bounded', () => {
    for (let index = 0; index < 20; index += 1) {
      addPairedRelay(index.toString(16).padStart(2, '0').repeat(32));
    }
    expect(getPairedRelays().length).toBeLessThanOrEqual(8);
  });
});
