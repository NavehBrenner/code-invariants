import { expect, test } from "vitest";
import plugin from "./index.ts";

test("plugin exports name, rule, recommended, and dupehound provider", () => {
  expect(plugin.name).toBe("dry");
  expect(plugin.rules?.["no-duplicate-functions"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["dry/no-duplicate-functions"]).toBe("error");
  expect(typeof plugin.provides?.dupehound?.build).toBe("function");
});
