# AGENTS.md

> **Status: draft — pending review.**  
> Nothing in this file is closed. Content may change as the project evolves. Prefer `docs/SPECS.md` Locked decisions when this file and SPECS disagree, until review reconciles them.

## What this project is

`code-invariants` turns high-level engineering standards into **executable CI checks** so AI coding agents (and humans) get structural quality without relying on prose instructions or manual review of large diffs.

It sits **above** formatters and classic linters: plugin rules (compositional AST, test-presence). Not a SAST product; not a reimplementation of Biome/ESLint. Core has **no built-in rule bag** — every check is a plugin rule. Baseline TypeScript lives in `@code-invariants/typescript`.

## What to read before coding

1. [docs/SPECS.md](docs/SPECS.md) — **Locked decisions** are binding until changed by review.
2. [docs/VISION.md](docs/VISION.md) — why and success criteria.
3. [docs/RESEARCH.md](docs/RESEARCH.md) — competitive context (Semgrep, dupehound, etc.).
4. [docs/rulesets/typescript.md](docs/rulesets/typescript.md) — honest TypeScript plugin catalog (implemented vs not planned).
5. [docs/rulesets/](docs/rulesets/) — research inventories are **not** an implementation backlog.

Do **not** invent import-lint / cycle / path-ban rules or a long TypeScript catalog. Add rules to plugins; do not grow a core rule table.

## How to build (process, not style)

- Implement against the **plugin contract** and CLI surface in SPECS — do not invent parallel APIs.
- Prefer **extending plugins** over growing core, unless the change is shared infrastructure (frontend protocol, config, reporting).
- First product plugin is `@code-invariants/typescript`. Do not re-scaffold the engine.
- **One coherent change per PR** (one rule, one engine slice, or one docs theme).
- Add **fixtures** (valid + invalid) for every rule; messages must be actionable by another agent.
- Dogfood: once `code-invariants check` exists, run it on this repo.
- Core remains **free of generative LLM API keys**; embeddings only for optional semantic DRY.

Code style and TypeScript hygiene will be enforced by the tool itself as it matures. Do not expand agent docs with lint rule lists.

## Workflow skills

| Skill | Use when |
|-------|----------|
| [create-plugin](skills/create-plugin/SKILL.md) | Scaffolding a new plugin package |
| [add-rule](skills/add-rule/SKILL.md) | Adding one rule + fixtures to an existing plugin |

Process skills (issues/PRs) live under [docs/CONTRIBUTING-AGENTS.md](docs/CONTRIBUTING-AGENTS.md) until dedicated skill folders exist.

## MCP (planned)

Product MCP surface (draft): `check`, `check_diff`, `list_rules`, `get_rule_docs`. See [docs/mcp.md](docs/mcp.md).

## Non-goals for agents

- Rewriting the core in Rust in v1
- Wrapping or owning Biome/ESLint configuration
- Building a security SAST competitor
- Large “fix everything” PRs without fixtures or SPECS alignment
