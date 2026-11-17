/**
 * Filesystem layout for the relay.
 *
 * Everything is derived from a single root so the daemon, the CLI, the installer
 * and the tests agree, and so a development run can point somewhere harmless
 * (`POLARIS_RELAY_HOME`) instead of the user's real seed store.
 *
 *   <root>/
 *     config.json                # user-editable budgets and preferences
 *     corestore/<regionId>/      # replicated Hyperdrive blocks (what peers fetch)
 *     packs/<regionId>/<ver>/    # expanded pack, only for `seed --from` (dev)
 *     state/seeds.json           # pinned regions and their canonical drive keys
 *     state/usage.json           # egress counter + per-drive demand timestamps
 *     control.sock               # local control plane (D5)
 *
 * Note the split between `corestore` and `packs`: a canonical seeder replicates
 * the drive's blocks and never needs the expanded file tree. `packs` exists for
 * the development path that authors a drive from a locally built pack.
 */

import os from 'node:os';
import path from 'node:path';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} absolute relay root
 */
export function relayRoot(env = process.env) {
  if (env.POLARIS_RELAY_HOME) return path.resolve(env.POLARIS_RELAY_HOME);
  return path.join(os.homedir(), 'Library', 'Application Support', 'Polaris Relay');
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function relayPaths(env = process.env) {
  const root = relayRoot(env);
  return {
    root,
    config: path.join(root, 'config.json'),
    corestore: path.join(root, 'corestore'),
    packs: path.join(root, 'packs'),
    state: path.join(root, 'state'),
    seeds: path.join(root, 'state', 'seeds.json'),
    usage: path.join(root, 'state', 'usage.json'),
    controlSocket: path.join(root, 'control.sock'),
    logs: path.join(os.homedir(), 'Library', 'Logs', 'Polaris Relay'),
  };
}
