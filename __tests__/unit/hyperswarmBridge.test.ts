import * as RpcCommands from '../../src/services/traffic/rpcCommands';

describe('RpcCommands', () => {
  it('has unique command IDs', () => {
    const values = Object.values(RpcCommands);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('separates outbound (0-9) and inbound (10-19) and lifecycle (20+) ranges', () => {
    expect(RpcCommands.CMD_JOIN_TOPIC).toBeLessThan(10);
    expect(RpcCommands.CMD_LEAVE_TOPIC).toBeLessThan(10);
    expect(RpcCommands.CMD_PUBLISH_PROBE).toBeLessThan(10);
    expect(RpcCommands.CMD_GET_STATUS).toBeLessThan(10);

    expect(RpcCommands.CMD_INCOMING_PROBE).toBeGreaterThanOrEqual(10);
    expect(RpcCommands.CMD_INCOMING_PROBE).toBeLessThan(20);
    expect(RpcCommands.CMD_PEER_COUNT).toBeGreaterThanOrEqual(10);
    expect(RpcCommands.CMD_PEER_COUNT).toBeLessThan(20);
    expect(RpcCommands.CMD_AGGREGATED_UPDATE).toBeGreaterThanOrEqual(10);
    expect(RpcCommands.CMD_AGGREGATED_UPDATE).toBeLessThan(20);

    expect(RpcCommands.CMD_SUSPEND).toBeGreaterThanOrEqual(20);
    expect(RpcCommands.CMD_RESUME).toBeGreaterThanOrEqual(20);
  });
});

// ── getStatus request/reply ─────────────────────────────────────────
// The worklet answers CMD_GET_STATUS with a JSON status payload. These
// tests mock the native BareKit + bare-rpc layers so the bridge can be
// exercised in Jest without a native rebuild.

let mockStatusReply: string | Uint8Array | null = null;
let mockReplyHangs = false;
let mockReplyRejects = false;

jest.mock('react-native-bare-kit', () => ({
  Worklet: class {
    IPC = {};
    start() {}
    terminate() {}
  },
}));

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///doc/' }));

jest.mock('bare-rpc', () => {
  return class MockRPC {
    constructor(_ipc: unknown, _onrequest: unknown) {}
    request(_command: number) {
      return {
        send: () => {},
        reply: () => {
          if (mockReplyRejects) return Promise.reject(new Error('boom'));
          return mockReplyHangs ? new Promise<never>(() => {}) : Promise.resolve(mockStatusReply);
        },
      };
    }
  };
});

jest.mock('../../backend/traffic-swarm.bundle.mjs', () => ({ default: 'stub-bundle' }));

describe('getStatus', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bridge = require('../../src/services/traffic/hyperswarmBridge');

  afterEach(() => {
    bridge.disposeHyperswarmBridge();
    mockStatusReply = null;
    mockReplyHangs = false;
    mockReplyRejects = false;
    jest.useRealTimers();
  });

  it('resolves the worklet status reply', async () => {
    mockStatusReply = JSON.stringify({
      peerCount: 7,
      topicCount: 2,
      topics: ['9q8y', '9q8z'],
      segmentCount: 42,
    });

    bridge.initHyperswarmBridge();
    await expect(bridge.getStatus()).resolves.toEqual({
      peerCount: 7,
      topicCount: 2,
      topics: ['9q8y', '9q8z'],
      segmentCount: 42,
    });
  });

  it('falls back to zeroes when the bridge is not started', async () => {
    bridge.disposeHyperswarmBridge();
    await expect(bridge.getStatus()).resolves.toEqual({
      peerCount: 0,
      topicCount: 0,
      topics: [],
      segmentCount: 0,
    });
  });

  it('falls back to zeroes on a malformed reply', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockStatusReply = 'not json';
    bridge.initHyperswarmBridge();
    await expect(bridge.getStatus()).resolves.toEqual({
      peerCount: 0,
      topicCount: 0,
      topics: [],
      segmentCount: 0,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('times out and falls back when the worklet never replies', async () => {
    jest.useFakeTimers();
    mockReplyHangs = true;
    bridge.initHyperswarmBridge();

    const pending = bridge.getStatus();
    jest.advanceTimersByTime(3000);

    await expect(pending).resolves.toEqual({
      peerCount: 0,
      topicCount: 0,
      topics: [],
      segmentCount: 0,
    });
  });

  it('falls back to zeroes when the reply rejects', async () => {
    mockReplyRejects = true;
    bridge.initHyperswarmBridge();
    await expect(bridge.getStatus()).resolves.toEqual({
      peerCount: 0,
      topicCount: 0,
      topics: [],
      segmentCount: 0,
    });
  });
});
