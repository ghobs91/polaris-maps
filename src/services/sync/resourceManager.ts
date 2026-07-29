import { getFreeDiskStorageAsync } from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { getLocalNode } from './peerService';

export interface ResourceBudget {
  storageMb: number;
  bandwidthMbps: number;
  batteryPctHr: number;
}

export interface ResourceUsage {
  storageUsedMb: number;
  storageAvailableMb: number;
  storagePct: number;
  bandwidthUsedMbps: number;
  batteryUsedPctHr: number;
}

// Conservative defaults so the app works on a wide range of devices without
// user tuning. Storage scales with free disk space; bandwidth scales with the
// active network type.
const MIN_STORAGE_MB = 512;
const MAX_STORAGE_MB = 4096;
const STORAGE_FRACTION_OF_FREE_SPACE = 0.15;

const BANDWIDTH_MBPS_BY_TYPE: Record<string, number> = {
  wifi: 25,
  cellular: 5,
  unknown: 10,
  none: 0,
};

// Target aligned with the Polaris constitution: background peer participation
// should not exceed ~5% battery per hour on a typical device.
const BATTERY_PCT_HR = 5;

/**
 * Compute the current device-adaptive resource budget.
 *
 * - Storage: up to 15% of free disk space, clamped between 512 MB and 4 GB.
 * - Bandwidth: 25 Mbps on Wi-Fi, 5 Mbps on cellular, 0 when offline.
 * - Battery: hard ceiling of 5% per hour.
 */
export async function getBudget(): Promise<ResourceBudget> {
  const [freeBytes, netInfo] = await Promise.all([
    getFreeDiskStorageAsync().catch(() => null),
    NetInfo.fetch().catch(() => ({ type: 'unknown' as const })),
  ]);

  let storageMb: number;
  if (freeBytes === null) {
    storageMb = MIN_STORAGE_MB;
  } else {
    const freeMb = freeBytes / (1024 * 1024);
    storageMb = Math.min(
      MAX_STORAGE_MB,
      Math.max(MIN_STORAGE_MB, Math.floor(freeMb * STORAGE_FRACTION_OF_FREE_SPACE)),
    );
  }

  const networkType = netInfo?.type ?? 'unknown';
  const bandwidthMbps = BANDWIDTH_MBPS_BY_TYPE[networkType] ?? BANDWIDTH_MBPS_BY_TYPE.unknown;

  return { storageMb, bandwidthMbps, batteryPctHr: BATTERY_PCT_HR };
}

export async function getUsage(): Promise<ResourceUsage> {
  const node = await getLocalNode();
  const budget = await getBudget();
  const cacheMb = node.cacheSizeBytes / (1024 * 1024);

  return {
    storageUsedMb: Math.round(cacheMb),
    storageAvailableMb: Math.max(0, budget.storageMb - cacheMb),
    storagePct: budget.storageMb > 0 ? Math.min(100, (cacheMb / budget.storageMb) * 100) : 0,
    bandwidthUsedMbps: 0, // Tracked externally per interval
    batteryUsedPctHr: 0, // Tracked externally
  };
}

export async function isStorageAvailable(additionalBytes: number): Promise<boolean> {
  const budget = await getBudget();
  const maxBytes = budget.storageMb * 1024 * 1024;
  return additionalBytes < maxBytes; // Simplified; actual check needs current usage
}

export async function isBandwidthAvailable(): Promise<boolean> {
  const budget = await getBudget();
  return budget.bandwidthMbps > 0;
}
