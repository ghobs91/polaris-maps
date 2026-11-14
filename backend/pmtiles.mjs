/**
 * Minimal PMTiles v3 reader + unpacker.
 *
 * Region packs ship a base-map `tiles.pmtiles` (planetiler output). The app's
 * render path serves individual `{z}/{x}/{y}.pbf` files from the on-device tile
 * server, so a pack's PMTiles archive is expanded into that tree once, at
 * install time, and everything downstream (style rewrite, offline detection,
 * region deletion) works unchanged.
 *
 * Deliberately dependency-free apart from `pako` (already bundled for gunzip):
 * the archive format is a header plus varint-encoded directories, so a small
 * reader is less risk than pulling in a package the app would have to declare.
 *
 * Runs in two places:
 *   - the Bare worklet (backend/hyperdrive.mjs), via the `unpack-pmtiles` RPC,
 *     with `bare-fs` injected;
 *   - Node, for the parity test, with `node:fs` injected.
 *
 * Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */

import { ungzip } from 'pako';

// ── Constants ───────────────────────────────────────────────────────

/** Fixed header size in bytes (v3). */
export const HEADER_SIZE = 127;

/** PMTiles magic bytes. */
const MAGIC = 'PMTiles';

/** Directory/data compression codes. */
export const COMPRESSION = { unknown: 0, none: 1, gzip: 2, brotli: 3, zstd: 4 };

/** Highest zoom the reader accepts (tile-id maths stays exact in doubles). */
export const MAX_SUPPORTED_ZOOM = 26;

// ── Header ──────────────────────────────────────────────────────────

/**
 * Parse the 127-byte v3 header.
 * Throws on a bad magic or an unsupported version.
 */
export function parseHeader(buf) {
  if (buf.length < HEADER_SIZE) throw new Error('pmtiles: file shorter than header');
  const magic = String.fromCharCode(...buf.subarray(0, 7));
  if (magic !== MAGIC) throw new Error(`pmtiles: bad magic "${magic}"`);
  const version = buf[7];
  if (version !== 3) throw new Error(`pmtiles: unsupported version ${version}`);

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u64 = (off) => Number(view.getBigUint64(off, true));

  return {
    version,
    rootDirOffset: u64(8),
    rootDirLength: u64(16),
    metadataOffset: u64(24),
    metadataLength: u64(32),
    leafDirsOffset: u64(40),
    leafDirsLength: u64(48),
    tileDataOffset: u64(56),
    tileDataLength: u64(64),
    addressedTilesCount: u64(72),
    tileEntriesCount: u64(80),
    tileContentsCount: u64(88),
    clustered: buf[96] === 1,
    internalCompression: buf[97],
    tileCompression: buf[98],
    tileType: buf[99],
    minZoom: buf[100],
    maxZoom: buf[101],
  };
}

// ── Varints ─────────────────────────────────────────────────────────

/** Read a base-128 varint; returns [value, nextOffset]. */
export function readVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buf.length) throw new Error('pmtiles: truncated varint');
    const byte = buf[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, pos];
    shift += 7;
    if (shift > 63) throw new Error('pmtiles: varint too long');
  }
}

// ── Tile ids (Hilbert curve) ────────────────────────────────────────

/** Inverse Hilbert mapping: tile id → { z, x, y }. */
export function tileIdToZxy(tileId) {
  if (!Number.isFinite(tileId) || tileId < 0) throw new Error('pmtiles: bad tile id');
  let acc = 0;
  let z = 0;
  for (;;) {
    if (z > MAX_SUPPORTED_ZOOM) throw new Error('pmtiles: tile id out of range');
    const n = 2 ** z;
    const count = n * n;
    if (tileId < acc + count) break;
    acc += count;
    z++;
  }
  const n = 2 ** z;
  let t = tileId - acc;
  let x = 0;
  let y = 0;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & Math.floor(t / 2);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const swap = x;
      x = y;
      y = swap;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return { z, x, y };
}

// ── Directories ─────────────────────────────────────────────────────

/**
 * Decode a directory (root or leaf) into entries:
 * `{ tileId, offset, length, runLength }`.
 *
 * `offset` is relative to the tile-data section (root) or the leaf-dirs
 * section (leaf pointer entries, marked by `runLength === 0`).
 */
export function parseDirectory(buf) {
  const [numEntries, afterCount] = readVarint(buf, 0);
  const entries = [];
  let pos = afterCount;

  // tile ids are delta-encoded
  let lastId = 0;
  const tileIds = new Array(numEntries);
  for (let i = 0; i < numEntries; i++) {
    const [delta, next] = readVarint(buf, pos);
    pos = next;
    lastId += delta;
    tileIds[i] = lastId;
  }

  const runLengths = new Array(numEntries);
  for (let i = 0; i < numEntries; i++) {
    const [value, next] = readVarint(buf, pos);
    pos = next;
    runLengths[i] = value;
  }

  const lengths = new Array(numEntries);
  for (let i = 0; i < numEntries; i++) {
    const [value, next] = readVarint(buf, pos);
    pos = next;
    lengths[i] = value;
  }

  let lastOffset = 0;
  for (let i = 0; i < numEntries; i++) {
    const [value, next] = readVarint(buf, pos);
    pos = next;
    // 0 means "immediately after the previous entry's blob"
    const offset = value === 0 ? lastOffset + (lengths[i - 1] ?? 0) : value - 1;
    lastOffset = offset;
    entries.push({
      tileId: tileIds[i],
      offset,
      length: lengths[i],
      runLength: runLengths[i],
    });
  }

  return entries;
}

/** Decompress a directory/data block per the archive's compression code. */
export function decompressBlock(buf, compression) {
  if (compression === COMPRESSION.none) return buf;
  if (compression === COMPRESSION.gzip) return ungzip(buf);
  throw new Error(`pmtiles: unsupported compression code ${compression}`);
}

// ── Range reading ───────────────────────────────────────────────────

/**
 * Bytes fetched per range read.
 *
 * Caps peak memory at roughly one window plus one tile, instead of the whole
 * archive. That is the difference between "a pack can be at most what the
 * device can hold in RAM" and "a pack can be any size the device can store".
 */
export const READ_WINDOW_BYTES = 4 * 1024 * 1024;

/**
 * Sequential range reader with a bounded window.
 *
 * A clustered archive stores tiles in tile-id order, so the walk reads forward;
 * a window turns thousands of per-tile reads into a handful of sequential ones
 * without ever holding the archive.
 */
function createWindowReader(reader) {
  let base = 0;
  let window = null;

  return async (offset, length) => {
    if (length === 0) return new Uint8Array(0);

    if (window && offset >= base && offset + length <= base + window.length) {
      return window.subarray(offset - base, offset - base + length);
    }
    if (length > READ_WINDOW_BYTES) return reader.read(offset, length);

    const got = await reader.read(offset, Math.max(READ_WINDOW_BYTES, length));
    window = got;
    base = offset;

    if (got.length < length) {
      // Short read at end of file. Ask for exactly what the directory promised
      // so a truncated archive fails loudly instead of writing an empty tile.
      const exact = await reader.read(offset, length);
      if (exact.length < length) {
        throw new Error(`pmtiles: short read at ${offset} (${exact.length}/${length})`);
      }
      return exact;
    }
    return got.subarray(0, length);
  };
}

// ── Unpacking ───────────────────────────────────────────────────────

/**
 * Expand a PMTiles archive into a `{z}/{x}/{y}.pbf` tree.
 *
 * The archive is read through range requests, never loaded whole: header, then
 * the root directory, then one leaf directory or tile at a time. Peak memory is
 * `READ_WINDOW_BYTES`, independent of pack size.
 *
 * @param io        `{ open(path), writeFile(path, data), mkdir(path) }`, where
 *                  `open` resolves to `{ read(offset, length), close() }`.
 *                  Injected so the same code runs on bare-fs (worklet) and
 *                  node:fs (tests and the CLI wrapper).
 * @param srcPath   Path to the .pmtiles file.
 * @param destDir   Directory that receives `{z}/{x}/{y}.pbf` (trailing slash
 *                  optional).
 * @param options   `{ maxZoom }` — tiles above this zoom are skipped.
 * @returns `{ tiles, skipped, bytes, minZoom, maxZoom }`
 */
export async function unpackPmtiles(io, srcPath, destDir, options = {}) {
  const maxZoom = options.maxZoom ?? MAX_SUPPORTED_ZOOM;
  const base = destDir.endsWith('/') ? destDir : `${destDir}/`;
  const reader = await io.open(srcPath);

  try {
    const read = createWindowReader(reader);

    const header = parseHeader(await read(0, HEADER_SIZE));
    const rootEntries = parseDirectory(
      decompressBlock(
        await read(header.rootDirOffset, header.rootDirLength),
        header.internalCompression,
      ),
    );

    let tiles = 0;
    let skipped = 0;
    let bytes = 0;
    const createdDirs = new Set();

    const writeEntry = async (entry) => {
      for (let i = 0; i < entry.runLength; i++) {
        const { z, x, y } = tileIdToZxy(entry.tileId + i);
        if (z > maxZoom) {
          skipped++;
          continue;
        }
        const blob = await read(header.tileDataOffset + entry.offset, entry.length);
        const tile = decompressBlock(blob, header.tileCompression);

        const dir = `${base}${z}/${x}/`;
        if (!createdDirs.has(dir)) {
          await io.mkdir(dir);
          createdDirs.add(dir);
        }
        await io.writeFile(`${dir}${y}.pbf`, tile);
        tiles++;
        bytes += tile.length;
      }
    };

    const walk = async (entries) => {
      for (const entry of entries) {
        if (entry.runLength === 0) {
          // Leaf directory pointer (offset relative to the leaf-dirs section).
          const raw = await read(header.leafDirsOffset + entry.offset, entry.length);
          await walk(parseDirectory(decompressBlock(raw, header.internalCompression)));
          continue;
        }
        await writeEntry(entry);
      }
    };

    await walk(rootEntries);

    return { tiles, skipped, bytes, minZoom: header.minZoom, maxZoom: header.maxZoom };
  } finally {
    await reader.close();
  }
}
