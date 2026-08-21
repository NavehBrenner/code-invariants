# Specifications — code-invariants

This document defines the intended architecture, interfaces, and first set of rules so that a coding agent (or human) can implement the system without ambiguity.

## Locked decisions (August 2026)

These decisions are considered stable unless a major new constraint appears:

1. **Consumption model**  
   CLI-first (ESLint/Ruff-like). Selective execution is required:
   ```bash
   code-invariants check
   code-invariants check --plugin react
   code-invariants check --rule react/data-region-exhaustive
   code-invariants check --exclude-plugin dry
   code-invariants check --diff --plugin react
   ```
   Exit codes 0/1/2. JSON/SARIF output. Optional MCP server as a thin wrapper around the same engine. Official GitHub Action + pre-commit examples.

2. **Configuration**  
   Primary path is a typed `defineConfig` function (TypeScript) that provides IntelliSense, autocomplete, and runtime validation of unknown keys / mismatched rule ids. JSON/YAML remains supported for non-TS projects. Every rule is independently toggleable; installing a plugin does **not** force all of its rules on.

3. **Core language & multi-language strategy**  
   Core engine, CLI, MCP, and config system are written in **TypeScript**. Language frontends are separate packages that speak a stable, narrow protocol. Rules for a given language are written against that language’s native AST library (ts-morph for TypeScript, libCST/tree-sitter for Python, etc.). The core never imports language-specific AST types directly.

4. **Plugins**  
   First-class and user-writable. There is one explicit contract (see § Plugin contract). Plugins can be published as npm packages or loaded from local paths. Agent skills for creating and maintaining plugins are part of the deliverable.  
   **v1 plugin language is TypeScript only.** Plugins are TypeScript/JavaScript packages that export the `Plugin` interface. Python-written plugins may be supported later via the same protocol once a Python frontend exists.  
    **Core has no built-in rule bag.** Every check is a plugin rule. Core is the engine, language frontends, config/CLI, and a generic artifact seam — not a default catalog and **not** a dupehound (or other niche binary) host. Baseline TypeScript rules live in `@code-invariants/typescript` (`Plugin.name: "ts"`). React compositional rules live in `@code-invariants/react` (`Plugin.name: "react"`). Structural DRY lives in `@code-invariants/dry` (`Plugin.name: "dry"`), which **provides** the `dupehound` artifact. A plugin may ship `configs.recommended`; installing a plugin does **not** enable its rules (locked #2).

5. **Runtime helpers**  
   Optional companion packages (e.g. a future official `DataRegion`). Static rules work both with the official helpers and with equivalent structural patterns the user already has. **Helpers are optional; this WP ships none.** TanStack Query detectors live under `@code-invariants/react`, not a separate package.

6. **Scope of v1**  
   High-quality TypeScript/React engine first. Python (and other languages) later, reusing the same core protocol.

7. **Relationship to classic linters/formatters**  
   `code-invariants` is the *higher-order* layer. It does **not** wrap, re-implement, or own configuration for Biome, ESLint, Prettier, Oxlint, or Ruff. Users are expected to run a fast linter/formatter of their choice. We may later offer a thin convenience flag that invokes the user’s existing Biome/ESLint config and then runs our rules, but we never own those tools’ configuration or rule sets. Custom plugins that need classic lint/format results should call those tools themselves.

    **TypeScript baseline — what we own:** `ts/public-exports-tested` (static R5-lite).

    **React plugin — what we own:** `react/no-fetch-in-useeffect` and `react/query-error-handled` (R1-lite). TanStack stays inside `@code-invariants/react` (detectors only). **R3 semantic tokens → future `@code-invariants/tailwind` (or DS), not react.**

    **DRY plugin — what we own:** `dry/no-duplicate-functions` (structural R4 via dupehound). We wrap the dupehound CLI for agent-facing violations and plugin config; we do not re-own its fingerprinting algorithm. Embeddings / Slopo-style semantic near-dupes remain later. Architecture fitness only if we add something ArchUnit / dependency-cruiser do not already cover.

   **What we do not own** (use Biome, ESLint, or dependency-cruiser): circular imports; max relative import depth; simple path bans (`dist/`, `generated/`, …); deep-import / internal-module bans; generic layer charts those tools already do well.

   **Overlap family:** `import-boundary` / layers / no-import-from / no-deep-import / max-relative-depth are one policy family. The v1 TypeScript plugin catalogs **none** of them unless a future WP proves a unique agent-facing gap. Prefer configuring Biome + dependency-cruiser over reimplementation.

8. **One rule type / one engine loop**  
   No unified cross-language AST. Same product idea on two languages ⇒ **two rules** (convention, not `meta.kind`), each `requires` that language’s artifact id. There is a single `Rule` / `RuleContext`. Optional `meta.requires: string[]` names artifacts. Language AST id = language name (`"typescript"` → today’s `ParsedProject`). `config.languages` is an **allowlist**: requiring a language not listed → exit 2.

   **Who provides:** core wraps language frontends as providers keyed by language name. Plugins `provides` **non-language artifacts only** (`dupehound` stays in `@code-invariants/dry`). Language ids are reserved (plugin `provides.typescript` → exit 2).

   **Engine:** resolve enabled rules → validate `requires` → union ids → **build each once** (core language **or** plugin `provides`) → `create` every rule once with the same context. One include/exclude file pass; language `build` filters extensions (TS: `.ts`/`.tsx`/`.mts`/`.cts`). Empty sources after filter is success, not an error. No language vs project pipelines.

   **Fail closed (exit 2, name rule ids):** invalid `requires`; language id not in `config.languages`; language in allowlist but no frontend; missing plugin provider; duplicate provider id; reserved language id on plugin `provides`; build throw; `getArtifact` for an id not in that rule’s `requires`. Do not silently skip.

   Not a vector store. `code-invariants index` CLI stays unimplemented. Dupehound (structural fingerprints / winnowing, **not** embeddings) is provided by `@code-invariants/dry` as artifact id `"dupehound"`.

   This avoids both the precision loss of a lowest-common-denominator IR and the cost of re-parsing for every rule.

9. **Performance approach**  
   TypeScript core is the deliberate starting point for velocity and for a TypeScript-native plugin ecosystem. Performance is treated as a hard constraint:
   - Default CI mode should be incremental (`--diff` / changed files only).
   - Cache the language frontend’s project/AST state across runs where possible.
   - Avoid naïve full-project type-aware analysis on every invocation.
   - Measure real wall-clock time on representative monorepos early.
   - Only if measured numbers are unacceptable: extract hot paths (parsing, simple structural walks) into a native (Rust/oxc) addon while keeping the rule-authoring surface in TypeScript.  
   A full rewrite of the core in Rust (or making Rust the first supported language for self-hosting) is explicitly **out of scope** for v1.

---

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI / MCP Server                     │
│  code-invariants check | query | index | report             │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                     Rule Engine (core)                      │
│  - loads plugins                                            │
│  - unions requires; builds each artifact once               │
│  - one create() loop; collects violations                   │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
      ┌─────────▼─────────┐          ┌─────────▼─────────┐
      │  Language artifacts│          │  Plugin artifacts │
      │  (core frontends)  │          │  (plugin provides)│
      │  id = language name│          │  e.g. dupehound   │
      │  "typescript" →    │          │  in @…/dry        │
      │  ParsedProject     │          │  embeddings later │
      └────────────────────┘          └───────────────────┘
```

### Core concepts

- **Rule**: A named, configurable check that produces zero or more `Violation`s.
- **Violation**: `{ ruleId, severity, file, range, message, suggestion }`  
  `suggestion` is **required**. When a rule has nothing to suggest, pass the sentinel exported from core:

  `NO_SUGGESTION = "No suggestion available for this rule."`

  Product rules in this repo (`ts/public-exports-tested`, `react/no-fetch-in-useeffect`, `react/query-error-handled`, `dry/no-duplicate-functions`) **must** use concrete suggestions, not the sentinel. CLI prints a `suggestion:` line unless the value is exactly `NO_SUGGESTION`. `report()` fills the sentinel at runtime if the field is missing (JS plugins keep working).
- **Frontend**: Language-specific AST / symbol provider that implements the frontend protocol.
- **Plugin**: A package that exports one or more rules (and optionally recommended configs and `provides` artifact builders) conforming to the plugin contract.
- **Artifact**: Opaque value built once per check when an enabled rule `requires` its id. Language AST id = language name (`"typescript"` → `ParsedProject` from the core frontend). `@code-invariants/dry` provides `"dupehound"` (structural fingerprints). Vector / embedding index is still future.

## 2. Plugin contract (explicit)

Every plugin must export an object matching this shape (TypeScript types will be published):

```ts
export interface Plugin {
  name: string;                 // e.g. "react" or "@my-org/internal"
  version?: string;
  rules?: Record<string, Rule>;
  provides?: Record<string, ArtifactProvider>;
  configs?: {
    recommended?: Partial<UserConfig>;
  };
}

export interface ArtifactProvider {
  build(ctx: ArtifactBuildContext): Promise<unknown> | unknown;
}

export interface ArtifactBuildContext {
  cwd: string;
  files: readonly string[];     // display paths, stable order
  exclude: readonly string[];
  requiredBy: readonly string[]; // enabled rule ids that require this artifact
}

export interface Rule {
  meta: {
    requires?: string[];        // artifact ids; language AST id = language name
    docs: { description: string; url?: string };
    schema?: JSONSchema;
    fixable?: "code" | "whitespace";
  };
  create(context: RuleContext): void | RuleListener;
}

export interface RuleContext {
  id: string;
  options: unknown;             // already validated against schema
  report(violation: Omit<Violation, "ruleId">): void;
  getCwd(): string;
  getFiles(): readonly string[]; // one include/exclude pass, display paths
  getArtifact(id: string): unknown; // only if meta.requires includes id
}

export interface LanguageFrontend {
  readonly language: string;
  /** Parse all paths once. Same project/sources object is reused for every rule. */
  parseFiles(absolutePaths: readonly string[]): ParsedProject;
}

/** Opaque to core; TS frontend uses ts-morph Project + SourceFiles. */
export interface ParsedProject {
  readonly project: unknown;
  readonly sources: ReadonlyMap<string, SourceUnit>;
}
```

`create` is invoked once per enabled rule, not once per file. Rules never touch the filesystem or the CLI; they only receive their context and call `context.report`. Language consumers: `requires: ["typescript"]` and `getArtifact("typescript")` as `ParsedProject` (`.project` / `.sources`). A plugin `provides.build` function **may** spawn tools; rules must not. Plugins must not `provides` a language id. This keeps rules testable and isolatable.

Invalid `requires`, a required language not in `config.languages`, a language in the allowlist with no frontend, a missing plugin provider, a duplicate or reserved provider id, a build throw, or `getArtifact` for an id not in that rule’s `requires` is an error (exit 2; do not silently skip). The message names the rule id(s).

A custom plugin is simply an npm package (or local folder) that exports a `Plugin`. The core discovers it from the `plugins` array in the user’s config. Core never ships a default rule table; a rule exists only if a loaded plugin lists it. Installing `@code-invariants/typescript` (or any plugin) does not enable rules until they appear in `config.rules`. `configs.recommended` is an optional preset the user copies in — the engine does not apply it on install.

**v1 constraint**: plugins are authored in TypeScript/JavaScript only.

## 3. First-class rules (v1 targets)

### R1 — Query error handling (`react/query-error-handled`)

Implemented in `@code-invariants/react` as **`react/query-error-handled`**.  
`requires: ["typescript"]`; read AST from `getArtifact("typescript")`. Structural only — no mandatory DataRegion / helper.

**Intent:** Every TanStack `useQuery` (and locked twins) usage must not ignore errors.

| Topic | Decision |
|--------|----------|
| Import | Specifier `=== "@tanstack/react-query"` or starts with `@tanstack/react-query/`. |
| In | `useQuery`, `useInfiniteQuery` (same error model). Named aliases and `TQ.useQuery` / default-or-namespace member access. |
| Skip | `useSuspenseQuery`, `useSuspenseInfiniteQuery` — do **not** require `isError` (error often via boundary / throw). |
| Out | `useQueries`, `useMutation`, SWR, Apollo, parent Error Boundary graph proof, pending/loading UI, DataRegion / `matchQuery`. |
| Compliance (any one) | (1) Same **enclosing function body** branches (`if` / ternary / `&&`) on a **fact derived from that call’s result**: tracked `isError` / `error` / `status` via the result binding (`q.isError`, `q.status`, `q.error`), destructure (including renames such as `{ isError: failed }`), or a simple same-function alias / reassign (`const failed = q.isError`, `const s = q.status`). `status` must be compared with `===` / `==` to `"error"` / `'error'`. Free / unrelated identifiers named `isError` / `error` / `status`, or another call’s flags, do **not** count. Mere destructure without a branch is **not** enough. Nested function declarations / non-IIFE callbacks are **not** that body. (2) Options object (v5 first arg or v4 second) has `throwOnError: true` or a function (not literally `false`). (3) No other escapes. |
| Unfollowed | `throwOnError` as an identifier / shorthand we cannot see statically → **not** compliance. |
| Known miss | Interprocedural / helper / prop-drilled / Error Boundary graph — only the enclosing function body is scanned. |
| Config | none. |
| Violation | Range on the hook call; `ruleId` `react/query-error-handled`; message names the hook and says the error is unhandled; concrete suggestion to branch locally **or** set `throwOnError: true` and render an Error Boundary. |

**Recommended:** `configs.recommended.rules["react/query-error-handled"] = "error"`. Install does **not** apply recommended (locked #2 / #4).

### `react/no-fetch-in-useeffect`

Implemented in `@code-invariants/react`.  
`requires: ["typescript"]`; read AST from `getArtifact("typescript")`. Aligns with React’s [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

**Intent:** Do not kick off HTTP data loading inside `useEffect` / `useLayoutEffect`. Prefer data libraries, route loaders, or RSC.

| Topic | Decision |
|--------|----------|
| Effect callees | `useEffect`, `useLayoutEffect` whose binding resolves to `react` (named, `import React`, `import * as React`; specifier `=== "react"` or starts with `react/`). Unresolved / local same-name functions: **not** flagged. |
| Callback shape | First arg is inline `function` / arrow. Identifier callbacks: **known miss**, not followed in v1. |
| Nested policy | Scan the callback body, blocks (`if` / `try` / `for`), and **IIFEs**. **Do not** scan nested function declarations / non-IIFE arrows (event handlers / helpers). |
| Forbidden | `fetch(...)` (global or imported; a module-level local `function`/`const` named `fetch` is not the global). Callees bound to default/named/namespace import from specifier `axios` / `ky` / `got` (exact, or those names as path prefix `axios/…`). Cheap methods: `.get` / `.post` / `.put` / `.patch` / `.delete` on those same bindings (`axios.get`, `client.post`). |
| Not forbidden | DOM, subscriptions, analytics, `setTimeout`, non-listed HTTP libs. |
| Config | none. Future allowlist is a SPECS note only — not shipped. |
| Violation | Range on the **forbidden call**; `ruleId` `react/no-fetch-in-useeffect`; message names the API (`fetch` / `axios.get` / …); concrete suggestion to load with TanStack Query / SWR / a route loader / RSC. |

**Recommended:** `configs.recommended.rules["react/no-fetch-in-useeffect"] = "error"`.

### R2 — Exhaustive data states via compositional components (DataRegion pattern)

**Deferred.** No mandatory DataRegion / `matchQuery` helper in this WP. Backlog (`react/query-pending-handled`, optional later DataRegion path) lives in [docs/rulesets/react.md](./rulesets/react.md) — research inventory, not implement-now.

### R3 — Semantic style tokens only

**Not the React plugin.** Future `@code-invariants/tailwind` (or DS). Do not add token/class allowlists to `@code-invariants/react`.

### R4 — Structural DRY (`dry/no-duplicate-functions`)

Implemented in `@code-invariants/dry` as **`dry/no-duplicate-functions`**.  
`requires: ["dupehound"]`. Typed as `Rule`; uses `getCwd`, `getFiles`, `getArtifact`, `report`. The **dry plugin** wraps [dupehound](https://github.com/Rafaelpta/dupehound) `scan --json` in `provides.dupehound.build`; core does not spawn it. We do not reimplement fingerprints.

**Intent:** No structurally duplicate functions/methods in included non-test, non-generated sources.

| Topic | Decision |
|--------|----------|
| Engine | dupehound structural fingerprints (tree-sitter + winnowing — **not** embeddings). Dry provides artifact `"dupehound"`; the engine builds it once when any enabled rule `requires: ["dupehound"]` and exposes `getArtifact("dupehound")`. |
| Out | Embeddings, Slopo, `query --similar`, auto-merge / codemods, TypeScript interface/type-alias / whole-class clone detection (needs another provider, e.g. similarity-ts or the checker — not more dupehound flags). Incremental `dupehound check --diff` is later (`--diff` / WP-015). |
| Unit | All function-likes dupehound extracts (top-level, methods, arrow/`const` function-likes, `<anonymous>`). |
| Skip | Tests (`--exclude-tests` + path rules), generated (dupehound defaults + our exclude), files outside include (post-filter). |
| Threshold | dupehound scan default (0.80). Not configurable in v1. |
| `min_tokens` | 40 (dupehound default). Short functions are a known miss. |
| Violation | Copy (non-representative) location; `Omit<Violation, "ruleId">` only (engine stamps severity from config). Message names both functions and similarity; concrete reuse suggestion pointing at the original. Never `NO_SUGGESTION`. Range is best-effort (lines only, column 1). |
| Severity | `"error"` in recommended; config may set `"warn"`. No extra soft-gate product mode. |
| Capability | `requires: ["dupehound"]`. Fail closed (exit 2, clear message naming the rule) if the provider is missing, dupehound is missing / unrunnable, times out, or returns invalid JSON. Empty clusters after test/generated skip is success, not an error. |
| Install | Binary on `PATH` or `CODE_INVARIANTS_DUPEHOUND`. Pin **v0.1.2**. No network in default `check`. Optional `scripts/install-dupehound.sh` for local/CI. |

**Recommended:** `configs.recommended.rules["dry/no-duplicate-functions"] = "error"`. Install does **not** apply recommended (locked #2 / #4).

See [docs/rulesets/dry.md](./rulesets/dry.md).

### R5 — Test presence (static)

Implemented in `@code-invariants/typescript` as **`ts/public-exports-tested`**.  
`requires: ["typescript"]`; read AST from `getArtifact("typescript")`. Coverage tools are out of scope for this check.

**Intent:** Every **public** value export in included non-test sources must be referenced at least once from a **test** path.

| Topic | Decision |
|--------|----------|
| Public export | Value exports in non-test, non-`.d.ts` files already in the TypeScript artifact: `export function` / `class` / `const` / `let` / `var` / `enum`, `export default`, `export { name }`, `export { name } from`. Name for default is `"default"`. |
| Skip | Type-only (`export type`, `export interface`, `export { type X }`). `export *` / `export * as ns`. `export =`. Ambient `.d.ts`. Exports in test paths. |
| Test path (not configurable in v1) | File is in the TypeScript artifact, and basename matches `*.test.*` / `*.spec.*`, or a path segment is `__tests__`. |
| Reference | Test-file import whose specifier **resolves relatively** (`.ts` / `.tsx` / `.mts` / `.cts` + `index`) to the exporting file in `getArtifact("typescript").sources`, and the import binds that export name (named) or is a default import (`default`). `import *` does not satisfy named exports. Bare specifiers / dynamic `import()` do not count in v1. |
| Barrel + source | If both `impl.ts` (`export const x`) and `barrel.ts` (`export { x } from "./impl"`) are in the language set, a test import from the barrel satisfies **only** the barrel export, not impl’s own public export. Each public surface needs its own test reference. |
| Scope | Include/exclude only. No index. **Tests must not be excluded** or every export fails. This rule only sees files in the TypeScript artifact; a default/global `exclude` of `**/*.test.*` / `**/*.spec.*` wipes the reference sources. Production excludes (`**/generated/**`, `**/dist/**`) are fine. Recommended and example configs keep tests in the set. |
| Violation | `ruleId` `ts/public-exports-tested`; location on the export; message names the export and file; suggestion: import it from a test. |
| Recommended | `configs.recommended.rules["ts/public-exports-tested"] = "error"`. Install does **not** apply recommended (locked #2 / #4). |

See [docs/rulesets/typescript.md](./rulesets/typescript.md).

### R6 — Architecture fitness (stretch)

(Details of R6 remain as previously specified.)

### v1 TypeScript plugin catalog

`@code-invariants/typescript` (`name: "ts"`) ships only:

| Rule | Status |
|------|--------|
| `ts/public-exports-tested` | Implemented (this section) |

**Not catalogued** (do not implement in this plugin): circular imports, max relative import depth, simple path bans, deep-import / internal-module bans, generic layer charts. Use Biome / ESLint / dependency-cruiser.

**Overlap family:** `import-boundary` / layers / no-import-from / no-deep-import / max-relative-depth — catalog **none**.

React compositional rules live in `@code-invariants/react`, not this plugin. See the React catalog below and [docs/rulesets/react.md](./rulesets/react.md).

### v1 React plugin catalog

`@code-invariants/react` (`name: "react"`) ships only:

| Rule | Status |
|------|--------|
| `react/no-fetch-in-useeffect` | Implemented (this section) |
| `react/query-error-handled` | Implemented (this section; R1-lite) |

Backlog (effects family, query-pending, component API, Next/RSC, tailwind/R3) is documented in [docs/rulesets/react.md](./rulesets/react.md) and is **not** an implementation list for this WP.

Do **not** own classic eslint-plugin-react / react-hooks / jsx-a11y, TanStack eslint mechanical rules, or `@next/no-async-client-component`.

### v1 DRY plugin catalog

`@code-invariants/dry` (`name: "dry"`) ships only:

| Rule | Status |
|------|--------|
| `dry/no-duplicate-functions` | Implemented (this section; structural R4) |

Embeddings / semantic near-dupes are **not** this plugin.

## 4. CLI interface

```bash
code-invariants init
code-invariants check
code-invariants check --plugin react
code-invariants check --rule react/data-region-exhaustive
code-invariants check --exclude-plugin dry
code-invariants check --diff
code-invariants index
code-invariants query --similar "..."
code-invariants report
```

## 5. Configuration

```ts
import { defineConfig } from "code-invariants";

export default defineConfig({
  languages: ["typescript"],
  plugins: [
    "@code-invariants/typescript",
    "@code-invariants/react",
    // "@code-invariants/dry",
    "./my-custom-plugin",
  ],
  rules: {
    "ts/public-exports-tested": "error",
    "react/no-fetch-in-useeffect": "error",
    "react/query-error-handled": "error",
    // "dry/no-duplicate-functions": "error",
  },
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["**/generated/**"],
});
```

`defineConfig` performs both type-level and runtime validation.

**Do not exclude test paths** (`**/*.test.*`, `**/*.spec.*`, `__tests__/**`) when `ts/public-exports-tested` is enabled. The rule only sees files in the TypeScript artifact; wiping tests from the set makes every public export fail. Keep tests in `include`. Default exclude is `node_modules` and `dist` only.

## 6. MCP server

Thin wrapper exposing at least: `check_file`, `check_diff`, `query_similar`, `list_violations`, `get_rule_docs`.

## 7. Language support matrix (initial)

| Capability                    | TypeScript | Python |
|-------------------------------|------------|--------|
| AST compositional rules       | Primary    | Planned |
| Semantic style / tokens       | Primary    | Later   |
| Semantic DRY (embeddings)     | Yes        | Yes     |
| Structural clone detection    | Yes        | Yes     |
| Test-presence                 | Yes        | Yes     |
| Architecture fitness          | Yes        | Yes     |

## 8. Agent skills (required deliverable)

- Skill for scaffolding a new plugin that obeys the contract
- Skill for implementing and testing a rule against the TypeScript frontend
- Skill for registering the plugin in a consumer config
- Later: skills for filing issues and opening PRs against this repository

## 9. Success metrics for v0.1

- Three compositional rules (R1–R3) working on a real React + TanStack Query codebase
- CLI `check` usable in GitHub Actions (with `--diff` as the recommended CI mode)
- Clear, actionable violation messages
- Published plugin contract + at least one example custom plugin
- Agent skills that allow another model to create a working plugin
- Measured performance on at least one non-trivial monorepo; no naïve full-project re-parse on every run
