/**
 * CLI wrapper around the PMTiles reader, for the parity test and for manual
 * inspection of a built pack.
 *
 * The reader itself lives in `backend/pmtiles.mjs` and is shared with the Bare
 * worklet, so it must stay free of Node-only imports — hence this wrapper.
 *
 * The reader takes a range-reading handle rather than a path so the archive is
 * never loaded whole; this is where `node:fs` supplies that handle.
 *
 * Usage: node scripts/unpack-pmtiles.mjs <src.pmtiles> <destDir> [maxZoom] [--stats]
 *
 * `--stats` adds `{ reads, maxReadLength }` to the output so a test can assert
 * that the archive is read in bounded windows rather than all at once.
 */

import { open, writeFile, mkdir } from 'node:fs/promises';
import { unpackPmtiles } from '../backend/pmtiles.mjs';

const args = process.argv.slice(2);
const wantStats = args.includes('--stats');
const [src, dest, maxZoomArg] = args.filter((a) => a !== '--stats');
if (!src || !dest) {
  console.error('usage: node scripts/unpack-pmtiles.mjs <src.pmtiles> <destDir> [maxZoom]');
  process.exit(2);
}

const readStats = { reads: 0, maxReadLength: 0 };

/** Open a read-only range handle. Reads past EOF return a short buffer. */
async function openRangeHandle(path) {
  const handle = await open(path, 'r');
  return {
    async read(offset, length) {
      readStats.reads++;
      readStats.maxReadLength = Math.max(readStats.maxReadLength, length);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
}

const result = await unpackPmtiles(
  {
    open: openRangeHandle,
    writeFile: (p, data) => writeFile(p, data),
    mkdir: (p) => mkdir(p, { recursive: true }),
  },
  src,
  dest,
  maxZoomArg ? { maxZoom: Number(maxZoomArg) } : {},
);

process.stdout.write(JSON.stringify(wantStats ? { ...result, stats: readStats } : result));
