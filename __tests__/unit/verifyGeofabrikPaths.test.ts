/**
 * Geofabrik path verification.
 *
 * Two CI runs were lost to catalog regions whose extract does not exist:
 * `africa/congo-kinshasa` (Geofabrik publishes `africa/congo-democratic-
 * republic`) and leaves for countries it does not publish at all. Each failed
 * its download step minutes in, and the run reported only "failed" without
 * saying which of ~200 regions was at fault. This gate runs in the setup job,
 * in seconds, before any build job is spawned.
 *
 * Exercised through the CLI with `--index`, because the script is ESM.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/verify-geofabrik-paths.mjs');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'geofabrik-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A catalog in regions.json's shape: real ids, explicit Geofabrik paths. */
function writeCatalog(regions: Array<[id: string, geofabrikPath: string]>): string {
  const path = join(dir, 'catalog.json');
  writeFileSync(
    path,
    JSON.stringify({
      include: regions.map(([id, geofabrikPath]) => ({
        id,
        name: id,
        geofabrik: `https://download.geofabrik.de/${geofabrikPath}-latest.osm.pbf`,
        bbox: '0,0,1,1',
      })),
    }),
  );
  return path;
}

/**
 * A Geofabrik-shaped index with `parent` links, as index-v1.json has.
 *
 * Each feature's `urls.pbf` is the real published form — an extract lives in a
 * directory named after it (`europe/france/alsace/alsace-latest.osm.pbf`) —
 * because that URL is what the check compares against.
 */
function writeIndex(features: Array<{ id: string; parent?: string; name?: string }>): string {
  const byId = new Map(features.map((f) => [f.id, f]));
  const chainOf = (feature: { id: string; parent?: string }): string[] => {
    const parent = feature.parent ? byId.get(feature.parent) : undefined;
    return parent ? [...chainOf(parent), feature.id] : [feature.id];
  };
  const path = join(dir, 'index.json');
  writeFileSync(
    path,
    JSON.stringify({
      features: features.map((f) => {
        const chain = chainOf(f);
        const leaf = chain[chain.length - 1];
        return {
          properties: {
            ...f,
            urls: {
              pbf: `https://download.geofabrik.de/${[...chain, leaf].join('/')}-latest.osm.pbf`,
            },
          },
        };
      }),
    }),
  );
  return path;
}

function run(indexPath: string, catalogPath: string): { code: number; err: string } {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--index', indexPath, '--catalog', catalogPath],
    { encoding: 'utf8' },
  );
  return { code: result.status ?? 1, err: result.stderr ?? '' };
}

describe('verify-geofabrik-paths', () => {
  it('accepts a catalog whose regions are all published', () => {
    const index = writeIndex([
      { id: 'africa' },
      { id: 'algeria', parent: 'africa' },
      { id: 'europe' },
      { id: 'france', parent: 'europe' },
      { id: 'alsace', parent: 'france' },
    ]);
    // Nested regions need the whole parent chain, not a one-level join: a
    // catalogue entry for `alsace` whose path said `france/alsace` would omit
    // the continent.
    const catalog = writeCatalog([
      ['africa-algeria', 'africa/algeria/algeria'],
      ['europe-france-alsace', 'europe/france/alsace/alsace'],
    ]);
    expect(run(index, catalog).code).toBe(0);
  });

  it('flags a flat URL whose directory is published but whose file is not', () => {
    // Geofabrik moved extracts into a directory named after them. The legacy
    // flat URL still redirects for continent-level files, but for a nested one
    // it drops the continent and 404s — 138 catalog entries were dead this way
    // while a directory-only check kept reporting them as fine.
    const index = writeIndex([
      { id: 'europe' },
      { id: 'france', parent: 'europe' },
      { id: 'alsace', parent: 'france' },
    ]);
    const result = run(index, writeCatalog([['europe-france-alsace', 'europe/france/alsace']]));
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/europe-france-alsace → europe\/france\/alsace\n/);
  });

  it('fails on the real regressions this was written for', () => {
    const index = writeIndex([
      { id: 'africa' },
      { id: 'algeria', parent: 'africa' },
      { id: 'congo-democratic-republic', parent: 'africa' },
    ]);
    const catalog = writeCatalog([
      ['africa-comoros', 'africa/comoros/comoros'],
      ['africa-congo-kinshasa', 'africa/congo-kinshasa/congo-kinshasa'],
      ['africa-algeria', 'africa/algeria/algeria'],
    ]);
    const result = run(index, catalog);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/not published by Geofabrik/);
    expect(result.err).toMatch(/africa-comoros/);
    expect(result.err).toMatch(/africa-congo-kinshasa/);
    // The published one is not flagged.
    expect(result.err).not.toMatch(/africa-algeria/);
  });

  it('names the path it checked, so the fix is obvious', () => {
    const index = writeIndex([{ id: 'africa' }]);
    const result = run(
      index,
      writeCatalog([['africa-congo-kinshasa', 'africa/congo-kinshasa/congo-kinshasa']]),
    );
    expect(result.err).toMatch(/africa-congo-kinshasa → africa\/congo-kinshasa\/congo-kinshasa/);
  });
});

describe('the committed catalog', () => {
  it('resolves against the live index', () => {
    // Network-dependent on purpose: this is the check that would have caught
    // the bad paths, and a fixture cannot go stale the way Geofabrik's index
    // does (it renamed 53 ids and moved every extract into its own directory).
    let status: number | null = 0;
    let stderr = '';
    let killed = false;
    try {
      execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe', timeout: 180_000 });
    } catch (error) {
      // Never rethrow the exec error: it carries circular references that
      // jest-worker cannot serialise, so the run dies as "Test suite failed to
      // run" and buries whatever Geofabrik actually said.
      const e = error as { status?: number | null; stderr?: Buffer; signal?: string };
      status = e.status ?? null;
      stderr = e.stderr?.toString() ?? '';
      killed = e.signal != null;
    }

    if (status === 0) return;

    // Exit 2 is "the index could not be read", and a killed child is the same
    // situation from the other side: a 3.4 MB CDN fetch that throttles bursts.
    // Skipping out loud beats reporting a data verdict the check never reached.
    if (
      status === 2 ||
      killed ||
      /fetch failed|ENOTFOUND|EAI_AGAIN|network|timed out/i.test(stderr)
    ) {
      console.warn(`skipped: Geofabrik index unavailable\n${stderr.trim()}`);
      return;
    }

    throw new Error(`the committed catalog does not resolve against the live index:\n${stderr}`);
  });
});
