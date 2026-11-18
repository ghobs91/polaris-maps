import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { schnorr } from '@noble/curves/secp256k1';

import {
  buildManifestCore,
  manifestGossipPath,
  signManifest,
  verifyOwnManifest,
} from '../src/publisher.mjs';
import { checkManifest } from '../src/manifests.mjs';
import { fetchPack, packAssets } from '../src/fetchPack.mjs';

const relayPrivate = new Uint8Array(32).fill(0x42);
const relayPubkey = Buffer.from(schnorr.getPublicKey(relayPrivate)).toString('hex');

function core(overrides = {}) {
  return buildManifestCore({
    regionId: 'europe-spain-melilla',
    version: 'map-data-2026-11',
    driveKey: 'ab'.repeat(32),
    discoveryKey: 'cd'.repeat(32),
    contentHash: 'ef'.repeat(32),
    bytes: 125131,
    publisherPubkey: relayPubkey,
    ...overrides,
  });
}

test('a signed manifest verifies against the relay key', async () => {
  const manifest = await signManifest(core(), relayPrivate);
  assert.deepEqual(checkManifest(manifest, [relayPubkey]), { ok: true, reason: null });
  assert.deepEqual(verifyOwnManifest(manifest, [relayPubkey]), { ok: true, reason: null });
});

test('a manifest signed by the relay is not trusted by the shipped allowlist alone', async () => {
  // This is the point of pairing: a relay's own key is by definition not compiled in.
  const manifest = await signManifest(core(), relayPrivate);
  assert.equal(checkManifest(manifest).reason, 'publisher is not trusted');
});

test('tampering with the signed key invalidates the manifest', async () => {
  const manifest = await signManifest(core(), relayPrivate);
  const tampered = { ...manifest, driveKey: 'ff'.repeat(32) };
  assert.equal(checkManifest(tampered, [relayPubkey]).ok, false);
});

test('the gossip path matches what the app reads', async () => {
  const manifest = await signManifest(core(), relayPrivate);
  assert.deepEqual(manifestGossipPath(manifest), [
    'polaris',
    'region-manifests',
    'europe-spain-melilla',
    relayPubkey,
  ]);
});

// ── fetchPack ───────────────────────────────────────────────────────

const region = {
  id: 'europe-spain-melilla',
  assets: [
    {
      name: 'tiles.pmtiles',
      url: 'https://example.invalid/tiles.pmtiles',
      md5: 'aaa',
      sizeBytes: 3,
    },
    {
      name: 'search.sqlite',
      url: 'https://example.invalid/search.sqlite',
      md5: 'bbb',
      sizeBytes: 3,
    },
  ],
};

function fakeFetch(bodies) {
  let calls = 0;
  const impl = async (url) => {
    calls += 1;
    const name = String(url).split('/').pop();
    const body = bodies[name];
    if (body == null) return { ok: false, status: 404, body: null };
    return {
      ok: true,
      status: 200,
      body: (async function* () {
        for (const chunk of body) yield Buffer.from(chunk);
      })(),
    };
  };
  return { impl, calls: () => calls };
}

test('packAssets keeps only downloadable assets', () => {
  const assets = packAssets({ assets: [...region.assets, { name: 'no-url' }] });
  assert.deepEqual(
    assets.map((asset) => asset.name),
    ['tiles.pmtiles', 'search.sqlite'],
  );
});

test('a verified pack is written to disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fetch-'));
  // md5 of "abc" is 900150983cd24fb0d6963f7d28e17f72
  const md5 = '900150983cd24fb0d6963f7d28e17f72';
  const { impl } = fakeFetch({
    'tiles.pmtiles': ['ab', 'c'],
    'search.sqlite': ['abc'],
  });
  const result = await fetchPack({
    region: { ...region, assets: region.assets.map((a) => ({ ...a, md5 })) },
    destDir: dir,
    fetchImpl: impl,
  });
  assert.equal(result.error, null);
  assert.equal(result.files.length, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'tiles.pmtiles'), 'utf8'), 'abc');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a pack whose bytes do not match the catalog is refused, not authored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fetch-'));
  const { impl } = fakeFetch({ 'tiles.pmtiles': ['wrong'], 'search.sqlite': ['wrong'] });
  const result = await fetchPack({ region, destDir: dir, fetchImpl: impl });
  assert.match(result.error ?? '', /failed its md5 check/);
  // The bad bytes must not be left behind to be authored later.
  assert.equal(fs.existsSync(path.join(dir, 'tiles.pmtiles')), false);
  assert.equal(fs.existsSync(path.join(dir, 'tiles.pmtiles.part')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an already-verified file is not downloaded again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fetch-'));
  const md5 = '900150983cd24fb0d6963f7d28e17f72'; // "abc"
  const assets = [
    { name: 'tiles.pmtiles', url: 'https://example.invalid/tiles.pmtiles', md5, sizeBytes: 3 },
  ];
  fakeFetch({ 'tiles.pmtiles': ['abc'] });
  await fetchPack({
    region: { ...region, assets },
    destDir: dir,
    fetchImpl: fakeFetch({ 'tiles.pmtiles': ['abc'] }).impl,
  });

  const second = fakeFetch({ 'tiles.pmtiles': ['abc'] });
  const result = await fetchPack({
    region: { ...region, assets },
    destDir: dir,
    fetchImpl: second.impl,
  });
  assert.equal(result.error, null);
  assert.equal(second.calls(), 0, 'the verified file should be reused');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing asset fails the fetch instead of authoring a partial pack', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fetch-'));
  const md5 = '900150983cd24fb0d6963f7d28e17f72'; // "abc"
  // First asset downloads fine; the second is missing from the origin.
  const { impl } = fakeFetch({ 'tiles.pmtiles': ['abc'] });
  const result = await fetchPack({
    region: {
      ...region,
      assets: [
        { name: 'tiles.pmtiles', url: 'https://example.invalid/tiles.pmtiles', md5, sizeBytes: 3 },
        { name: 'search.sqlite', url: 'https://example.invalid/search.sqlite', md5, sizeBytes: 3 },
      ],
    },
    destDir: dir,
    fetchImpl: impl,
  });
  assert.match(result.error ?? '', /HTTP 404/);
  fs.rmSync(dir, { recursive: true, force: true });
});
