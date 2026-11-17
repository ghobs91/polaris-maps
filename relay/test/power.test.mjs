import assert from 'node:assert/strict';
import test from 'node:test';

import { decideServing, parseLowPowerMode, parsePowerSource } from '../src/power.mjs';

const AC = "Now drawing from 'AC Power'\n";
const BATTERY =
  "Now drawing from 'Battery Power'\n  -InternalBattery-0 (id=1234567)\t88%; discharging; 4:12 remaining present: true\n";

test('parsePowerSource reads AC and battery', () => {
  assert.equal(parsePowerSource(AC), 'ac');
  assert.equal(parsePowerSource(BATTERY), 'battery');
  assert.equal(parsePowerSource('garbage'), 'unknown');
  assert.equal(parsePowerSource(''), 'unknown');
});

test('parseLowPowerMode reads the lowpowermode key', () => {
  assert.equal(parseLowPowerMode(' lowpowermode         1 \n'), true);
  assert.equal(parseLowPowerMode(' lowpowermode         0 \n'), false);
  // Absent key means "not low power mode", not unknown.
  assert.equal(parseLowPowerMode(' displaysleep 10\n'), false);
});

const base = {
  power: /** @type {const} */ ('ac'),
  lowPowerMode: false,
  metered: false,
  seedOnBattery: false,
  seedOnMetered: false,
  manuallyPaused: false,
  egress: { allowed: true, reason: null },
};

test('serves on AC with an unmetered link', () => {
  assert.deepEqual(decideServing(base), { serving: true, reason: null });
});

test('stops on battery by default and says why', () => {
  const decision = decideServing({ ...base, power: 'battery' });
  assert.equal(decision.serving, false);
  assert.equal(decision.reason, 'on battery power');
});

test('the user can opt into seeding on battery', () => {
  const decision = decideServing({ ...base, power: 'battery', seedOnBattery: true });
  assert.equal(decision.serving, true);
});

test('an unknown power source is treated as battery', () => {
  // `pmset` output changing shape must not become "seed on a tethered link".
  const decision = decideServing({ ...base, power: 'unknown' });
  assert.equal(decision.serving, false);
  assert.equal(decision.reason, 'power source unknown');
});

test('Low Power Mode stops serving even on AC', () => {
  const decision = decideServing({ ...base, lowPowerMode: true });
  assert.equal(decision.serving, false);
  assert.equal(decision.reason, 'Low Power Mode is on');
});

test('metered links stop serving unless the user opted in', () => {
  assert.equal(decideServing({ ...base, metered: true }).serving, false);
  assert.equal(decideServing({ ...base, metered: true, seedOnMetered: true }).serving, true);
});

test('a manual pause wins over every other condition', () => {
  const decision = decideServing({ ...base, manuallyPaused: true });
  assert.equal(decision.serving, false);
  assert.equal(decision.reason, 'paused by user');
});

test('the egress cap stops serving and reports the cap as the reason', () => {
  const decision = decideServing({
    ...base,
    egress: { allowed: false, reason: 'monthly egress cap reached (500/500 bytes)' },
  });
  assert.equal(decision.serving, false);
  assert.match(decision.reason, /monthly egress cap reached/);
});
