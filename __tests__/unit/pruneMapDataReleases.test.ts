/**
 * map-data release retention.
 *
 * This script deletes published data, so the selection rules are the thing
 * worth pinning: it must never touch the `map-data-latest` pointer the app
 * reads, never guess at a tag that only looks dated, and always leave at least
 * one real release behind.
 *
 * Exercised through the CLI rather than by importing it — the repo's `.mjs`
 * scripts are ESM and Jest's transform does not cover them (see
 * `pmtilesUnpack.test.ts` for the same pattern). `--input` exists so the rules
 * can be checked against fixtures without touching GitHub.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/prune-map-data-releases.mjs');

interface PruneResult {
  dryRun: boolean;
  keep: string[];
  pruned: string[];
  ignored: string[];
}

const dir = mkdtempSync(join(tmpdir(), 'polaris-prune-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Run the CLI over a fixture release list and return its JSON result. */
function prune(tags: string[], extraArgs: string[] = []): PruneResult {
  const input = join(dir, `releases-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(input, JSON.stringify(tags));
  const stdout = execFileSync(
    process.execPath,
    [SCRIPT, '--input', input, '--dry-run', '--json', ...extraArgs],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(stdout) as PruneResult;
}

describe('map-data release retention', () => {
  it('keeps the newest two dated releases and prunes the rest', () => {
    const result = prune([
      'map-data-2026-08',
      'map-data-2026-11',
      'map-data-2026-09',
      'map-data-2026-10',
    ]);

    expect(result.keep).toEqual(['map-data-2026-11', 'map-data-2026-10']);
    expect(result.pruned).toEqual(['map-data-2026-09', 'map-data-2026-08']);
  });

  it('never prunes the map-data-latest pointer', () => {
    // The pointer is what the app reads; deleting it would take every install
    // back to live third-party tiles.
    const result = prune(['map-data-latest', 'map-data-2026-11', 'map-data-2026-10']);

    expect(result.pruned).toEqual([]);
    expect(result.ignored).toContain('map-data-latest');
  });

  it('ignores tags that only look dated', () => {
    const result = prune([
      'map-data-2026-11',
      'map-data-2026-1', // not zero-padded
      'map-data-2026-13', // not a month
      'map-data-26-01', // wrong year width
      'map-data-latest',
      'v1.0.0',
      'map-data-2026-11-extra',
    ]);

    expect(result.pruned).toEqual([]);
    expect(result.ignored.sort()).toEqual(
      [
        'map-data-2026-1',
        'map-data-2026-13',
        'map-data-26-01',
        'map-data-latest',
        'v1.0.0',
        'map-data-2026-11-extra',
      ].sort(),
    );
  });

  it('orders by tag year-month, not by list order', () => {
    // A release can be created long after its tag; the tag is what the catalog
    // points at, so it is what retention must order by.
    const result = prune(['map-data-2026-01', 'map-data-2026-12', 'map-data-2026-06']);

    expect(result.keep).toEqual(['map-data-2026-12', 'map-data-2026-06']);
    expect(result.pruned).toEqual(['map-data-2026-01']);
  });

  it('handles year boundaries', () => {
    const result = prune(['map-data-2025-12', 'map-data-2026-01', 'map-data-2025-11']);

    expect(result.keep).toEqual(['map-data-2026-01', 'map-data-2025-12']);
    expect(result.pruned).toEqual(['map-data-2025-11']);
  });

  it('does nothing when there are fewer releases than the keep window', () => {
    expect(prune(['map-data-2026-11']).pruned).toEqual([]);
    expect(prune([]).pruned).toEqual([]);
    expect(prune(['map-data-latest']).pruned).toEqual([]);
  });

  it('honours --keep', () => {
    const tags = ['map-data-2026-11', 'map-data-2026-10', 'map-data-2026-09', 'map-data-2026-08'];

    expect(prune(tags, ['--keep', '1']).pruned).toEqual([
      'map-data-2026-10',
      'map-data-2026-09',
      'map-data-2026-08',
    ]);
    expect(prune(tags, ['--keep', '3']).pruned).toEqual(['map-data-2026-08']);
  });

  it('refuses a keep window that would delete everything', () => {
    const input = join(dir, 'refuse.json');
    writeFileSync(input, JSON.stringify(['map-data-2026-11', 'map-data-2026-10']));

    expect(() =>
      execFileSync(process.execPath, [SCRIPT, '--input', input, '--dry-run', '--keep', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).toThrow();
  });

  it('reports dryRun so a caller cannot mistake a plan for a deletion', () => {
    expect(prune(['map-data-2026-11', 'map-data-2026-10', 'map-data-2026-09']).dryRun).toBe(true);
  });
});
