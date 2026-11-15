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
import { buildSourceList, downloadResumable } from '../regions/assetDownload';
import {
  orderMirrorSources,
  recordMirrorFailure,
  recordMirrorSuccess,
} from '../regions/mirrorHealth';
import { REGION_CATALOG, boundsIntersect, type CatalogEntry } from '../../constants/regionCatalog';
import { getDownloadedRegions, getRegionById } from '../regions/regionRepository';
import type { DownloadProgress } from '../regions/downloadService';
import type { Region } from '../../models/region';
import {
  isGlobishBounds,
  selectRoutingGraphTargets,
  unionBounds,
  type LatLngBounds,
  type RoutingGraphCandidate,
} from '../../utils/routingGraphSelect';
import {
  recordRoutingGraphInstallStatus,
  type RoutingGraphInstallStatus,
} from './routingGraphStatus';

/** Cap on how many routing graphs a single region download pulls. */
const MAX_ROUTING_GRAPHS_PER_REGION = 4;

/** Sidecar written into a graph directory recording the bounds it was published
 *  under. Selection prefers it over the compiled-in catalog bounds, which drift
 *  as the published catalog is re-cut. */
const GRAPH_META_FILE = 'polaris-graph.json';

const RELEASE_TAG_PREFIX = 'map-data-';

/** Cached latest `map-data-*` release tag; `undefined` until first lookup. */
let cachedReleaseTag: string | null | undefined;

/**
 * Multi-origin metadata from the catalog, resolved lazily.
 *
 * `catalogService` pulls in MMKV (and through it expo-crypto), and this module
 * is imported by the region downloader on paths that never touch the catalog.
 * Requiring it at call time keeps that dependency out of their module graph.
 */
function catalogAssetOrigins(): { tag: string | null; baseUrls: string[] } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../regions/catalogService') as typeof import('../regions/catalogService');
    return mod.getCatalogAssetOrigins();
  } catch {
    return { tag: null, baseUrls: [] };
  }
}

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

/** Metadata stored beside a graph's Valhalla tiles. */
interface RoutingGraphMeta {
  version: 1;
  id: string;
  /** Bounds the graph was published under (catalog ∪ database at install). */
  bounds: LatLngBounds;
  installedAt: number;
}

/** Best-effort: a missing or unreadable sidecar just means selection falls back
 *  to the compiled-in catalog bounds. */
async function writeGraphMeta(dirUri: string, meta: RoutingGraphMeta): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(`${dirUri}${GRAPH_META_FILE}`, JSON.stringify(meta));
  } catch {
    // Ignored — see the doc comment above.
  }
}

async function readGraphMeta(dirUri: string): Promise<RoutingGraphMeta | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(`${dirUri}${GRAPH_META_FILE}`);
    const parsed = JSON.parse(raw) as Partial<RoutingGraphMeta>;
    const bounds = parsed.bounds;
    if (
      !bounds ||
      typeof bounds.minLat !== 'number' ||
      typeof bounds.maxLat !== 'number' ||
      typeof bounds.minLng !== 'number' ||
      typeof bounds.maxLng !== 'number'
    ) {
      return null;
    }
    return {
      version: 1,
      id: typeof parsed.id === 'string' ? parsed.id : '',
      bounds,
      installedAt: typeof parsed.installedAt === 'number' ? parsed.installedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Bounds to record for a freshly installed graph: the compiled-in catalog box
 * widened by the database's (remote-catalog) box for the same id.
 *
 * The two disagree in practice — the published catalog for New York Metro ends
 * at -73.2° while the compiled-in box ends at -73.7° — and the narrower one
 * silently excludes routes it should have covered. Union is the conservative
 * choice: over-selection degrades to "no route in coverage" (a clean failure
 * that falls through the cascade), under-selection hides the graph entirely.
 */
async function resolveGraphBounds(catalogId: string): Promise<LatLngBounds | null> {
  const entry = REGION_CATALOG.find((e) => e.id === catalogId);
  let bounds: LatLngBounds | null = entry ? { ...entry.bounds } : null;
  try {
    const row = await getRegionById(catalogId);
    if (row) bounds = bounds ? unionBounds(bounds, row.bounds) : { ...row.bounds };
  } catch {
    // DB unavailable — the compiled-in box still works.
  }
  return bounds;
}

/** Latest `map-data-*` release tag, or null when unreachable/disabled.
 *
 * The catalog stamps the tag its asset URLs were published under, so the
 * mirrors stay usable even when the GitHub API is rate-limited or down. The API
 * is only consulted for catalogs published before `assetTag` existed. */
async function getLatestRoutingReleaseTag(): Promise<string | null> {
  if (cachedReleaseTag !== undefined) return cachedReleaseTag;

  const catalogTag = catalogAssetOrigins().tag;
  if (catalogTag) return (cachedReleaseTag = catalogTag);

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

/**
 * Origins for a routing tarball, in load-distributed order.
 *
 * The tarball is published as a release asset, so it lives beside the packs on
 * every mirror: GitHub Releases (primary) plus whatever `assetBaseUrls` the
 * catalog advertises (R2 / B2 / Internet Archive). Rotation and failure
 * cooldowns are shared with the pack downloader.
 *
 * Each tag is expanded across every base in turn, so the caller's tag order is
 * preserved: the pack's own release is tried before the catalog-wide one.
 */
function routingTarballSources(catalogId: string, tags: readonly string[]): string[] {
  const asset = `${catalogId}-routing.tar`;
  const githubBase = REGION_DATA_REPO
    ? `https://github.com/${REGION_DATA_REPO}/releases/download`
    : null;
  const bases = [githubBase, ...catalogAssetOrigins().baseUrls].filter(
    (base): base is string => !!base,
  );
  const urls: string[] = [];
  for (const tag of tags) {
    for (const base of bases) {
      urls.push(`${base.replace(/\/+$/, '')}/${tag}/${asset}`);
    }
  }
  return orderMirrorSources(buildSourceList(null, [...new Set(urls)]));
}

/**
 * Release tag a pack's own assets were stamped under (e.g. `map-data-2026-11-a`).
 *
 * Routing tarballs are published per release and the newest tag does not carry
 * every metro id — `us-ny-new-york-routing.tar` exists in `-a` and in the base
 * release, but not in `-c`…`-f`, where the same metro ships under its Geofabrik
 * id instead. Looking the graph up under the catalog-wide tag therefore 404s
 * for packs that are otherwise perfectly downloadable, which is why the pack's
 * own tag leads the candidate list.
 */
function packReleaseTag(region: Region): string | null {
  const urls = (region.assets ?? []).map((asset) => asset.url);
  if (region.geocodingUrl) urls.push(region.geocodingUrl);
  for (const url of urls) {
    const match = /\/releases\/download\/([^/]+)\//.exec(url ?? '');
    if (match) return match[1];
  }
  return null;
}

/**
 * Catalog entries worth downloading a graph for, best-covered first.
 *
 * Targets are ranked by how completely the pack covers each metro rather than
 * by raw bbox intersection: a pack whose bounds span most of the globe (island
 * nations across the date line) intersects dozens of metros it holds no data
 * for, and the old "smallest intersecting box" cap spent a 240 MB budget on
 * Jakarta, Nairobi and Singapore for a Kiribati download.
 */
function routingCatalogTargets(region: Region): CatalogEntry[] {
  return selectRoutingGraphTargets(REGION_CATALOG, region.bounds, {
    maxTargets: MAX_ROUTING_GRAPHS_PER_REGION,
    packId: region.id,
  });
}

/** Outcome of installing one graph: on disk after the attempt, or why not. */
export interface RoutingGraphInstallResult {
  ok: boolean;
  /** Present when `ok` is false. */
  reason?: string;
}

/**
 * Download and extract one catalog region's Valhalla graph. Returns whether the
 * graph is present afterwards. Best-effort: any failure is reported, never
 * thrown, so a routing fetch cannot fail the tile download that owns it.
 */
export async function downloadRoutingGraph(
  catalogId: string,
  onProgress?: (written: number, total: number, percent: number) => void,
  signal?: AbortSignal,
  /** Release tag the owning pack was published under; tried before the
   *  catalog-wide tag. */
  tagHint?: string | null,
): Promise<RoutingGraphInstallResult> {
  const dirUri = graphDirUri(catalogId);
  if (await exists(dirUri)) return { ok: true };

  const tags: string[] = [];
  if (tagHint) tags.push(tagHint);
  const catalogTag = await getLatestRoutingReleaseTag();
  if (catalogTag && !tags.includes(catalogTag)) tags.push(catalogTag);
  if (tags.length === 0) return { ok: false, reason: 'no release tag' };

  const tarUri = `${FileSystem.cacheDirectory}routing-${catalogId}.tar`;
  const tmpUri = `${sharedRootUri()}.tmp-${catalogId}/`;

  try {
    if (signal?.aborted) return { ok: false, reason: 'cancelled' };
    await FileSystem.deleteAsync(tarUri, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});

    await downloadResumable({
      destPath: tarUri,
      sources: routingTarballSources(catalogId, tags),
      signal,
      onSourceSettled: (source, outcome) => {
        if (outcome === 'success') recordMirrorSuccess(source);
        else recordMirrorFailure(source);
      },
      onProgress: (progress) => {
        const total = progress.totalBytes ?? 0;
        onProgress?.(
          progress.bytesWritten,
          total,
          total > 0 ? Math.round((progress.bytesWritten / total) * 100) : 0,
        );
      },
    });
    if (signal?.aborted) return { ok: false, reason: 'cancelled' };

    // Extract to a temp dir and move into place, so an interrupted extraction
    // never leaves a half-populated graph that later reads as installed.
    await FileSystem.makeDirectoryAsync(tmpUri, { intermediates: true });
    await extractTar(toNativePath(tarUri), toNativePath(tmpUri));
    await FileSystem.deleteAsync(dirUri, { idempotent: true }).catch(() => {});
    await FileSystem.moveAsync({ from: tmpUri, to: dirUri });

    // Record the bounds this graph was published under, so selection does not
    // depend on compiled-in catalog boxes that drift between releases.
    const bounds = await resolveGraphBounds(catalogId);
    if (bounds) {
      await writeGraphMeta(dirUri, {
        version: 1,
        id: catalogId,
        bounds,
        installedAt: Date.now(),
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: describeError(err) };
  } finally {
    await FileSystem.deleteAsync(tarUri, { idempotent: true }).catch(() => {});
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * Download the routing graphs covering a freshly downloaded region.
 *
 * Returns (and records) what was attempted and what landed, so the caller can
 * surface a failure instead of the routing tier degrading with no explanation.
 */
export async function downloadRoutingGraphsForRegion(
  region: Region,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<RoutingGraphInstallStatus> {
  const targets = routingCatalogTargets(region);
  const status: Omit<RoutingGraphInstallStatus, 'at'> = {
    regionId: region.id,
    requested: targets.map((entry) => entry.id),
    installed: [],
    failed: [],
    ...(targets.length > 0
      ? {}
      : {
          skipped: (isGlobishBounds(region.bounds)
            ? 'untrusted-pack-bounds'
            : 'no-metro-coverage') as 'untrusted-pack-bounds' | 'no-metro-coverage',
        }),
  };

  if (targets.length === 0 || signal?.aborted) {
    return recordRoutingGraphInstallStatus(status);
  }

  const totalBytes = targets.reduce((sum, entry) => sum + (entry.routingSizeBytes ?? 0), 0);
  let baseBytes = 0;
  // The pack's own tag is the one its routing tarballs were published under.
  const tagHint = packReleaseTag(region);

  onProgress?.({
    regionId: region.id,
    totalBytes,
    downloadedBytes: 0,
    percent: 0,
    stage: 'routing',
  });

  for (const entry of targets) {
    if (signal?.aborted) break;
    const base = baseBytes;
    const result = await downloadRoutingGraph(
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
      tagHint,
    );
    if (result.ok) status.installed.push(entry.id);
    else status.failed.push({ id: entry.id, reason: result.reason ?? 'unknown' });
    baseBytes = base + (entry.routingSizeBytes ?? 0);
  }

  onProgress?.({
    regionId: region.id,
    totalBytes,
    downloadedBytes: totalBytes,
    percent: 100,
    stage: 'routing',
  });

  return recordRoutingGraphInstallStatus(status);
}

/** Every routing graph currently on disk: shared store plus region packs. */
export async function listInstalledRoutingGraphs(): Promise<RoutingGraphCandidate[]> {
  const candidates: RoutingGraphCandidate[] = [];

  for (const entry of REGION_CATALOG) {
    const uri = graphDirUri(entry.id);
    if (!(await exists(uri))) continue;
    // Prefer the bounds recorded at install time, widened by the compiled-in
    // box so a graph installed by an older build still covers what it used to.
    const meta = await readGraphMeta(uri);
    candidates.push({
      id: `catalog:${entry.id}`,
      dir: toNativePath(uri),
      bounds: meta ? unionBounds(entry.bounds, meta.bounds) : entry.bounds,
    });
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
    const meta = await readGraphMeta(uri);
    const bounds = meta ? unionBounds(entry.bounds, meta.bounds) : entry.bounds;
    const stillNeeded = regions.some((region) => boundsIntersect(region.bounds, bounds));
    if (!stillNeeded) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
}
