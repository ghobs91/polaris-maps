import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  TRUSTED_REGION_PUBLISHERS,
  catalogRegions,
  checkManifest,
  mergeManifests,
  regionManifestPayload,
} from '../src/manifests.mjs';
import { BUNDLED_REGION_MANIFESTS } from '../src/bundledManifests.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8');

/**
 * The relay duplicates two things from the app on purpose: the trusted publisher
 * list and the bundled manifests. Both are parsed straight out of the TypeScript
 * sources here, because the failure mode is silent — a publisher added in the app
 * but not in the relay leaves the desktop unable to pin a region, and nothing on
 * either side would say so.
 */

test('the trusted publisher list matches src/constants/regionPublishers.ts', () => {
  const source = read('src/constants/regionPublishers.ts');
  const file = source.slice(0, source.indexOf('];'));
  const keys = [...file.matchAll(/'([0-9a-f]{64})'/g)].map((match) => match[1]);
  assert.deepEqual([...TRUSTED_REGION_PUBLISHERS].sort(), keys.sort());
});

test('the bundled manifests match src/constants/regionManifests.ts', () => {
  const source = read('src/constants/regionManifests.ts');
  for (const bundled of BUNDLED_REGION_MANIFESTS) {
    for (const field of ['regionId', 'driveKey', 'discoveryKey', 'contentHash', 'publisherPubkey']) {
      assert.ok(
        source.includes(String(bundled[field])),
        `${field} of ${bundled.regionId} is missing from the app's bundled manifests`,
      );
    }
    assert.ok(source.includes(String(bundled.signature)));
  }
});

test('the canonical payload matches the app field order', () => {
  const manifest = BUNDLED_REGION_MANIFESTS[0];
  assert.equal(
    regionManifestPayload(manifest),
    [
      'north-america-us-new-york',
      '1.0',
      '',
      'ae49c8f0526445ade476c5f73656113fab4f6146b0fef56ee766e5a632aee712',
      '2a48911feba8f912b4f209d73578e5b38bb3696b4f19c97a78dab251d4bce4c5',
      '0a2e533c677de34f07798ef39c0adae4621c6e8efea66cd578b8a06d29e71fd9',
      '194194043',
      '530601b0fd1879b525079aff4da67ac95315cd4ed6df36c9935b90ad6dcac8fb',
    ].join('\u0000'),
  );
});

test('the bundled pilot manifest verifies against its signature', () => {
  assert.deepEqual(checkManifest(BUNDLED_REGION_MANIFESTS[0]), { ok: true, reason: null });
});

test('a tampered manifest is refused with a reason', () => {
  const tampered = { ...BUNDLED_REGION_MANIFESTS[0], driveKey: 'ff'.repeat(32) };
  const check = checkManifest(tampered);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'signature does not verify');
});

test('an untrusted publisher is refused even with a valid signature', () => {
  const other = { ...BUNDLED_REGION_MANIFESTS[0], publisherPubkey: '11'.repeat(32) };
  assert.equal(checkManifest(other).reason, 'publisher is not trusted');
});

test('a manifest without a key is refused', () => {
  const { driveKey, ...rest } = BUNDLED_REGION_MANIFESTS[0];
  assert.equal(checkManifest(rest).reason, 'manifest has no canonical drive key');
});

const catalog = {
  assetTag: 'map-data-2026-11',
  regions: [
    {
      id: 'north-america-us-new-york',
      name: 'New York',
      version: 'map-data-2026-11',
      bounds: { minLat: 40.5, maxLat: 45, minLng: -79.8, maxLng: -71.8 },
      assets: [{ name: 'tiles.pmtiles', sizeBytes: 1000 }],
    },
    { id: 'fr-paris', name: 'Paris', version: 'map-data-2026-11', bounds: null, assets: [] },
  ],
};

test('every catalog region is listed, pinnable only where a manifest verifies', () => {
  const { manifests } = mergeManifests({ catalog });
  const regions = catalogRegions(catalog, manifests);

  assert.equal(regions.length, 2);
  const ny = regions.find((r) => r.regionId === 'north-america-us-new-york');
  assert.equal(ny.pinnable, true);
  assert.equal(ny.manifestSource, 'bundled');
  assert.deepEqual(ny.bounds, { minLat: 40.5, maxLat: 45, minLng: -79.8, maxLng: -71.8 });

  const paris = regions.find((r) => r.regionId === 'fr-paris');
  assert.equal(paris.pinnable, false);
  assert.match(paris.reason, /no signed manifest/);
  // Size still comes from the assets, so the row is useful even when unpinnable.
  assert.equal(regions.every((r) => typeof r.bytes === 'number'), true);
});

test('the newest verified manifest wins for a region', async () => {
  // Signed properly rather than mutated: changing the version of a real manifest
  // would invalidate its signature, which is the point of the next test.
  const { schnorr } = await import('@noble/curves/secp256k1');
  const { sha256 } = await import('@noble/hashes/sha256');

  const privateKey = new Uint8Array(32).fill(0x5a);
  const publisherPubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');

  const sign = (version) => {
    const core = {
      regionId: 'fr-paris',
      version,
      overtureRelease: null,
      driveKey: 'ab'.repeat(32),
      discoveryKey: 'cd'.repeat(32),
      contentHash: 'ef'.repeat(32),
      bytes: 1000,
      publisherPubkey,
    };
    const digest = sha256(new TextEncoder().encode(regionManifestPayload(core)));
    return { ...core, signature: Buffer.from(schnorr.sign(digest, privateKey)).toString('hex') };
  };

  const { manifests } = mergeManifests({
    catalog,
    gossiped: [sign('1.0'), sign('9.9')],
    trusted: [publisherPubkey],
  });

  assert.equal(manifests.get('fr-paris').manifest.version, '9.9');
  assert.equal(manifests.get('fr-paris').source, 'gossip');
});

test('an unverifiable gossiped manifest is refused and reported', () => {
  const forged = { ...BUNDLED_REGION_MANIFESTS[0], driveKey: 'ab'.repeat(32) };
  const { manifests, problems } = mergeManifests({ catalog, gossiped: [forged] });
  // The bundled entry still wins; the forgery is recorded, not merged.
  assert.equal(manifests.get('north-america-us-new-york').source, 'bundled');
  assert.equal(problems[0].source, 'gossip');
  assert.match(problems[0].reason, /signature/);
});
