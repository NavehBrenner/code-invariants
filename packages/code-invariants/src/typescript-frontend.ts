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
      const sources = new Map<string, SourceUnit>();
      for (const path of absolutePaths) {
        sources.set(path, project.addSourceFileAtPath(path));
      }
      return { project, sources };
    },
  };
}
