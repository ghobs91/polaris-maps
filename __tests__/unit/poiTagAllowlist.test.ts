/**
 * Tag-allowlist drift guard.
 *
 * `scripts/poi-tags.json` decides which OSM tags a pack keeps in
 * `osm_pois.tags_json`. Everything else is dropped at build time — on a dense
 * metro the full tag maps were 87% of the search index's payload, mostly
 * `surface`/`check_date`/`source`/`wikimedia_commons` that the app never reads.
 *
 * The failure mode is silent: a trimmed key that some screen reads does not
 * throw, it renders an empty field. So this test reads the app's own source,
 * collects every tag key it accesses by literal name, and fails if the pack
 * would not ship it.
 *
 * Keys read through a variable (e.g. `Object.entries(paymentMap)` in
 * `parsePayment`, or the `NAME_KEYS`/`PRIMARY_KEYS` arrays in `osmMatchScorer`)
 * cannot be seen by a source scan. Those namespaces are therefore kept whole
 * via `prefixes` rather than by member, which is why `payment:*`, `diet:*` and
 * friends appear as families in the config.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface TagsFile {
  exact: string[];
  prefixes: string[];
}

const TAGS: TagsFile = JSON.parse(
  readFileSync(resolve(__dirname, '../../scripts/poi-tags.json'), 'utf8'),
);

const SHAPES: { anyValueKeys: string[]; namedOptionalPairs: Array<[string, string]> } = JSON.parse(
  readFileSync(resolve(__dirname, '../../scripts/poi-index-shapes.json'), 'utf8'),
);

const SRC = resolve(__dirname, '../../src');

/** Every `.ts`/`.tsx` file under src/. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Tag keys the app reads by literal name: `tags['addr:street']`. */
function literalTagKeys(): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  const pattern = /\.tags\[['"]([^'"]+)['"]\]/g;
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const key = match[1]!;
      const files = keys.get(key) ?? [];
      if (!files.includes(file)) files.push(file);
      keys.set(key, files);
    }
  }
  return keys;
}

function keptByPack(key: string): boolean {
  if (TAGS.exact.includes(key)) return true;
  return TAGS.prefixes.some((prefix) => key.startsWith(prefix));
}

describe('poi-tags.json', () => {
  it('ships every tag key the app reads by literal name', () => {
    const missing: string[] = [];
    for (const [key, files] of literalTagKeys()) {
      if (keptByPack(key)) continue;
      const relative = files.map((file) => file.replace(`${SRC}/`, '')).join(', ');
      missing.push(`${key} (read in ${relative})`);
    }
    expect(missing).toEqual([]);
  });

  it('finds tag reads at all, so the scan above cannot pass vacuously', () => {
    // If this drops to zero the regex broke, not the codebase.
    expect(literalTagKeys().size).toBeGreaterThan(10);
  });

  it('ships the primary keys the index is built from', () => {
    // `buildLocalPoiQuery` resolves a key filter from the `primary_key` column,
    // but `query.tags` filters and shard verification read the tag map itself.
    const shapeKeys = new Set<string>(SHAPES.anyValueKeys);
    for (const [key] of SHAPES.namedOptionalPairs) shapeKeys.add(key);
    const missing = [...shapeKeys].filter((key) => !keptByPack(key));
    expect(missing).toEqual([]);
  });

  it('ships cuisine, which is the only tag filter category search adds', () => {
    // `fetchOsmPoisByTags(..., [['cuisine', hint]])` → `json_extract(tags_json)`.
    expect(keptByPack('cuisine')).toBe(true);
  });

  it('has no duplicate or empty entries', () => {
    expect(TAGS.exact).toHaveLength(new Set(TAGS.exact).size);
    expect(TAGS.exact.every((key) => key.length > 0)).toBe(true);
    expect(TAGS.prefixes.every((prefix) => prefix.length > 1 && prefix.endsWith(':'))).toBe(true);
    expect(TAGS.prefixes).toHaveLength(new Set(TAGS.prefixes).size);
  });

  it('keeps namespaces the app reads through a variable', () => {
    // These are the families the source scan cannot see. Losing one silently
    // empties a POI card section rather than failing.
    for (const prefix of ['payment:', 'diet:', 'addr:', 'contact:']) {
      expect(TAGS.prefixes).toContain(prefix);
    }
  });
});
