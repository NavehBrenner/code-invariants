# Skill: add-rule

> **Status: draft — pending review.**  
> Align rule ids and behavior with [docs/rulesets/](../../docs/rulesets/) and [docs/SPECS.md](../../docs/SPECS.md). Nothing here is final.

## When to use

Add **one** rule to an existing plugin, with fixtures and tests.

## Inputs

- Target **plugin**
- **Rule id** (stable, e.g. `ts/no-deep-import` or `react/data-region-exhaustive`)
- Short **intent** (one sentence)
- Optional: severity default, links to ruleset section

## Steps

1. Confirm the rule belongs in this plugin (language baseline vs framework vs architecture).
2. Implement `Rule` with:
   - `meta.docs.description` (and url if docs exist)
   - `create(context)` using only `RuleContext` (report violations; no direct CLI/fs side channels)
3. Add fixtures:
   - **valid** samples that must produce zero violations
   - **invalid** samples that must produce the expected `ruleId` and clear messages
4. Assert in tests on rule id, message usefulness, and location when applicable.
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
