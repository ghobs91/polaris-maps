import { readFileSync } from 'fs';
import { join } from 'path';
import * as rpc from '../../src/services/traffic/rpcCommands';

/**
 * Contract tests for the RN ↔ Bare worklet incident protocol. The worklet
 * cannot run under Jest (Bare runtime), so these assert the shared command
 * IDs and the worklet source's dispatch order directly.
 */
describe('incident RPC contract', () => {
  it('assigns the documented incident command IDs', () => {
    expect(rpc.CMD_PUBLISH_INCIDENT).toBe(8);
    expect(rpc.CMD_INCOMING_INCIDENT).toBe(17);
  });

  it('keeps every RPC command ID unique', () => {
    const ids = Object.entries(rpc)
      .filter(([name]) => name.startsWith('CMD_'))
      .map(([, value]) => value as number);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mirrors the command IDs and exports in the worklet source', () => {
    const source = readFileSync(join(__dirname, '../../backend/traffic-swarm.mjs'), 'utf8');

    expect(source).toContain('const CMD_PUBLISH_INCIDENT = 8;');
    expect(source).toContain('const CMD_INCOMING_INCIDENT = 17;');
    expect(source).toContain('function broadcastIncident(');
    expect(source).toContain('function notifyIncident(');
    expect(source).toContain('CMD_PUBLISH_INCIDENT,');
    expect(source).toContain('CMD_INCOMING_INCIDENT,');
  });

  it('routes incident envelopes before the legacy probe decoder', () => {
    const source = readFileSync(join(__dirname, '../../backend/traffic-swarm.mjs'), 'utf8');

    const incidentBranch = source.indexOf("msg.t === 'i'");
    const probeDecode = source.indexOf('handleIncomingProbe(data, conn)');

    expect(incidentBranch).toBeGreaterThan(-1);
    expect(probeDecode).toBeGreaterThan(-1);
    // The incident branch must be evaluated before the probe fallthrough.
    expect(incidentBranch).toBeLessThan(probeDecode);
  });
});
