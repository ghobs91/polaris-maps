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
