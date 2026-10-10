jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => {
        store.set(key, value);
      },
      getNumber: () => undefined,
      delete: (key: string) => {
        store.delete(key);
      },
    })),
  };
});

import {
  clearSeedLedger,
  hasSeededOverturePlace,
  recordSeededOverturePlace,
} from '../../src/services/osm/overtureSeedLedger';

describe('overtureSeedLedger', () => {
  beforeEach(() => {
    clearSeedLedger();
  });

  it('remembers submitted Overture ids across calls', () => {
    expect(hasSeededOverturePlace('ov-1')).toBe(false);
    recordSeededOverturePlace('ov-1', 123);
    expect(hasSeededOverturePlace('ov-1')).toBe(true);
  });

  it('ignores empty ids', () => {
    expect(hasSeededOverturePlace('')).toBe(false);
    recordSeededOverturePlace('');
    expect(hasSeededOverturePlace('')).toBe(false);
  });

  it('clears the ledger', () => {
    recordSeededOverturePlace('ov-2');
    clearSeedLedger();
    expect(hasSeededOverturePlace('ov-2')).toBe(false);
  });
});
