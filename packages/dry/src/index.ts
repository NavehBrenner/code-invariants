import type { Plugin } from "code-invariants";
import { buildDupehoundIndex } from "./dupehound.ts";
import { noDuplicateFunctions } from "./no-duplicate-functions.ts";

const plugin: Plugin = {
  name: "dry",
  provides: {
    dupehound: {
      build: (ctx) => buildDupehoundIndex(ctx),
    },
  },
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
