# TypeScript plugin catalog

Honest catalog for **`@code-invariants/typescript`** (`Plugin.name: "ts"`).  
This is the implementation list for this plugin. [typescript-baseline.md](./typescript-baseline.md) and [typescript-nice-to-have.md](./typescript-nice-to-have.md) are research inventories, **not** an implementation backlog.

Core has no built-in rule bag. Rules exist only on this plugin’s `rules` map. Installing the plugin does **not** enable them. `configs.recommended` sets `ts/public-exports-tested` to `"error"` for users who opt into that preset.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `ts/public-exports-tested` | Every public value export in included non-test sources is referenced from a test path (static R5-lite; not coverage) | `error` |

Behavior is locked in [SPECS.md](../SPECS.md) §3 R5. Summary:

- **Public export:** value exports in non-test, non-`.d.ts` files already in the language pipeline: `export function` / `class` / `const` / `let` / `var` / `enum`, `export default`, `export { name }`, `export { name } from`. Default name is `"default"`.
- **Skip:** type-only (`export type`, `export interface`, `export { type X }`); `export *` / `export * as ns`; `export =`; ambient `.d.ts`; exports in test paths.
- **Test path (not configurable in v1):** file is in the pipeline, and basename matches `*.test.*` / `*.spec.*`, or a path segment is `__tests__`.
- **Reference:** a test-file import whose specifier **resolves relatively** (`.ts` / `.tsx` / `.mts` / `.cts` + `index`) to the exporting file in `getSources()`, and the import binds that export name (named) or is a default import (`default`). `import *` does not satisfy named exports. Bare specifiers and dynamic `import()` do not count.
- **Scope:** include/exclude only. No index.
- **Do not exclude test paths** when this rule is enabled. The rule only sees files in the language pipeline; a default/global `exclude` of `**/*.test.*` / `**/*.spec.*` makes every public export fail. Production excludes (`**/generated/**`, `**/dist/**`) are fine. Recommended and example configs **must keep tests in the set**.
- **Violation:** `ruleId` `ts/public-exports-tested`; location on the export; message names the export and file; suggestion to import it from a test.

## Not planned in this plugin

Use Biome, ESLint, or dependency-cruiser:

- Circular imports
- Max relative import depth
- Simple path bans (`dist/`, `generated/`, …)
- Deep-import / internal-module bans
- Generic layer charts those tools already do well

**Overlap family** — catalog **none** of these as CI rules here: `import-boundary` / layers / no-import-from / no-deep-import / max-relative-depth.

## Other first-class SPECS rules

R1–R6 stay [SPECS](../SPECS.md) §3 pointers. React / compositional rules (R1/R2) are **not** TypeScript-baseline; they belong in a later `@code-invariants/react` (or similar). R3 semantic tokens, R4 index-backed DRY, and stretch architecture fitness are not this plugin.
