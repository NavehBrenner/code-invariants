import { expect, test } from "vitest";
import { defineRule } from "./define-rule.ts";

test("defineRule returns the same object", () => {
  const rule = {
    meta: { docs: { description: "identity" } },
    create() {},
  };
  expect(defineRule(rule)).toBe(rule);
});
