/**
 * Relay control protocol: signed commands from a device, signed acks from a relay.
 *
 * The relay's local control plane is a Unix socket, which a phone cannot reach —
 * it is on another machine and usually on another network. The two options were a
 * listening TCP port with pairing (Bonjour, port forwarding, a firewall prompt,
 * and an entirely new attack surface) or the channel both sides already share.
 *
 * This is the second one: commands travel on the same Gun.js gossip namespace as
 * the announcements, signed with each side's existing secp256k1 identity.
 *
 *   polaris / relay-commands / <relayPubkey> / <commandId>   ← signed by the device
 *   polaris / relay-acks     / <relayPubkey> / <commandId>   ← signed by the relay
 *
 * Consequences, stated plainly because they shape the UI:
 *
 *   - **It is not RPC.** Delivery is best-effort with seconds of latency, so every
 *     command carries an expiry and a stable `commandId`, the relay applies each
 *     id at most once, and the dashboard shows pending → applied/failed instead of
 *     pretending a tap is synchronous.
 *   - **Authorization is explicit.** A new device must be authorized on the relay
 *     (`polaris-relay ctl authorize <pubkey>`); until then its commands are
 *     verifiable but ignored. That is what stops anyone who can read the
 *     namespace from pausing somebody's seeder.
 *   - **Replay is bounded** by `expiresAt` plus an `issuedAt` window, because a
 *     signed "pin" is a durable write and the record stays on the network.
 *
 * The payload strings must match `src/services/relay/protocol.ts` byte for byte;
 * `__tests__/unit/relayProtocol.test.ts` pins both against one shared fixture.
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

export const COMMAND_VERSION = 1;
export const ACK_VERSION = 1;

/** How long a command is allowed to sit on the network before it is ignored. */
export const COMMAND_TTL_MS = 10 * 60 * 1000;

/** How far in the past `issuedAt` may be before a command is treated as a replay. */
export const COMMAND_REPLAY_WINDOW_MS = 10 * 60 * 1000;

/** Commands the relay knows how to apply. Kept explicit so nothing else can be. */
export const COMMANDS = Object.freeze([
  'pause',
  'resume',
  'pin',
  'unpin',
  'set-budget',
  'evict-idle',
  'refresh',
]);

/**
 * Unwrap a record from its transport envelope.
 *
 * Records are published as `{ body: <json string>, updatedAt }` rather than as
 * native Gun graphs, for two reasons discovered by reading Gun back rather than
 * assuming: it flattens arrays into `{0:…,1:…}` (so `regions[]` arrives as an
 * object), and it treats `null` as a deletion (so `pausedReason: null` vanishes).
 * A JSON string round-trips exactly, and the signature is over the decoded
 * record either way, so nothing about trust changes.
 */
export function unwrapBody(value) {
  if (!value || typeof value !== 'object') return null;
  const candidate = typeof value.body === 'string' ? safeJson(value.body) : value;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function unhex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Canonical rendering of a command's arguments.
 *
 * Sorted keys, `key=value` pairs, `,` between. Only primitives are allowed: a
 * nested object would have to be serialized with an ordering rule nobody would
 * get right on both runtimes, and every real command is a handful of scalars.
 */
export function canonicalArgs(args) {
  const source = args && typeof args === 'object' ? args : {};
  return Object.keys(source)
    .filter((key) => source[key] !== undefined && source[key] !== null)
    .sort()
    .map((key) => {
      const value = source[key];
      if (typeof value === 'object') {
        throw new Error(`command argument '${key}' must be a primitive`);
      }
      return `${key}=${value}`;
    })
    .join(',');
}

/**
 * Canonical payload a device signs.
 *
 * Field order is the wire contract — append only after a version bump.
 */
export function commandPayload(command) {
  return [
    `v${COMMAND_VERSION}`,
    command.commandId,
    command.relayPubkey,
    command.devicePubkey,
    command.issuedAt,
    command.expiresAt,
    command.cmd,
    canonicalArgs(command.args),
  ]
    .map(String)
    .join('\u0000');
}

/** Canonical payload a relay signs when acknowledging a command. */
export function ackPayload(ack) {
  return [
    `v${ACK_VERSION}`,
    ack.commandId,
    ack.relayPubkey,
    ack.ok ? 'true' : 'false',
    ack.result ?? '',
    ack.error ?? '',
    ack.at,
  ]
    .map(String)
    .join('\u0000');
}

function signPayload(payload, privateKey) {
  return hex(schnorr.sign(sha256(new TextEncoder().encode(payload)), privateKey));
}

function verifyPayload(payload, signature, publicKey) {
  try {
    return schnorr.verify(unhex(signature), sha256(new TextEncoder().encode(payload)), publicKey);
  } catch {
    return false;
  }
}

/**
 * Build and sign a command (device side).
 *
 * @param {{ commandId: string, devicePubkey: string, relayPubkey: string, cmd: string,
 *           args?: Record<string, string | number | boolean>, now: number,
 *           ttlMs?: number, privateKey: Uint8Array }} input
 */
export function buildCommand(input) {
  const issuedAt = input.now;
  const expiresAt = input.now + (input.ttlMs ?? COMMAND_TTL_MS);
  const base = {
    v: COMMAND_VERSION,
    commandId: input.commandId,
    relayPubkey: input.relayPubkey.toLowerCase(),
    devicePubkey: input.devicePubkey.toLowerCase(),
    issuedAt,
    expiresAt,
    cmd: input.cmd,
    args: input.args ?? {},
  };
  return { ...base, signature: signPayload(commandPayload(base), input.privateKey) };
}

export function verifyCommand(command) {
  if (!command || typeof command !== 'object') return false;
  if (command.v !== COMMAND_VERSION) return false;
  if (typeof command.commandId !== 'string' || command.commandId.length < 8) return false;
  if (typeof command.relayPubkey !== 'string' || typeof command.devicePubkey !== 'string') {
    return false;
  }
  if (typeof command.cmd !== 'string' || !COMMANDS.includes(command.cmd)) return false;
  if (typeof command.signature !== 'string') return false;
  return verifyPayload(commandPayload(command), command.signature, command.devicePubkey);
}

/** Build and sign an ack (relay side). */
export function buildAck(input) {
  const base = {
    v: ACK_VERSION,
    commandId: input.commandId,
    relayPubkey: input.relayPubkey.toLowerCase(),
    ok: input.ok === true,
    result: input.result ?? null,
    error: input.error ?? null,
    at: input.at,
  };
  return { ...base, signature: signPayload(ackPayload(base), input.privateKey) };
}

export function verifyAck(ack, relayPubkey) {
  if (!ack || typeof ack !== 'object') return false;
  if (ack.v !== ACK_VERSION) return false;
  if (typeof ack.signature !== 'string') return false;
  const expected = ack.relayPubkey;
  if (typeof expected !== 'string') return false;
  if (relayPubkey && expected.toLowerCase() !== relayPubkey.toLowerCase()) return false;
  return verifyPayload(ackPayload(ack), ack.signature, expected);
}

/**
 * Is this command allowed to be applied now?
 *
 * Pure so the rules can be tested without a relay: it is the difference between
 * "a phone can pause a stranger's seeder" and "a phone can pause its own".
 *
 * @param {object} command a verified command
 * @param {{ relayPubkey: string, authorizedDevices: string[], now: number,
 *           appliedCommandIds?: Iterable<string> }} context
 * @returns {{ allowed: boolean, reason: string | null }}
 */
export function admitCommand(command, context) {
  if (!verifyCommand(command)) return { allowed: false, reason: 'signature does not verify' };

  if (
    typeof command.relayPubkey !== 'string' ||
    command.relayPubkey.toLowerCase() !== context.relayPubkey.toLowerCase()
  ) {
    return { allowed: false, reason: 'command is addressed to a different relay' };
  }

  if (!context.authorizedDevices.includes(command.devicePubkey.toLowerCase())) {
    return { allowed: false, reason: 'device is not authorized on this relay' };
  }

  if (Number(command.expiresAt) <= context.now) {
    return { allowed: false, reason: 'command expired before it arrived' };
  }

  // A signed record can sit on the network indefinitely, so an old one must not
  // be re-applied when it surfaces again.
  if (context.now - Number(command.issuedAt) > COMMAND_REPLAY_WINDOW_MS) {
    return { allowed: false, reason: 'command is outside the replay window' };
  }

  const applied = context.appliedCommandIds;
  if (applied) {
    const seen =
      applied instanceof Set
        ? applied.has(command.commandId)
        : [...applied].includes(command.commandId);
    if (seen) return { allowed: false, reason: 'command was already applied' };
  }

  return { allowed: true, reason: null };
}
