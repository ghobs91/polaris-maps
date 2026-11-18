import { readFileSync } from 'fs';
import * as path from 'path';

import {
  ACK_VERSION,
  COMMAND_TTL_MS,
  COMMAND_VERSION,
  RELAY_COMMANDS,
  ackPayload,
  canonicalArgs,
  commandPayload,
  describeRefusal,
  parseAck,
  parseCommand,
  parsePairingPayload,
  unwrapBody,
  verifyAck,
  verifyCommand,
  type RelayAck,
  type RelayCommand,
} from '../../src/services/relay/protocol';
import { parseRelayStatus } from '../../src/services/relay/announcement';

/**
 * The control channel is two implementations of one wire format — `relay/src/protocol.mjs`
 * under Node and `src/services/relay/protocol.ts` on the device. If they disagree
 * about field order, a separator, or an argument ordering, every command is
 * silently unverifiable and the UI looks like it is talking to a relay that
 * ignores it. These tests pin both sides to the same literals.
 */

const command: Omit<RelayCommand, 'signature'> = {
  v: COMMAND_VERSION,
  commandId: 'c12345678',
  relayPubkey: 'ab'.repeat(32),
  devicePubkey: 'cd'.repeat(32),
  issuedAt: 1_767_225_600_000,
  expiresAt: 1_767_226_200_000,
  cmd: 'pin',
  args: { regionId: 'us-ny-new-york', driveKey: 'ef'.repeat(32) },
};

describe('command payload parity with the relay', () => {
  it('serializes to the exact string the Node relay signs', () => {
    // Produced by `relay/src/protocol.mjs`; duplicated on purpose.
    expect(commandPayload(command)).toBe(
      'v1\u0000c12345678\u0000' +
        'ab'.repeat(32) +
        '\u0000' +
        'cd'.repeat(32) +
        '\u00001767225600000\u00001767226200000\u0000pin\u0000' +
        `driveKey=${'ef'.repeat(32)},regionId=us-ny-new-york`,
    );
  });

  it('is independent of argument insertion order', () => {
    const reordered = {
      ...command,
      args: { driveKey: 'ef'.repeat(32), regionId: 'us-ny-new-york' },
    };
    expect(commandPayload(reordered)).toBe(commandPayload(command));
  });
});

describe('canonicalArgs', () => {
  it('sorts keys and drops absent values while keeping false and zero', () => {
    expect(canonicalArgs({ b: 2, a: 1 })).toBe('a=1,b=2');
    expect(canonicalArgs({ a: undefined, b: null, c: false, d: 0 })).toBe('c=false,d=0');
  });

  it('refuses nested values rather than inventing an ordering', () => {
    expect(() => canonicalArgs({ nested: { a: 1 } as unknown as string })).toThrow(
      /must be a primitive/,
    );
  });

  it('treats missing args as empty', () => {
    expect(canonicalArgs(undefined)).toBe('');
  });
});

describe('ack payload', () => {
  const ack: Omit<RelayAck, 'signature'> = {
    v: ACK_VERSION,
    commandId: 'c12345678',
    relayPubkey: 'ab'.repeat(32),
    ok: false,
    result: null,
    error: 'device is not authorized on this relay',
    at: 1_767_225_600_500,
  };

  it('serializes refusals distinctly from success', () => {
    const refusal = ackPayload(ack);
    const success = ackPayload({ ...ack, ok: true, error: null });
    expect(refusal).not.toBe(success);
    expect(refusal).toContain('false');
    expect(success).toContain('true');
  });
});

describe('parsing untrusted records', () => {
  it('unwraps the transport envelope and accepts bare objects', () => {
    expect(unwrapBody({ body: JSON.stringify({ a: 1 }), updatedAt: 1 })).toEqual({ a: 1 });
    expect(unwrapBody({ a: 1 })).toEqual({ a: 1 });
    expect(unwrapBody({ body: '{' })).toBeNull();
    expect(unwrapBody(null)).toBeNull();
  });

  it('coerces numbers Gun hands back as strings', () => {
    const parsed = parseCommand({
      body: JSON.stringify({ ...command, issuedAt: String(command.issuedAt), signature: 'x' }),
    });
    expect(parsed?.issuedAt).toBe(command.issuedAt);
  });

  it('rejects commands with an unknown name', () => {
    expect(parseCommand({ ...command, cmd: 'rm-rf', signature: 'x' })).toBeNull();
  });

  it('drops acks with a missing timestamp instead of guessing', () => {
    expect(
      parseAck({ commandId: 'c12345678', relayPubkey: 'ab'.repeat(32), signature: 'x' }),
    ).toBeNull();
  });
});

describe('verification rejects what an open gossip namespace allows', () => {
  it('rejects an unsigned command and an unknown command name', () => {
    expect(verifyCommand({ ...command, signature: '00'.repeat(64) })).toBe(false);
    expect(
      verifyCommand({
        ...command,
        cmd: 'frobnicate' as RelayCommand['cmd'],
        signature: '00'.repeat(64),
      }),
    ).toBe(false);
    expect(RELAY_COMMANDS).toContain('pin');
  });

  it('rejects an ack attributed to a different relay', () => {
    const ack: RelayAck = {
      v: ACK_VERSION,
      commandId: 'c12345678',
      relayPubkey: 'ab'.repeat(32),
      ok: true,
      result: '',
      error: null,
      at: 1,
      signature: '00'.repeat(64),
    };
    expect(verifyAck(ack, 'ff'.repeat(32))).toBe(false);
  });
});

describe('dashboard helpers', () => {
  it('explains an authorization refusal in words a user can act on', () => {
    expect(describeRefusal('device is not authorized on this relay')).toMatch(/not authorized/i);
    expect(describeRefusal('command expired before it arrived')).toMatch(/expired/i);
    expect(describeRefusal(null)).toMatch(/refused/);
    expect(describeRefusal('something else entirely')).toBe('something else entirely');
  });

  it('decodes a status payload and refuses garbage', () => {
    const base = {
      v: 1,
      relayPubkey: 'ab'.repeat(32),
      regions: [],
      capacityBytes: 1,
      usedBytes: 0,
      uplinkKbps: 1,
      paused: false,
      pausedReason: null,
      servedBytes24h: 0,
      updatedAt: 1,
      statusHash: '',
      signature: 'x',
    };

    expect(parseRelayStatus(base)).toBeNull();
    expect(
      parseRelayStatus({
        ...base,
        statusJson: JSON.stringify({ serving: true, drives: [], usage: {} }),
      })?.serving,
    ).toBe(true);
    expect(parseRelayStatus({ ...base, statusJson: '{ not json' })).toBeNull();
  });
});

describe('command lifetime', () => {
  it('gives a command a ten minute window', () => {
    expect(COMMAND_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe('pairing codes', () => {
  const relayPubkey = 'ab'.repeat(32);
  const secret = 'cd'.repeat(16);

  it('parses the payload the Mac draws into the QR code', () => {
    expect(parsePairingPayload(`polaris://pair?relay=${relayPubkey}&secret=${secret}`)).toEqual({
      relayPubkey,
      secret,
    });
  });

  it('is case-insensitive on the scheme and hex', () => {
    const payload = `POLARIS://PAIR?relay=${relayPubkey.toUpperCase()}&secret=${secret.toUpperCase()}`;
    expect(parsePairingPayload(payload)).toEqual({ relayPubkey, secret });
  });

  it('rejects anything that is not a pairing code', () => {
    // A camera sees a lot of QR codes; a URL or a wifi code must not be treated as
    // an authorization attempt.
    for (const value of [
      '',
      'https://example.com',
      'WIFI:S:home;T:WPA;P:secret;;',
      `polaris://pair?relay=${relayPubkey}`,
      `polaris://pair?relay=short&secret=${secret}`,
      `polaris://pair?relay=${relayPubkey}&secret=xyz`,
    ]) {
      expect(parsePairingPayload(value)).toBeNull();
    }
  });
});

describe('command list parity with the relay', () => {
  it('exposes the same commands the relay will admit', () => {
    // The relay refuses anything not on its own list before applying it, so a
    // command that exists only on one side is a dead button.
    const source = readFileSync(path.join(__dirname, '../../relay/src/protocol.mjs'), 'utf8');
    const block = source.slice(
      source.indexOf('export const COMMANDS'),
      source.indexOf(']);', source.indexOf('export const COMMANDS')),
    );
    const remote = [...block.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]).sort();
    expect([...RELAY_COMMANDS].sort()).toEqual(remote);
  });
});
