import { expect, test } from "vitest";
import plugin from "./index.ts";

test("plugin exports name, rule, and recommended", () => {
  expect(plugin.name).toBe("dry");
  expect(plugin.rules?.["no-duplicate-functions"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["dry/no-duplicate-functions"]).toBe("error");
});
