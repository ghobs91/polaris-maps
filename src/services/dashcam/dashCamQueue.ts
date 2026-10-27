import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from '../database/init';
import type { DashCamClip, DashCamRetention, DashCamTotals } from '../../models/dashCam';
import { planDashCamPrune } from './dashCamRetention';

const ROOT_DIR = `${FileSystem.documentDirectory}dashcam/`;

interface ClipRow {
  id: string;
  local_uri: string;
  started_at: number;
  duration_ms: number;
  bytes: number;
  created_at: number;
}

function clipFromRow(row: ClipRow): DashCamClip {
  return {
    id: row.id,
    localUri: row.local_uri,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    bytes: row.bytes,
    createdAt: row.created_at,
  };
}

/** Creates the clip directory on first use and returns its URI. */
export async function ensureDashCamDir(): Promise<string> {
  const info = await FileSystem.getInfoAsync(ROOT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  }
  return ROOT_DIR;
}

export async function insertDashCamClip(clip: DashCamClip): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO dashcam_clips (id, local_uri, started_at, duration_ms, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [clip.id, clip.localUri, clip.startedAt, clip.durationMs, clip.bytes, clip.createdAt],
  );
}

/** Newest first, for the recordings list. */
export async function listDashCamClips(): Promise<DashCamClip[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ClipRow>(
    'SELECT * FROM dashcam_clips ORDER BY started_at DESC',
  );
  return rows.map(clipFromRow);
}

export async function getDashCamTotals(): Promise<DashCamTotals> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    clips: number;
    bytes: number | null;
    duration_ms: number | null;
  }>(
    `SELECT COUNT(*) AS clips, SUM(bytes) AS bytes, SUM(duration_ms) AS duration_ms
       FROM dashcam_clips`,
  );
  return {
    clips: row?.clips ?? 0,
    bytes: row?.bytes ?? 0,
    durationMs: row?.duration_ms ?? 0,
  };
}

export async function deleteDashCamClip(clip: DashCamClip): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM dashcam_clips WHERE id = ?', [clip.id]);
  await FileSystem.deleteAsync(clip.localUri, { idempotent: true }).catch(() => {});
}

export async function deleteAllDashCamClips(): Promise<number> {
  const clips = await listDashCamClips();
  const db = await getDatabase();
  await db.runAsync('DELETE FROM dashcam_clips');
  for (const clip of clips) {
    await FileSystem.deleteAsync(clip.localUri, { idempotent: true }).catch(() => {});
  }
  return clips.length;
}

/**
 * Drops the oldest clips until the rolling buffer is under both caps. Called
 * after every segment so storage never exceeds the configured budget.
 */
export async function pruneDashCamClips(retention: DashCamRetention): Promise<number> {
  const clips = await listDashCamClips();
  const plan = planDashCamPrune(clips, retention);
  for (const clip of plan.drop) {
    await deleteDashCamClip(clip);
  }
  return plan.drop.length;
}

/**
 * Removes rows whose file disappeared (e.g. an OS cleanup of the documents
 * directory) so the list and the totals stay truthful.
 */
export async function reconcileDashCamClips(): Promise<number> {
  const clips = await listDashCamClips();
  if (clips.length === 0) return 0;
  const db = await getDatabase();
  let removed = 0;
  for (const clip of clips) {
    const info = await FileSystem.getInfoAsync(clip.localUri).catch(() => null);
    if (info && info.exists) continue;
    await db.runAsync('DELETE FROM dashcam_clips WHERE id = ?', [clip.id]);
    removed += 1;
  }
  return removed;
}
