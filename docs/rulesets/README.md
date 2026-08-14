# Rulesets

Curated invariant sets enforced by `code-invariants`.

| Ruleset | Scope | Status |
|---------|--------|--------|
| [typescript-baseline.md](./typescript-baseline.md) | TypeScript **must-have** (language + module separation) | Draft — research complete |
| [typescript-nice-to-have.md](./typescript-nice-to-have.md) | TypeScript **optional** / advanced | Draft — second research pass |
| *(planned)* `react.md` | React / JSX compositional patterns | — |
| *(planned)* `python-baseline.md` | Python language baseline | — |

### Must-have vs nice-to-have

- **Baseline** — defaults on in `typescript/recommended` and `typescript/strict`. Includes compiler strictness, type safety, correctness, and **module separation** (public API barrels, no deep imports, layer hierarchy).
- **Nice-to-have** — off by default; teams opt in (`satisfies`, no-enum, branded IDs, export hygiene, stricter barrel policy, etc.).

The TypeScript baseline distinguishes:

1. Rules owned by **tsc** / **Biome** / **Oxlint** (we document and expect them; we do not reimplement)
2. Rules owned by **code-invariants** (compositional, structural, architecture, DRY, test-presence)

See the main [SPECS](../SPECS.md) for how plugins and presets load these rules.
