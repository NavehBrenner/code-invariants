import type { ArtifactMap, Rule, RuleContext, RuleListener, RuleMeta } from "./index.ts";

export function defineRule<
  const Requires extends readonly (keyof ArtifactMap)[] = readonly [],
>(rule: {
  meta: Omit<RuleMeta, "requires"> & { requires?: Requires };
  create(
    context: Omit<RuleContext, "getArtifact"> & {
      getArtifact<Id extends Requires[number]>(id: Id): ArtifactMap[Id];
    },
  ): void | RuleListener;
}): Rule {
  return rule as Rule;
}
