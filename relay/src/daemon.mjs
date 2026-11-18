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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSeedCore } from '../../backend/seed-core.mjs';
import { createTokenBucket, checkEgress, recordEgress } from './budgets.mjs';
import { DEFAULT_CATALOG_URL, loadCatalog } from './catalog.mjs';
import { catalogRegions, mergeManifests } from './manifests.mjs';
import { loadConfig } from './config.mjs';
import { startControlServer } from './control.mjs';
import { planEviction, planIdleEviction, touchDemand } from './demand.mjs';
import { decideServing, readPowerState } from './power.mjs';
import { admitCommand, buildAck, PAIRING_TTL_MS, unwrapBody } from './protocol.mjs';
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
  /** Last catalog load, kept in memory so the picker does not refetch per request. */
  let catalogState = null;
  /** Manifests learned over gossip, newest per region. */
  const gossipedManifests = new Map();
  /**
   * An in-progress QR pairing: a one-time secret, valid for two minutes, that lets
   * one device authorize itself. Never persisted — a restart must not leave a live
   * capability behind — and marked `used` the moment it is redeemed.
   */
  let pairing = null;
  const catalogUrl = config.catalogUrl || process.env.POLARIS_CATALOG_URL || DEFAULT_CATALOG_URL;
  let powerState = {
    power: /** @type {'ac'|'battery'|'unknown'} */ ('unknown'),
    lowPowerMode: false,
  };
  /** @type {string[]} */
  const errors = [];
  /** Command ids already applied. In-memory only: every command is idempotent, and the signed record's expiry bounds a re-apply after a restart. */
  const appliedCommandIds = new Set();
  /**
   * Recently published acks, re-published on every status tick.
   *
   * A Gun peer serves its current graph; it does not keep a history. A one-shot ack
   * write was therefore invisible to a phone that subscribed a minute later — the
   * command arrived (the relay keeps a live subscription) but the confirmation did
   * not, which is exactly the "did my tap do anything?" hole. Re-publishing for 30
   * minutes costs a few hundred bytes per tick and closes it.
   */
  const recentAcks = new Map();
  const ACK_RETENTION_MS = 30 * 60 * 1000;
  const ACK_RETENTION_MAX = 20;

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
      pairing: pairing
        ? { active: !pairing.used && pairing.expiresAt > now(), expiresAt: pairing.expiresAt }
        : null,
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
      republishRecentAcks();
    } catch (err) {
      noteError(`announcement failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Re-send acks that are still inside the retention window (see `recentAcks`). */
  function republishRecentAcks() {
    if (!bus) return;
    const cutoff = now() - ACK_RETENTION_MS;
    for (const [commandId, ack] of recentAcks) {
      if (ack.at < cutoff) {
        recentAcks.delete(commandId);
        continue;
      }
      try {
        bus.publishAck(ack);
      } catch {
        /* the next tick retries */
      }
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

      case 'catalog':
      case 'refresh-catalog': {
        // One loader for both: `refresh-catalog` just refuses the cache. The list is
        // every region the catalog advertises, so the desktop can show a map of the
        // world rather than only what happens to be pinnable today.
        const loaded = await loadCatalog({
          cachePath: dirs.catalog,
          url: catalogUrl,
          now: now(),
          force: request.cmd === 'refresh-catalog',
          log,
        });
        catalogState = loaded;
        const { manifests, problems } = mergeManifests({
          catalog: loaded.catalog,
          gossiped: [...gossipedManifests.values()],
        });
        const regions = catalogRegions(loaded.catalog, manifests, {
          pinnedIds: new Set(pins.map((p) => p.regionId)),
        });

        return {
          fetchedAt: loaded.fetchedAt,
          source: loaded.source,
          error: loaded.error,
          assetTag: loaded.catalog?.assetTag ?? null,
          regions,
          problems,
        };
      }

      case 'pin-region': {
        // Pin by region id using a verified manifest, so a key never has to be
        // copied by hand — and cannot be pasted wrong.
        const regionId = String(request.regionId ?? '');
        if (!regionId) throw new Error('pin-region requires regionId');

        const loaded =
          catalogState ??
          (catalogState = await loadCatalog({
            cachePath: dirs.catalog,
            url: catalogUrl,
            now: now(),
            log,
          }));
        const { manifests } = mergeManifests({
          catalog: loaded.catalog,
          gossiped: [...gossipedManifests.values()],
        });
        const found = manifests.get(regionId);
        if (!found) {
          throw new Error(
            `no verified manifest for ${regionId}: publish one from Polaris Maps, or pin it with an explicit key`,
          );
        }
        return pinRegion({
          regionId,
          driveKey: found.manifest.driveKey,
          version: found.manifest.version,
          bytes: found.manifest.bytes,
        });
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

      case 'catalog':
      case 'refresh-catalog': {
        // One loader for both: `refresh-catalog` just refuses the cache. The result
        // carries verified entries *and* the rejected ones with reasons, so the
        // picker can show "advertised but not trusted" rather than hide it.
        const loaded = await loadCatalog({
          cachePath: dirs.catalog,
          url: catalogUrl,
          now: now(),
          force: request.cmd === 'refresh-catalog',
          log,
        });
        catalogState = loaded;
        const { pinnable, rejected } = loaded.catalog
          ? pinnableRegions(loaded.catalog)
          : { pinnable: [], rejected: [] };

        const pinned = new Set(pins.map((p) => p.regionId));
        return {
          fetchedAt: loaded.fetchedAt,
          source: loaded.source,
          error: loaded.error,
          regions: pinnable.map((region) => ({ ...region, pinned: pinned.has(region.regionId) })),
          rejected,
        };
      }

      case 'pin-region': {
        // Pin by region id using the verified manifest, so a key never has to be
        // copied by hand (and cannot be pasted wrong).
        const regionId = String(request.regionId ?? '');
        if (!regionId) throw new Error('pin-region requires regionId');
        const loaded =
          catalogState ??
          (catalogState = await loadCatalog({
            cachePath: dirs.catalog,
            url: catalogUrl,
            now: now(),
            log,
          }));
        if (!loaded.catalog) {
          throw new Error(
            `the region catalog is unavailable${loaded.error ? ` (${loaded.error})` : ''}`,
          );
        }
        const { pinnable, rejected } = pinnableRegions(loaded.catalog);
        const region = pinnable.find((entry) => entry.regionId === regionId);
        if (!region) {
          const why = rejected.find((entry) => entry.regionId === regionId)?.reason;
          throw new Error(
            why
              ? `cannot pin ${regionId}: ${why}`
              : `${regionId} is not in the catalog with a signed manifest`,
          );
        }
        return pinRegion({
          regionId: region.regionId,
          driveKey: region.driveKey,
          version: region.version,
          bytes: region.bytes,
        });
      }

      case 'pairing-start': {
        // The Mac app draws this secret as a QR code. Returned only over the local
        // socket, so it can never be read off the gossip channel.
        const secret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        pairing = { secret, expiresAt: now() + PAIRING_TTL_MS, used: false };
        return {
          relayPubkey: identity.publicKey,
          secret,
          expiresAt: pairing.expiresAt,
          payload: `polaris://pair?relay=${identity.publicKey}&secret=${secret}`,
        };
      }

      case 'pairing-cancel':
        pairing = null;
        return { pairing: null };

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
      pairing,
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

    // A pairing is redeemed exactly once, and authorizes the signing device.
    if (command.cmd === 'pair') {
      if (pairing) pairing = { ...pairing, used: true };
      const label = String(command.args?.label ?? 'phone');
      const applied = applyAuthorize(devices, { pubkey: command.devicePubkey, label }, now());
      devices = applied.devices;
      saveDevices(dirs.devices, devices);
      log(`[relay] paired a device: ${label} (${command.devicePubkey.slice(0, 12)}…)`);
      await publishStatus({ force: true });
      sendAck(command, true, `paired as ${applied.device.pubkey.slice(0, 12)}`, null);
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
    const ack = buildAck({
      commandId: command.commandId,
      relayPubkey: identity.publicKey,
      ok,
      result,
      error,
      at: now(),
      privateKey: identity.privateKey,
    });
    recentAcks.set(command.commandId, ack);
    while (recentAcks.size > ACK_RETENTION_MAX) {
      const oldest = [...recentAcks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!oldest) break;
      recentAcks.delete(oldest[0]);
    }
    try {
      bus.publishAck(ack);
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
    // Manifests published by devices are how the desktop learns canonical keys for
    // regions the bundled set does not cover. Verified in `mergeManifests`, not here.
    bus.subscribeManifests?.((manifest) => {
      if (!manifest || typeof manifest !== 'object' || !manifest.regionId) return;
      gossipedManifests.set(String(manifest.regionId), manifest);
      catalogState = null; // force a re-merge on the next catalog read
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
