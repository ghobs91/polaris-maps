import {
  PEER_MISS_STREAK_LIMIT,
  nextPeerMissStreak,
  resetPeerMissStreak,
  shouldQueryPeersForTile,
} from '../../src/services/traffic/trafficTilePeerPolicy';

describe('shouldQueryPeersForTile', () => {
  const base = { peersConnected: 3, swarmStarted: true, missStreak: 0 };

  it('asks the mesh when peers are connected and tiles have been answered before', () => {
    expect(shouldQueryPeersForTile(base)).toBe(true);
  });

  it('skips the mesh when the worklet is not started', () => {
    expect(shouldQueryPeersForTile({ ...base, swarmStarted: false })).toBe(false);
  });

  it('skips the mesh when no peer is connected', () => {
    // The regression this guards: `isSwarmStarted()` is true as soon as the
    // worklet boots, so a device with zero peers paid the full peer timeout on
    // every cold tile before the origin fetch was allowed to start.
    expect(shouldQueryPeersForTile({ ...base, peersConnected: 0 })).toBe(false);
    expect(shouldQueryPeersForTile({ ...base, peersConnected: -1 })).toBe(false);
  });

  it('stops asking after a run of empty peer answers', () => {
    expect(shouldQueryPeersForTile({ ...base, missStreak: PEER_MISS_STREAK_LIMIT - 1 })).toBe(true);
    expect(shouldQueryPeersForTile({ ...base, missStreak: PEER_MISS_STREAK_LIMIT })).toBe(false);
    expect(shouldQueryPeersForTile({ ...base, missStreak: PEER_MISS_STREAK_LIMIT + 5 })).toBe(
      false,
    );
  });
});

describe('nextPeerMissStreak', () => {
  it('clears the streak on a hit', () => {
    expect(nextPeerMissStreak(4, true)).toBe(0);
  });

  it('extends the streak on a miss', () => {
    expect(nextPeerMissStreak(0, false)).toBe(1);
    expect(nextPeerMissStreak(4, false)).toBe(5);
  });

  it('caps the streak at the limit', () => {
    expect(nextPeerMissStreak(PEER_MISS_STREAK_LIMIT, false)).toBe(PEER_MISS_STREAK_LIMIT);
    expect(nextPeerMissStreak(PEER_MISS_STREAK_LIMIT + 10, false)).toBe(PEER_MISS_STREAK_LIMIT);
  });
});

describe('resetPeerMissStreak', () => {
  it('keeps the streak while the peer count is unchanged', () => {
    expect(resetPeerMissStreak(3, 3, 5)).toBe(5);
  });

  it('clears the streak when peers join or leave', () => {
    expect(resetPeerMissStreak(0, 3, 5)).toBe(0);
    expect(resetPeerMissStreak(3, 0, 5)).toBe(0);
  });
});
