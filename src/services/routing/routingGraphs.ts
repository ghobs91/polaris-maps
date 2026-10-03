/**
 * Offline routing graph store.
 *
 * Valhalla graphs live under `regions/_routing/<catalogRegionId>/` when
 * downloaded from GitHub Releases, or `regions/<regionId>/routing/` when
 * extracted from a peer-provided region pack. Graphs are shared by every
 * downloaded region whose area they cover, so one metro graph can serve a
 * whole state download.
 *
 * All downloads are best-effort: a failed routing fetch must never fail the
 * vector-tile download that owns the region.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { extractTar } from '../../utils/archiveExtract';
import { REGION_DATA_REPO } from '../../constants/config';
import {
  REGION_CATALOG,
  boundsIntersect,
  catalogEntriesIntersectingBounds,
  type CatalogEntry,
} from '../../constants/regionCatalog';
import { getDownloadedRegions } from '../regions/regionRepository';
import type { DownloadProgress } from '../regions/downloadService';
import type { Region } from '../../models/region';
import { boundsArea, type RoutingGraphCandidate } from '../../utils/routingGraphSelect';

/** Cap on how many routing graphs a single region download pulls. */
const MAX_ROUTING_GRAPHS_PER_REGION = 4;

const RELEASE_TAG_PREFIX = 'map-data-';

/** Cached latest `map-data-*` release tag; `undefined` until first lookup. */
let cachedReleaseTag: string | null | undefined;

/** Strip the `file://` scheme — the native engine and node sidecar need raw paths. */
function toNativePath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

function sharedRootUri(): string {
  return `${FileSystem.documentDirectory}regions/_routing/`;
}

/** `file://` URI for a catalog region's shared graph directory. */
function graphDirUri(catalogId: string): string {
  return `${sharedRootUri()}${catalogId}/`;
}

async function exists(uri: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

/** Latest `map-data-*` release tag, or null when unreachable/disabled. */
async function getLatestRoutingReleaseTag(): Promise<string | null> {
  if (cachedReleaseTag !== undefined) return cachedReleaseTag;
  if (!REGION_DATA_REPO) return (cachedReleaseTag = null);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(
      `https://api.github.com/repos/${REGION_DATA_REPO}/releases?per_page=10`,
      { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) return (cachedReleaseTag = null);

    const releases = (await res.json()) as Array<{
      tag_name?: string;
      draft?: boolean;
    }>;
    const usable = releases.filter((r) => !r.draft && r.tag_name);
    const match = usable.find((r) => r.tag_name!.startsWith(RELEASE_TAG_PREFIX)) ?? usable[0];
    cachedReleaseTag = match?.tag_name ?? null;
    return cachedReleaseTag;
  } catch {
    return (cachedReleaseTag = null);
  }
}

/** Catalog entries intersecting a region download, most specific (smallest) first. */
function routingCatalogTargets(region: Region): CatalogEntry[] {
  return catalogEntriesIntersectingBounds(region.bounds)
    .slice()
    .sort((a, b) => boundsArea(a.bounds) - boundsArea(b.bounds))
    .slice(0, MAX_ROUTING_GRAPHS_PER_REGION);
}

/**
 * Download and extract one catalog region's Valhalla graph. Returns true when
 * the graph is present afterwards. Best-effort: any failure returns false.
 */
export async function downloadRoutingGraph(
  catalogId: string,
  onProgress?: (written: number, total: number, percent: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const dirUri = graphDirUri(catalogId);
  if (await exists(dirUri)) return true;

  const tag = await getLatestRoutingReleaseTag();
  if (!tag) return false;

  const url = `https://github.com/${REGION_DATA_REPO}/releases/download/${tag}/${catalogId}-routing.tar`;
  const tarUri = `${FileSystem.cacheDirectory}routing-${catalogId}.tar`;
  const tmpUri = `${sharedRootUri()}.tmp-${catalogId}/`;

  try {
    if (signal?.aborted) return false;
    await FileSystem.deleteAsync(tarUri, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});

    const download = FileSystem.createDownloadResumable(url, tarUri, {}, (progress) => {
      const total = progress.totalBytesExpectedToWrite ?? 0;
      const written = progress.totalBytesWritten ?? 0;
      onProgress?.(written, total, total > 0 ? Math.round((written / total) * 100) : 0);
    });
    const result = await download.downloadAsync();
    if (!result || signal?.aborted) return false;

    // Extract to a temp dir and move into place, so an interrupted extraction
    // never leaves a half-populated graph that later reads as installed.
    await FileSystem.makeDirectoryAsync(tmpUri, { intermediates: true });
    await extractTar(toNativePath(tarUri), toNativePath(tmpUri));
    await FileSystem.deleteAsync(dirUri, { idempotent: true }).catch(() => {});
    await FileSystem.moveAsync({ from: tmpUri, to: dirUri });
    return true;
  } catch {
    return false;
  } finally {
    await FileSystem.deleteAsync(tarUri, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
}

/**
 * Download the routing graphs covering a freshly downloaded region. Targets
 * are catalog regions intersecting the pack's bounds (catalog regions are the
 * only ones with pre-built graphs).
 */
export async function downloadRoutingGraphsForRegion(
  region: Region,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const targets = routingCatalogTargets(region);
  if (targets.length === 0 || signal?.aborted) return;

  const totalBytes = targets.reduce((sum, entry) => sum + (entry.routingSizeBytes ?? 0), 0);
  let baseBytes = 0;

  onProgress?.({
    regionId: region.id,
    totalBytes,
    downloadedBytes: 0,
    percent: 0,
    stage: 'routing',
  });

  for (const entry of targets) {
    if (signal?.aborted) return;
    const base = baseBytes;
    await downloadRoutingGraph(
      entry.id,
      (written) => {
        const downloadedBytes = base + written;
        onProgress?.({
          regionId: region.id,
          totalBytes,
          downloadedBytes,
          percent:
            totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0,
          stage: 'routing',
        });
      },
      signal,
    );
    baseBytes = base + (entry.routingSizeBytes ?? 0);
  }

  onProgress?.({
    regionId: region.id,
    totalBytes,
    downloadedBytes: totalBytes,
    percent: 100,
    stage: 'routing',
  });
}

/** Every routing graph currently on disk: shared store plus region packs. */
export async function listInstalledRoutingGraphs(): Promise<RoutingGraphCandidate[]> {
  const candidates: RoutingGraphCandidate[] = [];

  for (const entry of REGION_CATALOG) {
    const uri = graphDirUri(entry.id);
    if (await exists(uri)) {
      candidates.push({
        id: `catalog:${entry.id}`,
        dir: toNativePath(uri),
        bounds: entry.bounds,
      });
    }
  }

  try {
    const regions = await getDownloadedRegions();
    const root = `${FileSystem.documentDirectory}regions/`;
    for (const region of regions) {
      const uri = `${root}${region.id}/routing/`;
      if (await exists(uri)) {
        candidates.push({
          id: `region:${region.id}`,
          dir: toNativePath(uri),
          bounds: region.bounds,
        });
      }
    }
  } catch {
    // DB unavailable — shared graphs still work.
  }

  return candidates;
}

/**
 * Delete shared routing graphs that no downloaded region needs anymore. Called
 * after a region is removed so deleting a pack can reclaim its graph storage.
 */
export async function pruneUnusedRoutingGraphs(): Promise<void> {
  let regions: Awaited<ReturnType<typeof getDownloadedRegions>>;
  try {
    regions = await getDownloadedRegions();
  } catch {
    return;
  }

  for (const entry of REGION_CATALOG) {
    const uri = graphDirUri(entry.id);
    if (!(await exists(uri))) continue;
    const stillNeeded = regions.some((region) => boundsIntersect(region.bounds, entry.bounds));
    if (!stillNeeded) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
}
