jest.mock('../../src/services/storage/mmkv', () => {
  const store = new Map<string, string>();
  return {
    storage: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
    },
    __store: store,
  };
});

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', ios: { buildNumber: '366' } } },
}));

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  __resetDiagnosticsForTests,
  logDiagnostic,
} from '../../src/services/diagnostics/diagnosticsLog';
import { exportDiagnostics } from '../../src/services/diagnostics/diagnosticsExport';

describe('diagnostics export', () => {
  afterEach(() => {
    __resetDiagnosticsForTests();
  });

  it('writes a redacted JSON file and opens the share sheet', async () => {
    logDiagnostic('geocoding', 'warn', 'nominatim HTTP 429 at https://x.test/a?token=secret');

    const uri = await exportDiagnostics();

    expect(uri).toBe('file:///cache/polaris-diagnostics.json');
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      uri,
      expect.stringContaining('nominatim HTTP 429'),
    );
    const written = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][1] as string;
    expect(written).not.toContain('secret');
    expect(written).toContain('"appVersion": "0.1.0"');
    expect(Sharing.shareAsync).toHaveBeenCalled();
  });
});
