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

1. Confirm the rule belongs in this plugin (language baseline vs framework vs architecture). Do **not** add import-boundary / layers / no-deep-import / cycle / path-ban rules to `@code-invariants/typescript` (SPECS locked #7). Do **not** add token/class allowlists to `@code-invariants/react` (R3 → tailwind/DS). Do not implement backlog rows from [docs/rulesets/react.md](../../docs/rulesets/react.md) unless the task asks for that rule.
2. Implement `Rule` with **no default `kind`**:
   - `meta.kind: "language"` **or** `"project"` (required)
   - Language: set `meta.languages` (non-empty, e.g. `["typescript"]`); `create` uses `LanguageRuleContext` (`getProject` / `getSources` / `getSource` / `getFilenames`). Same idea on two languages ⇒ two language rules.
    - Project: workspace-level, **not** ts-morph `Project`. `create` uses only `ProjectRuleContext` (`getCwd` / `getFiles` / `report`, and `getArtifact(id)` only if `meta.requires` lists `id`). Do **not** call language AST APIs or spawn CLIs. A plugin `provides.build` **may** spawn tools; the rule must not.
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
