import { verify } from '../identity/signing';

/**
 * Relay control protocol (device side).
 *
 * Mirrors `relay/src/protocol.mjs` byte for byte. The relay's local socket is
 * unreachable from a phone on another machine — and often on another network — so
 * commands travel on the Gun.js gossip channel both sides already use, signed with
 * each side's existing secp256k1 identity:
 *
 *   polaris / relay-commands / <relayPubkey> / <commandId>   ← signed by the device
 *   polaris / relay-acks     / <relayPubkey> / <commandId>   ← signed by the relay
 *
 * It is **not** RPC: delivery is best-effort and takes seconds, so every command
 * carries an expiry and a stable id, the relay applies each id at most once, and
 * the dashboard shows pending → applied/failed rather than pretending a tap is
 * synchronous. A refusal is still an ack, because "the relay ignored me" and "the
 * network ate my command" are different problems.
 *
 * Parity is enforced by `__tests__/unit/relayProtocol.test.ts`, which verifies a
 * fixture signed by the Node implementation.
 */

export const COMMAND_VERSION = 1;
export const ACK_VERSION = 1;

/** How long a command may sit on the network before the relay ignores it. */
export const COMMAND_TTL_MS = 10 * 60 * 1000;

/** Commands the relay implements. Anything else is refused before it is applied. */
export const RELAY_COMMANDS = [
  'pause',
  'resume',
  'pin',
  'unpin',
  'set-budget',
  'evict-idle',
  'refresh',
  'pair',
] as const;

export type RelayCommandName = (typeof RELAY_COMMANDS)[number];

export type RelayCommandArgs = Record<string, string | number | boolean | undefined | null>;

export interface RelayCommand {
  v: number;
  commandId: string;
  relayPubkey: string;
  devicePubkey: string;
  issuedAt: number;
  expiresAt: number;
  cmd: RelayCommandName;
  args: RelayCommandArgs;
  signature: string;
}

export interface RelayAck {
  v: number;
  commandId: string;
  relayPubkey: string;
  ok: boolean;
  result: string | null;
  error: string | null;
  at: number;
  signature: string;
}

/**
 * Canonical rendering of a command's arguments: sorted keys, `key=value`, `,`
 * between, primitives only. Identical to `canonicalArgs` in the relay.
 */
export function canonicalArgs(args: RelayCommandArgs | undefined): string {
  const source = args ?? {};
  return Object.keys(source)
    .filter((key) => source[key] !== undefined && source[key] !== null)
    .sort()
    .map((key) => {
      const value = source[key];
      if (value !== null && typeof value === 'object') {
        throw new Error(`command argument '${key}' must be a primitive`);
      }
      return `${key}=${value}`;
    })
    .join(',');
}

/** Canonical payload the device signs. Field order is the wire contract. */
export function commandPayload(command: Omit<RelayCommand, 'signature'>): string {
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

/** Canonical payload the relay signs when acknowledging. */
export function ackPayload(ack: Omit<RelayAck, 'signature'>): string {
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

export function verifyCommand(command: RelayCommand): boolean {
  if (!command || command.v !== COMMAND_VERSION) return false;
  if (typeof command.commandId !== 'string' || command.commandId.length < 8) return false;
  if (!RELAY_COMMANDS.includes(command.cmd)) return false;
  if (typeof command.signature !== 'string') return false;
  try {
    return verify(commandPayload(command), command.signature, command.devicePubkey);
  } catch {
    return false;
  }
}

/**
 * Verify an ack attributed to a specific relay.
 *
 * Binding to the relay key matters: an ack is the only evidence a command was
 * applied, so any relay could otherwise answer for another.
 */
export function verifyAck(ack: RelayAck, relayPubkey?: string): boolean {
  if (!ack || ack.v !== ACK_VERSION) return false;
  if (typeof ack.signature !== 'string' || typeof ack.relayPubkey !== 'string') return false;
  if (relayPubkey && ack.relayPubkey.toLowerCase() !== relayPubkey.toLowerCase()) return false;
  try {
    return verify(ackPayload(ack), ack.signature, ack.relayPubkey);
  } catch {
    return false;
  }
}

/** Unwrap the `{ body, updatedAt }` Gun envelope (see `relay/src/protocol.mjs`). */
export function unwrapBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.body === 'string') {
    try {
      const parsed = JSON.parse(record.body) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return record;
}

/** Coerce a Gun-returned command (numbers arrive as strings) into the typed shape. */
export function parseCommand(value: unknown): RelayCommand | null {
  const record = unwrapBody(value);
  if (!record) return null;
  if (typeof record.commandId !== 'string') return null;
  if (typeof record.cmd !== 'string' || !RELAY_COMMANDS.includes(record.cmd as RelayCommandName)) {
    return null;
  }

  const issuedAt = Number(record.issuedAt);
  const expiresAt = Number(record.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;

  return {
    v: Number(record.v),
    commandId: record.commandId,
    relayPubkey: String(record.relayPubkey ?? '').toLowerCase(),
    devicePubkey: String(record.devicePubkey ?? '').toLowerCase(),
    issuedAt,
    expiresAt,
    cmd: record.cmd as RelayCommandName,
    args: (record.args as RelayCommandArgs) ?? {},
    signature: String(record.signature ?? ''),
  };
}

export function parseAck(value: unknown): RelayAck | null {
  const record = unwrapBody(value);
  if (!record) return null;
  if (typeof record.commandId !== 'string') return null;
  const at = Number(record.at);
  if (!Number.isFinite(at)) return null;

  return {
    v: Number(record.v),
    commandId: record.commandId,
    relayPubkey: String(record.relayPubkey ?? '').toLowerCase(),
    ok: record.ok === true || record.ok === 'true',
    result: typeof record.result === 'string' ? record.result : null,
    error: typeof record.error === 'string' ? record.error : null,
    at,
    signature: String(record.signature ?? ''),
  };
}

/**
 * A pairing code, as the Mac draws it into a QR code.
 *
 *   polaris://pair?relay=<64 hex>&secret=<32 hex>
 *
 * The secret is a single-use, two-minute capability created on the Mac and never
 * published: scanning it *is* the authorization, and redeeming it authorizes
 * exactly one device.
 */
export interface PairingCode {
  relayPubkey: string;
  secret: string;
}

export function parsePairingPayload(text: string): PairingCode | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith('polaris://pair')) return null;

  const queryStart = trimmed.indexOf('?');
  if (queryStart === -1) return null;
  const params = new Map<string, string>();
  for (const pair of trimmed.slice(queryStart + 1).split('&')) {
    const [key, value] = pair.split('=');
    if (key && value) params.set(key.toLowerCase(), decodeURIComponent(value));
  }

  const relayPubkey = (params.get('relay') ?? '').toLowerCase();
  const secret = (params.get('secret') ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(relayPubkey)) return null;
  if (!/^[0-9a-f]{16,64}$/.test(secret)) return null;
  return { relayPubkey, secret };
}

/** Human sentence for a refused command, for the dashboard's toast/row. */
export function describeRefusal(reason: string | null): string {
  if (!reason) return 'the relay refused the command';
  if (/not authorized/i.test(reason)) {
    return 'This phone is not authorized on that relay yet — authorize it on the Mac first.';
  }
  if (/expired|replay/i.test(reason)) {
    return 'The command expired before the relay saw it. Try again.';
  }
  if (/different relay/i.test(reason)) {
    return 'That command was addressed to a different relay.';
  }
  return reason;
}
