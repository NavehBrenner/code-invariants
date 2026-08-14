# Rulesets

Curated invariant sets enforced by `code-invariants`.

| Ruleset | Scope | Status |
|---------|--------|--------|
| [typescript-baseline.md](./typescript-baseline.md) | TypeScript language only (no frameworks) | Draft — research complete |
| *(planned)* `react.md` | React / JSX compositional patterns | — |
| *(planned)* `python-baseline.md` | Python language baseline | — |

The TypeScript baseline distinguishes:

1. Rules owned by **tsc** / **Biome** / **Oxlint** (we document and expect them; we do not reimplement)
2. Rules owned by **code-invariants** (compositional, structural, DRY, test-presence)

See the main [SPECS](../SPECS.md) for how plugins and presets load these rules.
