/**
 * The relay daemon.
 *
 * Lifecycle is deliberately boring: load state, seed what is pinned, answer the
 * control socket, poll power, publish announcements, exit cleanly on a signal.
 * Everything interesting is in a module that can be tested without a process
 * (`budgets`, `demand`, `power`, `config`, `state`, `announce`); this file is the
 * wiring, and it is the only place that touches the filesystem destructively.
 *
 * The one structural decision worth stating: **pausing means unseeding.** A relay
 * that "pauses" by keeping its swarm open still accepts connections and still
 * holds discovery topics, so a phone would still see it as coverage. Releasing
 * the drives is the only honest signal, and it is what makes `status` and the
 * phone's view agree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSeedCore } from '../../backend/seed-core.mjs';
import { createTokenBucket, checkEgress, recordEgress } from './budgets.mjs';
import { loadConfig } from './config.mjs';
import { startControlServer } from './control.mjs';
import { planEviction, planIdleEviction, touchDemand } from './demand.mjs';
import { decideServing, readPowerState } from './power.mjs';
import { applyPin, applyUnpin, loadSeeds, loadUsage, saveSeeds, saveUsage } from './state.mjs';

const POWER_POLL_MS = 60_000;
const USAGE_FLUSH_MS = 30_000;
const IDENTITY_FILE = 'identity.json';

/**
 * Load or create the relay's own identity.
 *
 * A relay identity is separate from any phone's: it signs availability
 * announcements and nothing else. It is created on first run and stored 0600 in
 * the relay root.
 *
 * @param {string} stateDir
 * @returns {{ privateKey: Uint8Array, publicKey: string }}
 */
export async function loadIdentity(stateDir) {
  const { schnorr } = await import('@noble/curves/secp256k1');
  const file = path.join(stateDir, IDENTITY_FILE);

  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const privateKey = Uint8Array.from(Buffer.from(String(parsed.privateKey), 'hex'));
      if (privateKey.length === 32) {
        const publicKey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');
        return { privateKey, publicKey };
      }
    } catch {
      /* regenerate below */
    }
  }

  const privateKey = schnorr.utils.randomPrivateKey();
  const publicKey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ privateKey: Buffer.from(privateKey).toString('hex'), publicKey }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { privateKey, publicKey };
}

/** Directory size in bytes, or 0 when unreadable. */
export function directorySize(dir) {
  let total = 0;
  /** @param {string} current */
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else {
        try {
          total += fs.statSync(abs).size;
        } catch {
          /* raced with a delete */
        }
      }
    }
  };
  walk(dir);
  return total;
}

/**
 * Start the daemon.
 *
 * @param {object} options
 * @param {ReturnType<import('./paths.mjs').relayPaths>} options.paths
 * @param {(message: string) => void} [options.log]
 * @param {{ createSwarm?: () => any, readPowerState?: typeof readPowerState, publishAnnouncement?: (a: any) => void }} [options.overrides]
 * @returns {Promise<{ status: () => unknown, stop: () => Promise<void> }>}
 */
export async function startDaemon({ paths: dirs, log = console.log, overrides = {} }) {
  for (const dir of [dirs.root, dirs.corestore, dirs.state]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const { config, warnings } = loadConfig(dirs.config);
  const { pins: initialPins, dropped } = loadSeeds(dirs.seeds);
  const usageState = loadUsage(dirs.usage);
  const identity = await loadIdentity(dirs.state);

  let pins = initialPins;
  if (dropped > 0) log(`[relay] dropped ${dropped} pin(s) without a valid canonical drive key`);

  const powerReader = overrides.readPowerState ?? readPowerState;
  const createSwarm = overrides.createSwarm ?? (await import('hyperswarm')).default;

  const core = createSeedCore({ fs, path, createSwarm: () => new createSwarm() });

  /** @type {{ serving: boolean, reason: string | null }} */
  let serving = { serving: false, reason: 'starting' };
  let pausedByUser = false;
  let usage = usageState.usage;
  let demand = usageState.demand;
  let servedBytes24h = usageState.servedBytes24h;
  let linkMetered = false;
  let powerState = {
    power: /** @type {'ac'|'battery'|'unknown'} */ ('unknown'),
    lowPowerMode: false,
  };
  const bucket = createTokenBucket({
    bytesPerSecond: config.maxBitsPerSecond / 8,
    capacityBytes: (config.maxBitsPerSecond / 8) * 5,
  });

  const seeded = new Set();

  /** Seed every pinned region; releases anything no longer pinned. */
  async function reconcileSeeds() {
    // Not serving means not reachable: keeping the drives open would still hold
    // the discovery topics, a phone would still count this relay as coverage, and
    // the pause would be a lie. Release everything and re-seed when allowed.
    if (!serving.serving) {
      for (const regionId of [...seeded]) {
        await core.unseed({ regionId }).catch(() => {});
        seeded.delete(regionId);
      }
      return;
    }

    const wanted = new Set(pins.map((p) => p.regionId));

    for (const regionId of [...seeded]) {
      if (!wanted.has(regionId)) {
        await core.unseed({ regionId }).catch(() => {});
        seeded.delete(regionId);
      }
    }

    for (const pin of pins) {
      if (seeded.has(pin.regionId)) continue;
      try {
        // No `filesDir`: a canonical seeder replicates blocks by key and never
        // needs the expanded file tree. Passing no key would *author* a drive,
        // which is the one thing a relay must never do.
        await core.seed({
          regionId: pin.regionId,
          key: pin.driveKey,
          corestoreRoot: dirs.corestore,
        });
        seeded.add(pin.regionId);
        log(`[relay] seeding ${pin.regionId} (${pin.driveKey.slice(0, 12)}…)`);
      } catch (err) {
        log(
          `[relay] could not seed ${pin.regionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async function refreshServingState() {
    powerState = await powerReader();
    const egress = checkEgress(usage, config.egressBytesPerMonth, Date.now());
    const decision = decideServing({
      power: powerState.power,
      lowPowerMode: powerState.lowPowerMode,
      metered: linkMetered,
      seedOnBattery: config.seedOnBattery,
      seedOnMetered: config.seedOnMetered,
      manuallyPaused: pausedByUser,
      egress,
    });

    const changed = decision.serving !== serving.serving || decision.reason !== serving.reason;
    serving = decision;
    if (changed) {
      log(
        decision.serving
          ? '[relay] serving'
          : `[relay] not serving: ${decision.reason ?? 'unknown'}`,
      );
      await reconcileSeeds();
    }
  }

  function currentDrives() {
    return core.status().drives;
  }

  /** Payload published to the gossip channel (and shown by `ctl status`). */
  function buildStatus() {
    return {
      serving: serving.serving,
      pauseReason: serving.reason,
      power: powerState.power,
      lowPowerMode: powerState.lowPowerMode,
      metered: linkMetered,
      relayPubkey: identity.publicKey,
      version: 1,
      drives: currentDrives(),
      pins: pins.map((p) => ({ regionId: p.regionId, version: p.version })),
      usage: {
        month: usage.month,
        usedBytes: usage.bytes,
        capBytes: config.egressBytesPerMonth,
        servedBytes24h,
      },
      budgets: {
        packStoreBytes: config.packStoreBytes,
        usedBytes: directorySize(dirs.corestore),
        maxPeers: config.maxPeers,
        maxBitsPerSecond: config.maxBitsPerSecond,
      },
      preferences: {
        seedOnBattery: config.seedOnBattery,
        seedOnMetered: config.seedOnMetered,
        pausedByUser,
      },
      configWarnings: warnings,
    };
  }

  async function publish() {
    if (!config.publishAnnouncements) return;
    const publisher = overrides.publishAnnouncement;
    if (!publisher) return;
    const status = buildStatus();
    const { buildAnnouncement } = await import('./announce.mjs');
    const announcement = buildAnnouncement({
      privateKey: identity.privateKey,
      regions: pins.map((pin) => {
        const drive = status.drives.find((d) => d.regionId === pin.regionId);
        return {
          regionId: pin.regionId,
          version: pin.version,
          driveKey: pin.driveKey,
          bytes: Number(drive?.bytes) || 0,
        };
      }),
      capacityBytes: config.packStoreBytes,
      usedBytes: status.budgets.usedBytes,
      uplinkKbps: Math.round(config.maxBitsPerSecond / 1000),
      paused: !status.serving,
      pausedReason: status.pauseReason,
      servedBytes24h,
      updatedAt: Date.now(),
    });
    try {
      publisher(announcement);
    } catch (err) {
      log(`[relay] announcement failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Evict to fit an incoming region.
   *
   * Refuses (and says so) when only pinned regions remain — the alternative is
   * silently dropping something the user explicitly asked to keep.
   */
  async function ensureBudget(incomingBytes) {
    const entries = currentDrives().map((drive) => ({
      regionId: drive.regionId,
      bytes: Number(drive.bytes) || 0,
      lastRequestedAt: demand[drive.regionId]?.lastRequestedAt ?? 0,
      pinned: pins.some((p) => p.regionId === drive.regionId),
    }));

    const plan = planEviction(entries, {
      budgetBytes: config.packStoreBytes,
      incomingBytes,
      now: Date.now(),
      idleEvictionDays: config.idleEvictionDays,
    });

    for (const regionId of plan.evict) {
      await core.unseed({ regionId }).catch(() => {});
      seeded.delete(regionId);
      try {
        fs.rmSync(path.join(dirs.corestore, regionId), { recursive: true, force: true });
      } catch {
        /* leave the bytes rather than fail the pin */
      }
      log(`[relay] evicted ${regionId} to stay inside the pack store budget`);
    }

    return plan;
  }

  /** @param {{ cmd: string, [key: string]: unknown }} request */
  async function handle(request) {
    switch (request.cmd) {
      case 'status':
        return buildStatus();

      case 'pin': {
        const regionId = String(request.regionId ?? '');
        const driveKey = String(request.driveKey ?? '');
        if (!regionId) throw new Error('pin requires regionId');
        if (!/^[0-9a-f]{64}$/i.test(driveKey)) {
          throw new Error('pin requires a canonical driveKey (64 hex characters)');
        }

        const applied = applyPin(
          pins,
          { regionId, version: request.version ? String(request.version) : undefined, driveKey },
          Date.now(),
        );
        pins = applied.pins;
        saveSeeds(dirs.seeds, pins);

        const plan = await ensureBudget(Number(request.bytes) || 0);
        if (plan.refused) {
          // The pin is kept (the user asked for it) but reported as unmeetable, so
          // the UI can say "raise the budget" instead of pretending it seeded.
          return { pin: applied.pin, refused: true, reason: plan.reason };
        }

        await reconcileSeeds();
        return { pin: applied.pin, refused: false, reason: null };
      }

      case 'unpin': {
        const regionId = String(request.regionId ?? '');
        pins = applyUnpin(pins, regionId);
        saveSeeds(dirs.seeds, pins);
        await core.unseed({ regionId }).catch(() => {});
        seeded.delete(regionId);
        return { pins: pins.map((p) => p.regionId) };
      }

      case 'pause':
        pausedByUser = true;
        await refreshServingState();
        return { serving: serving.serving, reason: serving.reason };

      case 'resume':
        pausedByUser = false;
        await refreshServingState();
        return { serving: serving.serving, reason: serving.reason };

      case 'set-budget': {
        const next = { ...config };
        if (request.packStoreGb !== undefined) {
          next.packStoreBytes = Math.max(1, Number(request.packStoreGb)) * 1024 ** 3;
        }
        if (request.egressGb !== undefined) {
          next.egressBytesPerMonth = Math.max(0, Number(request.egressGb)) * 1000 ** 3;
        }
        if (request.seedOnBattery !== undefined) {
          next.seedOnBattery = request.seedOnBattery === true || request.seedOnBattery === 'true';
        }
        if (request.maxPeers !== undefined) {
          next.maxPeers = Math.max(1, Number(request.maxPeers));
        }
        // Persist, then re-read through the validator so a bad value from the
        // socket cannot bypass the same clamping a hand-edited file gets.
        fs.writeFileSync(dirs.config, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        const reloaded = loadConfig(dirs.config);
        Object.assign(config, reloaded.config);
        await refreshServingState();
        return { config };
      }

      case 'evict-idle':
        return {
          evicted: planIdleEviction(
            currentDrives().map((d) => ({
              regionId: d.regionId,
              bytes: Number(d.bytes) || 0,
              lastRequestedAt: demand[d.regionId]?.lastRequestedAt ?? 0,
              pinned: pins.some((p) => p.regionId === d.regionId),
            })),
            { now: Date.now(), idleEvictionDays: config.idleEvictionDays },
          ),
        };

      default:
        throw new Error(`unknown command: ${String(request.cmd)}`);
    }
  }

  const control = await startControlServer({
    socketPath: dirs.controlSocket,
    handle,
    log,
  });

  await refreshServingState();
  await reconcileSeeds();

  const timers = [
    setInterval(() => void refreshServingState(), POWER_POLL_MS),
    setInterval(() => {
      demand = touchDemand(demand, currentDrives(), Date.now());
    }, POWER_POLL_MS),
    setInterval(() => saveUsage(dirs.usage, { usage, demand, servedBytes24h }), USAGE_FLUSH_MS),
    setInterval(() => void publish(), config.announceIntervalSec * 1000),
  ];
  void publish();

  /** Account for bytes this relay has actually served. */
  function noteServed(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    usage = recordEgress(usage, bytes, Date.now());
    servedBytes24h += bytes;
  }

  return {
    status: buildStatus,
    noteServed,
    bucket,
    async stop() {
      for (const timer of timers) clearInterval(timer);
      await control.close().catch(() => {});
      saveUsage(dirs.usage, { usage, demand, servedBytes24h });
      await core.destroy().catch(() => {});
    },
  };
}

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
