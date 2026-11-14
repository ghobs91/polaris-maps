import * as FileSystem from 'expo-file-system/legacy';
import type { RegionAsset } from '../../models/region';

/**
 * Resumable, mirror-aware, delta-aware asset downloads for region packs.
 *
 * Region packs are hundreds of megabytes, so three things matter:
 *
 *   1. **Resume** — a dropped connection must not restart a 200 MB transfer.
 *      The legacy `createDownloadResumable` API performs HTTP Range resume
 *      when handed resume data, and that data is persisted next to the
 *      partial file so a killed app resumes after relaunch.
 *   2. **Mirrors** — the catalog may list fallback origins (community mirrors,
 *      release assets). Permanent failures (404/403) move to the next source;
 *      transient failures retry the same source with exponential backoff.
 *   3. **Delta** — when the catalog carries per-asset checksums, an asset
 *      whose local copy already matches is skipped, so a data refresh costs
 *      the changed bytes rather than the whole pack.
 *
 * The policy functions are pure and unit tested; the transfer is driven
 * through an injectable {@link DownloadFs} adapter so tests never touch the
 * native module.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** Attempts per source before moving to the next mirror. */
export const MAX_ATTEMPTS_PER_SOURCE = 3;

/** First retry delay; doubles per attempt up to the cap. */
export const RETRY_BASE_MS = 1_000;

/** Upper bound on a single retry delay. */
export const RETRY_MAX_MS = 30_000;

/** HTTP statuses worth retrying (transient server/network conditions). */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

// ── Types ────────────────────────────────────────────────────────────

export interface DownloadProgress {
  bytesWritten: number;
  totalBytes?: number;
  /** Source currently being used. */
  source: string;
  /** Attempt number for this source (1-based). */
  attempt: number;
}

export interface ResumableDownloadOptions {
  /** Destination path (file URI). */
  destPath: string;
  /** Primary URL plus any mirrors, tried in order. */
  sources: string[];
  headers?: Record<string, string>;
  onProgress?: (progress: DownloadProgress) => void;
  /**
   * Integrity check run against the freshly transferred file. Throwing rejects
   * the source (no retry) and moves the transfer to the next mirror — which is
   * what makes a third-party origin safe to trust: a mirror that serves the
   * wrong bytes is demoted by the caller's health record, not silently used.
   */
  verify?: (path: string) => Promise<void>;
  /** Report per-source outcomes so the caller can rank mirrors for later
   *  transfers. Called once per source, after it succeeds or is abandoned. */
  onSourceSettled?: (source: string, outcome: 'success' | 'failure') => void;
  signal?: AbortSignal;
  maxAttemptsPerSource?: number;
  /** Injectable filesystem adapter (defaults to expo-file-system/legacy). */
  fs?: DownloadFs;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface DownloadResult {
  path: string;
  source: string;
  /** Bytes transferred during this call (0 when resumed from a complete file). */
  bytes: number;
  /** True when the asset was already complete and nothing was transferred. */
  skipped: boolean;
}

interface ResumableHandle {
  downloadAsync(): Promise<{ status?: number; uri?: string }>;
  savable(): string;
}

/** Minimal filesystem surface the downloader needs. */
export interface DownloadFs {
  createResumable(
    uri: string,
    fileUri: string,
    options: { headers?: Record<string, string> },
    onProgress: (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
    resumeData?: string,
  ): ResumableHandle;
  getInfoAsync(
    uri: string,
    options?: { md5?: boolean },
  ): Promise<{ exists: boolean; size?: number; md5?: string }>;
  deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>;
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, content: string): Promise<void>;
  makeDirectoryAsync(uri: string, options?: { intermediates?: boolean }): Promise<void>;
}

// ── Pure policy (unit tested) ────────────────────────────────────────

/** Build the ordered, deduped source list from a primary URL plus mirrors. */
export function buildSourceList(
  primary: string | null | undefined,
  mirrors: ReadonlyArray<string | null | undefined> = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [primary, ...mirrors]) {
    if (!url) continue;
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Exponential backoff with a cap. `attempt` is 1-based. */
export function backoffDelayMs(
  attempt: number,
  baseMs: number = RETRY_BASE_MS,
  maxMs: number = RETRY_MAX_MS,
): number {
  if (attempt <= 1) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}

/**
 * Classify a failure. Transient conditions (network, 5xx, 429) retry the
 * same source; everything else (404, 403, malformed) moves to a mirror.
 */
export function isRetryableFailure(status: number | undefined, message: string): boolean {
  if (status !== undefined && RETRYABLE_STATUSES.has(status)) return true;
  if (status !== undefined && status >= 400) return false;
  const text = message.toLowerCase();
  return (
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('connection') ||
    text.includes('offline') ||
    text.includes('econnreset') ||
    text.includes('socket')
  );
}

/** Sidecar path holding resume data for a partially downloaded asset. */
export function resumeSidecarPath(destPath: string): string {
  return `${destPath}.resume`;
}

/**
 * Delta plan: split catalog assets into ones to fetch and ones whose local
 * copy already matches the catalog checksum/size.
 *
 * A local file only counts as "already current" when the catalog supplies a
 * checksum (or size) and it matches; without either, the asset is refetched
 * rather than assumed good.
 */
export function planAssetDownloads(
  assets: readonly RegionAsset[],
  local: ReadonlyMap<string, { md5?: string | null; sizeBytes?: number | null }>,
): { toFetch: RegionAsset[]; skipped: string[] } {
  const toFetch: RegionAsset[] = [];
  const skipped: string[] = [];
  for (const asset of assets) {
    const have = local.get(asset.name);
    const md5Matches =
      !!asset.md5 && !!have?.md5 && asset.md5.toLowerCase() === have.md5.toLowerCase();
    const sizeMatches =
      !asset.md5 && asset.sizeBytes != null && have?.sizeBytes != null
        ? asset.sizeBytes === have.sizeBytes
        : false;
    if (md5Matches || sizeMatches) skipped.push(asset.name);
    else toFetch.push(asset);
  }
  return { toFetch, skipped };
}

// ── Filesystem adapter ───────────────────────────────────────────────

const defaultFs: DownloadFs = {
  createResumable: (uri, fileUri, options, onProgress, resumeData) =>
    FileSystem.createDownloadResumable(
      uri,
      fileUri,
      options,
      (p) => onProgress(p as { totalBytesWritten: number; totalBytesExpectedToWrite: number }),
      resumeData,
    ) as unknown as ResumableHandle,
  getInfoAsync: (uri, options) =>
    FileSystem.getInfoAsync(uri, options) as unknown as ReturnType<DownloadFs['getInfoAsync']>,
  deleteAsync: (uri, options) => FileSystem.deleteAsync(uri, options),
  readAsStringAsync: (uri) => FileSystem.readAsStringAsync(uri),
  writeAsStringAsync: (uri, content) => FileSystem.writeAsStringAsync(uri, content),
  makeDirectoryAsync: (uri, options) => FileSystem.makeDirectoryAsync(uri, options),
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── Transfer ─────────────────────────────────────────────────────────

/**
 * Download `destPath` from the first source that works, resuming partial
 * transfers and retrying transient failures.
 *
 * Returns `skipped: true` when the destination already exists and no source
 * was contacted (caller asked for a delta skip).
 */
export async function downloadResumable(
  options: ResumableDownloadOptions,
): Promise<DownloadResult> {
  const fs = options.fs ?? defaultFs;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttemptsPerSource ?? MAX_ATTEMPTS_PER_SOURCE;
  const sidecar = resumeSidecarPath(options.destPath);

  if (options.sources.length === 0) {
    throw new Error('downloadResumable: no sources provided');
  }

  let lastError: unknown = null;

  for (const source of options.sources) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(options.signal);
      const resumeData = await readResumeData(fs, sidecar, options.destPath);
      let transferred = 0;
      let handle: ResumableHandle | null = null;

      try {
        handle = fs.createResumable(
          source,
          options.destPath,
          { headers: options.headers },
          (p) => {
            transferred = p.totalBytesWritten;
            options.onProgress?.({
              bytesWritten: p.totalBytesWritten,
              totalBytes: p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : undefined,
              source,
              attempt,
            });
          },
          resumeData,
        );

        const result = await handle.downloadAsync();
        const status = result?.status;
        if (status !== undefined && status >= 400) {
          throw Object.assign(new Error(`HTTP ${status} from ${source}`), { status });
        }

        if (options.verify) {
          try {
            await options.verify(options.destPath);
          } catch (verifyError) {
            // Wrong bytes: never retry this source, and never keep the file.
            await fs.deleteAsync(options.destPath, { idempotent: true }).catch(() => {});
            await fs.deleteAsync(sidecar, { idempotent: true }).catch(() => {});
            throw Object.assign(
              verifyError instanceof Error
                ? verifyError
                : new Error(`integrity check failed for ${source}`),
              { permanent: true },
            );
          }
        }

        await fs.deleteAsync(sidecar, { idempotent: true }).catch(() => {});
        options.onSourceSettled?.(source, 'success');
        return { path: options.destPath, source, bytes: transferred, skipped: false };
      } catch (error) {
        lastError = error;
        if (isAbortError(error) || options.signal?.aborted) throw error;

        // Persist resume data so the next attempt (or next launch) continues
        // from the bytes already on disk instead of restarting the transfer.
        if (handle) {
          try {
            const savable = handle.savable();
            if (savable) await fs.writeAsStringAsync(sidecar, savable);
          } catch {
            // No resume data available — the retry restarts this asset.
          }
        }

        if ((error as { permanent?: boolean }).permanent) break;

        const status = (error as { status?: number }).status;
        const message = error instanceof Error ? error.message : String(error);
        if (!isRetryableFailure(status, message)) {
          break; // Permanent — move on to the next mirror.
        }
        if (attempt < maxAttempts) {
          await sleep(backoffDelayMs(attempt));
        }
      }
    }
    options.onSourceSettled?.(source, 'failure');
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`downloadResumable: all sources failed for ${options.destPath}`);
}

async function readResumeData(
  fs: DownloadFs,
  sidecar: string,
  destPath: string,
): Promise<string | undefined> {
  try {
    const info = await fs.getInfoAsync(destPath);
    if (!info.exists) {
      // Stale sidecar with no partial file — start clean.
      await fs.deleteAsync(sidecar, { idempotent: true }).catch(() => {});
      return undefined;
    }
    const raw = await fs.readAsStringAsync(sidecar);
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Download aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.message === 'Download aborted')
  );
}

/**
 * Read local checksums for a set of assets (native MD5, no read into JS).
 * Missing files are simply absent from the map.
 */
export async function localAssetState(
  dir: string,
  assets: readonly RegionAsset[],
  fs: DownloadFs = defaultFs,
): Promise<Map<string, { md5?: string | null; sizeBytes?: number | null }>> {
  const state = new Map<string, { md5?: string | null; sizeBytes?: number | null }>();
  for (const asset of assets) {
    try {
      const info = await fs.getInfoAsync(`${dir}${asset.name}`, { md5: true });
      if (info.exists) {
        state.set(asset.name, { md5: info.md5 ?? null, sizeBytes: info.size ?? null });
      }
    } catch {
      // Unreadable — treat as absent
    }
  }
  return state;
}
