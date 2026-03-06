export interface PeerNode {
  pubkey: string;
  regionIds: string[];
  cacheSizeBytes: number;
  dataServedBytes: number;
  peerConnections: number;
  uptimeSeconds: number;
  firstSeen: number;
  lastActive: number;
  resourceLimitStorageMb: number;
  resourceLimitBandwidthMbps: number;
  resourceLimitBatteryPctHr: number;
}
