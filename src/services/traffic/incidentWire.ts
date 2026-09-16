import { createSigningPayload, verify } from '../identity/signing';
import type { IncidentType, TrafficIncident } from '../../models/traffic';

/**
 * Compact, transport-agnostic incident envelope shared by the Hyperswarm
 * worklet and the Nostr fallback. The signature covers the canonical
 * signing payload (not this envelope) so both transports verify identically.
 */
export interface IncidentWire {
  t: 'i';
  /** incident id */
  i: string;
  /** reporter public key */
  pk: string;
  la: number;
  ln: number;
  /** geohash6 */
  g: string;
  ty: IncidentType;
  d: string;
  /** reported at (ms) */
  ra: number;
  /** expires at (ms) */
  ea: number;
  /** Schnorr signature (hex) */
  s: string;
}

export const INCIDENT_TYPES: readonly IncidentType[] = [
  'accident',
  'road_closure',
  'hazard',
  'construction',
  'police',
  'other',
];

export function isIncidentType(value: unknown): value is IncidentType {
  return typeof value === 'string' && (INCIDENT_TYPES as readonly string[]).includes(value);
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

/** Ionicons names for incident types. */
export const INCIDENT_TYPE_ICONS: Record<IncidentType, string> = {
  accident: 'car-sport',
  road_closure: 'ban',
  hazard: 'warning',
  construction: 'construct',
  police: 'shield-checkmark',
  other: 'alert-circle',
};

export function incidentSigningPayload(incident: {
  id: string;
  reporterPubkey: string;
  lat: number;
  lng: number;
  geohash6: string;
  type: IncidentType;
  description: string;
  reportedAt: number;
}): string {
  return createSigningPayload(
    incident.id,
    incident.reporterPubkey,
    String(incident.lat),
    String(incident.lng),
    incident.geohash6,
    incident.type,
    incident.description,
    String(incident.reportedAt),
  );
}

export function toIncidentWire(incident: TrafficIncident): IncidentWire {
  return {
    t: 'i',
    i: incident.id,
    pk: incident.reporterPubkey,
    la: incident.lat,
    ln: incident.lng,
    g: incident.geohash6,
    ty: incident.type,
    d: incident.description,
    ra: incident.reportedAt,
    ea: incident.expiresAt,
    s: bytesToHex(incident.signature),
  };
}

export function encodeIncidentWire(incident: TrafficIncident): string {
  return JSON.stringify(toIncidentWire(incident));
}

/** Parse and structurally validate an incident envelope (no signature check). */
export function decodeIncidentWire(raw: unknown): TrafficIncident | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const msg = parsed as Partial<IncidentWire>;
  if (msg.t !== 'i') return null;
  if (typeof msg.i !== 'string' || typeof msg.pk !== 'string' || typeof msg.g !== 'string') {
    return null;
  }
  if (typeof msg.s !== 'string') return null;
  if (
    typeof msg.la !== 'number' ||
    typeof msg.ln !== 'number' ||
    typeof msg.ra !== 'number' ||
    typeof msg.ea !== 'number'
  ) {
    return null;
  }
  if (!isIncidentType(msg.ty)) return null;

  return {
    id: msg.i,
    reporterPubkey: msg.pk,
    lat: msg.la,
    lng: msg.ln,
    geohash6: msg.g,
    type: msg.ty,
    description: typeof msg.d === 'string' ? msg.d : '',
    reportedAt: msg.ra,
    expiresAt: msg.ea,
    signature: hexToBytes(msg.s),
  };
}

/** Verify the incident's Schnorr signature against its reporter public key. */
export function verifyIncident(incident: TrafficIncident): boolean {
  try {
    return verify(
      incidentSigningPayload(incident),
      bytesToHex(incident.signature),
      incident.reporterPubkey,
    );
  } catch {
    return false;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
