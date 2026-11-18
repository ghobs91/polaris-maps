/**
 * The relay daemon.
 *
 * Lifecycle is deliberately boring: load state, seed what is pinned, answer the
 * control socket, poll power, publish status, apply signed remote commands, exit
 * cleanly on a signal. Everything interesting lives in a module that can be tested
 * without a process (`budgets`, `demand`, `power`, `config`, `state`, `announce`,
 * `protocol`); this file is the wiring, and it is the only place that touches the
 * filesystem destructively.
 *
 * Two structural decisions worth stating:
 *
 * **Pausing means unseeding.** A relay that "pauses" by keeping its swarm open
 * still accepts connections and still holds discovery topics, so a phone would
 * still see it as coverage. Releasing the drives is the only honest signal.
 *
 * **Two ways in, one implementation.** The local Unix socket (this machine, via
 * the CLI or the menu-bar controller) and signed Gun commands (a phone anywhere)
 * both funnel into the same `handle()` switch. A remote command is just a locally
 * authorized request with a signature and an expiry attached, so the two can never
 * drift into different behaviour.
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
import { admitCommand, buildAck, unwrapBody } from './protocol.mjs';
import {
  applyAuthorize,
  applyPin,
  applyRevoke,
  applyUnpin,
  loadDevices,
  loadSeeds,
  loadUsage,
  saveDevices,
  saveSeeds,
  saveUsage,
} from './state.mjs';

const POWER_POLL_MS = 60_000;
const USAGE_FLUSH_MS = 30_000;
const IDENTITY_FILE = 'identity.json';
/** How many recent errors `status` reports, for the dashboard's diagnostics line. */
const MAX_RECORDED_ERRORS = 5;

/**
 * Load or create the relay's own identity.
 *
 * A relay identity is separate from any phone's: it signs status announcements
 * and command acks, and nothing else. Created on first run, stored 0600.
 *
 * @param {string} stateDir
 * @returns {Promise<{ privateKey: Uint8Array, publicKey: string }>}
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
 * @param {() => void} [options.onShutdownRequest] invoked after a `shutdown`
 *   command has been acknowledged, so the host can tear down and exit. The daemon
 *   does not call `process.exit` itself — that keeps it testable.
 * @param {{
 *   createSwarm?: () => any,
 *   readPowerState?: typeof readPowerState,
 *   createBus?: (context: { relayPubkey: string }) => Promise<any> | any,
 *   now?: () => number,
 * }} [options.overrides]
 */
export async function startDaemon({
  paths: dirs,
  log = console.log,
  onShutdownRequest,
  overrides = {},
}) {
  for (const dir of [dirs.root, dirs.corestore, dirs.state]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const { config, warnings } = loadConfig(dirs.config);
  const { pins: initialPins, dropped } = loadSeeds(dirs.seeds);
  const usageState = loadUsage(dirs.usage);
  const identity = await loadIdentity(dirs.state);
  const now = overrides.now ?? (() => Date.now());
  const startedAt = now();

  let pins = initialPins;
  let devices = loadDevices(dirs.devices).devices;
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
  /** @type {string[]} */
  const errors = [];
  /** Command ids already applied. In-memory only: every command is idempotent, and the signed record's expiry bounds a re-apply after a restart. */
  const appliedCommandIds = new Set();

  const bucket = createTokenBucket({
    bytesPerSecond: config.maxBitsPerSecond / 8,
    capacityBytes: (config.maxBitsPerSecond / 8) * 5,
  });

  const seeded = new Set();
  let bus = null;
  let lastPublishedAt = 0;

  function noteError(message) {
    errors.unshift(`${new Date(now()).toISOString()} ${message}`);
    errors.length = Math.min(errors.length, MAX_RECORDED_ERRORS);
  }

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
        const message = err instanceof Error ? err.message : String(err);
        noteError(`could not seed ${pin.regionId}: ${message}`);
        log(`[relay] could not seed ${pin.regionId}: ${message}`);
      }
    }
  }

  async function refreshServingState() {
    powerState = await powerReader();
    const egress = checkEgress(usage, config.egressBytesPerMonth, now());
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

  /** Everything the dashboard renders, and everything the announcement carries. */
  function buildStatus() {
    return {
      version: 2,
      serving: serving.serving,
      pauseReason: serving.reason,
      power: powerState.power,
      lowPowerMode: powerState.lowPowerMode,
      metered: linkMetered,
      relayPubkey: identity.publicKey,
      uptimeSec: Math.max(0, Math.round((now() - startedAt) / 1000)),
      drives: currentDrives().map((drive) => ({
        ...drive,
        pinned: pins.some((p) => p.regionId === drive.regionId),
        lastRequestedAt: demand[drive.regionId]?.lastRequestedAt ?? 0,
      })),
      pins: pins.map((p) => ({ regionId: p.regionId, version: p.version, pinnedAt: p.pinnedAt })),
      devices: devices.map((d) => ({
        pubkey: d.pubkey,
        label: d.label,
        authorizedAt: d.authorizedAt,
      })),
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
        maxBitsPerSecondPerPeer: config.maxBitsPerSecondPerPeer,
      },
      preferences: {
        seedOnBattery: config.seedOnBattery,
        seedOnMetered: config.seedOnMetered,
        pausedByUser,
      },
      configWarnings: warnings,
      errors,
    };
  }

  /** Publish the signed status record the app reads and verifies. */
  async function publishStatus({ force = false } = {}) {
    if (!config.publishAnnouncements) return;
    if (!bus) return;
    const at = now();
    // Cheap guard against publish storms from rapid command application; the
    // dashboard polls status on its own cadence anyway.
    if (!force && at - lastPublishedAt < 1_000) return;
    lastPublishedAt = at;

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
      updatedAt: at,
      // The dashboard needs the rest of the picture, and a second channel for it
      // would be a second thing to verify. It rides inside the same signed record.
      status,
    });

    try {
      bus.publishStatus(announcement);
    } catch (err) {
      noteError(`announcement failed: ${err instanceof Error ? err.message : String(err)}`);
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
      now: now(),
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

  /** Persist and re-validate budgets, so a socket or gossip value is clamped identically to a hand-edited file. */
  async function applyBudget(request) {
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
    if (request.seedOnMetered !== undefined) {
      next.seedOnMetered = request.seedOnMetered === true || request.seedOnMetered === 'true';
    }
    if (request.maxPeers !== undefined) {
      next.maxPeers = Math.max(1, Number(request.maxPeers));
    }
    fs.writeFileSync(dirs.config, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    const reloaded = loadConfig(dirs.config);
    Object.assign(config, reloaded.config);
    await refreshServingState();
    return { config };
  }

  async function pinRegion(request) {
    const regionId = String(request.regionId ?? '');
    const driveKey = String(request.driveKey ?? '');
    if (!regionId) throw new Error('pin requires regionId');
    if (!/^[0-9a-f]{64}$/i.test(driveKey)) {
      throw new Error('pin requires a canonical driveKey (64 hex characters)');
    }

    const applied = applyPin(
      pins,
      { regionId, version: request.version ? String(request.version) : undefined, driveKey },
      now(),
    );
    pins = applied.pins;
    saveSeeds(dirs.seeds, pins);

    const plan = await ensureBudget(Number(request.bytes) || 0);
    if (plan.refused) {
      // The pin is kept (the user asked for it) but reported as unmeetable, so the
      // UI can say "raise the budget" instead of pretending it seeded.
      return { pin: applied.pin, refused: true, reason: plan.reason };
    }

    await reconcileSeeds();
    return { pin: applied.pin, refused: false, reason: null };
  }

  /**
   * One switch for both entry points: the local socket and signed Gun commands.
   *
   * @param {{ cmd: string, [key: string]: unknown }} request
   */
  async function handle(request) {
    switch (request.cmd) {
      case 'status':
        return buildStatus();

      case 'pin':
        return pinRegion(request);

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

      case 'set-budget':
        return applyBudget(request);

      case 'authorize': {
        const pubkey = String(request.devicePubkey ?? '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(pubkey)) {
          throw new Error('authorize requires a 64-hex device pubkey');
        }
        const applied = applyAuthorize(
          devices,
          { pubkey, label: request.label ? String(request.label) : undefined },
          now(),
        );
        devices = applied.devices;
        saveDevices(dirs.devices, devices);
        return { devices };
      }

      case 'revoke': {
        devices = applyRevoke(devices, String(request.devicePubkey ?? '').toLowerCase());
        saveDevices(dirs.devices, devices);
        return { devices };
      }

      case 'evict-idle': {
        const idle = planIdleEviction(
          currentDrives().map((d) => ({
            regionId: d.regionId,
            bytes: Number(d.bytes) || 0,
            lastRequestedAt: demand[d.regionId]?.lastRequestedAt ?? 0,
            pinned: pins.some((p) => p.regionId === d.regionId),
          })),
          { now: now(), idleEvictionDays: config.idleEvictionDays },
        );
        return { evicted: idle };
      }

      case 'refresh':
        await publishStatus({ force: true });
        return { publishedAt: now() };

      case 'shutdown':
        // A user asking the relay to quit means quit — stop seeding, then leave.
        // The reply is scheduled, not returned-and-forgotten: the socket has to
        // report success before it closes, or the caller sees "closed without a
        // reply" and cannot tell a clean stop from a crash.
        if (onShutdownRequest) setTimeout(onShutdownRequest, 100);
        return { stopping: true, serving: false };

      default:
        throw new Error(`unknown command: ${String(request.cmd)}`);
    }
  }

  /**
   * Apply a command that arrived over the gossip channel.
   *
   * Every path here ends in a signed ack — including refusals — because the
   * dashboard has to be able to tell "the relay ignored me" from "the network ate
   * my command". A refusal is a result, not silence.
   */
  async function applyRemoteCommand(raw) {
    const command = unwrapBody(raw);
    if (!command || typeof command.cmd !== 'string') return;

    const admission = admitCommand(command, {
      relayPubkey: identity.publicKey,
      authorizedDevices: devices.map((d) => d.pubkey),
      now: now(),
      appliedCommandIds,
    });

    if (!admission.allowed) {
      log(`[relay] refused remote command ${command.commandId}: ${admission.reason}`);
      // Not marked applied: an unauthorized device may be authorized later, and a
      // command that was only early must not be swallowed.
      if (admission.reason !== 'command was already applied' && bus) {
        sendAck(command, false, null, admission.reason);
      }
      return;
    }

    appliedCommandIds.add(command.commandId);
    try {
      const result = await handle({ cmd: command.cmd, ...command.args });
      log(`[relay] applied remote command ${command.cmd} (${command.commandId.slice(0, 8)})`);
      // Publish immediately: the dashboard's next read should already reflect it.
      await publishStatus({ force: true });
      sendAck(command, true, summarise(result), null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      noteError(`remote ${command.cmd} failed: ${message}`);
      sendAck(command, false, null, message);
    }
  }

  function summarise(result) {
    if (result === null || result === undefined) return '';
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result);
    } catch {
      return '';
    }
  }

  function sendAck(command, ok, result, error) {
    if (!bus) return;
    try {
      bus.publishAck(
        buildAck({
          commandId: command.commandId,
          relayPubkey: identity.publicKey,
          ok,
          result,
          error,
          at: now(),
          privateKey: identity.privateKey,
        }),
      );
    } catch (err) {
      noteError(`ack failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const control = await startControlServer({
    socketPath: dirs.controlSocket,
    handle,
    log,
  });

  // The bus is created after the control socket so a relay that cannot reach Gun
  // still works locally (CLI + menu bar), which is the common debugging case.
  const busFactory =
    overrides.createBus ??
    (async ({ relayPubkey }) =>
      (await import('./gun-bus.mjs')).createRelayBus({
        log,
        onConnected: () => log(`[relay] gossip channel up for ${relayPubkey.slice(0, 12)}…`),
      }));

  try {
    bus = await busFactory({ relayPubkey: identity.publicKey });
    bus.subscribeCommands?.(identity.publicKey, (raw) => {
      void applyRemoteCommand(raw);
    });
  } catch (err) {
    noteError(`gossip channel unavailable: ${err instanceof Error ? err.message : String(err)}`);
    log('[relay] gossip channel unavailable — remote control disabled for this session');
  }

  await refreshServingState();
  await reconcileSeeds();
  await publishStatus({ force: true });

  const timers = [
    setInterval(() => void refreshServingState(), POWER_POLL_MS),
    setInterval(() => {
      demand = touchDemand(demand, currentDrives(), now());
    }, POWER_POLL_MS),
    setInterval(() => saveUsage(dirs.usage, { usage, demand, servedBytes24h }), USAGE_FLUSH_MS),
    setInterval(() => void publishStatus({ force: true }), config.announceIntervalSec * 1000),
  ];

  /** Account for bytes this relay has actually served. */
  function noteServed(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    usage = recordEgress(usage, bytes, now());
    servedBytes24h += bytes;
  }

  return {
    status: buildStatus,
    handle,
    noteServed,
    bucket,
    /** Test hook: deliver a command as if it had arrived over the wire. */
    applyRemoteCommand,
    async stop() {
      for (const timer of timers) clearInterval(timer);
      await control.close().catch(() => {});
      try {
        bus?.close?.();
      } catch {
        /* best effort */
      }
      saveUsage(dirs.usage, { usage, demand, servedBytes24h });
      await core.destroy().catch(() => {});
    },
  };
}

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
