/**
 * Diagnostics export (UI-only).
 *
 * Kept separate from `diagnosticsLog` so the log stays free of native module
 * imports and can be used from network clients and tests without pulling in
 * expo-file-system / expo-sharing.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { getDiagnostics } from './diagnosticsLog';

/**
 * Write the buffer to a cache file and open the system share sheet.
 * Returns the file URI (also useful when sharing is unavailable).
 */
export async function exportDiagnostics(): Promise<string> {
  const payload = {
    generatedAt: new Date().toISOString(),
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    buildNumber: Constants.expoConfig?.ios?.buildNumber ?? null,
    platform: Platform.OS,
    platformVersion: String(Platform.Version),
    entries: getDiagnostics(),
  };

  const uri = `${FileSystem.cacheDirectory ?? ''}polaris-diagnostics.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: 'Export Polaris diagnostics',
      UTI: 'public.json',
    });
  }
  return uri;
}
