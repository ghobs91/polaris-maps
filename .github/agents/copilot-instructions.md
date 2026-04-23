# Repository Instructions

## Project approach

- First understand the existing implementation before making changes.
- Prefer small, focused changes over broad refactors.
- Reuse existing patterns, abstractions, naming, and folder structure before introducing new ones.
- Infer as much as possible from the repository before asking for clarification.
- If clarification is necessary, ask the smallest high-value set of questions in one batch.

## Implementation rules

- Build complete, working functionality unless the request explicitly asks for scaffolding or a partial implementation.
- Preserve backward compatibility unless the request clearly implies a behavior change.
- Avoid unrelated edits.
- Keep public APIs, config keys, CLI flags, route contracts, and persisted data formats stable unless a change is intentional and documented.
- Consider edge cases, validation, error handling, empty states, loading states, auth/permissions, and regression risk.

## Testing rules

- After any non-trivial code change, update or add tests.
- Prefer regression tests for bug fixes and behavior-focused tests for new functionality.
- Test the user-visible or externally observable behavior, not just implementation details.
- Reuse existing test helpers, fixtures, factories, and conventions.
- If a change is difficult to test, explain why and add the closest practical verification.
- Before finishing, run the most relevant existing tests for the changed area when possible.
- If tests cannot be run, say so clearly and explain what should be run.

## Review checklist

- Check that the change solves the actual problem and matches the request.
- Check for unintended regressions in nearby functionality.
- Check consistency with existing architecture, naming, types, and patterns.
- Check for unnecessary complexity or overengineering.
- Check input validation, null/undefined handling, async behavior, and state transitions where relevant.
- Check auth, permissions, secrets, and security-sensitive flows where relevant.
- Check whether docs, examples, types, schemas, config, and tests also need updates.
- Call out assumptions, tradeoffs, and any remaining risks explicitly.

## Documentation rules

- After code changes, update all affected documentation.
- Update README, usage docs, setup steps, API/reference docs, examples, and config documentation when behavior changes.
- Keep examples copy-pasteable and aligned with the current code.
- Preserve the project’s tone, terminology, and formatting.
- Do not rewrite unrelated documentation.

## Changelog and migration rules

- If a change is user-facing, add or update changelog or release-note text.
- If a change is breaking, explicitly document:
  - what changed
  - who is affected
  - how to migrate
  - any fallback or compatibility behavior
- If a flag, option, endpoint, event, schema, or config key is renamed, removed, or gains a new default, update migration guidance and examples.
- Avoid vague changelog language like “improved” or “enhanced”; describe the actual behavior change.

## Clarification policy

- Ask clarifying questions only when the answer materially affects correctness, scope, UX, compatibility, or migration guidance.
- Group questions into one concise message.
- If the repository strongly suggests the right path, follow it and state the assumption instead of blocking.

## Output expectations

- Summarize what changed.
- List important files changed.
- Note tests added, updated, or recommended.
- Note docs/changelog/migration updates made or still needed.
- State assumptions and any remaining risks or follow-up items.
