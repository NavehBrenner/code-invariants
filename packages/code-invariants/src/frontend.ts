import type { SourceUnit } from "./index.ts";
import { createTypeScriptFrontend } from "./typescript-frontend.ts";

export interface LanguageFrontend {
  readonly language: string;
  parseFiles(absolutePaths: readonly string[]): Map<string, SourceUnit>;
}

export function createFrontend(language: string): LanguageFrontend | undefined {
  if (language === "typescript") {
    return createTypeScriptFrontend();
  }
  return undefined;
}
