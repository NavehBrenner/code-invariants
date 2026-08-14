# TypeScript nice-to-have ruleset

Optional / advanced TypeScript practices **not** required in the [baseline (must-have)](./typescript-baseline.md).

Use these when a team wants a higher bar, library-quality public APIs, or stronger domain modeling. Defaults in our presets are **`off`** or **`warn`** unless noted.

**Research pass (2026)** focused on practices that did not already appear in the baseline: `satisfies`, branded types, enum alternatives, export hygiene, import ordering, readonly surfaces, and related style-guide guidance (Google TS, modern TS style guides, FSD, production blog consensus).

---

## 1. Type-level correctness patterns

| ID | Intent | Enforcement | Suggested |
|----|--------|-------------|----------|
| `ts/prefer-satisfies` | Prefer `satisfies Type` over `as Type` when validating object/array literals so inference is preserved | `code-invariants` / lint suggestion | warn |
| `ts/no-enum` | Prefer `as const` object + derived union over TypeScript `enum` (runtime cost, reverse mapping quirks, `erasableSyntaxOnly`) | lint (`no-restricted-syntax`) | warn |
| `ts/prefer-string-union-over-enum` | Documented alternative: `const Status = {…} as const; type Status = typeof Status[keyof typeof Status]` | convention / docs | — |
| `ts/branded-id-types` | Domain IDs (`UserId`, `OrderId`) should be branded types, not bare `string`/`number` (optional project-wide pattern) | `code-invariants` (heuristic) | off |
| `ts/exhaustive-never-default` | Switch on unions should end with `const _exhaustive: never = x` (stronger than exhaustiveness-check alone) | lint / `code-invariants` | warn |
| `ts/prefer-discriminated-unions` | Model multi-state data as discriminated unions rather than many optional flags | convention / review | — |
| `ts/no-invalid-void-type` | Restrict `void` in confusing positions (already partially in baseline type-checked rules) | type-checked lint | warn |

---

## 2. Export & API surface hygiene

| ID | Intent | Enforcement | Suggested |
|----|--------|-------------|----------|
| `ts/no-default-export` | Prefer named exports only (stable names, better refactors) — **opt-in** for apps/libs that agree | lint / `code-invariants` | off |
| `ts/no-mutable-exports` | Ban `export let` / reassignable live bindings | lint / `code-invariants` | warn |
| `ts/minimize-exports` | Flag exports never imported from outside the module (dead public surface) | `code-invariants` | warn |
| `ts/no-container-classes` | Ban classes that only exist to namespace static methods/constants — use modules | lint | warn |
| `ts/explicit-accessibility` | Require explicit `readonly` / visibility on class members where it clarifies intent | lint | off |
| `ts/prefer-readonly-public-props` | Public class fields that are never reassigned should be `readonly` | type-checked | warn |
| `ts/prefer-readonly-array-params` | Public APIs take `readonly T[]` / `ReadonlyArray<T>` when they don’t mutate | type-checked | off |

---

## 3. Import organization (style)

| ID | Intent | Enforcement | Suggested |
|----|--------|-------------|----------|
| `ts/import-order` | Groups: builtin → external → internal aliases → parent/sibling relative; newlines between groups | biome / eslint-plugin-import | warn |
| `ts/no-relative-parent-across-modules` | Ban `../../other-feature/...` when architecture modules are defined — force public API path | `code-invariants` | warn |
| `ts/consistent-path-style` | Prefer project alias (`@/…`) **or** relative consistently for cross-folder imports (team choice) | lint | off |

---

## 4. Barrel policy (beyond baseline)

Baseline already enforces public API + no deep imports. These are stricter policy knobs:

| ID | Intent | Enforcement | Suggested |
|----|--------|-------------|----------|
| `ts/barrels-only-at-boundaries` | Allow barrels only at configured module/package entries; ban incidental `index.ts` re-export folders | `code-invariants` | off |
| `ts/prefer-source-imports-internally` | Inside a module, import from source files rather than the module’s own barrel (avoids self-cycles) | `code-invariants` / lint | warn |
| `ts/max-barrel-export-count` | Soft cap on number of symbols a public barrel re-exports (forces splitting mega-APIs) | `code-invariants` | off |

> Note: the ecosystem is split on barrels. Our **baseline** position is: barrels are valid **as public API facades** at module boundaries; unrestricted barrels everywhere are not.

---

## 5. Async & error-handling polish

| ID | Intent | Enforcement | Suggested |
|----|--------|-------------|----------|
| `ts/prefer-promise-reject-errors` | `Promise.reject` only with `Error` values | lint | warn |
| `ts/no-async-promise-executor` | Ban `new Promise(async (resolve, reject) => …)` | lint | error (also common in recommended lint) |
| `ts/await-in-try-catch` | Discourage bare top-level await without error handling in app entry scripts | convention | — |
| `ts/prefer-result-type` | Optional: public fallible APIs return `Result<T, E>` / never-throw style (project convention) | convention / `code-invariants` | off |

---

## 6. Naming & documentation extras

| ID | Intent | Enforcement | Suggested |
|----|--------|-------------|----------|
| `ts/naming-generic-params` | Single type params often `T`; descriptive names for multiple (`TKey`, `TValue`) | lint naming | off |
| `ts/naming-boolean` | Booleans prefer `is`/`has`/`can`/`should` prefix | lint naming | off |
| `ts/jsdoc-public-api` | Exported symbols have a one-line JSDoc description | lint | off |
| `ts/no-redundant-type-constituents` | Ban `string \| any` / useless union constituents | type-checked | warn |

---

## 7. Performance & emit hygiene

| ID | Intent | Enforcement | Suggested |
|----|--------|-------------|----------|
| `ts/no-const-enum` | Ban `const enum` (breaks isolated modules / bundlers unless carefully controlled) | lint | warn |
| `ts/consistent-type-exports-on-api` | Library entrypoints export types with `export type` where value is not needed | lint | warn |
| `ts/no-side-effect-imports-in-lib` | Library source avoids bare `import './side-effect'` except documented entry | `code-invariants` | off |

---

## 8. Suggested optional preset

```text
typescript/strict+
  ├─ typescript/strict (must-have)
  ├─ prefer-satisfies, no-enum, exhaustive-never-default (warn)
  ├─ no-mutable-exports, minimize-exports (warn)
  ├─ import-order (warn)
  └─ prefer-source-imports-internally (warn)
```

Enable selectively:

```ts
export default defineConfig({
  plugins: ["@code-invariants/typescript"],
  rules: {
    "ts/prefer-satisfies": "warn",
    "ts/no-enum": "warn",
    "ts/no-mutable-exports": "error",
    "ts/prefer-source-imports-internally": "warn",
  },
});
```

---

## 9. Explicitly out of scope here

- Framework rules (React Query, DataRegion, hooks) → framework plugins
- Security (XSS, injection) → Semgrep / security plugin
- Formatting → Biome formatter
- Full FSD folder taxonomy as a hard default — we support it via configurable `architecture.layers`, not a single mandatory folder layout

---

*Must-have rules live in [typescript-baseline.md](./typescript-baseline.md). This file is the optional layer.*
