#!/usr/bin/env node
/**
 * `polaris-relay` — command line for the desktop seeder.
 *
 * Two kinds of command, deliberately split:
 *
 *   serve   the daemon itself (what launchd runs; never invoked by a UI)
 *   ctl/*   a client of the running daemon's control socket
 *
 * `seed --from` is the one command that talks to the seed core directly, because
 * it is the development path: author a drive from a locally built pack so the
 * seeding path can be exercised without a publisher. It is the only place a
 * writable drive is created by this package, and it says so.
 */

import fs from 'node:fs';
import path from 'node:path';

import { controlRequest } from './control.mjs';
import { relayPaths } from './paths.mjs';

const HELP = `polaris-relay — Polaris Maps desktop seeder

Usage:
  polaris-relay serve                    run the daemon (this is what launchd runs)
  polaris-relay status [--json]          show seeding state
  polaris-relay pin <regionId> <driveKey> [--version <v>] [--bytes <n>]
  polaris-relay unpin <regionId>
  polaris-relay pause | resume
  polaris-relay budget [--pack-store-gb <n>] [--egress-gb <n>] [--seed-on-battery <bool>]
  polaris-relay seed --from <dir> <regionId>   develop: author a drive from a pack
  polaris-relay verify                   check a running daemon answers

Environment:
  POLARIS_RELAY_HOME   override the relay root (default: ~/Library/Application Support/Polaris Relay)
`;

function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const dirs = relayPaths();

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  switch (command) {
    case 'serve': {
      const { startDaemon } = await import('./daemon.mjs');
      const daemon = await startDaemon({ paths: dirs });

      let stopping = false;
      const shutdown = async (signal) => {
        if (stopping) return;
        stopping = true;
        process.stdout.write(`\n[relay] ${signal} received, stopping\n`);
        await daemon.stop();
        process.exit(0);
      };
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.stdout.write(`[relay] serving from ${dirs.root}\n`);
      return;
    }

    case 'status': {
      const status = await controlRequest(dirs.controlSocket, { cmd: 'status' });
      if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        return;
      }
      printStatus(status);
      return;
    }

    case 'pin': {
      const regionId = args[1];
      const driveKey = args[2];
      if (!regionId || !driveKey) throw new Error('pin requires <regionId> <driveKey>');
      const result = await controlRequest(dirs.controlSocket, {
        cmd: 'pin',
        regionId,
        driveKey,
        version: flag(args, '--version'),
        bytes: flag(args, '--bytes') ? Number(flag(args, '--bytes')) : undefined,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    case 'unpin': {
      const regionId = args[1];
      if (!regionId) throw new Error('unpin requires <regionId>');
      process.stdout.write(
        `${JSON.stringify(await controlRequest(dirs.controlSocket, { cmd: 'unpin', regionId }), null, 2)}\n`,
      );
      return;
    }

    case 'pause':
    case 'resume':
      process.stdout.write(
        `${JSON.stringify(await controlRequest(dirs.controlSocket, { cmd: command }), null, 2)}\n`,
      );
      return;

    case 'budget': {
      const packStoreGb = flag(args, '--pack-store-gb');
      const egressGb = flag(args, '--egress-gb');
      const seedOnBattery = flag(args, '--seed-on-battery');
      process.stdout.write(
        `${JSON.stringify(
          await controlRequest(dirs.controlSocket, {
            cmd: 'set-budget',
            packStoreGb: packStoreGb === undefined ? undefined : Number(packStoreGb),
            egressGb: egressGb === undefined ? undefined : Number(egressGb),
            seedOnBattery,
          }),
          null,
          2,
        )}\n`,
      );
      return;
    }

    case 'verify': {
      const status = await controlRequest(dirs.controlSocket, { cmd: 'status' });
      process.stdout.write(`relay answered: ${status.serving ? 'serving' : 'not serving'}\n`);
      return;
    }

    case 'seed': {
      const dir = flag(args, '--from');
      const regionId = args[args.indexOf('--from') + 2];
      if (!dir || !regionId) throw new Error('seed requires --from <dir> <regionId>');
      if (!fs.existsSync(dir)) throw new Error(`pack directory not found: ${dir}`);

      const { createSeedCore } = await import('../../backend/seed-core.mjs');
      const Hyperswarm = (await import('hyperswarm')).default;
      const core = createSeedCore({ fs, path, createSwarm: () => new Hyperswarm() });

      // Authoring path, development only. Production seeding is always a
      // read-only replica of a canonical key supplied by a manifest.
      const result = await core.seed({
        regionId,
        filesDir: dir,
        corestoreRoot: dirs.corestore,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(
        `\nThis authored a writable drive. To seed it for real, pin it read-only:\n` +
          `  polaris-relay pin ${regionId} ${result.key} --version dev\n`,
      );
      return;
    }

    default:
      process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
      process.exitCode = 2;
  }
}

/** Human-readable status, sized for a menu bar or a terminal. */
function printStatus(status) {
  const gb = (bytes) => `${(Number(bytes) / 1024 ** 3).toFixed(1)} GiB`;
  const lines = [
    `relay      ${status.relayPubkey.slice(0, 16)}…`,
    `serving    ${status.serving ? 'yes' : `no (${status.pauseReason ?? 'unknown'})`}`,
    `power      ${status.power}${status.lowPowerMode ? ' (low power mode)' : ''}`,
    `pins       ${status.pins.length === 0 ? 'none' : status.pins.map((p) => p.regionId).join(', ')}`,
    `egress     ${gb(status.usage.usedBytes)} of ${gb(status.usage.capBytes)} this month`,
    `store      ${gb(status.budgets.usedBytes)} of ${gb(status.budgets.packStoreBytes)}`,
  ];
  for (const drive of status.drives) {
    lines.push(`  seeding  ${drive.regionId}  peers=${drive.peers}  ${gb(drive.bytes ?? 0)}`);
  }
  for (const warning of status.configWarnings ?? []) lines.push(`config     ${warning}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
