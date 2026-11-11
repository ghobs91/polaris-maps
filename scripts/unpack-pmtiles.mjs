/**
 * CLI wrapper around the PMTiles reader, for the parity test and for manual
 * inspection of a built pack.
 *
 * The reader itself lives in `backend/pmtiles.mjs` and is shared with the Bare
 * worklet, so it must stay free of Node-only imports — hence this wrapper.
 *
 * Usage: node scripts/unpack-pmtiles.mjs <src.pmtiles> <destDir> [maxZoom]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { unpackPmtiles } from '../backend/pmtiles.mjs';

const [, , src, dest, maxZoomArg] = process.argv;
if (!src || !dest) {
  console.error('usage: node scripts/unpack-pmtiles.mjs <src.pmtiles> <destDir> [maxZoom]');
  process.exit(2);
}

const result = await unpackPmtiles(
  {
    readFile: (p) => readFile(p),
    writeFile: (p, data) => writeFile(p, data),
    mkdir: (p) => mkdir(p, { recursive: true }),
  },
  src,
  dest,
  maxZoomArg ? { maxZoom: Number(maxZoomArg) } : {},
);

process.stdout.write(JSON.stringify(result));
