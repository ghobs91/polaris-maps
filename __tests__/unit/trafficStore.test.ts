import { useTrafficStore } from '../../src/stores/trafficStore';

describe('trafficStore swarm status', () => {
  beforeEach(() => {
    useTrafficStore.getState().clearAll();
  });

  it('defaults mesh status to zero', () => {
    const s = useTrafficStore.getState();
    expect(s.swarmPeerCount).toBe(0);
    expect(s.swarmTopicCount).toBe(0);
    expect(s.swarmSegmentCount).toBe(0);
  });

  it('applies a full swarm status snapshot', () => {
    useTrafficStore.getState().setSwarmStatus({ peerCount: 4, topicCount: 9, segmentCount: 128 });

    const s = useTrafficStore.getState();
    expect(s.swarmPeerCount).toBe(4);
    expect(s.swarmTopicCount).toBe(9);
    expect(s.swarmSegmentCount).toBe(128);
  });

  it('resets mesh status on clearAll', () => {
    useTrafficStore.getState().setSwarmStatus({ peerCount: 4, topicCount: 9, segmentCount: 128 });
    useTrafficStore.getState().clearAll();

    const s = useTrafficStore.getState();
    expect(s.swarmPeerCount).toBe(0);
    expect(s.swarmTopicCount).toBe(0);
    expect(s.swarmSegmentCount).toBe(0);
  });
});
