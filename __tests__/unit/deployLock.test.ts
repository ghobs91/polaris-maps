/**
 * Serializing TestFlight deploys.
 *
 * Two deployers ran at once on this machine: builds 388, 390, 392 and 397
 * appeared minutes after manual uploads from a second session, all
 * `INTERNAL_ONLY` — they never reach `IN_BETA_TESTING`, never appear in the
 * TestFlight app, and burn build numbers. One collision cost a full archive and
 * export before App Store Connect rejected the upload as a duplicate.
 *
 * Exercised through the CLI: the script is ESM, which Jest cannot import here.
 * It writes into the repo's ignored `build/` directory, so the lock is shared by
 * every checkout-less deployer working in the same clone.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/deploy-lock.mjs');
const LOCK_DIR = resolve(__dirname, '../../build/.deploy.lock');

/**
 * Run the CLI. `spawnSync` rather than `execFileSync`: a lock conflict is a
 * normal outcome (exit 3), and the takeover path reports on stderr while still
 * exiting 0, so both streams have to be captured either way.
 */
function run(...args: string[]): { code: number; err: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status ?? 1, err: result.stderr ?? '' };
}

afterEach(() => {
  run('release');
});

describe('deploy lock', () => {
  it('lets the first deployer in and turns the second away', () => {
    expect(run('acquire', '--label', 'first').code).toBe(0);

    // A second archive-and-upload must not start: it would race on the shared
    // project file and the build-number counter.
    const second = run('acquire', '--label', 'second');
    expect(second.code).toBe(3);
    expect(second.err).toContain('deploy already in progress');
    expect(second.err).toContain('first');
  });

  it('releases the lock so the next deploy can start', () => {
    expect(run('acquire', '--label', 'first').code).toBe(0);
    expect(run('release').code).toBe(0);
    expect(existsSync(LOCK_DIR)).toBe(false);
    expect(run('acquire', '--label', 'next').code).toBe(0);
  });

  it('reports when nothing is held, and releasing twice is harmless', () => {
    expect(run('status').code).toBe(0);
    expect(run('release').code).toBe(0);
    expect(run('release').code).toBe(0);
  });

  it('takes over a lock left behind by a dead deploy', () => {
    // A killed terminal or crashed xcodebuild must not block every later deploy
    // until someone removes a directory by hand.
    expect(run('acquire', '--label', 'crashed').code).toBe(0);
    const takeover = run('acquire', '--label', 'next', '--ttl', '0');
    expect(takeover.code).toBe(0);
    expect(takeover.err).toContain('stale lock');
  });
});
