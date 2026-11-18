import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';

import { schnorr } from '@noble/curves/secp256k1';

import {
  COMMAND_REPLAY_WINDOW_MS,
  admitCommand,
  buildAck,
  buildCommand,
  canonicalArgs,
  commandPayload,
  unwrapBody,
  verifyAck,
  verifyCommand,
} from '../src/protocol.mjs';

const NOW = 1_767_225_600_000;

function keypair(seed = 0x11) {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');
  return { privateKey, publicKey };
}

const device = keypair(0x11);
const relay = keypair(0x22);
const stranger = keypair(0x33);

function command(overrides = {}) {
  return buildCommand({
    commandId: 'cmd-0000000001',
    devicePubkey: device.publicKey,
    relayPubkey: relay.publicKey,
    cmd: 'pin',
    args: { regionId: 'us-ny-new-york', driveKey: 'ab'.repeat(32) },
    now: NOW,
    privateKey: device.privateKey,
    ...overrides,
  });
}

describe('canonicalArgs', () => {
  it('sorts keys so argument order cannot change the signature', () => {
    assert.equal(canonicalArgs({ b: 2, a: 1 }), 'a=1,b=2');
    assert.equal(canonicalArgs({ a: 1, b: 2 }), 'a=1,b=2');
  });

  it('drops undefined and null, keeping false and zero', () => {
    assert.equal(canonicalArgs({ a: undefined, b: null, c: false, d: 0 }), 'c=false,d=0');
  });

  it('refuses nested values rather than inventing a serialization order', () => {
    assert.throws(() => canonicalArgs({ nested: { a: 1 } }), /must be a primitive/);
  });

  it('treats missing args as empty', () => {
    assert.equal(canonicalArgs(undefined), '');
    assert.equal(canonicalArgs({}), '');
  });
});

describe('commands', () => {
  it('round-trips a signed command', () => {
    const built = command();
    assert.equal(verifyCommand(built), true);
    assert.equal(built.v, 1);
  });

  it('rejects any tampered field', () => {
    const original = command();
    for (const tampered of [
      { ...original, cmd: 'pause' },
      { ...original, expiresAt: original.expiresAt + 1 },
      { ...original, issuedAt: original.issuedAt + 1 },
      { ...original, args: { ...original.args, regionId: 'fr-paris' } },
      { ...original, relayPubkey: stranger.publicKey },
    ]) {
      assert.equal(verifyCommand(tampered), false);
    }
  });

  it('rejects an unknown command name even when correctly signed', () => {
    // The allow list is checked before the signature, so a compromised device
    // cannot smuggle in a command the relay does not implement.
    const smuggled = buildCommand({
      commandId: 'cmd-0000000002',
      devicePubkey: device.publicKey,
      relayPubkey: relay.publicKey,
      cmd: 'rm-rf',
      now: NOW,
      privateKey: device.privateKey,
    });
    assert.equal(verifyCommand(smuggled), false);
  });

  it('payload is stable for the same command', () => {
    const a = command();
    const b = command({ args: { driveKey: 'ab'.repeat(32), regionId: 'us-ny-new-york' } });
    assert.equal(commandPayload(a), commandPayload(b));
  });
});

describe('admitCommand', () => {
  const base = {
    relayPubkey: relay.publicKey,
    authorizedDevices: [device.publicKey],
    now: NOW + 1_000,
  };

  it('admits a well-formed command from an authorized device', () => {
    assert.deepEqual(admitCommand(command(), base), { allowed: true, reason: null });
  });

  it('refuses a command for another relay', () => {
    const admission = admitCommand(command(), { ...base, relayPubkey: stranger.publicKey });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /different relay/);
  });

  it('refuses an unauthorized device — this is the whole authorization model', () => {
    const admission = admitCommand(command(), { ...base, authorizedDevices: [] });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /not authorized/);
  });

  it('refuses an expired command', () => {
    const built = command({ ttlMs: 1_000 });
    const admission = admitCommand(built, { ...base, now: built.expiresAt });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /expired/);
  });

  it('refuses a command outside the replay window even before it expires', () => {
    // A signed record can sit on the network indefinitely, so a long-lived command
    // is bounded by the replay window rather than by its TTL alone.
    const longLived = command({ ttlMs: 60 * 60 * 1000 });
    const admission = admitCommand(longLived, {
      ...base,
      now: NOW + COMMAND_REPLAY_WINDOW_MS + 1,
    });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /replay window/);
  });

  it('refuses an expired command before worrying about replay', () => {
    const admission = admitCommand(command(), { ...base, now: NOW + 20 * 60 * 1000 });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /expired/);
  });

  it('refuses a command id that was already applied', () => {
    const admission = admitCommand(command(), {
      ...base,
      appliedCommandIds: new Set(['cmd-0000000001']),
    });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /already applied/);
  });

  it('refuses a bad signature before anything else', () => {
    const admission = admitCommand({ ...command(), signature: '00'.repeat(64) }, base);
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /signature/);
  });
});

describe('acks', () => {
  function ack(overrides = {}) {
    return buildAck({
      commandId: 'cmd-0000000001',
      relayPubkey: relay.publicKey,
      ok: true,
      result: '{"refused":false}',
      error: null,
      at: NOW,
      privateKey: relay.privateKey,
      ...overrides,
    });
  }

  it('round-trips and verifies against the relay key', () => {
    const built = ack();
    assert.equal(verifyAck(built, relay.publicKey), true);
  });

  it('rejects a tampered ack, including a flipped ok flag', () => {
    const original = ack();
    for (const tampered of [
      { ...original, ok: false },
      { ...original, result: '' },
      { ...original, error: 'nope' },
      { ...original, at: original.at + 1 },
    ]) {
      assert.equal(verifyAck(tampered, relay.publicKey), false);
    }
  });

  it('rejects an ack attributed to a different relay', () => {
    assert.equal(verifyAck(ack(), stranger.publicKey), false);
  });

  it('distinguishes a refusal from silence', () => {
    const refusal = ack({
      ok: false,
      result: null,
      error: 'device is not authorized on this relay',
    });
    assert.equal(verifyAck(refusal, relay.publicKey), true);
    assert.equal(refusal.ok, false);
    assert.match(refusal.error, /not authorized/);
  });
});

describe('unwrapBody', () => {
  it('unwraps the transport envelope', () => {
    const record = { hello: 'world' };
    assert.deepEqual(unwrapBody({ body: JSON.stringify(record), updatedAt: 1 }), record);
  });

  it('accepts a bare object for older records', () => {
    assert.deepEqual(unwrapBody({ hello: 'world' }), { hello: 'world' });
  });

  it('returns null for garbage instead of throwing', () => {
    for (const bad of [null, undefined, 42, 'text', { body: '{' }]) {
      assert.equal(unwrapBody(bad), null);
    }
  });
});

describe('pairing', () => {
  const pairingContext = {
    relayPubkey: 'cd'.repeat(32),
    authorizedDevices: [],
    now: NOW + 1_000,
    pairing: { secret: 'ab'.repeat(16), expiresAt: NOW + 60_000, used: false },
  };

  const pairCommand = (overrides = {}) =>
    buildCommand({
      commandId: 'pair-0000001',
      devicePubkey: device.publicKey,
      relayPubkey: 'cd'.repeat(32),
      cmd: 'pair',
      args: { secret: 'ab'.repeat(16), label: 'iPhone' },
      now: NOW,
      privateKey: device.privateKey,
      ...overrides,
    });

  it('admits an unauthorized device holding the secret — the QR is the consent', () => {
    assert.deepEqual(admitCommand(pairCommand(), pairingContext), {
      allowed: true,
      reason: null,
    });
  });

  it('refuses when no pairing is in progress', () => {
    const admission = admitCommand(pairCommand(), { ...pairingContext, pairing: null });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /no pairing is in progress/);
  });

  it('refuses a wrong secret', () => {
    const admission = admitCommand(
      pairCommand({ args: { secret: 'ff'.repeat(16), label: 'iPhone' } }),
      pairingContext,
    );
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /does not match/);
  });

  it('refuses an expired pairing code', () => {
    const admission = admitCommand(pairCommand(), {
      ...pairingContext,
      now: NOW + 120_000,
    });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /expired/);
  });

  it('refuses a code that was already redeemed', () => {
    const admission = admitCommand(pairCommand(), {
      ...pairingContext,
      pairing: { ...pairingContext.pairing, used: true },
    });
    assert.equal(admission.allowed, false);
    assert.match(admission.reason, /already used/);
  });

  it('still requires a valid signature, so a stolen secret alone is not enough', () => {
    const forged = { ...pairCommand(), signature: '00'.repeat(64) };
    assert.equal(admitCommand(forged, pairingContext).allowed, false);
  });

  it('does not let pairing bypass the ordinary checks for other commands', () => {
    const pause = buildCommand({
      commandId: 'cmd-pairless',
      devicePubkey: device.publicKey,
      relayPubkey: 'cd'.repeat(32),
      cmd: 'pause',
      now: NOW,
      privateKey: device.privateKey,
    });
    assert.equal(admitCommand(pause, pairingContext).allowed, false);
  });
});
