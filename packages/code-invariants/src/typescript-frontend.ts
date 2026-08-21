import { extname, resolve } from "node:path";
import { Project } from "ts-morph";
import type { ArtifactProvider, LanguageFrontend, SourceUnit } from "./index.ts";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

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

export function createTypeScriptProvider(): ArtifactProvider {
  const frontend = createTypeScriptFrontend();
  return {
    build(context) {
      const absolutePaths = context.files
        .map((file) => resolve(context.cwd, file))
        .filter((path) => TS_EXTENSIONS.has(extname(path)));
      return frontend.parseFiles(absolutePaths);
    },
  };
}
