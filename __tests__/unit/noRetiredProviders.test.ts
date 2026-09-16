import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Data-source policy guard: retired paid providers (HERE, Esri World Imagery,
 * MapKit JS embed / Apple Maps Server API) must not appear in runtime source,
 * config, or environment templates. TomTom is permitted only as the bounded
 * cold-start bridge, and on-device website photo scraping is intentional.
 */
const RETIRED_MARKERS = [
  'hereapi.com',
  'HERE_FLOW',
  'hereApiKey',
  'EXPO_PUBLIC_HERE_API_KEY',
  'arcgisonline',
  'World_Imagery',
  'mapkitJsEmbedToken',
  'mapkitPlaceDetailUrl',
  'appleMapkitToken',
  'EXPO_PUBLIC_APPLE_MAPKIT_TOKEN',
  'EXPO_PUBLIC_APPLE_MAPKITJS_EMBED_TOKEN',
  'EXPO_PUBLIC_MAPKIT_PLACE_DETAIL_URL',
  'placeDetailEmbed',
  'PlaceDetailEmbed',
  'generate-mapkit-token',
];

const ROOTS = ['src', 'app', 'backend'];
const ROOT_FILES = ['.env.example'];

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collectFiles(path));
    else if (/\.(ts|tsx|mjs|js|json)$/.test(entry)) out.push(path);
  }
  return out;
}

describe('no retired paid data sources in runtime code', () => {
  const repoRoot = join(__dirname, '../..');
  const files = [
    ...ROOTS.flatMap((root) => collectFiles(join(repoRoot, root))),
    ...ROOT_FILES.map((file) => join(repoRoot, file)),
  ];

  it('scans a non-trivial set of runtime files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const marker of RETIRED_MARKERS) {
    it(`does not reference "${marker}"`, () => {
      const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(marker));
      expect(offenders).toEqual([]);
    });
  }
});
