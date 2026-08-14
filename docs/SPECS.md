# Specifications — code-invariants

This document defines the intended architecture, interfaces, and first set of rules so that a coding agent (or human) can implement the system without ambiguity.

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI / MCP Server                     │
│  code-invariants check | query | index | report             │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                     Rule Engine (core)                      │
│  - loads rule plugins                                       │
│  - walks AST / graph / embeddings                           │
│  - collects violations with location + fix hints            │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
     ┌─────────▼─────────┐          ┌─────────▼─────────┐
     │  Language Frontends│          │  Semantic Index   │
     │  - TypeScript      │          │  (vector store)   │
     │    (ts-morph)      │          │  for DRY checks   │
     │  - Python          │          └───────────────────┘
     │    (libCST /       │
     │     tree-sitter)   │
     └────────────────────┘
```

### Core concepts

- **Rule**: A named, configurable check that produces zero or more `Violation`s.
- **Violation**: `{ ruleId, severity, file, range, message, suggestion? }`
- **Frontend**: Language-specific AST / symbol provider.
- **Index**: Optional persistent vector + structural index of the repository (updated on merge / on demand).

## 2. First-class rules (v1 targets)

### R1 — Query error handling (TypeScript / React)

**Intent**: Every call to `useQuery` / `useMutation` (TanStack Query) must either:
- provide a non-empty `onError` handler, **or**
- be used inside a component that exhaustively handles the `isError` / `error` state (preferred modern pattern), **or**
- be covered by a project-level global `QueryCache` `onError` that the rule can detect as configured.

**Enforcement style**: AST walker that finds all `useQuery(...)` call expressions and inspects the options object + surrounding JSX / control flow.

**Config knobs**:
- `requireOnError: boolean` (legacy)
- `allowGlobalHandler: boolean`
- `frameworks: ["tanstack-query"]`

### R2 — Exhaustive data states via compositional components

**Intent**: Any page or component that performs a data query must render through a `DataRegion` (or equivalent) that forces the developer/agent to supply `.loading`, `.error`, and `.success` children.

Example shape the rule should recognise and enforce:

```tsx
<DataRegion query={someQuery}>
  <DataRegion.Loading>...</DataRegion.Loading>
  <DataRegion.Error>...</DataRegion.Error>
  <DataRegion.Success>...</DataRegion.Success>
</DataRegion>
```

**Enforcement**:
1. Detect files / components that call `useQuery` (or configured data hooks).
2. Require that the returned JSX root (or a configured wrapper) is a `DataRegion`.
3. Require that the three composition children are present exactly once.

This is the canonical “higher-order compositional” rule that classic ESLint struggles with and that custom AST walkers excel at.

### R3 — Semantic style tokens only

**Intent**: `className` (and equivalent style props) may only receive values of a branded `StyleToken` type generated from the project’s design-system definition.

**Enforcement**:
- Generate / maintain a branded type from the design tokens source of truth.
- Type-aware or AST rule that flags any `className={...}` whose static value is not a known token (or a concatenation of known tokens).
- Optional: ban raw Tailwind arbitrary values or CSS-in-JS magic strings outside the token set.

### R4 — Semantic DRY gate (proactive)

**Intent**: Before an agent (or developer) commits a new top-level function / component / class, the system can be queried for semantically similar existing symbols. CI can also fail if a newly added symbol is too similar to an existing one above a configurable threshold.

**Implementation sketch**:
- On `index` command (or post-merge hook): embed all exported functions/components using a code embedding model (local preferred).
- Store in a local vector DB (Chroma, LanceDB, sqlite-vss, etc.) keyed by symbol identity.
- `query --similar "description or code snippet"` returns nearest neighbours with scores.
- CI mode: for every newly added symbol in the diff, compute similarity; fail if > threshold and not in an allow-list / ignore file.

Combine with structural fingerprinting (inspired by dupehound) for higher precision on near-clones.

### R5 — Test presence (static)

**Intent**: Every exported function, class, or React component must appear as a reference (call expression, JSX usage, etc.) inside at least one test file (`*.test.*`, `*.spec.*`, `__tests__/**`, etc.).

**Enforcement**: Cross-file AST / symbol analysis. Complement (do not replace) runtime function coverage thresholds.

### R6 — Architecture fitness (stretch for v1)

Layer / folder dependency rules, cycle detection, naming conventions — largely already solved by ArchUnitTS, dependency-cruiser, etc. The value is offering a unified configuration surface and agent-friendly reporting.

## 3. CLI interface (proposed)

```bash
npx code-invariants init          # create config + example rules
npx code-invariants check         # run all enabled rules on the repo / changed files
npx code-invariants check --rule R2
npx code-invariants index         # (re)build the semantic + structural index
npx code-invariants query --similar "user profile card with avatar"
npx code-invariants report        # human + machine readable summary
```

Exit codes: 0 = clean, 1 = violations found, 2 = tool error.

## 4. Configuration (proposed)

`code-invariants.config.ts` or `.yml`:

```ts
export default {
  languages: ["typescript", "python"],
  rules: {
    "query-error-handling": { enabled: true, ... },
    "data-region-exhaustive": { enabled: true, componentName: "DataRegion" },
    "semantic-style-tokens": { enabled: true, tokensPath: "./src/theme/tokens.ts" },
    "semantic-dry": { enabled: true, threshold: 0.82, indexPath: ".code-invariants/index" },
    "test-presence": { enabled: true },
  },
  include: ["src/**/*.{ts,tsx,py}"],
  exclude: ["**/*.test.*", "**/generated/**"],
};
```

## 5. MCP server (agent integration)

Expose at least:

- `check_file(path)` / `check_diff`
- `query_similar(code_or_description)`
- `list_violations`
- `get_rule_docs(ruleId)`

So that an agent can call the tools mid-generation and self-correct.

## 6. Language support matrix (initial)

| Capability                    | TypeScript | Python |
|-------------------------------|------------|--------|
| AST compositional rules       | Primary    | Planned |
| Semantic style / tokens       | Primary    | Later   |
| Semantic DRY (embeddings)     | Yes        | Yes     |
| Structural clone detection    | Yes        | Yes     |
| Test-presence                 | Yes        | Yes     |
| Architecture fitness          | Yes        | Yes     |

## 7. Implementation notes for the first agent

- Prefer `ts-morph` for the TypeScript frontend (already proven in the author’s prototype).
- Keep rules as pure functions / classes that receive a `SourceFile` (or equivalent) + project context and return `Violation[]`.
- Make the engine rule-plugin based from day one so new invariants can be added without touching the core.
- Start with a single package; monorepo can come later if needed.
- Tests for the rules themselves are mandatory (feed example good/bad code and assert on violations).

## 8. Success metrics for v0.1

- Three compositional rules (R1–R3) working on a real React + TanStack Query codebase.
- CLI `check` that can be dropped into GitHub Actions and fails the build on violations.
- Clear, actionable violation messages.
- Basic documentation that lets another agent continue the work.
