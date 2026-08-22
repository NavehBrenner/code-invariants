import type { Rule } from "./index.ts";

/** Identity helper. The engine validates `ruleSchema` at load; this does not parse. */
export function defineRule<T extends Rule>(rule: T): T {
  return rule;
}
