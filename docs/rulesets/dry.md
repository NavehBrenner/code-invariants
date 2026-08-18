# DRY plugin catalog

Honest catalog for **`@code-invariants/dry`** (`Plugin.name: "dry"`).  
This is the implementation list for this plugin. Installing the plugin does **not** enable its rules. `configs.recommended` sets `dry/no-duplicate-functions` to `"error"` for users who opt into that preset.

We wrap [dupehound](https://github.com/Rafaelpta/dupehound) for structural clone detection. We do **not** re-own its fingerprinting algorithm. Embeddings / Slopo-style semantic near-dupes are **not** this plugin.

## Implemented

| ID | Intent | Default in recommended |
|----|--------|------------------------|
| `dry/no-duplicate-functions` | No structurally duplicate functions/methods in included non-test, non-generated sources | `error` |

Behavior is locked in [SPECS.md](../SPECS.md) §3 R4. Summary:

- **Kind:** `project`. `requires: ["index"]`. Uses only `ProjectRuleContext` (`getCwd`, `getFiles`, `getIndex`, `report`). No language AST APIs. Does not spawn CLIs.
- **Engine:** when this rule is enabled, core runs `dupehound scan --json --exclude-tests` once and exposes a `StructuralIndex`. Pin **v0.1.2**.
- **Unit:** whatever function-likes dupehound extracts (top-level, methods, arrows / `const` function-likes, `<anonymous>`).
- **Skip:** tests (`--exclude-tests` + path rules); generated (dupehound defaults such as `*.gen.ts` / vendor / `@generated`); files outside workspace include (post-filter). Do **not** add `**/*.test.*` to the global default exclude — `ts/public-exports-tested` needs tests in the language pipeline.
- **Threshold / `min_tokens`:** dupehound defaults (0.80 / 40). Short functions are a known miss. Not configurable in v1.
- **Violation:** non-representative member; message names both functions, the original location, and similarity; concrete suggestion to reuse the original. Never `NO_SUGGESTION`. Range is best-effort (start/end line, column 1).
- **Severity:** `"error"` when enabled via recommended; config may set `"warn"` (label only; violations still fail the run).
- **Fail closed:** missing / unrunnable dupehound, timeout, or invalid JSON → exit 2 with a message that names the rule and how to install. Empty clusters after skips → exit 0.
- **Install:** put `dupehound` on `PATH`, or set `CODE_INVARIANTS_DUPEHOUND`. No network inside `code-invariants check`. Optional repo helper: `scripts/install-dupehound.sh` (writes `.tools/dupehound`).

## Not planned in this plugin

- Embedding / vector semantic similarity
- `code-invariants query --similar` / MCP `query_similar`
- Auto-merge / codemod of duplicates
- Incremental `dupehound check --diff` (later CLI `--diff` work)
- Reimplementing clone detection in TypeScript
