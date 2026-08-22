# Skill: add-rule

> **Status: draft — pending review.**  
> Align rule ids and behavior with [docs/rulesets/](../../docs/rulesets/) and [docs/SPECS.md](../../docs/SPECS.md). Nothing here is final.

## When to use

Add **one** rule to an existing plugin, with fixtures and tests.

## Inputs

- Target **plugin**
- **Rule id** (stable, e.g. `ts/public-exports-tested` or `react/data-region-exhaustive`)
- Short **intent** (one sentence)
- Optional: severity default, links to ruleset section

## Steps

1. Confirm the rule belongs in this plugin (language baseline vs framework vs architecture). Do **not** add import-boundary / layers / no-deep-import / cycle / path-ban rules to `@qualety/typescript` (SPECS locked #7). Do **not** add token/class allowlists to `@qualety/react` (R3 → tailwind/DS). Do not implement backlog rows from [docs/rulesets/react.md](../../docs/rulesets/react.md) unless the task asks for that rule.
  2. Implement a single `Rule` / `RuleContext` (no `meta.kind`) with **`defineRule`** (identity; the engine validates `pluginSchema` / `ruleSchema` at load):
    - Optional `meta.requires` as a const tuple of known artifact ids (e.g. `["typescript"]`; dry: `["dupehound"]`)
    - `create` uses `id` / `options` / `report` / `getCwd` / `getFiles` / `getArtifact(id)` — `getArtifact` returns the typed `ArtifactMap` value (no `as ParsedProject` / `as DupehoundIndex`). Narrow `SourceFile` with `instanceof` / type guards, not `as SourceFile`. Only ids in `requires`; else exit 2
    - Same idea on two languages ⇒ two rules (convention, not `meta.kind`); each requires that artifact
    - Do **not** spawn CLIs from the rule. A plugin `provides.build` **may** spawn tools. Duplicate artifact ids fail closed (both owners named). Defaults only fill gaps — a plugin may `provides.typescript`. Shared providers register as ruleless plugins (`name` + `provides`, no `rules`) via `plugins[]`
    - Prefer **verbose names** (`artifacts`, not `arts`; `artifactBuildContext`, not `abc`). Shorthands only if the full name would make a variable/function identifier **longer than 20 characters**. If a shorthand is used under that rule, put a **comment line immediately above the declaration** with the full verbose intended name
    - `meta.docs.description` (and url if docs exist)
    - No filesystem or CLI side channels from the rule
3. Add fixtures:
   - **valid** samples that must produce zero violations
   - **invalid** samples that must produce the expected `ruleId` and clear messages
4. Assert in tests on rule id, message usefulness, location, and a **concrete** `suggestion` (product rules must not use `NO_SUGGESTION`).
5. Register the rule on the plugin’s `rules` map.
6. If the rule is part of a published ruleset doc, add or update a row there in the same PR when behavior is user-facing.
7. Prefer incremental analysis friendliness (no full-repo work per file unless the rule truly needs the graph — e.g. layer hierarchy).

## Outputs

- One rule id, testable in isolation
- Actionable violation messages (another agent should know how to fix)
- Docs/ruleset touch only if the public catalog changes

## Out of scope

- Scaffolding a whole new plugin → [create-plugin](../create-plugin/SKILL.md)
- Enabling the rule in every consumer preset without explicit request
