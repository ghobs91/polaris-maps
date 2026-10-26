#!/usr/bin/env node
/**
 * Refuse to commit from a detached HEAD inside a linked worktree.
 *
 * OpenCode creates worktrees with a detached HEAD, so a commit made there
 * belongs to no branch: it survives only in the reflog and is one `git gc`
 * away from being unrecoverable. Branch first, then commit.
 *
 * Skips:
 *  - the primary working tree (people legitimately commit while detached there)
 *  - an in-progress rebase / bisect / cherry-pick / revert
 *  - POLARIS_ALLOW_DETACHED_COMMIT=1
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function isOnBranch() {
  try {
    git(['symbolic-ref', '-q', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function hasOperationInProgress() {
  const root = git(['rev-parse', '--show-toplevel']);
  const markers = [
    'rebase-merge',
    'rebase-apply',
    'BISECT_LOG',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'sequencer',
  ];
  return markers.some((marker) => {
    const located = git(['rev-parse', '--git-path', marker]);
    return existsSync(isAbsolute(located) ? located : resolve(root, located));
  });
}

function isLinkedWorktree() {
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return gitDir !== commonDir;
}

if (isOnBranch() || hasOperationInProgress() || !isLinkedWorktree()) {
  process.exit(0);
}

if (process.env.POLARIS_ALLOW_DETACHED_COMMIT === '1') {
  process.exit(0);
}

const worktree = process.cwd().split('/').pop();
console.error(
  [
    '',
    `✖ Refusing to commit on a detached HEAD (worktree: ${worktree}).`,
    '',
    '  This commit would belong to no branch — no ref would contain it, so it',
    '  would survive only in the reflog and be lost on the next `git gc`.',
    '',
    '  Create a branch, then re-run the commit:',
    '',
    '      git switch -c feat/<short-slug>',
    '',
    '  Bypass once with POLARIS_ALLOW_DETACHED_COMMIT=1.',
    '',
  ].join('\n'),
);
process.exit(1);
