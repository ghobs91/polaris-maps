import * as Location from 'expo-location';
import { randomBytes } from '@noble/hashes/utils';
import { encode as geohashEncode } from '../../utils/geohash';
import { publishProbe as hyperswarmPublish, isStarted as isSwarmStarted } from './hyperswarmBridge';
import { publishProbe as nostrPublish } from './nostrFallback';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTrafficStore } from '../../stores/trafficStore';
import type { TrafficProbe } from '../../models/traffic';
import { consumePublishBudget } from './publishBudget';

const PUBLISH_INTERVAL_MS = 5_000;
/**
 * Public Nostr relays are shared infrastructure. When the swarm has too few
 * peers and probes fall back to relays, sample at 1/6 the local GPS rate so a
 * launch spike does not turn into thousands of events per second per relay.
 */
const NOSTR_PUBLISH_MIN_INTERVAL_MS = 30_000;
const MIN_SPEED_MPH = 3;
const PROBE_ID_ROTATION_MS = 60 * 60 * 1000; // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastNostrPublishAt = 0;
let currentProbeId: Uint8Array = randomBytes(32);
let probeIdCreatedAt: number = Date.now();

function getProbeId(): Uint8Array {
  if (Date.now() - probeIdCreatedAt > PROBE_ID_ROTATION_MS) {
    currentProbeId = randomBytes(32);
    probeIdCreatedAt = Date.now();
  }
  return currentProbeId;
}

function encodeTrafficProbe(probe: TrafficProbe): string {
  // Compact JSON for Hyperswarm exchange (migrate to protobuf in production)
  return JSON.stringify({
    g6: probe.geohash6,
    sid: probe.segmentId,
    spd: probe.speedMph,
    brg: probe.bearing,
    ts: probe.timestamp,
    pid: Array.from(probe.probeId),
  });
}

/**
 * Minimum swarm peers before probes stay on the mesh.
 *
 * At scale the relay path must stay rare: probes are high-frequency (every few
 * seconds), so they only leave the mesh when the swarm has **no** peers at
 * all. A device with even one peer publishes over Hyperswarm (which reaches
 * that peer) instead of broadcasting to donation-funded public relays. The
 * daily publish budget (publishBudget.ts) is the hard backstop.
 */
export const PROBE_RELAY_MIN_PEERS = 1;

/**
 * Choose the transport for an outbound probe: Hyperswarm while any peer is
 * connected, otherwise the Nostr relay fallback.
 */
export function selectProbeTransport(
  swarmStarted: boolean,
  swarmPeerCount: number,
): 'hyperswarm' | 'nostr' {
  return swarmStarted && swarmPeerCount >= PROBE_RELAY_MIN_PEERS ? 'hyperswarm' : 'nostr';
}

async function collectAndPublish(): Promise<void> {
  const perms = useSettingsStore.getState().permissions;
  if (!perms.trafficTelemetryEnabled) return;

  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const speedMps = location.coords.speed ?? 0;
    const speedMph = Math.max(0, speedMps * 2.23694);
    if (speedMph < MIN_SPEED_MPH) return;

    const bearing = Math.round(location.coords.heading ?? 0) % 360;
    const geohash6 = geohashEncode(location.coords.latitude, location.coords.longitude, 6);
    const geohash4 = geohash6.slice(0, 4);

    const probe: TrafficProbe = {
      geohash6,
      segmentId: geohash6, // use geohash6 as segment ID until nearest-segment lookup (T042)
      speedMph: Math.round(speedMph * 10) / 10,
      bearing,
      timestamp: Math.floor(Date.now() / 1000),
      probeId: getProbeId(),
    };

    const swarmPeerCount = useTrafficStore.getState().swarmPeerCount;

    // Primary: Hyperswarm direct P2P exchange
    if (selectProbeTransport(isSwarmStarted(), swarmPeerCount) === 'hyperswarm') {
      const probeJson = encodeTrafficProbe(probe);
      hyperswarmPublish(probeJson);
    } else {
      // Fallback: Nostr relay broadcast, sampled and budgeted to protect
      // donation-funded public relays.
      const now = Date.now();
      if (now - lastNostrPublishAt < NOSTR_PUBLISH_MIN_INTERVAL_MS) return;
      if (!consumePublishBudget('probe', now)) return;
      lastNostrPublishAt = now;
      await nostrPublish(probe, geohash4);
    }
  } catch {
    // location unavailable or publish failed — silently skip
  }
}

export function startProbeCollector(): void {
  if (intervalId) return;
  intervalId = setInterval(collectAndPublish, PUBLISH_INTERVAL_MS);
}

export function stopProbeCollector(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function isCollecting(): boolean {
  return intervalId !== null;
}
