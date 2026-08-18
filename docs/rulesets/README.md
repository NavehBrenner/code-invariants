# Rulesets

| Doc | Role |
|-----|------|
| [typescript.md](./typescript.md) | **Binding catalog** for `@code-invariants/typescript` — implemented vs not planned |
| [react.md](./react.md) | **Binding catalog** for `@code-invariants/react` — implemented vs backlog |
| [dry.md](./dry.md) | **Binding catalog** for `@code-invariants/dry` — structural `dry/no-duplicate-functions` |
| [typescript-baseline.md](./typescript-baseline.md) | Research inventory (must-have ideas). **Not** an implementation backlog |
| [typescript-nice-to-have.md](./typescript-nice-to-have.md) | Research inventory (optional ideas). **Not** an implementation backlog |
| *(planned)* `python-baseline.md` | Python language baseline |

Core has no built-in rule bag. Language/framework/DRY rules live in `@code-invariants/typescript`, `@code-invariants/react`, and `@code-invariants/dry`. Installing a plugin does not enable its rules.

We do **not** reimplement Biome / ESLint / dependency-cruiser (cycles, deep imports, path bans, generic layer charts). See SPECS locked #7 and [typescript.md](./typescript.md). We do **not** own classic eslint-plugin-react / react-hooks / jsx-a11y or TanStack eslint mechanics. See [react.md](./react.md).

See [SPECS](../SPECS.md) for the plugin contract and locked rule behavior.
