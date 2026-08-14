# Vision — code-invariants

## One-sentence vision

Turn the engineering standards that teams *wish* AI agents would follow into **executable, deterministic, CI-enforceable invariants** so that structural quality becomes a machine-checked property instead of a human review burden.

## Why this matters now

AI coding agents (Cursor, Claude Code, Codex, Windsurf, etc.) can produce thousands of lines of working code in minutes. The bottleneck has shifted from “writing code” to “reviewing and keeping the codebase coherent.”

Traditional tools sit at two extremes:

- **Linters / formatters / type checkers** — fast, deterministic, but only catch shallow issues.
- **Human review + instruction files** — flexible and high-level, but not enforced and do not scale to large AI-generated PRs.

There is a missing middle layer: **complex, compositional, semantic, and architectural invariants** that can be expressed once and then enforced automatically on every change.

## Core principles

1. **Enforcement over documentation**  
   If a rule is important, it must be possible to make CI fail when it is violated. Instructions are necessary but insufficient.

2. **Compositional & higher-order patterns**  
   The most valuable rules are not “never use `any`” but things like:
   - “Any component that calls `useQuery` must be wrapped in a `DataRegion` that exhaustively handles loading / error / success.”
   - “All `className` values must be drawn from the design-system token set (branded type).”
   - “Every public function must appear as a call site inside at least one test file.”

3. **Agent-native**  
   Error messages and tooling surfaces (CLI, MCP servers, pre-commit hooks) should be optimised so that an agent can understand the violation and fix it autonomously.

4. **Multi-language from day one (focus)**  
   TypeScript/React first (where the original prototype lives), Python second, with a shared conceptual model so rules can be ported.

5. **Static-first, embeddings where they add unique value**  
   Prefer pure static analysis (AST, graph, fingerprinting) for reliability and speed. Use vector embeddings only for the semantic-DRY use case where structural methods are insufficient.

6. **Progressive adoption**  
   Rules must be independently toggleable. Teams should be able to start with 2–3 high-value invariants and expand.

## Success criteria

A successful `code-invariants` system lets a team say:

> “If the PR is green on our invariant suite, we are confident that the structural, compositional, and test-presence properties we care about are held. Human review can therefore focus almost entirely on business logic, edge cases, and product correctness.”

Secondary goals:

- Agents stop inventing parallel implementations of existing helpers (semantic DRY).
- New pages never ship without proper loading/error/success UI.
- Design-system tokens are actually used instead of ad-hoc CSS.
- The same mental model works across TypeScript and Python codebases.

## Non-goals (at least initially)

- Replacing type checkers or security SAST tools.
- Attempting to prove full logical correctness (impossible in general).
- Building a full IDE or agent framework — we integrate with existing ones via CLI + MCP.
- Supporting every language under the sun in v1.

## Relationship to existing tools

We stand on the shoulders of Semgrep, ts-morph, ArchUnit*, dupehound, coverage tools, etc. The contribution is the *integration layer*, the *higher-order rule primitives* (especially compositional JSX/TS patterns), the *proactive semantic DRY agent loop*, and a coherent multi-language product experience aimed at AI-era workflows.

See [RESEARCH.md](./RESEARCH.md) for the detailed competitive landscape.
