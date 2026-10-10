/**
 * Unit tests for the Bare Hyperdrive region-pack bridge.
 *
 * `react-native-bare-kit`, `bare-rpc`, the committed bundle, and expo-file-system
 * are mocked so the request/response mapping can be exercised in Node.
 */

let mockResponder: (cmd: number, payload: Record<string, unknown>) => unknown = () => ({});

jest.mock(
  'bare-rpc',
  () =>
    class {
      constructor(_ipc: unknown, _onrequest: unknown) {}
      request(cmd: number) {
        let response: unknown = {};
        return {
          send: (data: Uint8Array) => {
            response = mockResponder(cmd, JSON.parse(new TextDecoder().decode(data)));
          },
          reply: async () => new TextEncoder().encode(JSON.stringify(response)),
        };
      }
    },
);

jest.mock('react-native-bare-kit', () => ({
  Worklet: class {
    IPC = {};
    start() {}
    terminate() {}
  },
}));

jest.mock('../../backend/hyperdrive.bundle.mjs', () => ({ default: 'BUNDLE' }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/' }));

import {
  seedRegion,
  downloadFromPeers,
  getHyperdriveStatus,
  disposeHyperdriveBridge,
} from '../../src/services/sync/hyperdriveBridge';
import { CMD_HD_SEED, CMD_HD_DOWNLOAD, CMD_HD_STATUS } from '../../src/services/sync/hdRpcCommands';

beforeEach(() => {
  disposeHyperdriveBridge();
  mockResponder = () => ({});
});

describe('hyperdriveBridge', () => {
  it('author-seeds a region through the worklet', async () => {
    mockResponder = (cmd, payload) => {
      expect(cmd).toBe(CMD_HD_SEED);
      expect(payload).toEqual({
        regionId: 'us-ny-new-york',
        filesDir: '/docs/regions/us-ny-new-york/',
        corestoreRoot: '/docs/.polaris-corestore',
      });
      return {
        key: 'a'.repeat(64),
        discoveryKey: 'b'.repeat(64),
        contentHash: 'c'.repeat(64),
        bytes: 42,
      };
    };

    const result = await seedRegion('us-ny-new-york', 'file:///docs/regions/us-ny-new-york/');

    expect(result).toEqual({
      key: 'a'.repeat(64),
      discoveryKey: 'b'.repeat(64),
      readOnly: false,
      contentHash: 'c'.repeat(64),
      bytes: 42,
    });
  });

  it('passes the canonical key when joining read-only', async () => {
    mockResponder = (cmd, payload) => {
      expect(cmd).toBe(CMD_HD_SEED);
      expect(payload.key).toBe('d'.repeat(64));
      return { key: 'd'.repeat(64), discoveryKey: 'e'.repeat(64) };
    };

    const result = await seedRegion('us-ny-new-york', '/d/', 'd'.repeat(64));
    expect(result.readOnly).toBe(true);
    expect(result.key).toBe('d'.repeat(64));
  });

  it('downloads a pack and returns total bytes', async () => {
    mockResponder = (cmd, payload) => {
      expect(cmd).toBe(CMD_HD_DOWNLOAD);
      expect(payload.driveKey).toBe('a'.repeat(64));
      return { totalBytes: 12345 };
    };

    const result = await downloadFromPeers('a'.repeat(64), '/dest/');
    expect(result.totalBytes).toBe(12345);
  });

  it('reports seeded-drive status', async () => {
    mockResponder = (cmd) => {
      expect(cmd).toBe(CMD_HD_STATUS);
      return {
        drives: [{ regionId: 'us-ny-new-york', key: 'a', discoveryKey: 'b', peers: 2 }],
        swarmConnections: 3,
      };
    };

    const status = await getHyperdriveStatus();
    expect(status.swarmConnections).toBe(3);
    expect(status.drives).toHaveLength(1);
    expect(status.drives[0].peers).toBe(2);
  });

  it('degrades to an empty status when the worklet errors', async () => {
    mockResponder = () => ({ error: 'boom' });
    const status = await getHyperdriveStatus();
    expect(status).toEqual({ drives: [], swarmConnections: 0 });
  });
});
