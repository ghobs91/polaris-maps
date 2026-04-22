---
name: smart-commit
description: 'Analyze uncommitted git changes, group them into cohesive scopes, validate each group, and create one or more Conventional Commits instead of a single monolithic commit. Use for git status review, commit splitting, staging by scope, and writing feat/fix/refactor/test/chore/docs/build/ci messages.'
argument-hint: 'Optional focus area, exclusions, or commit constraints'
---

# Git Commit Batching

## When to Use

- You want to commit current uncommitted changes without collapsing distinct work into one large commit.
- The worktree contains a mix of app code, tests, config, scripts, generated-file cleanup, or repo hygiene.
- You need Conventional Commits messages with the right type and scope.
- You want the agent to analyze `git status`, stage changes in logical groups, validate each group, and commit them in order.

## Outcome

Produce a small set of clean commits where each commit:

- Represents one cohesive change in behavior or repo maintenance.
- Uses a Conventional Commits message.
- Includes the minimum tests or checks appropriate to that scope.
- Avoids unrelated files, generated artifacts, and accidental catch-all commits.

## Procedure

1. Inspect the current worktree.
   - Review unstaged and staged changes separately.
   - Check file lists, diff summaries, and the actual diffs before deciding commit boundaries.
   - Call out generated artifacts, local caches, or unrelated pre-existing edits immediately.

2. Partition changes by intent, not by file count.
   - Group files that implement one user-visible feature or one bug fix together.
   - Keep tests with the behavior they verify when they are specific to that change.
   - Split independent repo hygiene, tooling, config, documentation, or ignore-file changes into separate commits.
   - Keep cleanup or generated-artifact removal separate unless it is required for the same behavior change.

3. Apply commit-boundary decision rules.
   - Same commit: source change plus tightly coupled test/config change required for that source change.
   - Separate commit: unrelated build config, ignore rules, formatting-only edits, docs-only changes, or incidental cleanup.
   - Stop and ask if ownership or intent is unclear, especially when unrelated user changes are mixed into the worktree.
   - Do not commit generated caches, derived data, or other machine output unless the repo intentionally tracks them.

4. Choose the Conventional Commits type and scope for each partition.
   - `feat`: new user-facing capability.
   - `fix`: bug fix or regression fix.
   - `refactor`: internal restructuring with no intended behavior change.
   - `test`: test-only additions or updates.
   - `docs`: documentation-only changes.
   - `chore`: repo maintenance, ignore files, housekeeping, or non-runtime metadata.
   - `build`: dependency, bundler, compiler, or build-system changes.
   - `ci`: CI workflow or automation changes.
   - `perf`: measurable performance improvement.
   - `revert`: explicit revert commit.
   - Prefer a narrow scope such as `carplay`, `ios`, `tests`, `gitignore`, or `build` when that improves clarity.

5. Validate each partition before committing.
   - Run the smallest relevant verification for that partition.
   - Prefer targeted tests over full-suite runs when the change is narrow.
   - If validation cannot run, say so explicitly before committing.

6. Stage and commit one partition at a time.
   - Stage only the files that belong to the current partition.
   - Re-check the staged diff before committing.
   - Write a concise Conventional Commits subject line.
   - Use additional body text only when it explains a non-obvious reason, constraint, or follow-up.

7. Repeat until all intended changes are committed.
   - Revisit the remaining worktree after each commit.
   - Re-split if the remainder still contains distinct scopes.
   - Leave unrelated or user-owned changes untouched if they were explicitly excluded.

8. Summarize the result.
   - List the commits created in order.
   - Mention any changes intentionally left uncommitted.
   - Note any checks that were run or skipped.

## Quality Checks

- Every commit is cohesive and explainable in one sentence.
- No commit mixes independent product behavior with unrelated repo hygiene.
- Tests live with the change they verify unless they are broadly separate test maintenance.
- Commit messages follow `<type>(<scope>): <subject>` when a scope is useful.
- The staged diff matches the intended commit message.
- No destructive git commands are used.

## Ambiguity Rules

- If multiple logical commit splits are plausible, propose the split first and ask one focused question before committing.
- If the worktree contains unrelated edits from different efforts, isolate what is clearly in scope and ask before touching the rest.
- If a large refactor hides a bug fix, split only when the bug fix can stand on its own without breaking build or tests.

## Completion Criteria

- All intended changes are committed.
- The commit history is non-monolithic and grouped by scope.
- Conventional Commits formatting is respected.
- Verification status is documented.

## Example Commit Subjects

- `fix(carplay): register simulator entitlements for debug builds`
- `test(carplay): cover xcode target membership and install script wiring`
- `chore(gitignore): ignore repo-local carplay derived data`
