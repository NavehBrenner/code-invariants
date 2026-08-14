# TypeScript baseline ruleset (must-have)

Language-level invariants for TypeScript (no framework-specific rules).  
This is the foundation every TypeScript project should get from `code-invariants` before React, Node, or other plugins are layered on.

**Sources researched (2026):** typescript-eslint (`recommended` / `strict` / `strict-type-checked` / `stylistic`), Biome recommended + TypeScript rules, TypeScript handbook & `strict` family, `@tsconfig/strictest`, Google TypeScript Style Guide, dependency-cruiser / eslint-plugin-boundaries / Feature-Sliced Design patterns, common production practices.

**Companion doc:** [typescript-nice-to-have.md](./typescript-nice-to-have.md) — optional / advanced rules not required for the baseline.

**How to read this document**

| Column | Meaning |
|--------|--------|
| **ID** | Stable rule id we will use in config |
| **Intent** | What we are enforcing and why |
| **Enforcement** | Where it lives: `tsc` · `biome`/`oxlint` · `code-invariants` · `structural-dry` |
| **Default** | `error` / `warn` / `off` in our recommended preset |

Remember: per project design, we do **not** re-implement Biome/ESLint. Trivial and classic lint rules are expected to be run by the user’s fast linter (Biome or Oxlint recommended). We *document* them here so the full quality bar is explicit, and we only implement in our engine what those tools cannot do well.

---

## 1. Compiler / type-system foundation (`tsc`)

These are `tsconfig.json` requirements. `code-invariants` should verify they are present (or provide a preset) rather than re-implement the checks.

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/strict` | `"strict": true` (enables null checks, noImplicitAny, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, noImplicitThis, alwaysStrict, useUnknownInCatchVariables, …) | `tsc` + config gate | error |
| `ts/no-unchecked-indexed-access` | Indexing returns `T \| undefined` — forces handling of missing keys | `tsc` | error |
| `ts/exact-optional-property-types` | Optional props mean “may be absent”, not “may be undefined” | `tsc` | warn |
| `ts/no-fallthrough-cases-in-switch` | No accidental switch fallthrough | `tsc` | error |
| `ts/no-implicit-returns` | All code paths return a value when return type is non-void | `tsc` | error |
| `ts/no-unused-locals` / `no-unused-parameters` | Dead locals/params (complement lint unused rules) | `tsc` | error |
| `ts/verbatim-module-syntax` (or equivalent modern module isolation) | Clear type-only vs value imports; safer emit | `tsc` | error |
| `ts/force-consistent-casing-in-file-names` | Case-sensitive path safety | `tsc` | error |
| `ts/no-property-access-from-index-signature` | Prefer `obj["key"]` for index signatures (explicit dynamic access) | `tsc` | warn |

**Recommended baseline:** start from `@tsconfig/strictest` (or equivalent) and layer project target/module settings.

---

## 2. Type safety & banned unsafe patterns

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/no-explicit-any` | Ban `any` (prefer `unknown` + narrowing) | biome / oxlint / eslint | error |
| `ts/no-unsafe-*` family | No unsafe any-flow: assignment, call, member access, return, argument | typescript-eslint type-checked (or future biome equivalents) | error |
| `ts/no-banned-types` / `noBannedTypes` | Ban `Object`, `String`, `Number`, `Boolean`, `Symbol`, bare `Function`, misleading `{}` | biome / eslint | error |
| `ts/no-empty-object-type` | Ban confusing empty `{}` type | biome / eslint | error |
| `ts/no-non-null-assertion` | Ban `!` non-null assertions (force proper narrowing) | biome / eslint | warn → error over time |
| `ts/no-extra-non-null-assertion` | Ban redundant `!!` | biome / eslint | error |
| `ts/ban-ts-comment` | Disallow `@ts-ignore` / `@ts-nocheck`; allow `@ts-expect-error` only with description | biome / eslint | error |
| `ts/consistent-type-assertions` | Prefer `value as T` (not angle-bracket); optionally restrict object-literal assertions | biome / eslint | error |
| `ts/prefer-as-const` | Use `as const` for literal inference where appropriate | biome / eslint | error |
| `ts/no-unnecessary-type-assertion` | Remove assertions that don’t change the type | type-checked eslint | warn |
| `ts/no-unnecessary-type-constraint` | Ban useless `extends any` / similar | biome / eslint | error |
| `ts/no-wrapper-object-types` | Prefer primitive types over `Number` / `String` wrappers | biome / eslint | error |

---

## 3. Correctness & bug prevention

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/await-thenable` / `useAwaitThenable` | Only `await` real Thenables | type-checked | error |
| `ts/no-floating-promises` | Every Promise must be awaited, returned, or explicitly voided | type-checked | error |
| `ts/no-misused-promises` | Don’t pass async functions where sync void is expected (e.g. event handlers without care) | type-checked | error |
| `ts/require-await` / `useAwait` | `async` functions must use `await` | biome / eslint | warn |
| `ts/only-throw-error` | Only throw `Error` values | biome / eslint | error |
| `ts/no-useless-constructor` | Ban empty/useless constructors | biome / eslint | error |
| `ts/no-dupe-class-members` | No duplicate class members | biome / eslint | error |
| `ts/no-redeclare` | No redeclarations | biome / eslint | error |
| `ts/no-use-before-define` | No use before declaration (sensible TS options) | biome / eslint | error |
| `ts/prefer-optional-chain` | Prefer `?.` over manual null checks | biome / eslint | error |
| `ts/prefer-nullish-coalescing` | Prefer `??` over `\|\|` when dealing with nullish | type-checked / biome | warn |
| `ts/no-unnecessary-condition` | Ban conditions that are always true/false given types | type-checked | warn |
| `ts/switch-exhaustiveness-check` / `useExhaustiveSwitchCases` | Discriminated unions must be handled exhaustively in switches | type-checked / biome | error |
| `ts/no-confusing-void-expression` | Don’t use void expressions in misleading positions | type-checked | warn |
| `ts/return-await` | Consistent `return await` in try/catch contexts | type-checked | warn |

---

## 4. Modules, imports, and exports

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/consistent-type-imports` / `useImportType` | Type-only imports use `import type` (or inline `type`) | biome / eslint | error |
| `ts/consistent-type-exports` | Type-only exports marked correctly | biome / eslint | error |
| `ts/no-require-imports` / `noCommonJs` | Prefer ESM `import` over `require` | biome / eslint | error |
| `ts/no-useless-empty-export` | Ban empty `export {}` when unneeded | biome / eslint | error |
| `ts/no-unused-vars` (TS-aware) | Unused vars/imports (allow `_` prefix) | biome / eslint | error |
| `ts/no-import-type-side-effects` | Avoid type-import patterns that keep runtime side effects | eslint | error |
| `ts/isolated-modules` friendliness | Code must be valid under `isolatedModules` / verbatim syntax | `tsc` + lint | error |

---

## 5. Style consistency (TypeScript-specific)

These are opinionated but widely adopted. Prefer one style project-wide.

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/consistent-type-definitions` | Prefer `interface` **or** `type` consistently for object shapes (we recommend `interface` for extendable object shapes, `type` for unions/intersections/aliases) | biome / eslint | error |
| `ts/array-type` / `useConsistentArrayType` | Consistent `T[]` vs `Array<T>` (recommend `T[]` for simple arrays) | biome / eslint | error |
| `ts/consistent-generic-constructors` | `new Map<string, number>()` style consistency | eslint | warn |
| `ts/method-signature-style` | Prefer property syntax for method signatures in types (`fn: () => void`) | eslint | warn |
| `ts/prefer-function-type` | Prefer function type over callable interface when possible | eslint | warn |
| `ts/prefer-enum-initializers` | Enum members should be initialized | biome / eslint | warn |
| `ts/prefer-literal-enum-member` | Enum members should be literals | biome / eslint | error |
| `ts/adjacent-overload-signatures` | Overloads must be consecutive | biome / eslint | error |
| `ts/no-inferrable-types` | Don’t annotate trivially inferred literals | biome / eslint | warn |
| `ts/no-empty-interface` / `noEmptyInterface` | Ban empty interfaces (unless extending) | biome / eslint | error |
| `ts/no-namespace` | Prefer ES modules over `namespace` | biome / eslint | error |
| `ts/no-this-alias` | Ban `const self = this` | biome / eslint | error |
| `ts/class-literal-property-style` | Prefer `readonly` fields over literal getters | eslint | warn |

---

## 6. Naming conventions

Align with Google TS style + common ecosystem practice. Enforce via lint where possible; document the rest.

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/naming-types` | Types, interfaces, classes, enums, type params: `PascalCase` | biome / eslint naming | error |
| `ts/naming-variables` | Variables, params, functions, methods: `camelCase` | biome / eslint naming | error |
| `ts/naming-constants` | True constants (global immutable): `CONSTANT_CASE` optional; module-level `const` may stay camelCase | lint (configurable) | warn |
| `ts/naming-no-i-prefix` | Do not prefix interfaces with `I` | lint / convention | error |
| `ts/naming-no-underscore-prefix` | No leading `_` except for intentionally unused vars | lint | warn |
| `ts/file-naming` | File names match primary export (configurable: kebab vs camel) | `code-invariants` or lint | warn |

---

## 7. Complexity & maintainability

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/no-magic-numbers` | Ban unexplained numeric literals (allow 0, 1, -1, common consts) | biome / eslint | warn |
| `ts/max-params` | Limit function arity (e.g. ≤4); prefer options objects | biome / eslint | warn |
| `ts/complexity` / cognitive complexity | Cap cyclomatic/cognitive complexity per function | biome / eslint | warn |
| `ts/no-nested-ternary` | Avoid nested ternaries | biome / eslint | warn |
| `ts/max-depth` | Limit block nesting depth | biome / eslint | warn |
| `ts/no-export-star` | Prefer explicit named re-exports over `export *` (clear public API, better tree-shaking) | lint / `code-invariants` | warn |
| `ts/explicit-module-boundary-types` | Explicit return/param types on **exported** functions (not every local) | eslint | warn |

---

## 8. Module separation, public API, and layer hierarchy

Good codebases are split by **concern** (feature / domain / layer). Each piece exposes a **public API** (typically a barrel `index.ts` or package entrypoint). Cross-boundary imports go **only** through that public API. Dependencies form a **strict stack hierarchy**: higher layers may import lower ones; the reverse is forbidden.

This is a first-class responsibility of `code-invariants` (same family as dependency-cruiser, eslint-plugin-boundaries, ArchUnit, Sheriff, Feature-Sliced Design public-API rules).

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/module-public-api` | Every configured module/feature folder must declare a public entry (`index.ts` or explicit `exports` map). Internals are not part of the API. | `code-invariants` | error |
| `ts/no-deep-import` | Imports from *outside* a module must target the module’s public entry only — never `feature/internal/...` or `feature/components/Foo`. Same-module relative imports remain allowed. | `code-invariants` | error |
| `ts/layer-hierarchy` | Imports must respect a declared directed acyclic layer graph (e.g. `ui → application → domain → infra`). Upward or peer-forbidden edges fail the check. | `code-invariants` | error |
| `ts/no-cross-feature-internals` | Feature A must not import Feature B’s non-public files; only B’s public API. | `code-invariants` | error |
| `ts/no-circular-imports` | No import cycles in the project graph (modules or files). | `code-invariants` (or dependency-cruiser integration) | error |
| `ts/explicit-barrel-exports` | Public barrels use explicit `export { X } from './x'` (not `export *`), so the API surface is auditable. | `code-invariants` / lint | warn |
| `ts/no-barrel-of-barrels` | Limit barrel depth: a public entry may re-export from implementation files, not from nested barrels that re-export everything again (avoids mega-graphs and hidden cycles). | `code-invariants` | warn |
| `ts/no-cross-package-deep-imports` | In monorepos, packages import other packages only via their package entry / `exports` field — not deep paths into `src/`. | `code-invariants` | error |

### Configuration sketch

```ts
export default defineConfig({
  languages: ["typescript"],
  plugins: ["@code-invariants/typescript"],
  architecture: {
    // Modules = units with a public API
    modules: [
      { name: "auth", path: "src/features/auth", entry: "index.ts" },
      { name: "billing", path: "src/features/billing", entry: "index.ts" },
      { name: "shared", path: "src/shared", entry: "index.ts" },
    ],
    // Layers = ordered stack (index 0 is lowest / most foundational)
    layers: [
      { name: "domain", pattern: "src/domain/**" },
      { name: "application", pattern: "src/application/**" },
      { name: "infrastructure", pattern: "src/infrastructure/**" },
      { name: "ui", pattern: "src/ui/**" },
    ],
    // Allowed edges: from → to[] (omit = only lower layers allowed)
    allow: [
      { from: "ui", to: ["application", "domain", "shared"] },
      { from: "application", to: ["domain", "shared"] },
      { from: "infrastructure", to: ["domain", "shared"] },
      // domain imports nothing internal above itself
    ],
  },
  rules: {
    "ts/no-deep-import": "error",
    "ts/layer-hierarchy": "error",
    "ts/module-public-api": "error",
  },
});
```

Projects that do not configure `architecture` skip layer/module rules (or get a soft warning once). When configured, violations are hard errors in the `strict` preset.

---

## 9. Other higher-order / structural rules

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/no-default-export` (optional) | Prefer named exports for better refactors & tree-shaking (project choice) | `code-invariants` or lint | off (opt-in) |
| `ts/explicit-return-type-public-api` | Public/exported API must have explicit return types | `code-invariants` / eslint | warn |
| `ts/max-file-lines` | Soft/hard cap on file length (e.g. warn 400, error 800) | `code-invariants` | warn |
| `ts/no-orphan-files` | Source files under `src` must be reachable from entrypoints or tests | `code-invariants` | warn |

---

## 10. DRY / duplication

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/no-duplicate-functions` | Structural near-duplicate functions (renamed clones) fail CI | `structural-dry` (dupehound-style fingerprinting) | error |
| `ts/semantic-duplicate-symbols` | Newly added symbols too similar to existing ones (embedding similarity) | `code-invariants` semantic index | warn → error |
| `ts/no-copy-paste-blocks` | Large identical token blocks across files | structural-dry / jscpd-style | warn |

---

## 11. Test presence (language-level)

| ID | Intent | Enforcement | Default |
|----|--------|-------------|--------|
| `ts/export-must-be-referenced-in-tests` | Every exported function/class/type-guard from `src` appears in at least one test file (static reference) | `code-invariants` | warn |
| `ts/function-coverage-threshold` | Runtime function coverage ≥ configured threshold (e.g. 80%) | coverage tool (vitest/c8) gated by CI | error |

Note: coverage is necessary but not sufficient; the static reference check catches “never imported in tests” even when coverage tools are misconfigured.

---

## 12. Suggested preset layers

```text
typescript/recommended
  ├─ §1 Compiler strict (tsc gate)
  ├─ §2 Type safety (error)
  ├─ §3 Correctness (error on promises / exhaustiveness)
  ├─ §4 Modules/imports (error)
  ├─ §8 Module separation (error when architecture is configured)
  └─ §10 Structural DRY (error on clones)

typescript/strict
  ├─ everything in recommended
  ├─ §5 Style consistency (error)
  ├─ §6 Naming (error)
  ├─ §7 Complexity (warn)
  ├─ §9 Structural extras
  └─ §11 Test presence (warn)

typescript/stylistic  (optional)
  └─ pure formatting-adjacent preferences not already owned by Biome formatter
```

Users enable via:

```ts
export default defineConfig({
  languages: ["typescript"],
  plugins: ["@code-invariants/typescript"],
  rules: {
    ...typescriptRecommended,
    // overrides
    "ts/no-non-null-assertion": "error",
  },
});
```

---

## 13. What we deliberately leave out of the *language* baseline

- React / JSX a11y / hooks rules → `@code-invariants/react`
- Node / security (fs, child_process) → security plugin or Semgrep
- Import path aliases specific to one bundler → project config
- Formatting (semicolons, quotes, width) → Biome/Oxlint formatter only
- Framework data-fetching patterns (DataRegion, useQuery) → framework plugins
- Advanced type patterns (`satisfies`, branded types, enum alternatives) → [nice-to-have](./typescript-nice-to-have.md)

---

## 14. Implementation notes for agents

1. **Do not reimplement** Biome/typescript-eslint rules inside our engine. Document them, optionally verify they are enabled in the user’s Biome/ESLint config, and focus implementation effort on §8–§11.
2. For §1, ship a `code-invariants init` that writes a strict `tsconfig` baseline and a check that fails if `strict` is off.
3. For §8, the architecture config is the source of truth; implement graph analysis once and share it across `no-deep-import`, `layer-hierarchy`, and cycle detection. dependency-cruiser / eslint-plugin-boundaries are valid inspiration or optional backends.
4. For §10, integrate structural fingerprinting (dupehound-like) first; add embedding-based semantic similarity second.
5. Every rule id above should become a stable, documented id in the plugin so configs remain portable.
6. Prefer **error** for anything that has caused production bugs (any, floating promises, non-exhaustive switches, circular imports, deep imports). Prefer **warn** for style and complexity until a team is ready to tighten.

---

*This ruleset is the TypeScript language **must-have** baseline only. See [typescript-nice-to-have.md](./typescript-nice-to-have.md) for optional rules. Framework plugins extend this; they do not replace it.*
