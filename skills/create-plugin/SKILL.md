# Skill: create-plugin

> **Status: draft — pending review.**  
> Contract details must track [docs/SPECS.md](../../docs/SPECS.md). Update this skill when the Plugin interface changes.

## When to use

Scaffold a **new** plugin package (e.g. `@code-invariants/typescript`, `@code-invariants/react`, or a user-local plugin) that conforms to the published plugin contract.

## When not to use

- Adding a rule to an existing plugin → use [add-rule](../add-rule/SKILL.md).
- Changing core engine/CLI → not this skill.

## Inputs

- Plugin **name** (e.g. `typescript`, `react`)
- Intended **rules** (optional list of rule ids to stub)
- Location: workspace package vs local path plugin

## Steps

1. Read SPECS § Plugin contract and Locked decisions (plugins are TypeScript in v1).
2. Create package skeleton:
   - `package.json` with name `@code-invariants/<name>` or local name
   - Entry that **exports a `Plugin` object** (`name`, `rules`, optional `configs.recommended`)
3. Export a `Plugin` (`name`, `rules`, optional `configs.recommended`). Installing a plugin must **not** force all rules on. Do not pad the `rules` map with empty stub rules — only real rules. Product plugins already live in `packages/typescript` (`@code-invariants/typescript`, `name: "ts"`), `packages/react` (`@code-invariants/react`, `name: "react"`), and `packages/dry` (`@code-invariants/dry`, `name: "dry"`); do not re-scaffold those plugins or the engine.
  4. Each requested rule needs `meta.docs`, optional `meta.requires`, and a real `create` via **`defineRule`** (or defer the rule to [add-rule](../add-rule/SKILL.md)). The engine validates `pluginSchema` / `ruleSchema` at load; `defineRule` does not parse. There is one `Rule` / `RuleContext` — no `kind`. TypeScript consumers set `requires: ["typescript"]` and call `getArtifact` (typed from `ArtifactMap`). Same idea on two languages ⇒ two rules. Plugins add `provides` to the same provider map as the default registry — **`build(context)` may spawn**; rules must not. Shared/provider-only packages are **ruleless plugins** (`name` + `provides`, no `rules`) listed in `plugins[]`. Duplicate artifact ids fail closed (both owners named). Defaults only fill gaps — a plugin `provides.typescript` wins. Prefer **verbose names** (`artifacts`, not `arts`; `artifactBuildContext`, not `abc`). Shorthands only if the full name would make a variable/function identifier **longer than 20 characters**. If a shorthand is used under that rule, put a **comment line immediately above the declaration** with the full verbose intended name.
5. Wire package into the monorepo (or document local path load via `defineConfig` `plugins` array).
6. Add a smoke test: load plugin, assert `name` and rule ids exist.
7. Do not implement full rule logic here unless the user asked for a specific rule in the same task — prefer [add-rule](../add-rule/SKILL.md) per rule.

## Outputs

- A package that satisfies the Plugin interface
- Discoverable via config `plugins: ["..."]`
- No LLM API usage in the plugin runtime

## Out of scope

- Architecture layer maps (consumer config)
- Framework runtime helpers (separate companion packages if needed)
