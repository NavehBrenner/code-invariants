import { Project } from "ts-morph";
import type { LanguageFrontend } from "./frontend.ts";
import type { SourceUnit } from "./index.ts";

export function createTypeScriptFrontend(): LanguageFrontend {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });
  return {
    language: "typescript",
    parseFiles(absolutePaths) {
      const units = new Map<string, SourceUnit>();
      for (const path of absolutePaths) {
        units.set(path, project.addSourceFileAtPath(path));
      }
      return units;
    },
  };
}
