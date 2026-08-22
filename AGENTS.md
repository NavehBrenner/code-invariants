# AGENTS.md

> **Status: draft — pending review.**  
> Nothing in this file is closed. Content may change as the project evolves. Prefer `docs/SPECS.md` Locked decisions when this file and SPECS disagree, until review reconciles them.

## What this project is

`code-invariants` turns high-level engineering standards into **executable CI checks** so AI coding agents (and humans) get structural quality without relying on prose instructions or manual review of large diffs.

It sits **above** formatters and classic linters: plugin rules (compositional AST, test-presence, structural DRY). Not a SAST product; not a reimplementation of Biome/ESLint. Core has **no built-in rule bag** — every check is a plugin rule. Baseline TypeScript lives in `@code-invariants/typescript`. React compositional rules live in `@code-invariants/react`. Structural DRY lives in `@code-invariants/dry`.

## What to read before coding

1. [docs/SPECS.md](docs/SPECS.md) — **Locked decisions** are binding until changed by review.
2. [docs/VISION.md](docs/VISION.md) — why and success criteria.
3. [docs/RESEARCH.md](docs/RESEARCH.md) — competitive context (Semgrep, dupehound, etc.).
4. [docs/rulesets/typescript.md](docs/rulesets/typescript.md) — honest TypeScript plugin catalog (implemented vs not planned).
5. [docs/rulesets/react.md](docs/rulesets/react.md) — React plugin catalog (implemented vs backlog).
6. [docs/rulesets/dry.md](docs/rulesets/dry.md) — DRY plugin catalog (`dry/no-duplicate-functions`).
7. [docs/rulesets/](docs/rulesets/) — research inventories are **not** an implementation backlog.

Do **not** invent import-lint / cycle / path-ban rules or a long TypeScript catalog. Add rules to plugins; do not grow a core rule table.

## How to build (process, not style)

- Implement against the **plugin contract** and CLI surface in SPECS — do not invent parallel APIs.
- Prefer **extending plugins** over growing core, unless the change is shared infrastructure (artifact providers, config, reporting).
- Shared/provider-only packages register as **ruleless plugins** (`name` + `provides`, no `rules`) via `plugins[]`. A rule in any loaded module may `requires` an artifact id provided by another loaded module. Duplicate artifact ids fail closed (exit 2, both owners named). Defaults (`"typescript"`) only fill ids nobody provided.
- Product plugins are `@code-invariants/typescript`, `@code-invariants/react`, and `@code-invariants/dry`. Do not re-scaffold the engine. Do not pad plugins with empty stub rules.
- **One coherent change per PR** (one rule, one engine slice, or one docs theme).
- Add **fixtures** (valid + invalid) for every rule; messages must be actionable by another agent.
- Dogfood: once `code-invariants check` exists, run it on this repo.
- Core remains **free of generative LLM API keys**; embeddings only for optional semantic DRY.

Prefer **verbose names** (`artifacts`, not `arts`; `artifactBuildContext`, not `abc`). Shorthands only if the full name would make a variable/function identifier **longer than 20 characters**. If a shorthand is used under that rule, put a **comment line immediately above the declaration** with the full verbose intended name.

Code style and TypeScript hygiene will be enforced by the tool itself as it matures. Do not expand agent docs with lint rule lists.

## Working through GitHub (`/oc`)

**Plan before you build. Always.**

- Opening an issue auto-runs you in `plan` mode. So does any `/oc …` comment
  (issue thread or inline review comment). PR review summaries never start a run.
- `/oc` comments must come from a user with write access (`NavehBrenner`); the
  action asserts that on the comment author.
- When planning or implementing a PR fix-up, read the latest PR review(s).
- In `plan` mode: post the plan as a comment on the issue and **stop**. No branch, no commits, no PR — not even a small one, not even if the issue looks trivial or already spells out the solution.
- Implement only when a comment says `/oc build`. That is the approval; prose asking you to "go ahead" in a plan run is not.
- Optional `model:<provider>/<id>` in the triggering comment (no space after
  the colon; first match) overrides the default `xai/grok-4.6`. Invalid
  tokens fail closed. Issue-open never overrides.
- A plan states: files touched, the SPECS sections it honours, what gets tested, and what is deliberately out of scope.

PR body: `Closes #<github-issue>`, then what changed, why, and how to verify. The closing reference is load-bearing — CI reads it to attach the PR to Linear and to request review. Nothing else about Linear or reviewers is your job.

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
