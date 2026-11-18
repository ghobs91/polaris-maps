import { getGun } from '../gun/init';
import { getOrCreateKeypair } from '../identity/keypair';
import { sign } from '../identity/signing';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import {
  ACK_VERSION,
  COMMAND_TTL_MS,
  COMMAND_VERSION,
  parseAck,
  commandPayload as _commandPayloadForTests,
  verifyAck,
  type RelayAck,
  type RelayCommandArgs,
  type RelayCommandName,
} from './protocol';

/**
 * Sending commands to a desktop relay.
 *
 * Writes one signed record and watches for the relay's signed ack. The app never
 * learns the relay's address, never opens a socket to it, and never needs the
 * relay to be on the same network — the Gun gossip channel carries both
 * directions, and the signature is the only thing that makes a command real.
 *
 * Deliberately not a request/response loop: Gun may replay, delay, or drop, so
 * the ack is matched by `commandId` and the caller is given a definite outcome
 * (applied, refused, or "no answer yet") instead of a promise that hangs.
 */

const NS_ROOT = 'polaris';
const NS_COMMANDS = 'relay-commands';
const NS_ACKS = 'relay-acks';

/** How long the UI waits for an ack before saying "no answer yet". */
export const ACK_WAIT_MS = 25_000;

/**
 * How often an unanswered command is re-published.
 *
 * Gun peers serve their *current* graph and do not keep history, so a command
 * published while the relay was reconnecting is simply gone — verified on a real
 * relay: the same command succeeded when the Mac's subscription was live and
 * vanished when it was not. Commands carry a stable id and the relay applies each id
 * at most once, so re-publishing is safe, and it is the only thing that makes "scan
 * the code and it works" true without polling infrastructure.
 */
export const COMMAND_RETRY_MS = 8_000;

export interface SentCommand {
  commandId: string;
  cmd: RelayCommandName;
  relayPubkey: string;
  sentAt: number;
}

function newCommandId(now: number): string {
  const random = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  return `c${now.toString(36)}${random}`;
}

/**
 * Publish a signed command and wait for the relay's ack.
 *
 * Resolves with the verified ack, or `null` when no ack arrived in `timeoutMs` —
 * never throws for "the network was slow", because that is a normal outcome the
 * UI has to show.
 */
export async function sendRelayCommand(
  relayPubkey: string,
  cmd: RelayCommandName,
  args: RelayCommandArgs = {},
  { timeoutMs = ACK_WAIT_MS, now = Date.now() }: { timeoutMs?: number; now?: number } = {},
): Promise<{ ack: RelayAck | null; commandId: string }> {
  const { privateKey, publicKey } = await getOrCreateKeypair();
  const commandId = newCommandId(now);

  const unsigned = {
    v: COMMAND_VERSION,
    commandId,
    relayPubkey: relayPubkey.toLowerCase(),
    devicePubkey: publicKey.toLowerCase(),
    issuedAt: now,
    expiresAt: now + COMMAND_TTL_MS,
    cmd,
    args,
  };

  const signature = await sign(_commandPayloadForTests(unsigned), privateKey);
  const command = { ...unsigned, signature };

  const gun = getGun();

  // Start watching before publishing: the relay can answer while the write is
  // still in flight, and a watcher attached afterwards would miss it.
  const ackPromise = waitForAck(gun, command.relayPubkey, commandId, timeoutMs);

  const publish = () => {
    try {
      // Gun's TypeScript chain types are unusable for dynamic namespaces (the same
      // reason `reputationService` and `editService` cast here).
      (gun as unknown as { get: (key: string) => any })
        .get(NS_ROOT)
        .get(NS_COMMANDS)
        .get(command.relayPubkey)
        .get(commandId)
        .put({ body: JSON.stringify(command), updatedAt: now });
      return true;
    } catch (err) {
      logDiagnostic('relay', 'warn', 'Could not publish relay command', {
        cmd,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };

  if (!publish()) return { ack: null, commandId };

  // Re-publish until the ack arrives or the caller's timeout expires.
  let retry: ReturnType<typeof setInterval> | null = setInterval(() => {
    publish();
  }, COMMAND_RETRY_MS);

  const ack = await ackPromise.finally(() => {
    if (retry) clearInterval(retry);
    retry = null;
  });

  return { ack, commandId };
}

/**
 * Redeem a QR pairing code shown by the Mac.
 *
 * Sent to the relay named *in the code*, not to whatever the dashboard happens to
 * have selected — pairing is how a device is introduced in the first place, so
 * there may be no announcement to work from yet.
 */
export async function pairRelayDevice(
  code: { relayPubkey: string; secret: string },
  label = 'iPhone',
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<{ ack: RelayAck | null; commandId: string }> {
  // Longer than an ordinary command: the user is standing there holding a phone at
  // a QR code, and the retry loop above is what makes a slow first connection
  // recoverable instead of a dead end.
  return sendRelayCommand(code.relayPubkey, 'pair', { secret: code.secret, label }, { timeoutMs });
}

/**
 * Watch for the ack to one command.
 *
 * The unwrapped body is re-parsed and signature-verified before it is believed:
 * the ack namespace is an open write surface, and the only party that can speak
 * for a relay is the holder of its key.
 */
export function waitForAck(
  gun: ReturnType<typeof getGun>,
  relayPubkey: string,
  commandId: string,
  timeoutMs: number,
): Promise<RelayAck | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ack: RelayAck | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      (gun as unknown as { get: (key: string) => any })
        .get(NS_ROOT)
        .get(NS_ACKS)
        .get(relayPubkey)
        .get(commandId)
        .on((value: unknown) => {
          const ack = parseAck(value);
          if (!ack || ack.commandId !== commandId) return;
          if (!verifyAck(ack, relayPubkey)) {
            logDiagnostic('relay', 'warn', 'Dropped relay ack with a bad signature', { commandId });
            return;
          }
          finish(ack);
        });
    } catch {
      finish(null);
    }
  });
}

/**
 * Current build of the command payload, exposed so the protocol test can pin the
 * wire format against the relay's implementation.
 */
export { commandPayload } from './protocol';
export { ACK_VERSION };
