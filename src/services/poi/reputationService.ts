import { getGun } from '../gun/init';
import { getOrCreateKeypair } from '../identity/keypair';
import type { UserReputation } from '../../models/reputation';
import { computeReputationScore } from '../../models/reputation';

export async function getReputation(pubkey: string): Promise<UserReputation | null> {
  return new Promise((resolve) => {
    const gun = getGun();
    (gun as any)
      .get('polaris')
      .get('reputation')
      .get(pubkey)
      .once((data: Record<string, unknown> | undefined) => {
        if (!data || !data.pubkey) {
          resolve(null);
          return;
        }
        resolve({
          pubkey: data.pubkey as string,
          score: (data.score as number) ?? 0,
          poiContributions: (data.poi_contributions as number) ?? 0,
          poiConfirmations: (data.poi_confirmations as number) ?? 0,
          poiRejections: (data.poi_rejections as number) ?? 0,
          trafficProbesSubmitted: (data.traffic_probes_submitted as number) ?? 0,
          trafficAccuracyScore: (data.traffic_accuracy_score as number) ?? 0.5,
          imageryContributions: (data.imagery_contributions as number) ?? 0,
          lastUpdated: (data.last_updated as number) ?? 0,
        });
      });
  });
}

export async function getMyReputation(): Promise<UserReputation> {
  const keypair = await getOrCreateKeypair();
  const existing = await getReputation(keypair.publicKey);
  return existing ?? createDefaultReputation(keypair.publicKey);
}

export async function recordContribution(
  _type: 'poi_create' | 'review' | 'edit_submit' | 'edit_corroborate',
): Promise<UserReputation> {
  const current = await getMyReputation();

  const updated: UserReputation = {
    ...current,
    poiContributions: current.poiContributions + 1,
    lastUpdated: Math.floor(Date.now() / 1000),
  };
  updated.score = computeReputationScore(updated);

  await writeReputation(updated);
  return updated;
}

export async function recordConfirmation(): Promise<UserReputation> {
  const current = await getMyReputation();

  const updated: UserReputation = {
    ...current,
    poiConfirmations: current.poiConfirmations + 1,
    lastUpdated: Math.floor(Date.now() / 1000),
  };
  updated.score = computeReputationScore(updated);

  await writeReputation(updated);
  return updated;
}

export async function recordRejection(): Promise<UserReputation> {
  const current = await getMyReputation();

  const updated: UserReputation = {
    ...current,
    poiRejections: current.poiRejections + 1,
    lastUpdated: Math.floor(Date.now() / 1000),
  };
  updated.score = computeReputationScore(updated);

  await writeReputation(updated);
  return updated;
}

export async function updateTrafficAccuracy(accuracy: number): Promise<UserReputation> {
  const clamped = Math.max(0, Math.min(1, accuracy));
  const current = await getMyReputation();

  const smoothed = current.trafficAccuracyScore * 0.9 + clamped * 0.1;

  const updated: UserReputation = {
    ...current,
    trafficAccuracyScore: smoothed,
    lastUpdated: Math.floor(Date.now() / 1000),
  };
  updated.score = computeReputationScore(updated);

  await writeReputation(updated);
  return updated;
}

async function writeReputation(rep: UserReputation): Promise<void> {
  const gun = getGun();
  (gun as any).get('polaris').get('reputation').get(rep.pubkey).put({
    pubkey: rep.pubkey,
    score: rep.score,
    poi_contributions: rep.poiContributions,
    poi_confirmations: rep.poiConfirmations,
    poi_rejections: rep.poiRejections,
    traffic_probes_submitted: rep.trafficProbesSubmitted,
    traffic_accuracy_score: rep.trafficAccuracyScore,
    imagery_contributions: rep.imageryContributions,
    last_updated: rep.lastUpdated,
  });
}

function createDefaultReputation(pubkey: string): UserReputation {
  return {
    pubkey,
    score: 0,
    poiContributions: 0,
    poiConfirmations: 0,
    poiRejections: 0,
    trafficProbesSubmitted: 0,
    trafficAccuracyScore: 0.5,
    imageryContributions: 0,
    lastUpdated: Math.floor(Date.now() / 1000),
  };
}
