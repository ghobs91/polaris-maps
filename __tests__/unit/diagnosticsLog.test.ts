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

import {
  __resetDiagnosticsForTests,
  getDiagnostics,
  logDiagnostic,
} from '../../src/services/diagnostics/diagnosticsLog';

const { __store: store } = jest.requireMock('../../src/services/storage/mmkv');

describe('diagnostics log', () => {
  beforeEach(() => {
    __resetDiagnosticsForTests();
    store.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records scoped entries with a timestamp and level', () => {
    logDiagnostic('overpass', 'warn', 'all mirrors failed', { failures: ['HTTP 403'] });

    const entries = getDiagnostics();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      scope: 'overpass',
      level: 'warn',
      message: 'all mirrors failed',
      data: { failures: ['HTTP 403'] },
    });
    expect(Number.isNaN(Date.parse(entries[0].t))).toBe(false);
  });

  it('redacts query strings from URLs', () => {
    logDiagnostic('remote-config', 'warn', 'GET https://example.com/config.json?token=secret');

    const entry = getDiagnostics()[0];
    expect(entry.message).toContain('https://example.com/config.json?<redacted>');
    expect(entry.message).not.toContain('secret');
  });

  it('bounds the buffer to the most recent entries', () => {
    for (let i = 0; i < 300; i++) {
      logDiagnostic('test', 'info', `entry ${i}`);
    }

    const entries = getDiagnostics();
    expect(entries).toHaveLength(250);
    expect(entries[0].message).toBe('entry 50');
    expect(entries[entries.length - 1].message).toBe('entry 299');
  });

  it('persists a bounded JSON snapshot', () => {
    logDiagnostic('traffic', 'error', 'mesh failed');
    jest.advanceTimersByTime(1_000);

    const raw = store.get('diagnostics:entries:v1');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)[0].message).toBe('mesh failed');
  });
});
