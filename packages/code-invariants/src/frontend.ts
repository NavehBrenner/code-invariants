import type { LanguageFrontend } from "./index.ts";
import { createTypeScriptFrontend } from "./typescript-frontend.ts";

export type { LanguageFrontend, ParsedProject } from "./index.ts";

export function createFrontend(language: string): LanguageFrontend | undefined {
  if (language === "typescript") {
    return createTypeScriptFrontend();
  }
  return undefined;
}
