import { getGun } from '../gun/init';
import { getOrCreateKeypair } from '../identity/keypair';
import { sign, verify, createSigningPayload } from '../identity/signing';
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

        // Verify the signature before trusting data from any Gun.js peer.
        // A malicious peer could write a fake high score for any pubkey, which
        // would cause edits from that pubkey to be auto-accepted.
        const sig = (data.signature as string) ?? '';
        const payload = createSigningPayload(
          data.pubkey as string,
          String(data.score ?? 0),
          String(data.last_updated ?? 0),
        );
        if (!sig || !verify(payload, sig, data.pubkey as string)) {
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
  const keypair = await getOrCreateKeypair();
  const payload = createSigningPayload(rep.pubkey, String(rep.score), String(rep.lastUpdated));
  const signature = await sign(payload, keypair.privateKey);

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
    signature,
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
