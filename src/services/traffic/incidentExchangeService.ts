import { createSignedIncident } from './incidentReportService';
import { decodeIncidentWire, encodeIncidentWire, verifyIncident } from './incidentWire';
import {
  isStarted as isSwarmStarted,
  onIncident as onSwarmIncident,
  publishIncident as publishIncidentHyperswarm,
} from './hyperswarmBridge';
import {
  getConnectedRelayCount,
  onIncident as onNostrIncident,
  publishIncident as publishIncidentNostr,
} from './nostrFallback';
import { useTrafficStore } from '../../stores/trafficStore';
import { storage } from '../storage/mmkv';
import { enqueue } from '../sync/offlineQueue';
import { MIN_PEER_THRESHOLD } from '../../models/traffic';
import type { IncidentType, TrafficIncident } from '../../models/traffic';
import { encode as geohashEncode } from '../../utils/geohash';

const STORAGE_KEY = 'traffic_incidents';
const TTL_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MIN_REPORT_INTERVAL_MS = 60 * 1000;
const MAX_TRACKED_REPORTERS = 1_000;

let sweepInterval: ReturnType<typeof setInterval> | null = null;
let swarmUnsubscribe: (() => void) | null = null;
let nostrUnsubscribe: (() => void) | null = null;
const seenIncidentIds = new Set<string>();
const lastReportAtByPubkey = new Map<string, number>();

/**
 * Sign, accept locally, and broadcast an incident report. Falls back from
 * Hyperswarm to Nostr, and enqueues for replay when neither transport is up.
 */
export async function reportIncident(
  lat: number,
  lng: number,
  type: IncidentType,
  description: string,
): Promise<TrafficIncident> {
  const incident = await createSignedIncident(lat, lng, type, description);
  acceptIncident(incident);
  broadcastIncident(incident);
  return incident;
}

function broadcastIncident(incident: TrafficIncident): void {
  const wire = encodeIncidentWire(incident);
  const peerCount = useTrafficStore.getState().swarmPeerCount;

  if (isSwarmStarted() && peerCount >= MIN_PEER_THRESHOLD) {
    publishIncidentHyperswarm(wire);
  } else if (getConnectedRelayCount() > 0) {
    void publishIncidentNostr(incident, incident.geohash6.slice(0, 4));
  } else {
    enqueue({ type: 'incident', payload: wire });
  }
}

/**
 * Decode, verify, validate, dedupe, and accept an incident received from a
 * transport. Returns true when the incident was newly accepted.
 */
export function receiveIncidentWire(raw: unknown): boolean {
  const incident = decodeIncidentWire(raw);
  if (!incident) return false;
  if (!verifyIncident(incident)) return false;
  return acceptIncident(incident);
}

function acceptIncident(incident: TrafficIncident): boolean {
  const now = Date.now();

  if (incident.expiresAt <= now) return false;
  if (incident.reportedAt > now + MAX_FUTURE_SKEW_MS) return false;
  if (incident.description.length > MAX_DESCRIPTION_LENGTH) return false;
  if (geohashEncode(incident.lat, incident.lng, 6) !== incident.geohash6) return false;
  if (seenIncidentIds.has(incident.id)) return false;

  const lastReportedAt = lastReportAtByPubkey.get(incident.reporterPubkey);
  if (lastReportedAt != null && now - lastReportedAt < MIN_REPORT_INTERVAL_MS) return false;

  seenIncidentIds.add(incident.id);
  lastReportAtByPubkey.set(incident.reporterPubkey, now);
  if (lastReportAtByPubkey.size > MAX_TRACKED_REPORTERS) {
    const oldest = lastReportAtByPubkey.keys().next().value;
    if (oldest != null) lastReportAtByPubkey.delete(oldest);
  }

  useTrafficStore.getState().upsertIncident(incident);
  persistIncidents();
  return true;
}

function persistIncidents(): void {
  const now = Date.now();
  const wire = useTrafficStore
    .getState()
    .incidents.filter((incident) => incident.expiresAt > now)
    .map((incident) => encodeIncidentWire(incident));
  storage.set(STORAGE_KEY, JSON.stringify(wire));
}

/** Restore unexpired incidents persisted from a previous session. */
export function loadPersistedIncidents(): void {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    const loaded: TrafficIncident[] = [];
    for (const entry of parsed) {
      const incident = decodeIncidentWire(entry);
      if (!incident || incident.expiresAt <= now) continue;
      loaded.push(incident);
      seenIncidentIds.add(incident.id);
    }
    useTrafficStore.getState().setIncidents(loaded);
  } catch {
    // Ignore corrupt persistence.
  }
}

function sweepExpiredIncidents(): void {
  useTrafficStore.getState().pruneExpiredIncidents(Date.now());
  persistIncidents();
}

/** Subscribe to both transports, restore persistence, and start the TTL sweep. */
export function initIncidentExchange(): void {
  loadPersistedIncidents();
  if (!swarmUnsubscribe) swarmUnsubscribe = onSwarmIncident(receiveIncidentWire);
  if (!nostrUnsubscribe) {
    nostrUnsubscribe = onNostrIncident((incident) => receiveIncidentWire(incident));
  }
  if (!sweepInterval) {
    sweepInterval = setInterval(sweepExpiredIncidents, TTL_SWEEP_INTERVAL_MS);
  }
}

export function disposeIncidentExchange(): void {
  swarmUnsubscribe?.();
  nostrUnsubscribe?.();
  swarmUnsubscribe = null;
  nostrUnsubscribe = null;
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

/** Clear in-memory dedupe/rate-limit state (tests). */
export function resetIncidentExchangeState(): void {
  seenIncidentIds.clear();
  lastReportAtByPubkey.clear();
}
