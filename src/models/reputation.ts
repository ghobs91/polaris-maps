export interface UserReputation {
  pubkey: string;
  score: number; // 0.0-100.0
  poiContributions: number;
  poiConfirmations: number;
  poiRejections: number;
  trafficProbesSubmitted: number;
  trafficAccuracyScore: number; // 0.0-1.0
  imageryContributions: number;
  lastUpdated: number;
}

export function computeReputationScore(rep: Omit<UserReputation, 'score'>): number {
  const totalContributions =
    rep.poiContributions + rep.trafficProbesSubmitted + rep.imageryContributions;
  const confirmRatio = rep.poiConfirmations / Math.max(1, rep.poiConfirmations + rep.poiRejections);

  const score =
    confirmRatio * 40 +
    rep.trafficAccuracyScore * 30 +
    Math.min(30, Math.log10(Math.max(1, totalContributions)) * 10);

  return Math.round(score * 10) / 10;
}
