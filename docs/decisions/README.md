# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Polaris Maps.

## Status

ADR statuses: `proposed`, `accepted`, `superseded`, `deprecated`.

## Filename Format

`NNNN-short-title.md` — zero-padded sequential number followed by a short hyphenated title.

Example: `0001-use-hyperswarm-for-peer-discovery.md`

## Required Sections

Each ADR must contain:

- **Context** — what is the problem or decision driving this, and what constraints apply.
- **Decision** — what was decided, concretely.
- **Consequences** — what results from the decision, positive and negative, including maintenance burden.
- **Alternatives Considered** — what else was on the table and why it was rejected.

## Creating a New ADR

1. Copy `0000-template.md` to the next number.
2. Fill in the sections.
3. Set status to `proposed`, then move to `accepted` once agreed.

## Relationship to Other Conventions

- `openspec/` is used for spec-driven change proposals and applies changes (`openspec/changes/`); ADRs here record long-lived architectural decisions.
- `.specify/memory/constitution.md` defines the project constitution; ADRs must not contradict it without explicitly reopening the relevant principle.
