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

/** A Geofabrik-shaped index with `parent` links, as index-v1.json has. */
function writeIndex(features: Array<{ id: string; parent?: string; name?: string }>): string {
  const path = join(dir, 'index.json');
  writeFileSync(
    path,
    JSON.stringify({
      features: features.map((f) => ({
        properties: { ...f, urls: { pbf: `https://download.geofabrik.de/x/${f.id}.osm.pbf` } },
      })),
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
    // Nested regions need the whole parent chain walked — `alsace`'s parent is
    // `france`, not `europe`, so a one-level join produces `france/alsace` and
    // every nested region looks unpublished.
    const catalog = writeCatalog([
      ['africa-algeria', 'africa/algeria'],
      ['europe-france-alsace', 'europe/france/alsace'],
    ]);
    expect(run(index, catalog).code).toBe(0);
  });

  it('fails on the real regressions this was written for', () => {
    const index = writeIndex([
      { id: 'africa' },
      { id: 'algeria', parent: 'africa' },
      { id: 'congo-democratic-republic', parent: 'africa' },
    ]);
    const catalog = writeCatalog([
      ['africa-comoros', 'africa/comoros'],
      ['africa-congo-kinshasa', 'africa/congo-kinshasa'],
      ['africa-algeria', 'africa/algeria'],
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
    const result = run(index, writeCatalog([['africa-congo-kinshasa', 'africa/congo-kinshasa']]));
    expect(result.err).toMatch(/africa-congo-kinshasa → africa\/congo-kinshasa/);
  });
});

describe('the committed catalog', () => {
  it('resolves against the live index', () => {
    // Network-dependent on purpose: this is the check that would have caught
    // the bad paths, and a fixture cannot go stale the way Geofabrik's index
    // does. Skipped automatically when offline.
    let offline = false;
    try {
      execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe', timeout: 60_000 });
    } catch (error) {
      const e = error as { stdout?: Buffer; stderr?: Buffer; status?: number };
      offline = /fetch failed|ENOTFOUND|EAI_AGAIN|network/i.test(
        `${e.stderr?.toString() ?? ''}${e.stdout?.toString() ?? ''}`,
      );
      if (!offline) throw error;
    }
    if (offline) expect(true).toBe(true);
  });
});
