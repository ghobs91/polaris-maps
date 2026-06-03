import { getOrCreateKeypair } from '../identity/keypair';
import { sign, createSigningPayload } from '../identity/signing';
import { encode as geohashEncode } from '../../utils/geohash';
import type { TrafficIncident, IncidentType } from '../../models/traffic';

/**
 * Submit a traffic incident report.
 * Signs the report with the user's Schnorr keypair and returns the
 * signed incident for broadcast to the P2P network.
 */
export async function submitIncidentReport(
  lat: number,
  lng: number,
  type: IncidentType,
  description: string,
): Promise<TrafficIncident> {
  const { privateKey, publicKey } = await getOrCreateKeypair();
  const geohash6 = geohashEncode(lat, lng, 6);
  const now = Date.now();
  const id = `${publicKey.slice(0, 8)}-${now.toString(36)}`;

  // Sign the incident payload
  const payload = createSigningPayload(
    id,
    publicKey,
    String(lat),
    String(lng),
    geohash6,
    type,
    description,
    String(now),
  );
  const signatureHex = await sign(payload, privateKey);

  // Convert hex signature to Uint8Array for the model
  const signature = new Uint8Array(signatureHex.length / 2);
  for (let i = 0; i < signatureHex.length; i += 2) {
    signature[i / 2] = parseInt(signatureHex.substring(i, i + 2), 16);
  }

  const incident: TrafficIncident = {
    id,
    reporterPubkey: publicKey,
    lat,
    lng,
    geohash6,
    type,
    description,
    reportedAt: now,
    expiresAt: now + 2 * 60 * 60 * 1000, // 2 hours
    signature,
  };

  // Store locally for now — P2P broadcast will be wired when the swarm
  // incident channel is implemented.
  // TODO: Broadcast to Hyperswarm incident topic channel
  return incident;
}

/** Human-readable labels for incident types. */
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  accident: 'Accident',
  road_closure: 'Road Closure',
  hazard: 'Hazard',
  construction: 'Construction',
  police: 'Police',
  other: 'Other',
};

/** Icons for incident types (Ionicons names). */
export const INCIDENT_TYPE_ICONS: Record<IncidentType, string> = {
  accident: 'car-sport',
  road_closure: 'ban',
  hazard: 'warning',
  construction: 'construct',
  police: 'shield-checkmark',
  other: 'alert-circle',
};
