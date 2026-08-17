import type { Plugin } from "code-invariants";
import { publicExportsTested } from "./public-exports-tested.ts";

const plugin: Plugin = {
  name: "ts",
  rules: {
    "public-exports-tested": publicExportsTested,
  },
  configs: {
    recommended: {
      rules: {
        "ts/public-exports-tested": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
