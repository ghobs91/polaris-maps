/**
 * Downloading a region's pack assets from the catalog.
 *
 * The catalog publishes per-asset URLs *and md5s*, so the relay can fetch a pack
 * and prove it got the bytes the catalog described before it authors anything from
 * them. Authoring a canonical drive from unverified bytes would be the one mistake
 * that cannot be undone: the key would be published and every seeder would
 * replicate whatever arrived.
 *
 * Streams to disk rather than buffering: packs run to hundreds of megabytes on the
 * big regions, and the whole point of the desktop is that it has the RAM headroom
 * *not* to need this.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Assets a region needs on disk to be a complete pack. */
export function packAssets(region) {
  const assets = Array.isArray(region?.assets) ? region.assets : [];
  return assets
    .filter((asset) => asset && typeof asset.url === 'string' && asset.url.length > 0)
    .map((asset) => ({
      name: String(asset.name ?? '')
        .split('/')
        .pop(),
      url: asset.url,
      md5: typeof asset.md5 === 'string' ? asset.md5.toLowerCase() : null,
      sizeBytes: Number(asset.sizeBytes) || 0,
      gzip: asset.gzip === true,
    }))
    .filter((asset) => asset.name.length > 0);
}

function md5OfFile(file) {
  const hash = crypto.createHash('md5');
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    while (true) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

/**
 * Ensure a region's pack is on disk, downloading only what is missing or wrong.
 *
 * A file whose md5 already matches is left alone, so re-running after an
 * interruption costs the remaining bytes rather than the whole pack.
 *
 * @param {object} options
 * @param {object} options.region catalog entry
 * @param {string} options.destDir
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(progress: { asset: string, done: number, total: number, bytes: number }) => void} [options.onProgress]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ dir: string, bytes: number, files: string[], error: string | null }>}
 */
export async function fetchPack({
  region,
  destDir,
  fetchImpl = fetch,
  onProgress = () => {},
  log = () => {},
}) {
  const assets = packAssets(region);
  if (assets.length === 0) {
    return { dir: destDir, bytes: 0, files: [], error: 'the catalog lists no downloadable assets' };
  }

  fs.mkdirSync(destDir, { recursive: true });
  const files = [];
  let total = 0;

  for (const [index, asset] of assets.entries()) {
    const target = path.join(destDir, asset.name);

    if (fs.existsSync(target) && asset.md5 && md5OfFile(target) === asset.md5) {
      log(`[relay] ${asset.name} already verified`);
      files.push(target);
      total += fs.statSync(target).size;
      onProgress({ asset: asset.name, done: index + 1, total: assets.length, bytes: total });
      continue;
    }

    log(`[relay] fetching ${asset.name} (${Math.round(asset.sizeBytes / 1_048_576)} MB)`);
    let response;
    try {
      response = await fetchImpl(asset.url);
    } catch (err) {
      return {
        dir: destDir,
        bytes: total,
        files,
        error: `could not download ${asset.name}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!response.ok || !response.body) {
      return {
        dir: destDir,
        bytes: total,
        files,
        error: `could not download ${asset.name}: HTTP ${response.status}`,
      };
    }

    const partial = `${target}.part`;
    const hash = crypto.createHash('md5');
    const out = fs.createWriteStream(partial);
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);
        if (!out.write(buffer)) {
          await new Promise((resolve) => out.once('drain', resolve));
        }
        total += buffer.length;
        onProgress({ asset: asset.name, done: index, total: assets.length, bytes: total });
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }

    const digest = hash.digest('hex');
    if (asset.md5 && digest !== asset.md5) {
      fs.rmSync(partial, { force: true });
      return {
        dir: destDir,
        bytes: total,
        files,
        error: `${asset.name} failed its md5 check (expected ${asset.md5}, got ${digest}) — refusing to author a pack from unverified bytes`,
      };
    }

    fs.renameSync(partial, target);
    files.push(target);
    onProgress({ asset: asset.name, done: index + 1, total: assets.length, bytes: total });
  }

  return { dir: destDir, bytes: total, files, error: null };
}
