# Rulesets

| Doc | Role |
|-----|------|
| [typescript.md](./typescript.md) | **Binding catalog** for `@code-invariants/typescript` — implemented vs not planned |
| [typescript-baseline.md](./typescript-baseline.md) | Research inventory (must-have ideas). **Not** an implementation backlog |
| [typescript-nice-to-have.md](./typescript-nice-to-have.md) | Research inventory (optional ideas). **Not** an implementation backlog |
| *(planned)* `react.md` | React / JSX compositional patterns — later plugin, not TS-baseline |
| *(planned)* `python-baseline.md` | Python language baseline |

Core has no built-in rule bag. Baseline language rules live in `@code-invariants/typescript`. Installing a plugin does not enable its rules.

We do **not** reimplement Biome / ESLint / dependency-cruiser (cycles, deep imports, path bans, generic layer charts). See SPECS locked #7 and [typescript.md](./typescript.md).

See [SPECS](../SPECS.md) for the plugin contract and locked `ts/public-exports-tested` behavior.
