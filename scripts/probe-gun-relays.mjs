#!/usr/bin/env node
/**
 * Verify that a Gun relay is actually usable before shipping it as a seed.
 *
 * The public Gun network is small and volatile: the `gun-*.herokuapp.com` demo
 * hosts that most apps seeded died with Heroku's free tier, and several hosts
 * that still accept a WebSocket upgrade are somebody's private deployment
 * rather than public infrastructure. "It answers HTTP" is not evidence — a
 * deleted Heroku app answers 404 with an HTML page, which is exactly how three
 * dead seeds stayed in `src/services/gun/init.ts` for years.
 *
 * So this script checks the two things that matter:
 *
 *   1. handshake  — the WebSocket upgrade succeeds and the host speaks the Gun
 *                   wire protocol (it greets with a `dam` frame).
 *   2. replicate  — a record written by one client is read back by a *second*
 *                   client through the same relay. This is the real test: it
 *                   is what the app's POI edits, reviews and place lists need.
 *
 * Usage:
 *   node scripts/probe-gun-relays.mjs [url...] [options]
 *
 * Options:
 *   --timeout <ms>   Per-relay handshake timeout (default 8000)
 *   --settle <ms>    Wait after each write before reading it back (default 4000)
 *   --json           Machine-readable output
 *   --help           Show this text
 *
 * With no URLs it probes the seeds shipped in `src/services/gun/init.ts`, so a
 * maintainer can check the real list without copying it.
 *
 * Exit codes: 0 every probed relay replicated, 1 any relay failed.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INIT_PATH = resolve(ROOT, 'src/services/gun/init.ts');

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

function flag(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return fallback;
  const value = Number(argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const TIMEOUT_MS = flag('--timeout', 8000);
const SETTLE_MS = flag('--settle', 4000);
const JSON_OUT = argv.includes('--json');

const positional = argv.filter((arg, i) => {
  if (arg.startsWith('--')) return false;
  const prev = argv[i - 1];
  return !(prev === '--timeout' || prev === '--settle');
});

/**
 * Read the shipped seed list out of the app source.
 *
 * Parsing the source (rather than keeping a second copy here) means the script
 * can never verify a list the app does not actually ship.
 */
function shippedSeeds() {
  const source = readFileSync(INIT_PATH, 'utf8');
  const match = source.match(/const SEED_RELAYS\s*=\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error(`Could not find SEED_RELAYS in ${INIT_PATH}`);
  return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
}

function toWebSocketUrl(url) {
  const trimmed = url.trim();
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  return trimmed;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Step 1: does the host accept the upgrade and speak Gun? */
function handshake(url, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    let settled = false;
    let socket;

    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      resolvePromise({ ok, detail, latencyMs: ok ? Date.now() - started : 0 });
    };

    const timer = setTimeout(() => finish(false, 'no frame within timeout'), timeoutMs);

    try {
      socket = new WebSocket(toWebSocketUrl(url));
    } catch (err) {
      finish(false, `constructor threw: ${err.message}`);
      return;
    }

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ '#': 'probe', get: { 'polaris-probe': { '#': 'x' } } }));
      } catch {
        finish(false, 'send failed');
      }
    };
    socket.onmessage = (event) => finish(true, String(event.data).slice(0, 80));
    socket.onerror = () => finish(false, 'socket error');
    socket.onclose = () => finish(false, 'closed before any frame');
  });
}

/** Step 2: write on one connection, read on a second. */
async function replicate(url, Gun) {
  const ns = `polaris-probe-${Math.random().toString(36).slice(2, 10)}`;
  const value = `v${Date.now()}`;
  const memory = () => {
    const store = new Map();
    return {
      get: (key, cb) => cb(null, store.get(key) ?? null),
      put: (key, val, cb) => {
        store.set(key, val);
        cb(null);
      },
    };
  };
  const opts = () => ({
    peers: [toWebSocketUrl(url)],
    radisk: false,
    localStorage: false,
    store: memory(),
  });

  const writer = Gun(opts());
  await sleep(2500);
  writer.get(ns).put({ hello: value });
  await sleep(SETTLE_MS);

  let seen = null;
  const reader = Gun(opts());
  await sleep(2000);
  reader.get(ns).on((data) => {
    if (data && data.hello) seen = data.hello;
  });
  await sleep(SETTLE_MS + 1000);

  try {
    writer.off();
    reader.off();
  } catch {
    /* ignore */
  }

  return seen === value;
}

async function main() {
  const targets = positional.length > 0 ? positional : shippedSeeds();
  if (targets.length === 0) {
    console.error('No relays to probe.');
    process.exit(1);
  }

  let Gun = null;
  try {
    Gun = require('gun');
  } catch (err) {
    console.warn(`! could not load 'gun' (${err.message}); reporting handshake only`);
  }

  const results = [];
  for (const url of targets) {
    const hs = await handshake(url);
    const replicated = hs.ok && Gun ? await replicate(url, Gun) : false;
    results.push({ url, ...hs, replicated });

    if (JSON_OUT) continue;

    const status = !hs.ok ? 'DEAD  ' : replicated ? 'OK    ' : 'NOREPL';
    console.log(
      `${status}  ${url}\n` +
        `        handshake: ${hs.ok ? `ok (${hs.latencyMs}ms) ${hs.detail}` : hs.detail}\n` +
        `        replicate: ${replicated ? 'ok' : Gun ? 'no' : 'skipped (gun unavailable)'}`,
    );
  }

  if (JSON_OUT) console.log(JSON.stringify(results, null, 2));

  const failed = results.filter((r) => !r.replicated).length;
  if (!JSON_OUT) {
    console.log(
      `\n${results.length - failed}/${results.length} relay(s) usable.` +
        (failed > 0 ? ' Do not ship a seed that does not replicate.' : ''),
    );
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
