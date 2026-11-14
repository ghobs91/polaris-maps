#!/usr/bin/env node
/**
 * Delete dated map-data releases that no longer need to exist.
 *
 * The data workflow tags by month (`map-data-2026-11`) and re-uploads with
 * `--clobber` within that month, so a month never grows. But each new month
 * creates a fresh release of roughly the same size — several GB across the
 * region catalog. Left alone, that accumulates forever.
 *
 * A device only needs the release its cached catalog points at, plus the one
 * before it while a catalog refresh is in flight. So: keep the newest N dated
 * releases, delete the rest.
 *
 * Safety rules, because this deletes published data:
 *
 *   - `map-data-latest` is never a candidate. It is the pointer the app reads,
 *     not a data release, and it does not match the dated pattern.
 *   - Only `map-data-YYYY-MM` with a real month (01–12) is ever considered.
 *     `map-data-2026-1`, `map-data-latest`, `v1.0.0` and anything else are
 *     ignored rather than guessed at.
 *   - At least one dated release always survives; `--keep` below 1 is refused.
 *   - `--dry-run` prints the plan and deletes nothing.
 *
 * Usage:
 *   node scripts/prune-map-data-releases.mjs [options]
 *
 * Options:
 *   --keep <n>        Dated releases to retain (default 2, minimum 1)
 *   --repo <owner/name>  Defaults to GITHUB_REPOSITORY, else the gh default
 *   --dry-run         Print what would be deleted; delete nothing
 *   --json            Machine-readable result on stdout
 *   --input <file>    Read the release list from JSON instead of `gh`
 *                     (array of tag strings, or objects with `tagName`)
 *   --help            Show this text
 *
 * Exit codes: 0 success (including "nothing to prune"), 1 on a refusal or a
 * failed deletion.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DATED_TAG = /^map-data-(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Split a list of release tags into the ones to keep and the ones to prune.
 *
 * Pure and exported so the rules can be exercised without touching GitHub.
 * Ordering is by the tag's own year-month, not by creation date: a release can
 * be created long after its tag, and the tag is what the catalog points at.
 *
 * @param {string[]} tags release tags
 * @param {number} keep how many dated releases to retain
 * @returns {{prune: string[], keep: string[], ignored: string[]}}
 */
export function selectReleasesToPrune(tags, keep = 2) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`--keep must be an integer >= 1 (got ${keep})`);
  }

  const dated = [];
  const ignored = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const match = DATED_TAG.exec(tag);
    if (match) dated.push({ tag, key: `${match[1]}${match[2]}` });
    else ignored.push(tag);
  }

  // Newest first. The key is fixed-width YYYYMM, so a string compare is exact.
  dated.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  return {
    keep: dated.slice(0, keep).map((entry) => entry.tag),
    prune: dated.slice(keep).map((entry) => entry.tag),
    ignored,
  };
}

function parseArgs(argv) {
  const args = { keep: 2, dryRun: false, json: false, input: null, repo: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--keep') args.keep = Number(argv[++i]);
    else if (arg === '--repo') args.repo = argv[++i];
    else if (arg === '--input') args.input = argv[++i];
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const header = source.slice(source.indexOf('/**') + 3, source.indexOf('*/'));
  console.log(
    header
      .split('\n')
      .map((line) => line.replace(/^\s?\* ?/, ''))
      .join('\n'),
  );
}

/** Tag strings from a release list, tolerating strings or `{ tagName }`. */
function tagsFromInput(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.releases) ? raw.releases : null;
  if (!list) throw new Error('--input must be an array, or an object with a `releases` array');
  return list.map((entry) => (typeof entry === 'string' ? entry : entry?.tagName)).filter(Boolean);
}

function tagsFromGitHub(repo) {
  const out = execFileSync(
    'gh',
    ['release', 'list', '--limit', '200', '--json', 'tagName', '--repo', repo],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out).map((release) => release.tagName);
}

function resolveRepo(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    return execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  let tags;
  let repo = null;
  if (args.input) {
    tags = tagsFromInput(JSON.parse(readFileSync(args.input, 'utf8')));
  } else {
    repo = resolveRepo(args.repo);
    if (!repo) {
      console.error('error: cannot determine the repository; pass --repo owner/name');
      return 1;
    }
    tags = tagsFromGitHub(repo);
  }

  let selection;
  try {
    selection = selectReleasesToPrune(tags, args.keep);
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }

  const result = {
    repo,
    dryRun: args.dryRun,
    keep: selection.keep,
    pruned: selection.prune,
    ignored: selection.ignored,
  };

  if (selection.prune.length === 0) {
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `nothing to prune — ${selection.keep.length} dated release(s) within the keep=${args.keep} window`,
      );
    }
    return 0;
  }

  if (!args.dryRun) {
    for (const tag of selection.prune) {
      try {
        execFileSync('gh', ['release', 'delete', tag, '--repo', repo, '--yes', '--cleanup-tag'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const detail = err.stderr ? String(err.stderr).trim() : String(err.message);
        console.error(`error: failed to delete ${tag}: ${detail}`);
        return 1;
      }
    }
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const verb = args.dryRun ? 'would delete' : 'deleted';
    console.log(`keeping: ${selection.keep.join(', ') || '(none)'}`);
    for (const tag of selection.prune) console.log(`${verb}: ${tag}`);
    if (args.dryRun) console.log('(dry run — nothing was deleted)');
  }

  return 0;
}

// Only run when executed directly, so the selection logic stays importable.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
