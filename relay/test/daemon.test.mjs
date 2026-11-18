import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { controlRequest } from '../src/control.mjs';
import { startDaemon } from '../src/daemon.mjs';
import { loadSeeds, saveSeeds, applyPin, applyUnpin, loadUsage, saveUsage } from '../src/state.mjs';

/**
 * A bus stand-in. Tests must never reach the real Gun network: it keeps sockets
 * open (so the test process never exits) and would make the suite depend on a
 * third-party relay being up.
 */
function stubBus() {
  const published = [];
  const acks = [];
  return {
    published,
    acks,
    publishStatus: (record) => published.push(record),
    publishAck: (ack) => acks.push(ack),
    subscribeCommands: (_relayPubkey, _handler) => {},
    close: () => {},
  };
}

/** A swarm stand-in: the daemon's contract with it is on/join/connections. */
function stubSwarm() {
  return {
    on() {},
    join: () => ({ flushed: async () => {}, destroy: async () => {} }),
    connections: new Set(),
    destroy: async () => {},
  };
}

function relayHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-relay-test-'));
}

test('the daemon serves, pins, pauses and resumes over the control socket', async () => {
  const home = relayHome();
  const env = { POLARIS_RELAY_HOME: home };
  const { relayPaths } = await import('../src/paths.mjs');
  const paths = relayPaths(env);

  const daemon = await startDaemon({
    paths,
    log: () => {},
    overrides: {
      createSwarm: stubSwarm,
      createBus: stubBus,
      readPowerState: async () => ({ power: 'ac', lowPowerMode: false }),
    },
  });

  try {
    const status = await controlRequest(paths.controlSocket, { cmd: 'status' });
    assert.equal(status.serving, true);
    assert.equal(status.power, 'ac');
    assert.deepEqual(status.drives, []);
    assert.equal(typeof status.relayPubkey, 'string');
    assert.equal(status.relayPubkey.length, 64);

    // Pin a region by canonical key: the daemon opens a read-only replica and
    // never authors — nothing here supplies a pack directory.
    const driveKey = 'ab'.repeat(32);
    const pinned = await controlRequest(paths.controlSocket, {
      cmd: 'pin',
      regionId: 'us-ny-new-york',
      driveKey,
      version: 'map-data-2026-01',
    });
    assert.equal(pinned.refused, false);

    const afterPin = await controlRequest(paths.controlSocket, { cmd: 'status' });
    assert.deepEqual(
      afterPin.drives.map((d) => d.regionId),
      ['us-ny-new-york'],
    );
    assert.equal(afterPin.drives[0].readOnly, true);
    assert.equal(afterPin.drives[0].key, driveKey);

    // The pin is persisted, not just in-memory.
    assert.deepEqual(
      loadSeeds(paths.seeds).pins.map((p) => [p.regionId, p.driveKey]),
      [['us-ny-new-york', driveKey]],
    );

    // Pausing releases the drives, so a phone stops seeing this relay as coverage.
    const paused = await controlRequest(paths.controlSocket, { cmd: 'pause' });
    assert.equal(paused.serving, false);
    assert.equal(paused.reason, 'paused by user');
    assert.deepEqual((await controlRequest(paths.controlSocket, { cmd: 'status' })).drives, []);

    const resumed = await controlRequest(paths.controlSocket, { cmd: 'resume' });
    assert.equal(resumed.serving, true);
    assert.equal((await controlRequest(paths.controlSocket, { cmd: 'status' })).drives.length, 1);

    // A pin without a canonical key is rejected outright: authoring from a pin is
    // the one thing the relay must never do.
    await assert.rejects(
      () => controlRequest(paths.controlSocket, { cmd: 'pin', regionId: 'x', driveKey: 'nope' }),
      /canonical driveKey/,
    );

    // Budgets round-trip through config.json and are clamped on reload.
    const budget = await controlRequest(paths.controlSocket, {
      cmd: 'set-budget',
      egressGb: 250,
      seedOnBattery: true,
    });
    assert.equal(budget.config.egressBytesPerMonth, 250 * 1000 ** 3);
    assert.equal(budget.config.seedOnBattery, true);

    const unpinned = await controlRequest(paths.controlSocket, {
      cmd: 'unpin',
      regionId: 'us-ny-new-york',
    });
    assert.deepEqual(unpinned.pins, []);
    assert.deepEqual(loadSeeds(paths.seeds).pins, []);
  } finally {
    await daemon.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('on battery the daemon stops serving and reports why, unless opted in', async () => {
  const home = relayHome();
  const { relayPaths } = await import('../src/paths.mjs');
  const paths = relayPaths({ POLARIS_RELAY_HOME: home });

  const daemon = await startDaemon({
    paths,
    log: () => {},
    overrides: {
      createSwarm: stubSwarm,
      createBus: stubBus,
      readPowerState: async () => ({ power: 'battery', lowPowerMode: false }),
    },
  });

  try {
    const status = await controlRequest(paths.controlSocket, { cmd: 'status' });
    assert.equal(status.serving, false);
    assert.equal(status.pauseReason, 'on battery power');

    // The user can override it, and the change takes effect without a restart.
    await controlRequest(paths.controlSocket, { cmd: 'set-budget', seedOnBattery: true });
    const optedIn = await controlRequest(paths.controlSocket, { cmd: 'status' });
    assert.equal(optedIn.serving, true);
  } finally {
    await daemon.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a second daemon on the same root replaces the stale socket', async () => {
  const home = relayHome();
  const { relayPaths } = await import('../src/paths.mjs');
  const paths = relayPaths({ POLARIS_RELAY_HOME: home });

  const overrides = {
    createSwarm: stubSwarm,
    createBus: stubBus,
    readPowerState: async () => ({ power: 'ac', lowPowerMode: false }),
  };

  const first = await startDaemon({ paths, log: () => {}, overrides });
  // Simulate a crash: the socket file stays behind with no listener.
  await first.stop();
  fs.writeFileSync(paths.controlSocket, '');

  const second = await startDaemon({ paths, log: () => {}, overrides });
  try {
    const status = await controlRequest(paths.controlSocket, { cmd: 'status' });
    assert.equal(status.serving, true);
  } finally {
    await second.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('seeds: invalid pins are dropped rather than seeded uncontrolled', () => {
  const home = relayHome();
  const file = path.join(home, 'seeds.json');
  saveSeeds(
    file,
    /** @type {any} */ ([
      { regionId: 'good', version: 'v1', driveKey: 'ff'.repeat(32), pinnedAt: 1 },
      { regionId: 'no-key', version: 'v1', pinnedAt: 1 },
      { regionId: 'short-key', version: 'v1', driveKey: 'abcd', pinnedAt: 1 },
    ]),
  );

  const { pins, dropped } = loadSeeds(file);
  assert.equal(dropped, 2);
  assert.deepEqual(
    pins.map((p) => p.regionId),
    ['good'],
  );
  fs.rmSync(home, { recursive: true, force: true });
});

test('seeds: re-pinning updates the key but keeps the original pin time', () => {
  const applied = applyPin([], { regionId: 'a', driveKey: 'aa'.repeat(32) }, 100);
  const repinned = applyPin(applied.pins, { regionId: 'a', driveKey: 'bb'.repeat(32) }, 500);
  assert.equal(repinned.pin.pinnedAt, 100);
  assert.equal(repinned.pin.driveKey, 'bb'.repeat(32));
  assert.equal(repinned.pins.length, 1);
  assert.deepEqual(applyUnpin(repinned.pins, 'a'), []);
});

test('usage state survives a round trip and tolerates a missing file', () => {
  const home = relayHome();
  const file = path.join(home, 'state', 'usage.json');

  assert.deepEqual(loadUsage(file), {
    usage: { month: '', bytes: 0 },
    demand: {},
    servedBytes24h: 0,
  });

  saveUsage(file, {
    usage: { month: '2026-02', bytes: 42 },
    demand: { 'us-ny-new-york': { lastRequestedAt: 7 } },
    servedBytes24h: 42,
  });
  assert.deepEqual(loadUsage(file), {
    usage: { month: '2026-02', bytes: 42 },
    demand: { 'us-ny-new-york': { lastRequestedAt: 7 } },
    servedBytes24h: 42,
  });
  fs.rmSync(home, { recursive: true, force: true });
});

test('shutdown acknowledges before stopping, so a caller can tell it from a crash', async () => {
  const home = relayHome();
  const { relayPaths } = await import('../src/paths.mjs');
  const paths = relayPaths({ POLARIS_RELAY_HOME: home });

  let shutdownRequested = false;
  const daemon = await startDaemon({
    paths,
    log: () => {},
    onShutdownRequest: () => {
      shutdownRequested = true;
    },
    overrides: {
      createSwarm: stubSwarm,
      createBus: stubBus,
      readPowerState: async () => ({ power: 'ac', lowPowerMode: false }),
    },
  });

  try {
    await controlRequest(paths.controlSocket, {
      cmd: 'pin',
      regionId: 'us-ny-new-york',
      driveKey: 'ab'.repeat(32),
    });

    const reply = await controlRequest(paths.controlSocket, { cmd: 'shutdown' });
    assert.deepEqual(reply, { stopping: true, serving: false });

    // The teardown is scheduled so the reply above is written first.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(shutdownRequested, true);
  } finally {
    await daemon.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a signed command from an authorized device is applied and acknowledged', async () => {
  const { schnorr } = await import('@noble/curves/secp256k1');
  const { buildCommand, verifyAck } = await import('../src/protocol.mjs');

  const home = relayHome();
  const { relayPaths } = await import('../src/paths.mjs');
  const paths = relayPaths({ POLARIS_RELAY_HOME: home });

  const bus = stubBus();
  const daemon = await startDaemon({
    paths,
    log: () => {},
    overrides: {
      createSwarm: stubSwarm,
      createBus: () => bus,
      readPowerState: async () => ({ power: 'ac', lowPowerMode: false }),
    },
  });

  try {
    const status = daemon.status();
    const relayPubkey = status.relayPubkey;

    // A device the user has authorized on the relay.
    const devicePrivate = new Uint8Array(32).fill(0x44);
    const devicePubkey = Buffer.from(schnorr.getPublicKey(devicePrivate)).toString('hex');
    await controlRequest(paths.controlSocket, {
      cmd: 'authorize',
      devicePubkey,
      label: "Andrew's iPhone",
    });

    const command = buildCommand({
      commandId: 'cmd-authorized-1',
      devicePubkey,
      relayPubkey,
      cmd: 'pause',
      now: Date.now(),
      privateKey: devicePrivate,
    });

    await daemon.applyRemoteCommand(command);

    // Applied: the relay really did stop serving, and said so with a signed ack.
    assert.equal(daemon.status().serving, false);
    assert.equal(daemon.status().pauseReason, 'paused by user');

    const ack = bus.acks.at(-1);
    assert.ok(ack, 'the relay published an ack');
    assert.equal(ack.ok, true);
    assert.equal(ack.commandId, 'cmd-authorized-1');
    assert.equal(verifyAck(ack, relayPubkey), true);

    // Replaying the same command must not re-apply it.
    const before = bus.acks.length;
    await daemon.applyRemoteCommand(command);
    assert.equal(bus.acks.length, before);
    assert.equal(daemon.status().serving, false);
  } finally {
    await daemon.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a signed command from an unauthorized device is refused, not ignored', async () => {
  const { schnorr } = await import('@noble/curves/secp256k1');
  const { buildCommand, verifyAck } = await import('../src/protocol.mjs');

  const home = relayHome();
  const { relayPaths } = await import('../src/paths.mjs');
  const paths = relayPaths({ POLARIS_RELAY_HOME: home });

  const bus = stubBus();
  const daemon = await startDaemon({
    paths,
    log: () => {},
    overrides: {
      createSwarm: stubSwarm,
      createBus: () => bus,
      readPowerState: async () => ({ power: 'ac', lowPowerMode: false }),
    },
  });

  try {
    const relayPubkey = daemon.status().relayPubkey;
    const strangerPrivate = new Uint8Array(32).fill(0x55);
    const strangerPubkey = Buffer.from(schnorr.getPublicKey(strangerPrivate)).toString('hex');

    await daemon.applyRemoteCommand(
      buildCommand({
        commandId: 'cmd-stranger-1',
        devicePubkey: strangerPubkey,
        relayPubkey,
        cmd: 'pause',
        now: Date.now(),
        privateKey: strangerPrivate,
      }),
    );

    // The relay keeps serving: a stranger cannot stop somebody's seeder.
    assert.equal(daemon.status().serving, true);

    // But the refusal is acknowledged, so the dashboard can explain it.
    const ack = bus.acks.at(-1);
    assert.ok(ack, 'refusals are acknowledged');
    assert.equal(ack.ok, false);
    assert.match(ack.error, /not authorized/);
    assert.equal(verifyAck(ack, relayPubkey), true);
  } finally {
    await daemon.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
