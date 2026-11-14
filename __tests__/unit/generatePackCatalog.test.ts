/**
 * The generated pack catalog must be seedable by the app.
 *
 * Two data bugs shipped from this generator and were invisible to every other
 * test, because the unit-test fixtures were written to match the TypeScript
 * types rather than the producer's real output:
 *
 *  - no per-region `version`, and `regions.version` is NOT NULL, so seeding
 *    threw on the first row and seeded *nothing*;
 *  - no `bounds` for the 324 generated regions (only `bbox`), and bounds are
 *    NOT NULL too, so those regions could not be stored either.
 *
 * Either one leaves the install with no pack-backed region, which surfaces as
 * "auto-download skipped: no-region" and no packs on the regions screen.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const GENERATOR = resolve(ROOT, 'scripts/generate-pack-catalog.mjs');
const REGIONS = resolve(ROOT, 'scripts/regions.json');

interface Entry {
  id: string;
  name: string;
  bbox?: string;
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

const entries: Entry[] = JSON.parse(readFileSync(REGIONS, 'utf8')).include;

describe('generated pack catalog', () => {
  it('is in sync with the Geofabrik tree', () => {
    // --check compares whole entries, not just ids, so a field the generator
    // stops emitting fails here instead of reaching a release.
    expect(() =>
      execFileSync(process.execPath, [GENERATOR, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('gives every region the bounds the app stores', () => {
    const missing = entries.filter((entry) => !entry.bounds);
    expect(missing.map((entry) => entry.id)).toEqual([]);
  });

  it('derives bounds from the region bbox', () => {
    const algeria = entries.find((entry) => entry.id === 'africa-algeria');
    expect(algeria?.bbox).toBe('-8.7,19,12,37.2');
    expect(algeria?.bounds).toEqual({ minLat: 19, maxLat: 37.2, minLng: -8.7, maxLng: 12 });
  });

  it('has unique ids, since each one becomes a CI job and an asset prefix', () => {
    const ids = entries.map((entry) => entry.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it('keeps the curated metros out of the generated set', () => {
    // Curated ids are not tree paths, so a metro and the state containing it
    // can coexist; the metro wins on smallest-area lookup.
    expect(entries.some((entry) => entry.id === 'us-ny-new-york')).toBe(true);
    expect(entries.some((entry) => entry.id === 'north-america-us-new-york')).toBe(true);
  });

  it('leaves the whole-country leaves on the tile path', () => {
    for (const id of ['asia-china', 'south-america-brazil', 'oceania-australia']) {
      expect(entries.some((entry) => entry.id === id)).toBe(false);
    }
  });
});
