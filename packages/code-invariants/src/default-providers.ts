import { createTypeScriptProvider } from "./typescript-frontend.ts";

export const DEFAULT_PROVIDERS = {
  typescript: createTypeScriptProvider,
} as const;
