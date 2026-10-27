import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { getDatabase } from '../database/init';
import type {
  StreetViewCapture,
  StreetViewCaptureStream,
  StreetViewDrive,
  StreetViewDriveStatus,
  StreetViewDriveSummary,
  StreetViewTargetStatus,
  StreetViewUploadBatch,
  StreetViewUploadTarget,
} from '../../models/streetViewCapture';

const ROOT_DIR = `${FileSystem.documentDirectory}streetview/`;

interface DriveRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  status: StreetViewDriveStatus;
  capture_count: number;
  bytes: number;
  error: string | null;
  created_at: number;
}

interface CaptureRow {
  id: string;
  drive_id: string;
  local_uri: string;
  lat: number;
  lng: number;
  altitude: number | null;
  heading: number | null;
  speed_mps: number | null;
  captured_at: number;
  width: number;
  height: number;
  bytes: number;
  image_hash: string | null;
  blurred: number;
  stream: StreetViewCaptureStream;
  pair_id: string | null;
  mapillary_status: StreetViewTargetStatus;
  mapillary_file_handle: string | null;
  mapillary_image_id: string | null;
  error: string | null;
  created_at: number;
}

interface UploadRow {
  id: string;
  drive_id: string;
  target: StreetViewUploadTarget;
  remote_batch_id: string | null;
  status: StreetViewUploadBatch['status'];
  total: number;
  uploaded: number;
  failed: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function newId(): string {
  return Crypto.randomUUID();
}

function driveFromRow(row: DriveRow): StreetViewDrive {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    captureCount: row.capture_count,
    bytes: row.bytes,
    error: row.error,
    createdAt: row.created_at,
  };
}

function captureFromRow(row: CaptureRow): StreetViewCapture {
  return {
    id: row.id,
    driveId: row.drive_id,
    localUri: row.local_uri,
    lat: row.lat,
    lng: row.lng,
    altitude: row.altitude,
    heading: row.heading,
    speedMps: row.speed_mps,
    capturedAt: row.captured_at,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    imageHash: row.image_hash,
    blurred: row.blurred === 1,
    stream: row.stream,
    pairId: row.pair_id,
    mapillaryStatus: row.mapillary_status,
    mapillaryFileHandle: row.mapillary_file_handle,
    mapillaryImageId: row.mapillary_image_id,
    error: row.error,
    createdAt: row.created_at,
  };
}

function uploadFromRow(row: UploadRow): StreetViewUploadBatch {
  return {
    id: row.id,
    driveId: row.drive_id,
    target: row.target,
    remoteBatchId: row.remote_batch_id,
    status: row.status,
    total: row.total,
    uploaded: row.uploaded,
    failed: row.failed,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function streetViewRootDir(): string {
  return ROOT_DIR;
}

export function streetViewDriveDir(driveId: string): string {
  return `${ROOT_DIR}${driveId}/`;
}

export async function initStreetViewStorage(): Promise<void> {
  const info = await FileSystem.getInfoAsync(ROOT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  }
}

export async function ensureStreetViewDriveDir(driveId: string): Promise<string> {
  await initStreetViewStorage();
  const dir = streetViewDriveDir(driveId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

export async function createDrive(startedAt = Date.now()): Promise<StreetViewDrive> {
  const db = await getDatabase();
  const id = newId();
  const createdAt = Date.now();
  await db.runAsync(
    `INSERT INTO streetview_drives (id, started_at, ended_at, status, capture_count, bytes, error, created_at)
     VALUES (?, ?, NULL, 'recording', 0, 0, NULL, ?)`,
    [id, startedAt, createdAt],
  );
  await ensureStreetViewDriveDir(id);
  return {
    id,
    startedAt,
    endedAt: null,
    status: 'recording',
    captureCount: 0,
    bytes: 0,
    error: null,
    createdAt,
  };
}

export async function getDrive(driveId: string): Promise<StreetViewDrive | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DriveRow>('SELECT * FROM streetview_drives WHERE id = ?', [
    driveId,
  ]);
  return row ? driveFromRow(row) : null;
}

export async function getActiveDrive(): Promise<StreetViewDrive | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DriveRow>(
    "SELECT * FROM streetview_drives WHERE status = 'recording' ORDER BY started_at DESC LIMIT 1",
  );
  return row ? driveFromRow(row) : null;
}

export interface InsertCaptureInput {
  id?: string;
  driveId: string;
  localUri: string;
  lat: number;
  lng: number;
  altitude: number | null;
  heading: number | null;
  speedMps: number | null;
  capturedAt: number;
  width: number;
  height: number;
  bytes: number;
  blurred?: boolean;
  /** Defaults to `wide`, the Mapillary sequence. */
  stream?: StreetViewCaptureStream;
  /** For a `detail` frame, the `wide` frame it was captured with. */
  pairId?: string | null;
  error?: string | null;
}

export async function insertCapture(input: InsertCaptureInput): Promise<StreetViewCapture> {
  const db = await getDatabase();
  const id = input.id ?? newId();
  const createdAt = Date.now();
  await db.runAsync(
    `INSERT INTO streetview_captures (
       id, drive_id, local_uri, lat, lng, altitude, heading, speed_mps, captured_at,
       width, height, bytes, image_hash, blurred, stream, pair_id,
       mapillary_status, mapillary_file_handle, mapillary_image_id,
       error, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
    [
      id,
      input.driveId,
      input.localUri,
      input.lat,
      input.lng,
      input.altitude,
      input.heading,
      input.speedMps,
      input.capturedAt,
      input.width,
      input.height,
      input.bytes,
      input.blurred ? 1 : 0,
      input.stream ?? 'wide',
      input.pairId ?? null,
      input.error ?? null,
      createdAt,
    ],
  );
  await refreshDriveTotals(input.driveId);
  return {
    id,
    driveId: input.driveId,
    localUri: input.localUri,
    lat: input.lat,
    lng: input.lng,
    altitude: input.altitude,
    heading: input.heading,
    speedMps: input.speedMps,
    capturedAt: input.capturedAt,
    width: input.width,
    height: input.height,
    bytes: input.bytes,
    imageHash: null,
    blurred: input.blurred === true,
    stream: input.stream ?? 'wide',
    pairId: input.pairId ?? null,
    mapillaryStatus: 'pending',
    mapillaryFileHandle: null,
    mapillaryImageId: null,
    error: input.error ?? null,
    createdAt,
  };
}

async function refreshDriveTotals(driveId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE streetview_drives
       SET capture_count = (SELECT COUNT(*) FROM streetview_captures WHERE drive_id = ?),
           bytes = (SELECT COALESCE(SUM(bytes), 0) FROM streetview_captures WHERE drive_id = ?)
     WHERE id = ?`,
    [driveId, driveId, driveId],
  );
}

export async function finalizeDrive(driveId: string, endedAt = Date.now()): Promise<void> {
  const db = await getDatabase();
  await refreshDriveTotals(driveId);
  await db.runAsync(
    `UPDATE streetview_drives SET ended_at = ?, status = 'pending' WHERE id = ? AND status = 'recording'`,
    [endedAt, driveId],
  );
}

export async function listCaptures(driveId: string): Promise<StreetViewCapture[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CaptureRow>(
    'SELECT * FROM streetview_captures WHERE drive_id = ? ORDER BY captured_at ASC',
    [driveId],
  );
  return rows.map(captureFromRow);
}

export async function getDriveSummary(driveId: string): Promise<StreetViewDriveSummary | null> {
  const drive = await getDrive(driveId);
  if (!drive) return null;
  const captures = await listCaptures(driveId);
  return {
    drive,
    captures,
    totalBytes: captures.reduce((sum, capture) => sum + capture.bytes, 0),
    allLandscape: captures.every((capture) => capture.width >= capture.height),
  };
}

export async function listPendingDrives(): Promise<StreetViewDrive[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<DriveRow>(
    `SELECT * FROM streetview_drives
      WHERE status IN ('pending', 'partial', 'uploading') AND capture_count > 0
      ORDER BY started_at DESC`,
  );
  return rows.map(driveFromRow);
}

export async function getPendingTotals(): Promise<{
  drives: number;
  captures: number;
  bytes: number;
}> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ drives: number; captures: number; bytes: number }>(
    `SELECT COUNT(*) AS drives,
            COALESCE(SUM(capture_count), 0) AS captures,
            COALESCE(SUM(bytes), 0) AS bytes
       FROM streetview_drives
      WHERE status IN ('pending', 'partial', 'uploading') AND capture_count > 0`,
  );
  return {
    drives: row?.drives ?? 0,
    captures: row?.captures ?? 0,
    bytes: row?.bytes ?? 0,
  };
}

export async function deleteDrive(driveId: string): Promise<void> {
  const db = await getDatabase();
  const dir = streetViewDriveDir(driveId);
  await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
  await db.runAsync('DELETE FROM streetview_captures WHERE drive_id = ?', [driveId]);
  await db.runAsync('DELETE FROM streetview_uploads WHERE drive_id = ?', [driveId]);
  await db.runAsync('DELETE FROM streetview_drives WHERE id = ?', [driveId]);
}

export async function deleteDriveFile(driveId: string): Promise<void> {
  await FileSystem.deleteAsync(streetViewDriveDir(driveId), { idempotent: true }).catch(() => {});
}

/**
 * A drive left in `recording` belongs to a process that died mid-drive. Turn it
 * into a normal pending drive so it can be reviewed or deleted from Settings.
 */
export async function recoverInterruptedDrives(): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE streetview_drives
        SET status = 'pending',
            ended_at = COALESCE(
              (SELECT MAX(captured_at) FROM streetview_captures WHERE drive_id = streetview_drives.id),
              started_at
            )
      WHERE status = 'recording'`,
  );
  // Recompute totals in case the process died between a capture insert and
  // its counter update, then drop drives that truly have no captures.
  await db
    .runAsync(
      `UPDATE streetview_drives
          SET capture_count = (SELECT COUNT(*) FROM streetview_captures WHERE drive_id = streetview_drives.id),
              bytes = (SELECT COALESCE(SUM(bytes), 0) FROM streetview_captures WHERE drive_id = streetview_drives.id)
        WHERE status = 'pending'`,
    )
    .catch(() => {});
  await db
    .runAsync(
      `DELETE FROM streetview_drives
        WHERE status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM streetview_captures WHERE drive_id = streetview_drives.id)`,
    )
    .catch(() => {});
  return result.changes ?? 0;
}

export async function setDriveStatus(
  driveId: string,
  status: StreetViewDriveStatus,
  error: string | null = null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE streetview_drives SET status = ?, error = ? WHERE id = ?', [
    status,
    error,
    driveId,
  ]);
}

export async function getOrCreateUploadBatch(
  driveId: string,
  target: StreetViewUploadTarget,
): Promise<StreetViewUploadBatch> {
  const db = await getDatabase();
  const now = Date.now();
  const id = newId();
  await db.runAsync(
    `INSERT OR IGNORE INTO streetview_uploads
       (id, drive_id, target, remote_batch_id, status, total, uploaded, failed, error, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'pending', 0, 0, 0, NULL, ?, ?)`,
    [id, driveId, target, now, now],
  );
  const row = await db.getFirstAsync<UploadRow>(
    'SELECT * FROM streetview_uploads WHERE drive_id = ? AND target = ?',
    [driveId, target],
  );
  if (!row) {
    throw new Error('Failed to create upload batch');
  }
  return uploadFromRow(row);
}

export async function updateUploadBatch(
  batchId: string,
  patch: Partial<
    Pick<
      StreetViewUploadBatch,
      'remoteBatchId' | 'status' | 'total' | 'uploaded' | 'failed' | 'error'
    >
  >,
): Promise<void> {
  const db = await getDatabase();
  const current = await db.getFirstAsync<UploadRow>(
    'SELECT * FROM streetview_uploads WHERE id = ?',
    [batchId],
  );
  if (!current) return;
  await db.runAsync(
    `UPDATE streetview_uploads
        SET remote_batch_id = ?, status = ?, total = ?, uploaded = ?, failed = ?, error = ?, updated_at = ?
      WHERE id = ?`,
    [
      patch.remoteBatchId !== undefined ? patch.remoteBatchId : current.remote_batch_id,
      patch.status ?? current.status,
      patch.total ?? current.total,
      patch.uploaded ?? current.uploaded,
      patch.failed ?? current.failed,
      patch.error !== undefined ? patch.error : current.error,
      Date.now(),
      batchId,
    ],
  );
}

export async function setCaptureMapillaryStatus(
  captureId: string,
  status: StreetViewTargetStatus,
  options: {
    fileHandle?: string | null;
    imageId?: string | null;
    error?: string | null;
  } = {},
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE streetview_captures
        SET mapillary_status = ?,
            mapillary_file_handle = COALESCE(?, mapillary_file_handle),
            mapillary_image_id = COALESCE(?, mapillary_image_id),
            error = ?
      WHERE id = ?`,
    [status, options.fileHandle ?? null, options.imageId ?? null, options.error ?? null, captureId],
  );
}

export async function getPendingMapillaryCaptures(driveId: string): Promise<StreetViewCapture[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CaptureRow>(
    `SELECT * FROM streetview_captures
      WHERE drive_id = ? AND mapillary_status IN ('pending', 'failed', 'uploading')
      ORDER BY captured_at ASC`,
    [driveId],
  );
  return rows.map(captureFromRow);
}

export async function getLocalFileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === 'number' ? info.size : 0;
}
