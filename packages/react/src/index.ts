import type { Plugin } from "code-invariants";
import { noFetchInUseEffect } from "./no-fetch-in-useeffect.ts";
import { queryErrorHandled } from "./query-error-handled.ts";

const plugin: Plugin = {
  name: "react",
  rules: {
    "no-fetch-in-useeffect": noFetchInUseEffect,
    "query-error-handled": queryErrorHandled,
  },
  configs: {
    recommended: {
      rules: {
        "react/no-fetch-in-useeffect": "error",
        "react/query-error-handled": "error",
      },
    },
  },
};

export default plugin;
export { plugin };
