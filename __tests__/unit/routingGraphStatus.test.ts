/**
 * The explanation behind "no region graph loaded".
 *
 * The routing badge reads `summarizeRoutingGraphProblem()` through the cascade;
 * before this existed, an install or selection failure was indistinguishable
 * from "the user downloaded nothing", so the only symptom was the tier silently
 * degrading to a network engine.
 */

import {
  clearRoutingGraphSelectionFailure,
  getRoutingGraphInstallStatus,
  getRoutingGraphSelectionStatus,
  recordRoutingGraphInstallStatus,
  recordRoutingGraphSelectionFailure,
  resetRoutingGraphStatus,
  summarizeRoutingGraphProblem,
} from '../../src/services/routing/routingGraphStatus';

beforeEach(() => resetRoutingGraphStatus());

describe('summarizeRoutingGraphProblem', () => {
  it('is null when nothing has been attempted', () => {
    expect(summarizeRoutingGraphProblem()).toBeNull();
  });

  it('stays silent when a graph installed cleanly', () => {
    recordRoutingGraphInstallStatus({
      regionId: 'us-ny-new-york',
      requested: ['us-ny-new-york'],
      installed: ['us-ny-new-york'],
      failed: [],
    });

    expect(getRoutingGraphInstallStatus()).not.toBeNull();
    expect(summarizeRoutingGraphProblem()).toBeNull();
  });

  it('reports the single graph that failed to install', () => {
    recordRoutingGraphInstallStatus({
      regionId: 'us-ny-new-york',
      requested: ['us-ny-new-york'],
      installed: [],
      failed: [{ id: 'us-ny-new-york', reason: 'HTTP 404' }],
    });

    expect(summarizeRoutingGraphProblem()).toBe(
      'graph install failed for us-ny-new-york: HTTP 404',
    );
  });

  it('counts the rest when several graphs failed', () => {
    recordRoutingGraphInstallStatus({
      regionId: 'us-ca-los-angeles',
      requested: ['us-ca-los-angeles', 'us-ca-san-francisco', 'us-ca-san-diego'],
      installed: [],
      failed: [
        { id: 'us-ca-los-angeles', reason: 'HTTP 404' },
        { id: 'us-ca-san-francisco', reason: 'HTTP 404' },
        { id: 'us-ca-san-diego', reason: 'HTTP 404' },
      ],
    });

    expect(summarizeRoutingGraphProblem()).toBe(
      'graph install failed for us-ca-los-angeles: us-ca-los-angeles: HTTP 404 (+2 more)',
    );
  });

  it('names the reason a pack was skipped', () => {
    recordRoutingGraphInstallStatus({
      regionId: 'australia-oceania-kiribati',
      requested: [],
      installed: [],
      failed: [],
      skipped: 'untrusted-pack-bounds',
    });

    expect(summarizeRoutingGraphProblem()).toBe(
      'no routing graph for australia-oceania-kiribati (pack bounds too wide to target metros)',
    );
  });

  it('prefers the selection failure over an older install note', () => {
    recordRoutingGraphInstallStatus({
      regionId: 'us-ny-new-york',
      requested: ['us-ny-new-york'],
      installed: [],
      failed: [{ id: 'us-ny-new-york', reason: 'HTTP 404' }],
    });
    recordRoutingGraphSelectionFailure('no installed graph covers this route (1 graph on device)');

    expect(summarizeRoutingGraphProblem()).toBe(
      'no installed graph covers this route (1 graph on device)',
    );
  });

  it('forgets the selection failure once a graph loads', () => {
    recordRoutingGraphSelectionFailure('graph load failed: ENOSPC');
    expect(getRoutingGraphSelectionStatus()).not.toBeNull();

    clearRoutingGraphSelectionFailure();

    expect(summarizeRoutingGraphProblem()).toBeNull();
  });
});
