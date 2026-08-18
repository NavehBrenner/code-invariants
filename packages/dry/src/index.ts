import type { Plugin } from "code-invariants";
import { noDuplicateFunctions } from "./no-duplicate-functions.ts";

const plugin: Plugin = {
  name: "dry",
  rules: {
    "no-duplicate-functions": noDuplicateFunctions,
  },
  configs: {
    recommended: {
      rules: {
        "dry/no-duplicate-functions": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
