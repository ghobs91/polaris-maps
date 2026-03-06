import * as Location from 'expo-location';
import { randomBytes } from '@noble/curves/abstract/utils';
import { encode as geohashEncode } from '../../utils/geohash';
import { publish } from './wakuBridge';
import { useSettingsStore } from '../../stores/settingsStore';
import type { TrafficProbe } from '../../models/traffic';

const PUBLISH_INTERVAL_MS = 5_000;
const MIN_SPEED_KMH = 5;
const PROBE_ID_ROTATION_MS = 60 * 60 * 1000; // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentProbeId: Uint8Array = randomBytes(32);
let probeIdCreatedAt: number = Date.now();

function getProbeId(): Uint8Array {
  if (Date.now() - probeIdCreatedAt > PROBE_ID_ROTATION_MS) {
    currentProbeId = randomBytes(32);
    probeIdCreatedAt = Date.now();
  }
  return currentProbeId;
}

function encodeTrafficProbe(probe: TrafficProbe): Uint8Array {
  // Lightweight encoding: JSON for now, migrate to protobuf in production
  const json = JSON.stringify({
    geohash6: probe.geohash6,
    segment_id: probe.segmentId,
    speed_kmh: probe.speedKmh,
    bearing: probe.bearing,
    timestamp: probe.timestamp,
    probe_id: Array.from(probe.probeId),
  });
  return new TextEncoder().encode(json);
}

async function collectAndPublish(): Promise<void> {
  const perms = useSettingsStore.getState().permissions;
  if (!perms.trafficTelemetryEnabled) return;

  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const speedMps = location.coords.speed ?? 0;
    const speedKmh = Math.max(0, speedMps * 3.6);
    if (speedKmh < MIN_SPEED_KMH) return;

    const bearing = Math.round(location.coords.heading ?? 0) % 360;
    const geohash6 = geohashEncode(location.coords.latitude, location.coords.longitude, 6);

    const probe: TrafficProbe = {
      geohash6,
      segmentId: '', // resolved via nearest-segment lookup (T042)
      speedKmh: Math.round(speedKmh * 10) / 10,
      bearing,
      timestamp: Math.floor(Date.now() / 1000),
      probeId: getProbeId(),
    };

    const topic = `/polaris/1/traffic/${geohash6}/proto`;
    const payload = encodeTrafficProbe(probe);
    await publish(topic, payload);
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
