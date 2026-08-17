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

5. **Runtime helpers**  
   Optional companion packages (e.g. `@code-invariants/react` shipping a reference `DataRegion`). Static rules work both with the official helpers and with equivalent structural patterns the user already has.

6. **Scope of v1**  
   High-quality TypeScript/React engine first. Python (and other languages) later, reusing the same core protocol.

7. **Relationship to classic linters/formatters**  
   `code-invariants` is the *higher-order* layer. It does **not** wrap, re-implement, or own configuration for Biome, ESLint, Prettier, Oxlint, or Ruff. Users are expected to run a fast linter/formatter of their choice. We may later offer a thin convenience flag that invokes the user’s existing Biome/ESLint config and then runs our rules, but we never own those tools’ configuration or rule sets. Custom plugins that need classic lint/format results should call those tools themselves.

8. **AST strategy**  
   No unified cross-language AST. Each frontend parses the language project **once per language run** and returns a `ParsedProject` (native `project` + `sources` map). The same project and source map are reused by every rule. Rules are **project-scoped**: `create` runs once per enabled rule (not once per file) and receives the whole graph via `RuleContext`. The plugin contract stays language-agnostic at the boundary (`RuleContext` + `report`) while giving rules full native AST power inside `create`. This avoids both the precision loss of a lowest-common-denominator IR and the cost of re-parsing for every rule.

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
- **Violation**: `{ ruleId, severity, file, range, message, suggestion? }`
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

export interface Rule {
  meta: {
    docs: { description: string; url?: string };
    schema?: JSONSchema;        // options validation
    fixable?: "code" | "whitespace";
  };
  create(context: RuleContext): void | RuleListener;
}

export interface RuleContext {
  id: string;
  options: unknown;             // already validated against schema
  report(violation: Omit<Violation, "ruleId">): void;
  getProject(): unknown;        // native project (ts-morph `Project` for TypeScript)
  getSources(): ReadonlyMap<string, SourceUnit>; // same Map instance for every rule
  getFilenames(): readonly string[];             // display paths, stable order
  getSource(filename: string): SourceUnit | undefined; // display or absolute path
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

Rules are project-scoped: `create` is invoked once per enabled rule per language run, not once per file. They never touch the filesystem or the CLI. They only receive a `RuleContext` and call `context.report`. This keeps them testable and isolatable.

A custom plugin is simply an npm package (or local folder) that exports a `Plugin`. The core discovers it from the `plugins` array in the user’s config.

**v1 constraint**: plugins are authored in TypeScript/JavaScript only.

## 3. First-class rules (v1 targets)

### R1 — Query error handling (TypeScript / React)
### R2 — Exhaustive data states via compositional components (DataRegion pattern)
### R3 — Semantic style tokens only
### R4 — Semantic DRY gate (proactive + CI)
### R5 — Test presence (static)
### R6 — Architecture fitness (stretch)

(Details of each rule remain as previously specified.)

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
    "@code-invariants/react",
    "./my-custom-plugin",
  ],
  rules: {
    "react/data-region-exhaustive": "error",
    "react/semantic-style-tokens": "off",
  },
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["**/*.test.*", "**/generated/**"],
});
```

`defineConfig` performs both type-level and runtime validation.

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
