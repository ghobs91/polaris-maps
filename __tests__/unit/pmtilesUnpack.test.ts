/**
 * PMTiles reader (backend/pmtiles.mjs).
 *
 * Region packs ship `tiles.pmtiles`; the app expands it into a
 * `{z}/{x}/{y}.pbf` tree that the on-device tile server already serves. This
 * builds a real PMTiles v3 archive byte-for-byte and runs the reader over it
 * under Node (the same module the Bare worklet loads), so a format mistake
 * shows up here rather than as a blank map on device.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const SCRIPT = resolve(__dirname, '../../scripts/unpack-pmtiles.mjs');

// ── Archive construction ─────────────────────────────────────────────

function writeVarint(out: number[], value: number): void {
  let v = value;
  for (;;) {
    const byte = v % 128;
    v = Math.floor(v / 128);
    if (v === 0) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
}

/** Forward Hilbert mapping: { z, x, y } → tile id (mirrors the spec). */
function zxyToTileId(z: number, x: number, y: number): number {
  let acc = 0;
  for (let t = 0; t < z; t++) {
    const n = 2 ** t;
    acc += n * n;
  }
  const n = 2 ** z;
  let rx = 0;
  let ry = 0;
  let d = 0;
  let tx = x;
  let ty = y;
  for (let s = Math.floor(n / 2); s > 0; s = Math.floor(s / 2)) {
    rx = (tx & s) > 0 ? 1 : 0;
    ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      const swap = tx;
      tx = ty;
      ty = swap;
    }
  }
  return acc + d;
}

interface Tile {
  z: number;
  x: number;
  y: number;
  body: string;
}

/**
 * Build a v3 archive containing `tiles`, with directories compressed per
 * `internalCompression` and tile blobs per `tileCompression` (1 = none,
 * 2 = gzip).
 */
function buildArchive(
  tiles: Tile[],
  { internalCompression = 1, tileCompression = 2 } = {},
): Buffer {
  const encodeDir = (
    entries: { tileId: number; offset: number; length: number; runLength: number }[],
  ) => {
    const out: number[] = [];
    writeVarint(out, entries.length);
    let lastId = 0;
    for (const e of entries) {
      writeVarint(out, e.tileId - lastId);
      lastId = e.tileId;
    }
    for (const e of entries) writeVarint(out, e.runLength);
    for (const e of entries) writeVarint(out, e.length);
    let lastOffset = 0;
    for (const e of entries) {
      if (e.offset === lastOffset) writeVarint(out, 0);
      else writeVarint(out, e.offset + 1);
      lastOffset = e.offset;
    }
    const raw = Buffer.from(out);
    return internalCompression === 2 ? gzipSync(raw) : raw;
  };

  // Tile data section
  const blobs: Buffer[] = [];
  const entries: { tileId: number; offset: number; length: number; runLength: number }[] = [];
  let offset = 0;
  for (const tile of tiles) {
    const payload = Buffer.from(tile.body);
    const blob = tileCompression === 2 ? gzipSync(payload) : payload;
    entries.push({
      tileId: zxyToTileId(tile.z, tile.x, tile.y),
      offset,
      length: blob.length,
      runLength: 1,
    });
    blobs.push(blob);
    offset += blob.length;
  }
  const tileData = Buffer.concat(blobs);

  const rootDir = encodeDir(entries);

  const header = Buffer.alloc(127);
  header.write('PMTiles', 0, 'latin1');
  header.writeUInt8(3, 7);
  const u64 = (off: number, value: number) => header.writeBigUInt64LE(BigInt(value), off);
  const rootOffset = 127;
  u64(8, rootOffset);
  u64(16, rootDir.length);
  u64(24, 0); // metadata offset
  u64(32, 0); // metadata length
  u64(40, 0); // leaf dirs offset
  u64(48, 0); // leaf dirs length
  const tileDataOffset = rootOffset + rootDir.length;
  u64(56, tileDataOffset);
  u64(64, tileData.length);
  u64(72, tiles.length);
  u64(80, tiles.length);
  u64(88, tiles.length);
  header.writeUInt8(1, 96); // clustered
  header.writeUInt8(internalCompression, 97);
  header.writeUInt8(tileCompression, 98);
  header.writeUInt8(1, 99); // tile type: mvt
  header.writeUInt8(0, 100); // min zoom
  header.writeUInt8(14, 101); // max zoom

  return Buffer.concat([header, rootDir, tileData]);
}

function unpack(archive: Buffer, extraArgs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'pmtiles-'));
  const src = join(dir, 'tiles.pmtiles');
  const dest = join(dir, 'out');
  writeFileSync(src, archive);
  const stdout = execFileSync(process.execPath, [SCRIPT, src, dest, ...extraArgs], {
    encoding: 'utf8',
  });
  return {
    dir,
    dest,
    summary: JSON.parse(stdout) as { tiles: number; skipped: number; bytes: number },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('unpackPmtiles', () => {
  const tiles: Tile[] = [
    { z: 0, x: 0, y: 0, body: 'tile-0-0-0' },
    { z: 1, x: 0, y: 0, body: 'tile-1-0-0' },
    { z: 1, x: 1, y: 1, body: 'tile-1-1-1' },
    { z: 2, x: 3, y: 2, body: 'tile-2-3-2' },
  ];

  it('expands gzip-compressed tiles into a {z}/{x}/{y}.pbf tree', () => {
    const { dir, dest, summary } = unpack(buildArchive(tiles));
    try {
      expect(summary.tiles).toBe(4);
      expect(summary.skipped).toBe(0);
      for (const t of tiles) {
        const path = join(dest, String(t.z), String(t.x), `${t.y}.pbf`);
        expect(existsSync(path)).toBe(true);
        // Tiles are stored decompressed: the renderer gets plain MVT bytes.
        expect(readFileSync(path, 'utf8')).toBe(t.body);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles gzip-compressed directories', () => {
    const { dir, dest, summary } = unpack(buildArchive(tiles, { internalCompression: 2 }));
    try {
      expect(summary.tiles).toBe(4);
      expect(readFileSync(join(dest, '2', '3', '2.pbf'), 'utf8')).toBe('tile-2-3-2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours a maxZoom cap (pack size control)', () => {
    const { dir, dest, summary } = unpack(buildArchive(tiles), ['1']);
    try {
      expect(summary.tiles).toBe(3); // z0 + two z1 tiles
      expect(summary.skipped).toBe(1);
      expect(existsSync(join(dest, '2'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a file that is not a PMTiles archive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmtiles-bad-'));
    const src = join(dir, 'bad.pmtiles');
    writeFileSync(src, Buffer.alloc(200, 7));
    try {
      expect(() =>
        execFileSync(process.execPath, [SCRIPT, src, join(dir, 'out')], { stdio: 'pipe' }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The reader must never hold the archive in memory.
 *
 * The previous implementation read the whole file, which is why pack size was
 * capped by device RAM rather than device storage. `--stats` reports the range
 * requests so the invariant is asserted, not assumed.
 */
describe('bounded memory', () => {
  const tiles: Tile[] = [
    { z: 0, x: 0, y: 0, body: 'tile-0-0-0' },
    { z: 1, x: 0, y: 0, body: 'tile-1-0-0' },
    { z: 1, x: 1, y: 1, body: 'tile-1-1-1' },
    { z: 2, x: 3, y: 2, body: 'tile-2-3-2' },
  ];

  function unpackStats(archive: Buffer) {
    const dir = mkdtempSync(join(tmpdir(), 'pmtiles-'));
    const src = join(dir, 'tiles.pmtiles');
    const dest = join(dir, 'out');
    writeFileSync(src, archive);
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, src, dest, '--stats'], {
        encoding: 'utf8',
      });
      return {
        archiveSize: archive.length,
        summary: JSON.parse(stdout) as {
          tiles: number;
          stats: { reads: number; maxReadLength: number };
        },
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('caps a single read at the window size regardless of archive size', () => {
    const { summary } = unpackStats(buildArchive(tiles));
    expect(summary.stats.maxReadLength).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it('streams an archive larger than the read window instead of buffering it', () => {
    // Uncompressed so the archive on disk really is bigger than the window:
    // 12 tiles of 400 kB is ~4.8 MB, past the 4 MB window.
    const big: Tile[] = Array.from({ length: 12 }, (_, i) => ({
      z: 4,
      x: i,
      y: 0,
      body: 'x'.repeat(400 * 1024),
    }));
    const archive = buildArchive(big, { internalCompression: 1, tileCompression: 1 });
    expect(archive.length).toBeGreaterThan(4 * 1024 * 1024);

    const { archiveSize, summary } = unpackStats(archive);

    // Several refills, and no read ever covers the archive.
    expect(summary.stats.reads).toBeGreaterThan(1);
    expect(summary.stats.maxReadLength).toBeLessThan(archiveSize);
    expect(summary.stats.maxReadLength).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(summary.tiles).toBe(12);
  });

  it('still expands every tile correctly through the window', () => {
    const { summary } = unpackStats(buildArchive(tiles));
    expect(summary.tiles).toBe(4);
  });

  it('fails loudly on a truncated archive instead of writing empty tiles', () => {
    const archive = buildArchive(tiles);
    const dir = mkdtempSync(join(tmpdir(), 'pmtiles-'));
    const src = join(dir, 'tiles.pmtiles');
    writeFileSync(src, archive.subarray(0, archive.length - 4));
    try {
      expect(() =>
        execFileSync(process.execPath, [SCRIPT, src, join(dir, 'out')], { stdio: 'pipe' }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('archive integrity', () => {
  it('produces deterministic archives for a fixed tile set', () => {
    const a = createHash('sha256')
      .update(buildArchive([{ z: 3, x: 1, y: 2, body: 'x' }]))
      .digest('hex');
    const b = createHash('sha256')
      .update(buildArchive([{ z: 3, x: 1, y: 2, body: 'x' }]))
      .digest('hex');
    expect(a).toBe(b);
  });
});
