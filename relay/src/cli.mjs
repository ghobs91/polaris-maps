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
  polaris-relay regions                  list pinnable regions from the signed catalog
  polaris-relay pin-region <regionId>    pin using the region's verified manifest
  polaris-relay pin <regionId> <driveKey> [--version <v>] [--bytes <n>]
  polaris-relay unpin <regionId>
  polaris-relay pause | resume
  polaris-relay stop                     stop seeding and exit the daemon
  polaris-relay budget [--pack-store-gb <n>] [--egress-gb <n>] [--seed-on-battery <bool>]
  polaris-relay devices                   list devices allowed to control this relay
  polaris-relay pair                      start QR pairing, prints the link to show
  polaris-relay authorize <pubkey> [--label <name>]
  polaris-relay revoke <pubkey>
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
      let stopping = false;
      const shutdown = async (reason) => {
        if (stopping) return;
        stopping = true;
        process.stdout.write(`\n[relay] ${reason}, stopping\n`);
        await daemon.stop();
        // Exit 0 on purpose: the launch agent uses KeepAlive{SuccessfulExit:false},
        // so a clean exit leaves it stopped. A non-zero exit would look like a
        // crash and be restarted — the opposite of what a user asking to quit
        // wants.
        process.exit(0);
      };
      const daemon = await startDaemon({
        paths: dirs,
        onShutdownRequest: () => void shutdown('shutdown requested'),
      });

      process.on('SIGTERM', () => void shutdown('SIGTERM received'));
      process.on('SIGINT', () => void shutdown('SIGINT received'));
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

    case 'regions': {
      const result = await controlRequest(
        dirs.controlSocket,
        { cmd: args.includes('--refresh') ? 'refresh-catalog' : 'catalog' },
        { timeoutMs: 30_000 },
      );
      if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      const pinnable = result.regions.filter((region) => region.pinnable);
      process.stdout.write(
        `${result.regions.length} region(s) in the catalog, ${pinnable.length} with a verified ` +
          `manifest (catalog: ${result.source}${result.error ? `, ${result.error}` : ''})\n`,
      );
      for (const region of pinnable) {
        process.stdout.write(
          `  ${region.regionId.padEnd(34)} ${region.name.slice(0, 26).padEnd(28)} ` +
            `${formatBytes(region.bytes)}  ${region.manifestSource}${region.pinned ? '  (pinned)' : ''}\n`,
        );
      }
      const withoutManifest = result.regions.length - pinnable.length;
      if (withoutManifest > 0) {
        process.stdout.write(
          `  … ${withoutManifest} more region(s) advertised without a signed manifest yet\n`,
        );
      }
      for (const problem of result.problems ?? []) {
        process.stdout.write(`  ! ${problem.regionId} (${problem.source}): ${problem.reason}\n`);
      }
      return;
    }

    case 'pin-region': {
      const regionId = args[1];
      if (!regionId) throw new Error('pin-region requires a region id');
      process.stdout.write(
        `${JSON.stringify(
          await controlRequest(
            dirs.controlSocket,
            { cmd: 'pin-region', regionId },
            { timeoutMs: 30_000 },
          ),
          null,
          2,
        )}\n`,
      );
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

    case 'devices': {
      const status = await controlRequest(dirs.controlSocket, { cmd: 'status' });
      if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(status.devices ?? [], null, 2)}\n`);
        return;
      }
      const devices = status.devices ?? [];
      if (devices.length === 0) {
        process.stdout.write(
          'No device may control this relay yet.\n' +
            "Open Polaris Maps → Settings → Desktop relay to get this phone's key, then run:\n" +
            '  polaris-relay authorize <pubkey> --label "Andrew\'s iPhone"\n',
        );
        return;
      }
      for (const device of devices) {
        process.stdout.write(
          `${device.pubkey.slice(0, 12)}…  ${device.label}  authorized ${new Date(
            device.authorizedAt,
          ).toISOString()}\n`,
        );
      }
      return;
    }

    case 'pair': {
      const started = await controlRequest(dirs.controlSocket, { cmd: 'pairing-start' });
      process.stdout.write(
        `Polaris Maps → Settings → Offline maps → Desktop relay → Link this phone\n` +
          `and scan this, valid for ${Math.round(
            (Number(started.expiresAt) - Date.now()) / 1000,
          )} seconds:\n\n${started.payload}\n`,
      );
      return;
    }

    case 'authorize': {
      const pubkey = args[1];
      if (!pubkey) throw new Error('authorize requires a device pubkey (64 hex characters)');
      process.stdout.write(
        `${JSON.stringify(
          await controlRequest(dirs.controlSocket, {
            cmd: 'authorize',
            devicePubkey: pubkey,
            label: flag(args, '--label'),
          }),
          null,
          2,
        )}\n`,
      );
      return;
    }

    case 'revoke': {
      const pubkey = args[1];
      if (!pubkey) throw new Error('revoke requires a device pubkey');
      process.stdout.write(
        `${JSON.stringify(
          await controlRequest(dirs.controlSocket, { cmd: 'revoke', devicePubkey: pubkey }),
          null,
          2,
        )}\n`,
      );
      return;
    }

    case 'stop': {
      // Ask the daemon to stop, then confirm the socket is gone so the caller
      // knows the seeding actually ended rather than the request merely landing.
      const result = await controlRequest(dirs.controlSocket, { cmd: 'shutdown' });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!fs.existsSync(dirs.controlSocket)) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      process.stdout.write(
        fs.existsSync(dirs.controlSocket)
          ? `relay accepted the shutdown but the control socket is still present at ${dirs.controlSocket}\n`
          : `relay stopped (was: ${JSON.stringify(result)})\n`,
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

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value === 0) return 'size unknown';
  if (value < 1024 ** 3) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
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
    lines.push(
      `  seeding  ${drive.regionId}  peers=${drive.peers}  ${gb(drive.bytes ?? 0)}` +
        (drive.pinned ? '  (pinned)' : ''),
    );
  }
  lines.push(
    `devices    ${
      (status.devices ?? []).length === 0
        ? 'none authorized — phones cannot control this relay'
        : (status.devices ?? []).map((d) => d.label).join(', ')
    }`,
  );
  for (const warning of status.configWarnings ?? []) lines.push(`config     ${warning}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // The most common failure by far is running a control command before `serve`
  // has ever started. Say what to do instead of printing a raw errno.
  if (/ENOENT|ECONNREFUSED/.test(message)) {
    process.stderr.write(
      `The relay is not running (no control socket at ${relayPaths().controlSocket}).\n` +
        'Start it for this session:  node relay/src/cli.mjs serve\n' +
        'Or install it as a launch agent:  relay/launchd/install.sh\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
