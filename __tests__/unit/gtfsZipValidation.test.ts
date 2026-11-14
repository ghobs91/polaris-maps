/**
 * GTFS zip reader used by the pack build.
 *
 * `scripts/verify-gtfs-feeds.mjs` decides whether a downloaded feed may reach
 * `build-transit-timetable.py`. The failure that matters is not "the URL is
 * dead" — curl catches that — it is "the URL answered 200 with something that
 * is not GTFS": a login page, a Cloudflare challenge, an error document. Those
 * arrive as a `.zip` and would otherwise crash the Python builder, or worse,
 * produce a silently empty timetable.
 *
 * Exercised through `--check` rather than by importing the module, matching
 * `pruneMapDataReleases.test.ts`: the scripts are ESM and Jest's transform does
 * not cover them.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/verify-gtfs-feeds.mjs');

interface CheckResult {
  ok: boolean;
  bytes: number | null;
  members: string[];
  missing: string[];
  error?: string;
}

const dir = mkdtempSync(join(tmpdir(), 'polaris-gtfs-zip-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Build a minimal "stored" (uncompressed) zip.
 *
 * CRCs are left at zero on purpose — the reader under test never verifies them,
 * and computing real ones would add a dependency for no coverage. The bytes are
 * a genuine zip container, which is what the central-directory walk reads.
 */
function buildZip(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(`content of ${name}`, 'utf8');

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDir, eocd]);
}

function check(bytes: Buffer | string): CheckResult {
  const file = join(dir, `feed-${Math.random().toString(36).slice(2)}.zip`);
  writeFileSync(file, bytes);
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--check', file, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout);
  } catch (error) {
    // --check exits 1 on a failed check, but still prints the JSON verdict.
    const stdout = (error as { stdout?: string }).stdout ?? '{}';
    return JSON.parse(stdout);
  }
}

const REQUIRED = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'];

describe('GTFS zip validation', () => {
  it('accepts an archive carrying the required members', () => {
    const result = check(buildZip([...REQUIRED, 'agency.txt', 'calendar.txt']));
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.members).toContain('stop_times.txt');
  });

  it('accepts members nested under a single top-level directory', () => {
    // Feeds zipped as `gtfs/stops.txt` are common, and the builder reads them
    // by basename, so the validator must not reject that shape.
    const result = check(buildZip(REQUIRED.map((name) => `gtfs/${name}`)));
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('names every required member that is absent', () => {
    const result = check(buildZip(['stops.txt', 'routes.txt']));
    expect(result.ok).toBe(false);
    expect(result.missing.sort()).toEqual(['stop_times.txt', 'trips.txt']);
  });

  it('rejects a 200-response that is an HTML page, not a zip', () => {
    // This is the exact shape of a Cloudflare challenge or a login redirect.
    const result = check('<html><body>Please enable cookies</body></html>');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a zip/);
    expect(result.members).toEqual([]);
  });

  it('rejects a truncated zip with no central directory', () => {
    const result = check(buildZip(REQUIRED).subarray(0, 40));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a zip|corrupt/);
  });
});
