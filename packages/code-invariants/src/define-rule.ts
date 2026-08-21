import type { Rule } from "./index.ts";

export function defineRule<T extends Rule>(rule: T): T {
  return rule;
}
