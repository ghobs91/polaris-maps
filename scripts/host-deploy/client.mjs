#!/usr/bin/env node
/**
 * client.mjs — container-side client for the Polaris host deploy bridge.
 *
 * The Xcode toolchain and the App Store Connect key live on the Mac; this
 * process usually runs inside the Linux Docker container (OpenHands), where
 * /projects is a bind mount of /Users/andrewg. So it talks to the host through
 * the shared filesystem:
 *
 *   queue   <repo>/.host-deploy/queue/<job_id>/request.json
 *   results <repo>/.host-deploy/results/<job_id>/{request.json,status.json,log.txt}
 *
 * A launchd agent on the Mac (com.polaris.hostdeploy) picks the request up and
 * runs a fixed lane whitelist. Nothing here can execute an arbitrary command on
 * the host, and no credential ever crosses the boundary.
 *
 * Usage:
 *   node scripts/host-deploy/client.mjs bridge
 *   node scripts/host-deploy/client.mjs preflight
 *   node scripts/host-deploy/client.mjs submit --lane beta --note "carplay fix"
 *   node scripts/host-deploy/client.mjs status <job_id>
 *   node scripts/host-deploy/client.mjs logs   <job_id> [-n 120]
 *   node scripts/host-deploy/client.mjs list
 *   node scripts/host-deploy/client.mjs cancel <job_id>
 *
 * Exit codes: 0 success · 1 lane failed · 2 rejected/invalid · 3 bridge
 * unavailable or a local gate refused the request.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.host-deploy');
const QUEUE_DIR = path.join(STATE_DIR, 'queue');
const RESULTS_DIR = path.join(STATE_DIR, 'results');
const HEARTBEAT = path.join(STATE_DIR, 'heartbeat.json');
const SCHEMA = 1;

const LANES = {
  preflight: 'host-side checks: Xcode, credentials, .env, git state, scheme',
  beta: 'archive, export and upload a TestFlight build',
  release: 'archive and upload an App Store release',
  validate: 'validate the existing build/archive',
};

const STALE_AFTER_MS = 6 * 60 * 1000; // heartbeat is rewritten at every run

// Docker Desktop presents container-written files to the host as the user's own
// uid, so plain write permissions are enough here.
// ---------------------------------------------------------------------------

const argv0 = process.argv.slice(2);
let argv = argv0;
const command = argv[0] || 'help';

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, fallback = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    die(`--${name} needs a value`, 2);
  }
  return value;
}

function die(message, code = 2) {
  // fs.writeSync is not buffered, so the message survives the process.exit().
  try {
    fs.writeSync(2, `error: ${message}\n`);
  } catch {
    process.stderr.write(`error: ${message}\n`);
  }
  process.exit(code);
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function git(args) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function newJobId(lane) {
  const stamp = isoNow().replace(/[-:]/g, '').replace('Z', 'Z');
  const rand = Math.random().toString(16).slice(2, 6);
  return `${stamp}-${lane}-${rand}`;
}

function resultDir(jobId) {
  return path.join(RESULTS_DIR, jobId);
}

function readStatus(jobId) {
  return readJson(path.join(resultDir(jobId), 'status.json'), null);
}

function oneLine(value, max = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// bridge health
// ---------------------------------------------------------------------------

function bridgeHealth() {
  const beat = readJson(HEARTBEAT, null);
  if (!beat) {
    return { ok: false, reason: 'no heartbeat yet — the launchd agent has never run', beat: null };
  }
  const ageMs = Date.now() - Date.parse(beat.updated_at || 0);
  const agent = (() => {
    try {
      const out = execFileSync('launchctl', ['print', `gui/${process.getuid()}/com.polaris.hostdeploy`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return /state = (running|not running)/.exec(out)?.[1] ?? 'loaded';
    } catch {
      return 'not loaded on this machine';
    }
  })();
  return {
    ok: Number.isFinite(ageMs) && ageMs < STALE_AFTER_MS,
    reason: Number.isFinite(ageMs) ? `last seen ${Math.round(ageMs / 1000)}s ago` : 'heartbeat unreadable',
    beat,
    agent,
  };
}

function cmdBridge() {
  const health = bridgeHealth();
  const beat = health.beat;
  console.log(`repo        ${REPO_ROOT}`);
  console.log(`queue       ${QUEUE_DIR}`);
  console.log(`heartbeat   ${health.ok ? 'live' : 'STALE'} (${health.reason})`);
  if (beat) {
    console.log(`host        ${beat.host} · runner ${beat.runner_version} · ${beat.state}`);
    console.log(`lanes       ${Object.keys(beat.lanes || {}).join(', ')}`);
  }
  if (!health.ok) {
    console.log('');
    console.log('The Mac-side executor is not answering. On the Mac, run:');
    console.log(`  cd ${REPO_ROOT} && ./scripts/host-deploy/install.sh`);
    console.log('Never fall back to CI/EAS: the archive must come from this Mac.');
    return 3;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

function cmdSubmit() {
  const lane = option('lane', argv[1] && !argv[1].startsWith('--') ? argv[1] : null);
  if (!lane) die(`--lane is required (one of: ${Object.keys(LANES).join(', ')})`);
  if (!(lane in LANES)) die(`unknown lane '${lane}' (one of: ${Object.keys(LANES).join(', ')})`);

  const note = option('note', '');
  const allowDirty = flag('allow-dirty');
  const allowNonMain = flag('allow-non-main');
  const skipMatch = flag('skip-match');
  const follow = !flag('no-follow');
  const requestedBy = option('by', process.env.OPENHANDS_SESSION_ID || process.env.USER || 'container');

  // Local gates mirror the Mac lane's own preconditions, so an obviously
  // doomed request fails in a second instead of after a pod install.
  if (lane !== 'preflight') {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const dirty = git(['status', '--porcelain'])
      .split('\n')
      .filter(Boolean);
    const envPath = path.join(REPO_ROOT, '.env');

    if (branch && branch !== 'main' && !allowNonMain) {
      die(
        `refusing to submit from branch '${branch}': the release lane only archives from main.\n` +
          `       merge to main first, or pass --allow-non-main for a deliberate one-off.`,
        3,
      );
    }
    if (dirty.length && !allowDirty) {
      die(
        `working tree has ${dirty.length} uncommitted change(s); the lane will refuse to build:\n` +
          dirty.map((l) => `       ${l}`).join('\n') +
          `\n       commit them first (smart-commit), or pass --allow-dirty.`,
        3,
      );
    }
    if (!fs.existsSync(envPath) && !flag('allow-missing-env')) {
      die(
        `no .env at ${envPath}: the lane hard-fails rather than ship a build with no traffic key.`,
        3,
      );
    }
  }

  const health = bridgeHealth();
  if (!health.ok) {
    console.log(`warning: ${health.reason}`);
    console.log('         the request will still be queued; launchd picks it up when the agent runs.');
  }

  const jobId = newJobId(lane);
  const queuePath = path.join(QUEUE_DIR, jobId);
  fs.mkdirSync(queuePath, { recursive: true });

  const request = {
    schema: SCHEMA,
    job_id: jobId,
    lane,
    note: note || undefined,
    requested_by: requestedBy,
    created_at: isoNow(),
    allow_dirty: allowDirty || undefined,
    allow_non_main: allowNonMain || undefined,
    skip_match: skipMatch || undefined,
  };
  for (const key of Object.keys(request)) if (request[key] === undefined) delete request[key];

  // Atomic hand-off: the runner ignores a directory with no request.json, and
  // this rename is what makes the file appear.
  const tmp = path.join(queuePath, 'request.json.tmp');
  fs.writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`);
  fs.renameSync(tmp, path.join(queuePath, 'request.json'));

  if (flag('json')) {
    console.log(JSON.stringify({ job_id: jobId, lane, queued_at: request.created_at }, null, 2));
    if (!follow) return 0;
  } else {
    console.log(`queued ${jobId}  lane=${lane}`);
  }

  return follow ? followJob(jobId, lane) : 0;
}

// ---------------------------------------------------------------------------
// follow / status / logs / list / cancel
// ---------------------------------------------------------------------------

function followJob(jobId, lane, fromStart = true) {
  const logPath = path.join(resultDir(jobId), 'log.txt');
  // Attaching to an existing job should not replay megabytes of history; a
  // fresh submit should show everything from the first line.
  let offset = fromStart || !fs.existsSync(logPath) ? 0 : fs.statSync(logPath).size;
  let lastStage = '';
  let lastState = '';
  const deadline = Date.now() + Number(option('timeout', 90)) * 60 * 1000;
  const quiet = flag('json');

  if (!fromStart && !quiet) {
    const first = readStatus(jobId);
    console.log(`attaching to ${jobId} (${lane}) — state ${first?.state ?? 'queued'}, stage ${first?.stage ?? '-'}`);
    console.log('history is in `logs`, or pass --from-start to replay it here');
  }

  while (Date.now() < deadline) {
    const status = readStatus(jobId);

    if (fs.existsSync(logPath)) {
      const size = fs.statSync(logPath).size;
      if (size > offset) {
        const fd = fs.openSync(logPath, 'r');
        const buffer = Buffer.alloc(size - offset);
        fs.readSync(fd, buffer, 0, buffer.length, offset);
        fs.closeSync(fd);
        offset = size;
        if (!quiet) process.stdout.write(buffer.toString('utf8'));
      }
    }

    if (status) {
      if (status.state !== lastState && !quiet) {
        if (status.state === 'running' && lastState === '') {
          console.log(`\n── running on ${status.host} ──`);
        }
        lastState = status.state;
      }
      const stage = status.progress && status.stage ? `${status.progress} ${status.stage}` : status.stage;
      if (stage && stage !== lastStage && !quiet) {
        // preflight streams its own check lines; a stage banner there is noise.
        if (lane !== 'preflight' && status.progress && status.progress !== '0/0') {
          console.log(`\n── ${stage} ──`);
        }
        lastStage = stage;
      }

      if (['succeeded', 'failed', 'rejected', 'cancelled'].includes(status.state)) {
        return report(status, quiet);
      }
    }

    sleepMs(1000);
  }

  console.error(`\nstill running after ${option('timeout', 90)} min — job ${jobId} continues on the Mac.`);
  console.error(`  node scripts/host-deploy/client.mjs status ${jobId}`);
  return 1;
}

function report(status, json = false) {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log('');
    console.log(`state      ${status.state}`);
    if (status.git) console.log(`git        ${status.git.branch} @ ${status.git.sha}`);
    if (status.duration_s) console.log(`duration   ${status.duration_s}s`);
    if (status.summary) console.log(`checks     ${status.summary}`);
    if (status.artifacts?.length) {
      for (const art of status.artifacts) {
        console.log(`artifact   ${art.path} (${(art.bytes / 1e6).toFixed(1)} MB, sha256 ${art.sha256.slice(0, 12)}…)`);
      }
    }
    if (status.failure) {
      console.log(`failure    ${status.failure.kind}: ${status.failure.message}`);
      if (status.failure.hint) console.log(`next       ${status.failure.hint}`);
    }
    if (status.errors) {
      console.log('\n--- error lines from the Mac ---');
      console.log(status.errors);
    }
    if (status.checks) {
      for (const check of status.checks) {
        const mark = check.status === 'ok' ? 'ok  ' : check.status === 'warn' ? 'warn' : 'FAIL';
        console.log(`  ${mark} ${check.check.padEnd(17)} ${oneLine(check.detail, 110)}`);
        if (check.hint && check.status === 'fail') console.log(`       ↳ ${oneLine(check.hint, 110)}`);
      }
    }
  }

  if (status.state === 'succeeded') return 0;
  if (status.state === 'rejected') return 2;
  if (status.state === 'cancelled') return 1;
  return 1;
}

function cmdStatus(jobId) {
  const status = readStatus(jobId);
  if (!status) die(`no status for job ${jobId} (is it still queued?)`, 2);
  if (flag('json')) console.log(JSON.stringify(status, null, 2));
  else {
    console.log(`job        ${jobId}`);
    console.log(`lane       ${status.lane ?? '-'}`);
    console.log(`state      ${status.state}`);
    console.log(`stage      ${status.progress ? `${status.progress} ` : ''}${status.stage ?? '-'}`);
    console.log(`updated    ${status.updated_at}`);
    if (status.tail) {
      console.log('\n--- log tail ---');
      console.log(status.tail);
    }
  }
  return status.state === 'succeeded' ? 0 : 1;
}

function cmdLogs(jobId) {
  const file = path.join(resultDir(jobId), 'log.txt');
  if (!fs.existsSync(file)) die(`no log for job ${jobId}`, 2);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const count = Number(option('n', 80));
  console.log(lines.slice(-count).join('\n'));
  return 0;
}

function cmdList() {
  const rows = [];
  for (const id of fs.existsSync(QUEUE_DIR) ? fs.readdirSync(QUEUE_DIR) : []) {
    rows.push({ id, lane: readJson(path.join(QUEUE_DIR, id, 'request.json'))?.lane ?? '?', state: 'queued', updated: '' });
  }
  for (const id of fs.existsSync(RESULTS_DIR) ? fs.readdirSync(RESULTS_DIR) : []) {
    const status = readStatus(id) || {};
    rows.push({ id, lane: status.lane ?? '?', state: status.state ?? 'claimed', updated: status.updated_at ?? '' });
  }
  if (!rows.length) {
    console.log('no jobs yet');
    return 0;
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  if (flag('json')) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const row of rows) console.log(`${row.id}  ${String(row.lane).padEnd(9)} ${row.state.padEnd(9)} ${row.updated}`);
  return 0;
}

function cmdCancel(jobId) {
  const queued = path.join(QUEUE_DIR, jobId);
  if (fs.existsSync(queued)) {
    fs.rmSync(queued, { recursive: true, force: true });
    console.log(`removed queued job ${jobId}`);
    return 0;
  }
  const dir = resultDir(jobId);
  if (!fs.existsSync(dir)) die(`unknown job ${jobId}`, 2);
  fs.writeFileSync(path.join(dir, 'cancel'), `${isoNow()}\n`);
  console.log(`cancel requested for ${jobId}`);
  return 0;
}

function cmdWait(jobId) {
  return followJob(jobId, readStatus(jobId)?.lane ?? '?', flag('from-start'));
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function help() {
  console.log(`Polaris host deploy client

  bridge                     is the Mac-side executor alive?
  preflight                  run host checks (Xcode, credentials, .env, git, scheme)
  submit --lane <lane>       queue a build; --note "..." --follow (default)
                             --allow-dirty --allow-non-main --skip-match --no-follow --json
  wait <job_id>              attach to a job and stream until it finishes
  status <job_id>            last known status (--json)
  logs <job_id> [-n 80]      tail the host log
  list                       queued and finished jobs
  cancel <job_id>            drop a queued job, or ask the runner to stop a running one

lanes: ${Object.entries(LANES).map(([k, v]) => `\n  ${k.padEnd(10)} ${v}`).join('')}

The host executor never accepts a command — only these lanes. Credentials stay
in ~/Library/Application Support/polaris-host-deploy/env on the Mac.`);
}

let exitCode = 0;
switch (command) {
  case 'bridge':
    exitCode = cmdBridge();
    break;
  case 'preflight':
    argv = ['--lane', 'preflight', ...argv0.slice(1)];
    exitCode = cmdSubmit();
    break;
  case 'submit':
    exitCode = cmdSubmit();
    break;
  case 'wait':
    exitCode = cmdWait(argv[1]);
    break;
  case 'status':
    if (!argv[1]) die('status needs a job id');
    exitCode = cmdStatus(argv[1]);
    break;
  case 'logs':
    if (!argv[1]) die('logs needs a job id');
    exitCode = cmdLogs(argv[1]);
    break;
  case 'list':
    exitCode = cmdList();
    break;
  case 'cancel':
    if (!argv[1]) die('cancel needs a job id');
    exitCode = cmdCancel(argv[1]);
    break;
  case 'help':
  case '--help':
  case '-h':
    help();
    break;
  default:
    help();
    exitCode = 2;
}

// Never process.exit() here: when stdout is a pipe (docker exec, CI), Node's
// writes are async and exit() throws away the buffered tail — which would be the
// build report the caller is waiting for. Setting exitCode lets the stream drain.
process.exitCode = exitCode;
