/**
 * The relay's Gun.js bus.
 *
 * Everything the phone can see or do travels over this: status announcements out,
 * signed commands in, signed acks back out. The relay has no other network
 * surface beyond the swarm itself.
 *
 * Records are published as `{ body: <json>, updatedAt }` envelopes rather than as
 * native Gun graphs — see `unwrapBody` in `protocol.mjs` for why (arrays flatten
 * to objects, `null` deletes a field).
 *
 * Best-effort by design: Gun drops writes when no relay answers, so a publish
 * failure is logged and retried on the next tick, never thrown. The dashboard's
 * "last seen" is what tells the user whether the channel is actually alive.
 */

import { unwrapBody } from './protocol.mjs';

/** Community Gun relays, not project infrastructure. Overridable by env. */
const DEFAULT_GUN_PEERS = ['wss://try.axe.eco/gun'];

const NS_ROOT = 'polaris';
const NS_MANIFESTS = 'region-manifests';
const NS_RELAYS = 'relays';
const NS_COMMANDS = 'relay-commands';
const NS_ACKS = 'relay-acks';

/**
 * Connect the relay to Gun.
 *
 * @param {object} options
 * @param {string[]} [options.peers]
 * @param {(message: string) => void} [options.log]
 * @param {(relayPubkey: string) => void} [options.onConnected]
 * @returns {Promise<{ publishRecord: Function, publishAck: Function, subscribeCommands: Function, close: Function }>}
 */
export async function createRelayBus({ peers, log = () => {}, onConnected } = {}) {
  const Gun = (await import('gun')).default;
  const resolvedPeers =
    peers ??
    (process.env.POLARIS_GUN_RELAYS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

  // `radisk`/`localStorage` off: the relay's durable state is its own JSON files,
  // and a Gun disk store under Application Support would be a second, invisible
  // source of truth.
  const gun = Gun({
    peers: resolvedPeers.length > 0 ? resolvedPeers : DEFAULT_GUN_PEERS,
    radisk: false,
    localStorage: false,
  });

  let announced = false;

  return {
    /** Publish the signed status/announcement record for this relay. */
    publishStatus(announcement) {
      gun
        .get(NS_ROOT)
        .get(NS_RELAYS)
        .get(announcement.relayPubkey)
        .put({ body: JSON.stringify(announcement), updatedAt: announcement.updatedAt });
      // Announce the first publish once, not on every tick: repeated "channel up"
      // lines read like reconnects and hide the ones that matter.
      if (!announced) {
        announced = true;
        onConnected?.(announcement.relayPubkey);
      }
    },

    /** Publish the ack for one applied (or refused) command. */
    publishAck(ack) {
      gun
        .get(NS_ROOT)
        .get(NS_ACKS)
        .get(ack.relayPubkey)
        .get(ack.commandId)
        .put({ body: JSON.stringify(ack), updatedAt: ack.at });
    },

    /**
     * Subscribe to commands addressed to this relay.
     *
     * The handler receives every record Gun replays, including ones already seen;
     * idempotency is the daemon's job (`appliedCommandIds`), not the bus's.
     */
    subscribeCommands(relayPubkey, onCommand) {
      gun
        .get(NS_ROOT)
        .get(NS_COMMANDS)
        .get(relayPubkey)
        .map()
        .on((value) => {
          const record = unwrapBody(value);
          if (!record) return;
          try {
            onCommand(record);
          } catch (err) {
            log(`command handler threw: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
    },

    /**
     * Publish a signed region manifest so devices can find this pack's key.
     *
     * Path matches the app's reader: `polaris/region-manifests/<regionId>/<pubkey>`.
     * Written as a `{ body }` envelope for the same reason as everything else here
     * (Gun flattens arrays and deletes nulls).
     */
    publishManifest(manifest) {
      gun
        .get(NS_ROOT)
        .get(NS_MANIFESTS)
        .get(manifest.regionId)
        .get(manifest.publisherPubkey)
        .put({ body: JSON.stringify(manifest), updatedAt: Date.now() });
    },

    /**
     * Subscribe to signed region manifests published by devices.
     *
     * Two levels of `.map()` because the app publishes at
     * `polaris/region-manifests/<regionId>/<publisherPubkey>`. Verification happens
     * in `mergeManifests` — an open gossip namespace is exactly where an unsigned
     * key would arrive from, so nothing here is trusted.
     */
    subscribeManifests(onManifest) {
      gun
        .get(NS_ROOT)
        .get(NS_MANIFESTS)
        .map()
        .map()
        .on((value) => {
          const record = unwrapBody(value);
          if (!record) return;
          try {
            onManifest(record);
          } catch (err) {
            log(`manifest handler threw: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
    },

    close() {
      try {
        gun.off?.();
      } catch {
        /* Gun's teardown is best-effort */
      }
    },
  };
}
