# Contributing as an agent

> **Status: draft — pending review.**  
> Process guidance only. May change during the project lifecycle. Not a code style guide.

## Principles

1. **Essence over ceremony** — agent instructions stay about *what* we build and *how* we slice work. Structural code quality is the product’s job.
2. **SPECS first** — Locked decisions in [SPECS.md](./SPECS.md) beat informal chat or outdated drafts.
3. **Small PRs** — one rule, one engine capability, or one documentation theme per PR.
4. **Fixtures required** — every rule ships with valid and invalid examples and assertions on violation ids/messages.

## Suggested loop

```text
read SPECS locked decisions
  → implement against plugin/CLI contract
  → add fixtures + tests
  → run check (when available) on repo / examples
  → open PR with short rationale + SPECS references
```

## Issues

When filing an issue (human or agent):

- State the problem or gap in product terms (rule, engine, docs).
- Link SPECS/VISION/ruleset sections if relevant.
- Avoid turning issues into full designs unless requested; prefer a crisp problem statement.

*(Dedicated `file-issue` skill may be added later.)*

## Pull requests

- Title: imperative, specific (`feat(typescript): add no-deep-import rule`).
- Body: what changed, why, how to verify (commands/fixtures).
- Do not mix unrelated refactors with rule additions.
- Update SPECS or ruleset docs when behavior or public contract changes.

*(Dedicated `open-pr` skill may be added later.)*

## What not to put in agent docs

- Exhaustive ESLint/Biome rule lists
- Formatting preferences
- Framework tutorials unrelated to this repo’s engine

Those belong in product rulesets or external tools, not in contribution prose.
