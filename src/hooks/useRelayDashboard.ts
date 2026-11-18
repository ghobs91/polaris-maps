import { useCallback, useEffect, useRef, useState } from 'react';

import { getAnnouncements } from '../services/relay/relayAnnouncements';
import {
  parseRelayStatus,
  type RelayAnnouncement,
  type RelayStatusPayload,
} from '../services/relay/announcement';
import { sendRelayCommand } from '../services/relay/relayClient';
import {
  describeRefusal,
  type RelayCommandArgs,
  type RelayCommandName,
} from '../services/relay/protocol';
import { getOrCreateKeypair } from '../services/identity/keypair';

/**
 * Dashboard state for one desktop relay.
 *
 * Composition only: announcements provide the status, `relayClient` sends the
 * commands, the relay's signed ack decides what to show. Nothing here caches a
 * "desired" state locally — the relay is the source of truth, and the whole point
 * of the pending/outcome pair is that a tap is not instantaneous.
 */

/** How often the dashboard re-reads verified announcements. */
export const DASHBOARD_REFRESH_MS = 10_000;

export interface PendingCommand {
  commandId: string | null;
  cmd: RelayCommandName;
  sentAt: number;
}

export interface CommandOutcome {
  ok: boolean;
  message: string;
  at: number;
}

export interface RelayDashboard {
  relays: RelayAnnouncement[];
  selected: RelayAnnouncement | null;
  status: RelayStatusPayload | null;
  devicePubkey: string | null;
  pending: PendingCommand | null;
  outcome: CommandOutcome | null;
  /** True when this device's key is in the relay's authorized list. */
  authorized: boolean;
  refresh: () => void;
  select: (relayPubkey: string) => void;
  run: (cmd: RelayCommandName, args?: RelayCommandArgs) => Promise<void>;
}

export function useRelayDashboard(): RelayDashboard {
  const [relays, setRelays] = useState<RelayAnnouncement[]>(() => getAnnouncements());
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [devicePubkey, setDevicePubkey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setRelays(getAnnouncements());
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, DASHBOARD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void getOrCreateKeypair()
      .then((pair) => {
        if (!cancelled) setDevicePubkey(pair.publicKey);
      })
      .catch(() => {
        /* the keypair is required for commands; the screen explains it if absent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Default to the freshest relay, and never leave the selection pointing at one
  // that stopped announcing.
  const selected =
    relays.find((relay) => relay.relayPubkey === selectedPubkey) ?? relays[0] ?? null;

  const status = selected ? parseRelayStatus(selected) : null;

  const authorized =
    devicePubkey != null &&
    (status?.devices ?? []).some((device) => device.pubkey === devicePubkey.toLowerCase());

  const select = useCallback((relayPubkey: string) => {
    setSelectedPubkey(relayPubkey);
  }, []);

  const run = useCallback(
    async (cmd: RelayCommandName, args: RelayCommandArgs = {}) => {
      if (!selected) {
        setOutcome({ ok: false, message: 'No relay is announcing itself yet.', at: Date.now() });
        return;
      }

      setPending({ commandId: null, cmd, sentAt: Date.now() });
      setOutcome(null);

      try {
        const { ack, commandId } = await sendRelayCommand(selected.relayPubkey, cmd, args);
        if (!mountedRef.current) return;

        if (!ack) {
          setOutcome({
            ok: false,
            message:
              'No answer from the relay yet. The command is signed and will apply if it arrives ' +
              'before it expires.',
            at: Date.now(),
          });
          return;
        }

        setOutcome(
          ack.ok
            ? { ok: true, message: `${cmd.replace('-', ' ')} applied.`, at: ack.at }
            : { ok: false, message: describeRefusal(ack.error), at: ack.at },
        );
        refresh();
        void commandId;
      } catch (err) {
        if (!mountedRef.current) return;
        setOutcome({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          at: Date.now(),
        });
      } finally {
        if (mountedRef.current) setPending(null);
      }
    },
    [refresh, selected],
  );

  return {
    relays,
    selected,
    status,
    devicePubkey,
    pending,
    outcome,
    authorized,
    refresh,
    select,
    run,
  };
}
