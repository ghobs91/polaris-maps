import * as Location from 'expo-location';
import { sign, verify, createSigningPayload } from '../identity/signing';
import { getOrCreateKeypair } from '../identity/keypair';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { encode as geohashEncode } from '../../utils/geohash';
import { recordConfirmation } from './reputationService';

const ATTESTATION_RADIUS_METERS = 100;

export interface POIAttestation {
  placeUuid: string;
  pubkey: string;
  lat: number;
  lng: number;
  timestampS: number;
  signature: string;
}

let attestationHandler: ((attestation: POIAttestation) => void) | null = null;

export function onAttestation(handler: (attestation: POIAttestation) => void): () => void {
  attestationHandler = handler;
  return () => {
    attestationHandler = null;
  };
}

export async function attestPOI(
  placeUuid: string,
  placeLat: number,
  placeLng: number,
): Promise<POIAttestation> {
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const distance = haversineMeters(
    location.coords.latitude,
    location.coords.longitude,
    placeLat,
    placeLng,
  );

  if (distance > ATTESTATION_RADIUS_METERS) {
    throw new Error(
      `Too far from POI (${Math.round(distance)}m). Must be within ${ATTESTATION_RADIUS_METERS}m.`,
    );
  }

  const keypair = await getOrCreateKeypair();
  const now = Math.floor(Date.now() / 1000);

  const payload = createSigningPayload(
    placeUuid,
    String(location.coords.latitude),
    String(location.coords.longitude),
    String(now),
  );
  const signature = await sign(payload, keypair.privateKey);

  const attestation: POIAttestation = {
    placeUuid,
    pubkey: keypair.publicKey,
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    timestampS: now,
    signature,
  };

  const geohash6 = geohashEncode(placeLat, placeLng, 6);
  const topic = `/polaris/1/poi-attest/${geohash6}/proto`;

  // Publish via nodejs-mobile NodeChannel (attestations use the existing sidecar)
  const { NodeChannel } = NativeModules;
  if (NodeChannel) {
    NodeChannel.send(
      JSON.stringify({
        type: 'publish',
        topic,
        payload: Array.from(new TextEncoder().encode(JSON.stringify(attestation))),
        requestId: `attest_${Date.now()}`,
      }),
    );
  }
  await recordConfirmation();

  return attestation;
}

export async function subscribeToAttestations(lat: number, lng: number): Promise<string> {
  const geohash6 = geohashEncode(lat, lng, 6);
  const topic = `/polaris/1/poi-attest/${geohash6}/proto`;

  // Subscribe via nodejs-mobile NodeChannel
  const { NodeChannel } = NativeModules;
  if (NodeChannel) {
    NodeChannel.send(
      JSON.stringify({
        type: 'subscribe',
        topic,
        requestId: `sub_${Date.now()}`,
      }),
    );

    const emitter = new NativeEventEmitter(NodeChannel);
    emitter.addListener('message', (raw: string) => {
      try {
        const event = JSON.parse(raw);
        if (event.type !== 'message' || event.topic !== topic) return;
        const payload = new Uint8Array(event.payload);
        const attestation: POIAttestation = JSON.parse(new TextDecoder().decode(payload));
        if (attestation.placeUuid && attestation.pubkey && attestation.signature) {
          validateAndDispatch(attestation);
        }
      } catch {
        // Ignore malformed messages
      }
    });
  }

  return topic;
}

export async function unsubscribeFromAttestations(topic: string): Promise<void> {
  const { NodeChannel } = NativeModules;
  if (NodeChannel) {
    NodeChannel.send(
      JSON.stringify({
        type: 'unsubscribe',
        topic,
        requestId: `unsub_${Date.now()}`,
      }),
    );
  }
}

async function validateAndDispatch(attestation: POIAttestation): Promise<void> {
  const payload = createSigningPayload(
    attestation.placeUuid,
    String(attestation.lat),
    String(attestation.lng),
    String(attestation.timestampS),
  );

  const valid = await verify(payload, attestation.signature, attestation.pubkey);
  if (!valid) return;

  // Reject attestations older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - attestation.timestampS) > 300) return;

  attestationHandler?.(attestation);
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
