import { getDatabase } from '../database/init';
import { getOrCreateKeypair } from '../identity/keypair';
import { useSettingsStore } from '../../stores/settingsStore';
import type { PeerNode } from '../../models/peer';

let joinedAt: number | null = null;

export async function joinNetwork(): Promise<PeerNode> {
  const keypair = await getOrCreateKeypair();
  const db = await getDatabase();
  const now = Math.floor(Date.now() / 1000);
  joinedAt = now;

  const settings = useSettingsStore.getState();

  // Upsert local node record
  const existing = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM peer_node WHERE pubkey = ?',
    [keypair.publicKey],
  );

  if (!existing) {
    await db.runAsync(
      `INSERT INTO peer_node (
        pubkey, region_ids, cache_size_bytes, data_served_bytes,
        peer_connections, uptime_seconds, first_seen, last_active,
        resource_limit_storage_mb, resource_limit_bandwidth_mbps, resource_limit_battery_pct_hr
      ) VALUES (?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
      [
        keypair.publicKey,
        '[]',
        now,
        now,
        settings.resourceLimits.maxStorageMb,
        settings.resourceLimits.maxBandwidthMbps,
        settings.resourceLimits.maxBatteryPctHr,
      ],
    );
  } else {
    await db.runAsync('UPDATE peer_node SET last_active = ? WHERE pubkey = ?', [
      now,
      keypair.publicKey,
    ]);
  }

  return getLocalNode();
}

export async function getLocalNode(): Promise<PeerNode> {
  const keypair = await getOrCreateKeypair();
  const db = await getDatabase();
  const row = await db.getFirstAsync<PeerNodeRow>('SELECT * FROM peer_node WHERE pubkey = ?', [
    keypair.publicKey,
  ]);

  if (!row) throw new Error('Local node not found. Call joinNetwork() first.');

  return rowToPeerNode(row);
}

export async function updatePeerMetrics(updates: {
  dataServedBytes?: number;
  peerConnections?: number;
  cacheSizeBytes?: number;
  regionIds?: string[];
}): Promise<void> {
  const keypair = await getOrCreateKeypair();
  const db = await getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const sets: string[] = ['last_active = ?'];
  const params: (string | number)[] = [now];

  if (updates.dataServedBytes !== undefined) {
    sets.push('data_served_bytes = data_served_bytes + ?');
    params.push(updates.dataServedBytes);
  }
  if (updates.peerConnections !== undefined) {
    sets.push('peer_connections = ?');
    params.push(updates.peerConnections);
  }
  if (updates.cacheSizeBytes !== undefined) {
    sets.push('cache_size_bytes = ?');
    params.push(updates.cacheSizeBytes);
  }
  if (updates.regionIds !== undefined) {
    sets.push('region_ids = ?');
    params.push(JSON.stringify(updates.regionIds));
  }

  // Compute uptime increment
  if (joinedAt) {
    const uptimeIncrement = now - joinedAt;
    sets.push('uptime_seconds = uptime_seconds + ?');
    params.push(uptimeIncrement);
    joinedAt = now;
  }

  params.push(keypair.publicKey);
  await db.runAsync(`UPDATE peer_node SET ${sets.join(', ')} WHERE pubkey = ?`, params);
}

export async function syncResourceLimits(): Promise<void> {
  const keypair = await getOrCreateKeypair();
  const db = await getDatabase();
  const settings = useSettingsStore.getState();

  await db.runAsync(
    `UPDATE peer_node SET
      resource_limit_storage_mb = ?,
      resource_limit_bandwidth_mbps = ?,
      resource_limit_battery_pct_hr = ?
    WHERE pubkey = ?`,
    [
      settings.resourceLimits.maxStorageMb,
      settings.resourceLimits.maxBandwidthMbps,
      settings.resourceLimits.maxBatteryPctHr,
      keypair.publicKey,
    ],
  );
}

interface PeerNodeRow {
  pubkey: string;
  region_ids: string;
  cache_size_bytes: number;
  data_served_bytes: number;
  peer_connections: number;
  uptime_seconds: number;
  first_seen: number;
  last_active: number;
  resource_limit_storage_mb: number;
  resource_limit_bandwidth_mbps: number;
  resource_limit_battery_pct_hr: number;
}

function rowToPeerNode(row: PeerNodeRow): PeerNode {
  return {
    pubkey: row.pubkey,
    regionIds: JSON.parse(row.region_ids),
    cacheSizeBytes: row.cache_size_bytes,
    dataServedBytes: row.data_served_bytes,
    peerConnections: row.peer_connections,
    uptimeSeconds: row.uptime_seconds,
    firstSeen: row.first_seen,
    lastActive: row.last_active,
    resourceLimitStorageMb: row.resource_limit_storage_mb,
    resourceLimitBandwidthMbps: row.resource_limit_bandwidth_mbps,
    resourceLimitBatteryPctHr: row.resource_limit_battery_pct_hr,
  };
}
