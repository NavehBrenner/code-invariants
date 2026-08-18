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
   **Core has no built-in rule bag.** Every check is a plugin rule. Core is the engine, language frontends, config/CLI, and (later) the index — not a default catalog. Baseline TypeScript rules live in `@code-invariants/typescript` (`Plugin.name: "ts"`). A plugin may ship `configs.recommended`; installing a plugin does **not** enable its rules (locked #2).

5. **Runtime helpers**  
   Optional companion packages (e.g. a future official `DataRegion`). Static rules work both with the official helpers and with equivalent structural patterns the user already has. **Helpers are optional; this WP ships none.** TanStack Query detectors live under `@code-invariants/react`, not a separate package.

6. **Scope of v1**  
   High-quality TypeScript/React engine first. Python (and other languages) later, reusing the same core protocol.

7. **Relationship to classic linters/formatters**  
   `code-invariants` is the *higher-order* layer. It does **not** wrap, re-implement, or own configuration for Biome, ESLint, Prettier, Oxlint, or Ruff. Users are expected to run a fast linter/formatter of their choice. We may later offer a thin convenience flag that invokes the user’s existing Biome/ESLint config and then runs our rules, but we never own those tools’ configuration or rule sets. Custom plugins that need classic lint/format results should call those tools themselves.

    **TypeScript baseline — what we own:** `ts/public-exports-tested` (static R5-lite).

    **React plugin — what we own:** `react/no-fetch-in-useeffect` and `react/query-error-handled` (R1-lite). TanStack stays inside `@code-invariants/react` (detectors only). **R3 semantic tokens → future `@code-invariants/tailwind` (or DS), not react.** Later: index-backed DRY (R4). Architecture fitness only if we add something ArchUnit / dependency-cruiser do not already cover.

   **What we do not own** (use Biome, ESLint, or dependency-cruiser): circular imports; max relative import depth; simple path bans (`dist/`, `generated/`, …); deep-import / internal-module bans; generic layer charts those tools already do well.

   **Overlap family:** `import-boundary` / layers / no-import-from / no-deep-import / max-relative-depth are one policy family. The v1 TypeScript plugin catalogs **none** of them unless a future WP proves a unique agent-facing gap. Prefer configuring Biome + dependency-cruiser over reimplementation.

8. **Two rule kinds / two pipelines**  
   No unified cross-language AST. Same product idea on two languages ⇒ **two language rules**, not one multi-AST rule. Rules declare `meta.kind` with **no default** (`"language"` | `"project"`). Missing or invalid kind is a load/check error (exit 2).

   **Language rules** (`kind: "language"`) must declare a non-empty `languages` array. Each frontend parses that language **once per language run** and returns a `ParsedProject` (native `project` + `sources` map). The same object is reused by every language rule for that language. `create` runs once per enabled language rule **per language** and receives `LanguageRuleContext` (`language`, `getProject`, `getSources`, `getSource(name)`, `getFilenames`). A language rule is never given another language’s parse, and must not set `requires`.

   **Project rules** (`kind: "project"`) are **workspace-level**, not a ts-morph `Project`. They run in a **separate** pipeline with `ProjectRuleContext` (`getCwd`, `getFiles`). They never receive `getProject()` / source units / language AST APIs. Name clash: `kind: "project"` ≠ `getProject()`. Optional `requires?: Array<"index">` is a seam; if any enabled project rule requires `"index"`, check exits 2 (`index not implemented`) until a real index exists.

   This avoids both the precision loss of a lowest-common-denominator IR and the cost of re-parsing for every rule, and keeps non-AST checks out of the language loop.

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
│  - loads rule plugins                                       │
│  - orchestrates frontends                                   │
│  - collects violations with location + fix hints            │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
     ┌─────────▼─────────┐          ┌─────────▼─────────┐
     │  Language Frontends│          │  Semantic Index   │
     │  - TypeScript      │          │  (vector store)   │
     │    (ts-morph)      │          │  for DRY checks   │
     │  - Python (later)  │          └───────────────────┘
     │    (libCST /       │
     │     tree-sitter)   │
     └────────────────────┘
```

### Core concepts

- **Rule**: A named, configurable check that produces zero or more `Violation`s.
- **Violation**: `{ ruleId, severity, file, range, message, suggestion }`  
  `suggestion` is **required**. When a rule has nothing to suggest, pass the sentinel exported from core:

  `NO_SUGGESTION = "No suggestion available for this rule."`

  Product rules in this repo (`ts/public-exports-tested`, `react/no-fetch-in-useeffect`, `react/query-error-handled`) **must** use concrete suggestions, not the sentinel. CLI prints a `suggestion:` line unless the value is exactly `NO_SUGGESTION`. `report()` fills the sentinel at runtime if the field is missing (JS plugins keep working).
- **Frontend**: Language-specific AST / symbol provider that implements the frontend protocol.
- **Plugin**: A package that exports one or more rules (and optionally recommended configs) conforming to the plugin contract.
- **Index**: Optional persistent vector + structural index of the repository.

## 2. Plugin contract (explicit)

Every plugin must export an object matching this shape (TypeScript types will be published):

```ts
export interface Plugin {
  name: string;                 // e.g. "react" or "@my-org/internal"
  version?: string;
  rules?: Record<string, Rule>;
  configs?: {
    recommended?: Partial<UserConfig>;
  };
}

export type Rule = LanguageRule | ProjectRule; // discriminated on meta.kind; no default

export interface LanguageRule {
  meta: {
    kind: "language";
    languages: string[];        // required, non-empty; e.g. ["typescript"]
    docs: { description: string; url?: string };
    schema?: JSONSchema;
    fixable?: "code" | "whitespace";
  };
  create(context: LanguageRuleContext): void | RuleListener;
}

export interface ProjectRule {
  meta: {
    kind: "project";            // workspace-level, **not** ts-morph Project
    requires?: Array<"index">;  // optional seam; "index" not implemented yet
    docs: { description: string; url?: string };
    schema?: JSONSchema;
    fixable?: "code" | "whitespace";
  };
  create(context: ProjectRuleContext): void | RuleListener;
}

export interface LanguageRuleContext {
  id: string;
  options: unknown;             // already validated against schema
  report(violation: Omit<Violation, "ruleId">): void;
  language: string;             // pipeline language for this invocation
  getProject(): unknown;        // native project for **that** language only
  getSources(): ReadonlyMap<string, SourceUnit>;
  getFilenames(): readonly string[];
  getSource(filename: string): SourceUnit | undefined;
}

export interface ProjectRuleContext {
  id: string;
  options: unknown;
  report(violation: Omit<Violation, "ruleId">): void;
  getCwd(): string;
  getFiles(): readonly string[]; // display paths, stable order; no AST APIs
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

Language rules: `create` is invoked once per enabled rule **per language**, not once per file, and only for languages in both `meta.languages` and `config.languages`. Project rules (`kind: "project"` = workspace-level, **not** ts-morph `Project`) run in a separate pipeline and must not receive language AST context. Rules never touch the filesystem or the CLI; they only receive their context and call `context.report`. This keeps them testable and isolatable.

Enabled language rule whose `languages` do not intersect `config.languages` is an error (do not silently skip). A language listed on an enabled rule with no frontend is an error. `requires` on a language rule is an error. Missing/invalid `kind` or empty `languages` on a language rule is an error.

A custom plugin is simply an npm package (or local folder) that exports a `Plugin`. The core discovers it from the `plugins` array in the user’s config. Core never ships a default rule table; a rule exists only if a loaded plugin lists it. Installing `@code-invariants/typescript` (or any plugin) does not enable rules until they appear in `config.rules`. `configs.recommended` is an optional preset the user copies in — the engine does not apply it on install.

**v1 constraint**: plugins are authored in TypeScript/JavaScript only.

## 3. First-class rules (v1 targets)

### R1 — Query error handling (`react/query-error-handled`)

Implemented in `@code-invariants/react` as **`react/query-error-handled`**.  
`kind: "language"`, `languages: ["typescript"]`. Structural only — no mandatory DataRegion / helper.

**Intent:** Every TanStack `useQuery` (and locked twins) usage must not ignore errors.

| Topic | Decision |
|--------|----------|
| Import | Specifier `=== "@tanstack/react-query"` or starts with `@tanstack/react-query/`. |
| In | `useQuery`, `useInfiniteQuery` (same error model). Named aliases and `TQ.useQuery` / default-or-namespace member access. |
| Skip | `useSuspenseQuery`, `useSuspenseInfiniteQuery` — do **not** require `isError` (error often via boundary / throw). |
| Out | `useQueries`, `useMutation`, SWR, Apollo, parent Error Boundary graph proof, pending/loading UI, DataRegion / `matchQuery`. |
| Compliance (any one) | (1) Same **enclosing function body** uses `isError` / `error` / `status === "error"` (or `'error'`) in `if` / ternary / `&&` — via destructure or `result.*`. Mere destructure without a condition is **not** enough. Nested function declarations / non-IIFE arrows are **not** that body. (2) Options object (v5 first arg or v4 second) has `throwOnError: true` or a function (not literally `false`). (3) No other escapes. |
| Unfollowed | `throwOnError` as an identifier / shorthand we cannot see statically → **not** compliance. |
| Config | none. |
| Violation | Range on the hook call; `ruleId` `react/query-error-handled`; message names the hook and says the error is unhandled; concrete suggestion to branch locally **or** set `throwOnError: true` and render an Error Boundary. |

**Recommended:** `configs.recommended.rules["react/query-error-handled"] = "error"`. Install does **not** apply recommended (locked #2 / #4).

### `react/no-fetch-in-useeffect`

Implemented in `@code-invariants/react`.  
`kind: "language"`, `languages: ["typescript"]`. Aligns with React’s [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

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

### R4 — Semantic DRY gate (proactive + CI)
### R5 — Test presence (static)

Implemented in `@code-invariants/typescript` as **`ts/public-exports-tested`**.  
`kind: "language"`, `languages: ["typescript"]`. Coverage tools are out of scope for this check.

**Intent:** Every **public** value export in included non-test sources must be referenced at least once from a **test** path.

| Topic | Decision |
|--------|----------|
| Public export | Value exports in non-test, non-`.d.ts` files already in the language pipeline: `export function` / `class` / `const` / `let` / `var` / `enum`, `export default`, `export { name }`, `export { name } from`. Name for default is `"default"`. |
| Skip | Type-only (`export type`, `export interface`, `export { type X }`). `export *` / `export * as ns`. `export =`. Ambient `.d.ts`. Exports in test paths. |
| Test path (not configurable in v1) | File is in the language pipeline, and basename matches `*.test.*` / `*.spec.*`, or a path segment is `__tests__`. |
| Reference | Test-file import whose specifier **resolves relatively** (`.ts` / `.tsx` / `.mts` / `.cts` + `index`) to the exporting file in `getSources()`, and the import binds that export name (named) or is a default import (`default`). `import *` does not satisfy named exports. Bare specifiers / dynamic `import()` do not count in v1. |
| Barrel + source | If both `impl.ts` (`export const x`) and `barrel.ts` (`export { x } from "./impl"`) are in the language set, a test import from the barrel satisfies **only** the barrel export, not impl’s own public export. Each public surface needs its own test reference. |
| Scope | Include/exclude only. No index. **Tests must not be excluded** or every export fails. This rule only sees files in the language pipeline; a default/global `exclude` of `**/*.test.*` / `**/*.spec.*` wipes the reference sources. Production excludes (`**/generated/**`, `**/dist/**`) are fine. Recommended and example configs keep tests in the set. |
| Violation | `ruleId` `ts/public-exports-tested`; location on the export; message names the export and file; suggestion: import it from a test. |
| Recommended | `configs.recommended.rules["ts/public-exports-tested"] = "error"`. Install does **not** apply recommended (locked #2 / #4). |

See [docs/rulesets/typescript.md](./rulesets/typescript.md).

### R6 — Architecture fitness (stretch)

(Details of R4 and R6 remain as previously specified.)

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
    "./my-custom-plugin",
  ],
  rules: {
    "ts/public-exports-tested": "error",
    "react/no-fetch-in-useeffect": "error",
    "react/query-error-handled": "error",
  },
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["**/generated/**"],
});
```

`defineConfig` performs both type-level and runtime validation.

**Do not exclude test paths** (`**/*.test.*`, `**/*.spec.*`, `__tests__/**`) when `ts/public-exports-tested` is enabled. The rule only sees files in the language pipeline; wiping tests from the set makes every public export fail. Keep tests in `include`. Default exclude is `node_modules` and `dist` only.

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
