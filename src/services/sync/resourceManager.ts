import { useSettingsStore } from '../../stores/settingsStore';
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

export function getLimits(): ResourceBudget {
  const settings = useSettingsStore.getState();
  return {
    storageMb: settings.resourceLimits.maxStorageMb,
    bandwidthMbps: settings.resourceLimits.maxBandwidthMbps,
    batteryPctHr: settings.resourceLimits.maxBatteryPctHr,
  };
}

export async function getUsage(): Promise<ResourceUsage> {
  const node = await getLocalNode();
  const limits = getLimits();
  const cacheMb = node.cacheSizeBytes / (1024 * 1024);

  return {
    storageUsedMb: Math.round(cacheMb),
    storageAvailableMb: Math.max(0, limits.storageMb - cacheMb),
    storagePct: limits.storageMb > 0 ? Math.min(100, (cacheMb / limits.storageMb) * 100) : 0,
    bandwidthUsedMbps: 0, // Tracked externally per interval
    batteryUsedPctHr: 0, // Tracked externally
  };
}

export function isStorageAvailable(additionalBytes: number): boolean {
  const limits = getLimits();
  // Quick sync check — for accurate check, use getUsage()
  const maxBytes = limits.storageMb * 1024 * 1024;
  return additionalBytes < maxBytes; // Simplified; actual check needs current usage
}

export function isBandwidthAvailable(): boolean {
  const limits = getLimits();
  return limits.bandwidthMbps > 0;
}
