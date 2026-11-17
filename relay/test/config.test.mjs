import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_CONFIG, loadConfig, validateConfig } from '../src/config.mjs';

test('a missing config is created from defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-'));
  const file = path.join(dir, 'config.json');

  const result = loadConfig(file);
  assert.equal(result.created, true);
  assert.deepEqual(result.config, DEFAULT_CONFIG);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), DEFAULT_CONFIG);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a corrupt config falls back to defaults instead of throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{ not json');

  const result = loadConfig(file);
  assert.deepEqual(result.config, DEFAULT_CONFIG);
  assert.match(result.warnings[0], /could not be parsed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('out-of-range numbers are clamped with a warning', () => {
  const { config, warnings } = validateConfig({ packStoreBytes: 1, maxPeers: 10_000 });
  assert.equal(config.packStoreBytes, 1024 ** 3);
  assert.equal(config.maxPeers, 1024);
  assert.equal(warnings.length, 2);
});

test('booleans of the wrong type keep the default', () => {
  const { config, warnings } = validateConfig({ seedOnBattery: 'yes', publishAnnouncements: true });
  assert.equal(config.seedOnBattery, false);
  assert.equal(config.publishAnnouncements, true);
  assert.match(warnings[0], /must be a boolean/);
});

test('unknown keys are reported, not silently accepted', () => {
  const { warnings } = validateConfig({ seedEverywhereAlways: true });
  assert.match(warnings[0], /unknown config key ignored: seedEverywhereAlways/);
});

test('the default is to seed only on AC power and unmetered links', () => {
  assert.equal(DEFAULT_CONFIG.seedOnBattery, false);
  assert.equal(DEFAULT_CONFIG.seedOnMetered, false);
});

test('numbers given as strings are coerced (hand-edited config files)', () => {
  const { config } = validateConfig({ maxPeers: '12' });
  assert.equal(config.maxPeers, 12);
});
