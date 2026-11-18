/**
 * Signed region manifests, on the relay side.
 *
 * A relay may only seed a pack it can name by canonical key, and the only
 * trustworthy source for that key is a manifest signed by a trusted publisher — the
 * same rule the app applies. This module mirrors
 * `src/services/regions/regionManifest.ts` and `src/constants/regionPublishers.ts`
 * so the desktop can turn "the region I live in" into a pinnable entry without a
 * human copying 64 hex characters from a phone.
 *
 * Two things are duplicated on purpose and pinned by tests:
 *
 *   - **The signed payload.** Field order is the wire contract; a one-character
 *     divergence would make every real manifest fail to verify here while working
 *     in the app, which would look like "the relay cannot see any regions".
 *   - **The trusted publisher list.** Adding a publisher in the app must not
 *     silently leave the relay trusting nobody.
 *
 * `relay/test/manifests.test.mjs` parses the TypeScript constants and fails if
 * either drifts.
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { BUNDLED_REGION_MANIFESTS } from './bundledManifests.mjs';

/**
 * Publishers whose manifests the relay trusts. MUST stay identical to
 * `TRUSTED_REGION_PUBLISHERS` in `src/constants/regionPublishers.ts`.
 */
export const TRUSTED_REGION_PUBLISHERS = Object.freeze([
  // Publisher app-identity public key (pilot device).
  '530601b0fd1879b525079aff4da67ac95315cd4ed6df36c9935b90ad6dcac8fb',
]);

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Canonical payload a manifest signature covers.
 *
 * Byte-identical to `regionManifestPayload` in the app: `createSigningPayload`
 * joins each field with `\0`, in this order.
 */
export function regionManifestPayload(core) {
  return [
    core.regionId,
    core.version,
    core.overtureRelease ?? '',
    core.driveKey,
    core.discoveryKey,
    core.contentHash,
    core.bytes,
    core.publisherPubkey,
  ]
    .map(String)
    .join('\u0000');
}

export function isTrustedPublisher(pubkey, trusted = TRUSTED_REGION_PUBLISHERS) {
  const normalized = String(pubkey ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return trusted.some((key) => key.trim().toLowerCase() === normalized);
}

/**
 * Verify a manifest: shape, trusted publisher, then signature.
 *
 * Returns a reason rather than a boolean so the picker can say *why* a region is
 * not pinnable ("publisher not trusted" is actionable; "no" is not).
 */
export function checkManifest(manifest, trusted = TRUSTED_REGION_PUBLISHERS) {
  if (!manifest || typeof manifest !== 'object') return { ok: false, reason: 'no manifest' };
  if (!manifest.regionId) return { ok: false, reason: 'manifest has no region id' };
  if (!/^[0-9a-f]{64}$/i.test(String(manifest.driveKey ?? ''))) {
    return { ok: false, reason: 'manifest has no canonical drive key' };
  }
  if (!manifest.publisherPubkey || !manifest.signature) {
    return { ok: false, reason: 'manifest is unsigned' };
  }
  if (!isTrustedPublisher(manifest.publisherPubkey, trusted)) {
    return { ok: false, reason: 'publisher is not trusted' };
  }
  try {
    const digest = sha256(new TextEncoder().encode(regionManifestPayload(manifest)));
    const valid = schnorr.verify(
      hexToBytes(String(manifest.signature)),
      digest,
      String(manifest.publisherPubkey).toLowerCase(),
    );
    return valid ? { ok: true, reason: null } : { ok: false, reason: 'signature does not verify' };
  } catch {
    return { ok: false, reason: 'signature does not verify' };
  }
}

/** Every manifest a catalog carries, as `{ manifest, regionName }`. */
function collectManifests(catalog) {
  const found = [];
  for (const manifest of Array.isArray(catalog?.manifests) ? catalog.manifests : []) {
    found.push({ manifest, regionName: null });
  }
  for (const region of Array.isArray(catalog?.regions) ? catalog.regions : []) {
    if (!region || typeof region !== 'object') continue;
    if (region.manifest && typeof region.manifest === 'object') {
      found.push({ manifest: region.manifest, regionName: region.name ?? null });
    }
  }
  return found;
}

/**
 * Regions the relay can pin, from a catalog.
 *
 * Bundled-style entries are *not* special-cased here: on the desktop there is no
 * compiled-in trust root beyond the publisher list, so a region is pinnable only
 * if its manifest verifies. Rejected regions carry a reason so the picker can show
 * "advertised but not trusted" instead of hiding them.
 *
 * @param {object} catalog parsed `catalog.json`
 * @param {{ trusted?: readonly string[] }} [options]
 * @returns {{ pinnable: Array<{ regionId: string, name: string, version: string,
 *   driveKey: string, bytes: number, bounds: { minLat: number, maxLat: number,
 *   minLng: number, maxLng: number } | null }>, rejected: Array<{ regionId: string, reason: string }> }}
 */
export function pinnableRegions(catalog, { trusted = TRUSTED_REGION_PUBLISHERS } = {}) {
  const names = new Map();
  const boundsById = new Map();
  for (const region of Array.isArray(catalog?.regions) ? catalog.regions : []) {
    if (!region?.id) continue;
    names.set(String(region.id), String(region.name ?? region.id));
    const bounds = region.bounds;
    if (
      bounds &&
      [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng].every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
    ) {
      boundsById.set(String(region.id), {
        minLat: bounds.minLat,
        maxLat: bounds.maxLat,
        minLng: bounds.minLng,
        maxLng: bounds.maxLng,
      });
    }
  }

  /** @type {Map<string, { regionId: string, name: string, version: string, driveKey: string, bytes: number }>} */
  const pinnable = new Map();
  /** @type {Map<string, string>} */
  const rejected = new Map();

  for (const { manifest, regionName } of collectManifests(catalog)) {
    const regionId = String(manifest?.regionId ?? '');
    if (!regionId) continue;

    const check = checkManifest(manifest, trusted);
    if (!check.ok) {
      // Keep the first reason, and never let a bad manifest shadow a good one.
      if (!pinnable.has(regionId)) rejected.set(regionId, check.reason);
      continue;
    }

    const bounds = boundsById.get(regionId) ?? null;
    pinnable.set(regionId, {
      regionId,
      name: names.get(regionId) ?? regionName ?? regionId,
      version: String(manifest.version ?? 'unknown'),
      driveKey: String(manifest.driveKey).toLowerCase(),
      bytes: Number(manifest.bytes) || 0,
      // Carried through so the desktop can show a map instead of a text field.
      bounds,
    });
    rejected.delete(regionId);
  }

  return {
    pinnable: [...pinnable.values()].sort((a, b) => a.name.localeCompare(b.name)),
    rejected: [...rejected.entries()].map(([regionId, reason]) => ({ regionId, reason })),
  };
}

/**
 * Merge manifests from every source into one lookup per region.
 *
 * Sources, in the order the app also uses:
 *
 *   1. **Gossip** (`polaris/region-manifests`) — signed manifests published by
 *      devices that hold the pack. This is the only source that grows as packs are
 *      published.
 *   2. **Catalog** — a `manifest` on a region entry or in the root `manifests` array.
 *      Published catalogs currently carry none, so this is usually empty.
 *   3. **Bundled** — the pilot entries compiled into the app, and here.
 *
 * A newer verified `version` wins over an older one for the same region; a
 * *bundled* entry is kept even if its signature fails (it is the compiled-in root
 * of trust, matching the app) but the failure is reported so it cannot pass
 * unnoticed.
 *
 * @param {{ catalog?: object, gossiped?: object[], trusted?: readonly string[] }} input
 * @returns {{ manifests: Map<string, { manifest: object, source: string, verified: boolean }>,
 *   problems: Array<{ regionId: string, source: string, reason: string }> }}
 */
export function mergeManifests({
  catalog = null,
  gossiped = [],
  trusted = TRUSTED_REGION_PUBLISHERS,
} = {}) {
  /** @type {Map<string, { manifest: object, source: string, verified: boolean }>} */
  const manifests = new Map();
  const problems = [];

  const consider = (manifest, source) => {
    if (!manifest || typeof manifest !== 'object' || !manifest.regionId) return;
    const regionId = String(manifest.regionId);
    const check = checkManifest(manifest, trusted);

    if (!check.ok) {
      if (source === 'bundled') {
        // Compiled-in root of trust: keep it, but say the signature failed.
        problems.push({ regionId, source, reason: check.reason });
        manifests.set(regionId, { manifest, source, verified: false });
      } else {
        problems.push({ regionId, source, reason: check.reason });
      }
      return;
    }

    const existing = manifests.get(regionId);
    const existingVersion = String(existing?.manifest?.version ?? '');
    const candidateVersion = String(manifest.version ?? '');
    if (existing && existingVersion >= candidateVersion) return;
    manifests.set(regionId, { manifest, source, verified: true });
  };

  for (const manifest of gossiped) consider(manifest, 'gossip');
  for (const { manifest } of collectManifests(catalog)) consider(manifest, 'catalog');
  for (const manifest of BUNDLED_REGION_MANIFESTS) consider(manifest, 'bundled');

  return { manifests, problems };
}

/**
 * The region list the desktop's catalog browser renders.
 *
 * Every region in the catalog appears, so the map shows the whole world rather than
 * only what happens to be pinnable today. `pinnable` is true only when a verified
 * manifest gives a canonical key, and `reason` says what is missing otherwise —
 * "advertised but no manifest published yet" is a different problem from "signature
 * does not verify", and both are different from "not in the catalog at all".
 *
 * @param {object | null} catalog
 * @param {Map<string, { manifest: object, source: string, verified: boolean }>} manifests
 * @param {{ pinnedIds?: Set<string> }} [options]
 */
export function catalogRegions(catalog, manifests, { pinnedIds = new Set() } = {}) {
  const entries = Array.isArray(catalog?.regions) ? catalog.regions : [];

  return entries
    .filter((entry) => entry && typeof entry.id === 'string')
    .map((entry) => {
      const found = manifests.get(entry.id);
      const manifest = found?.manifest ?? null;
      const check = manifest
        ? checkManifest(manifest)
        : { ok: false, reason: 'no signed manifest published' };
      const pinnable = Boolean(found) && check.ok;

      const assetBytes = (Array.isArray(entry.assets) ? entry.assets : []).reduce(
        (sum, asset) => sum + (Number(asset?.sizeBytes ?? asset?.size) || 0),
        0,
      );

      const bounds =
        entry.bounds &&
        [entry.bounds.minLat, entry.bounds.maxLat, entry.bounds.minLng, entry.bounds.maxLng].every(
          (value) => typeof value === 'number' && Number.isFinite(value),
        )
          ? {
              minLat: entry.bounds.minLat,
              maxLat: entry.bounds.maxLat,
              minLng: entry.bounds.minLng,
              maxLng: entry.bounds.maxLng,
            }
          : null;

      return {
        regionId: entry.id,
        name: String(entry.name ?? entry.id),
        version: String(manifest?.version ?? entry.version ?? 'unknown'),
        bytes: Number(manifest?.bytes) || assetBytes,
        bounds,
        pinned: pinnedIds.has(entry.id),
        pinnable,
        // Proof of where the key came from, shown in the UI: "bundled", "gossip",
        // "catalog", or null when there is no key at all.
        manifestSource: pinnable ? (found?.source ?? null) : null,
        reason: pinnable ? null : (check.reason ?? 'no signed manifest published'),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
