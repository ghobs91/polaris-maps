import { getOrCreateKeypair } from '../identity/keypair';
import { sign, createSigningPayload } from '../identity/signing';
import { encode as geohashEncode } from '../../utils/geohash';
import type { TrafficIncident, IncidentType } from '../../models/traffic';

/**
 * Build and Schnorr-sign a traffic incident report. Transport is handled by
 * `incidentExchangeService`; this function only produces the signed model so
 * it can stay free of P2P imports and be unit-tested in isolation.
 */
export async function createSignedIncident(
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

  return {
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
}

/** Human-readable labels for incident types. */
export { INCIDENT_TYPE_LABELS, INCIDENT_TYPE_ICONS } from './incidentWire';
