import { schnorr } from '@noble/curves/secp256k1';
import { sign } from '../../src/services/identity/signing';
import {
  decodeIncidentWire,
  encodeIncidentWire,
  incidentSigningPayload,
  verifyIncident,
} from '../../src/services/traffic/incidentWire';
import { encode as geohashEncode } from '../../src/utils/geohash';
import type { TrafficIncident } from '../../src/models/traffic';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function makeIncident(overrides: Partial<TrafficIncident> = {}): Promise<TrafficIncident> {
  const privateKey = schnorr.utils.randomPrivateKey();
  const publicKey = bytesToHex(schnorr.getPublicKey(privateKey));
  const lat = 40.7;
  const lng = -74.0;
  const now = 1_800_000_000_000;

  const base = {
    id: `${publicKey.slice(0, 8)}-abc`,
    reporterPubkey: publicKey,
    lat,
    lng,
    geohash6: geohashEncode(lat, lng, 6),
    type: 'hazard' as const,
    description: 'debris on road',
    reportedAt: now,
    expiresAt: now + 2 * 60 * 60 * 1000,
  };

  const signatureHex = await sign(incidentSigningPayload(base), privateKey);
  const signature = new Uint8Array(signatureHex.length / 2);
  for (let i = 0; i < signatureHex.length; i += 2) {
    signature[i / 2] = parseInt(signatureHex.substring(i, i + 2), 16);
  }

  return { ...base, signature, ...overrides };
}

describe('incident wire format', () => {
  it('round-trips through encode/decode', async () => {
    const incident = await makeIncident();

    const decoded = decodeIncidentWire(encodeIncidentWire(incident));

    expect(decoded).not.toBeNull();
    expect(decoded).toMatchObject({
      id: incident.id,
      reporterPubkey: incident.reporterPubkey,
      lat: incident.lat,
      lng: incident.lng,
      geohash6: incident.geohash6,
      type: incident.type,
      description: incident.description,
      reportedAt: incident.reportedAt,
      expiresAt: incident.expiresAt,
    });
    expect(Array.from(decoded!.signature)).toEqual(Array.from(incident.signature));
  });

  it('accepts an already-parsed envelope object', async () => {
    const incident = await makeIncident();
    const parsed = JSON.parse(encodeIncidentWire(incident));

    expect(decodeIncidentWire(parsed)).not.toBeNull();
  });

  it('verifies a valid signature', async () => {
    const incident = await makeIncident();
    expect(verifyIncident(incident)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const incident = await makeIncident();
    const tampered = { ...incident, description: 'something else' };
    expect(verifyIncident(tampered)).toBe(false);
  });

  it('rejects non-incident envelopes and unknown types', () => {
    expect(decodeIncidentWire(JSON.stringify({ t: 'cr', id: 'x' }))).toBeNull();
    expect(
      decodeIncidentWire(
        JSON.stringify({
          t: 'i',
          i: 'x',
          pk: 'a',
          la: 1,
          ln: 2,
          g: 'g',
          ty: 'alien',
          d: '',
          ra: 1,
          ea: 2,
          s: '00',
        }),
      ),
    ).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(decodeIncidentWire('{not json')).toBeNull();
  });
});
