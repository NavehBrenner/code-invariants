import { dirname, extname, join, resolve } from "node:path";
import type { LanguageRule, LanguageRuleContext, Range } from "code-invariants";
import { type ExportDeclaration, Node, type SourceFile, SyntaxKind } from "ts-morph";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"] as const;
const SWAP_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ...TS_EXTS]);

type PublicExport = {
  key: string;
  name: string;
  file: string;
  display: string;
  range: Range;
};

export const publicExportsTested: LanguageRule = {
  meta: {
    kind: "language",
    languages: ["typescript"],
    docs: {
      description:
        "Every public value export in included non-test sources must be referenced from a test path.",
    },
  },
  create(context) {
    const sources = context.getSources();
    const displayByAbs = mapDisplayPaths(context);
    const referenced = new Set<string>();
    const exported: PublicExport[] = [];

    for (const [abs, unit] of sources) {
      if (isDeclarationFile(abs)) {
        continue;
      }
      const sf = unit as SourceFile;
      if (isTestPath(abs)) {
        collectReferences(sf, abs, sources, referenced);
      } else {
        const display = displayByAbs.get(abs) ?? posix(abs);
        exported.push(...collectPublicExports(sf, abs, display));
      }
    }

    const seen = new Set<string>();
    for (const item of exported) {
      if (seen.has(item.key) || referenced.has(item.key)) {
        continue;
      }
      seen.add(item.key);
      context.report({
        severity: "error",
        file: item.file,
        range: item.range,
        message: `Public export "${item.name}" in ${item.display} is not referenced from a test file.`,
        suggestion: `Import "${item.name}" from a test path (*.test.*, *.spec.*, or a __tests__/ directory).`,
      });
    }
  },
};

function isTestPath(filePath: string): boolean {
  const normalized = posix(filePath);
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (/\.(?:test|spec)\./.test(base)) {
    return true;
  }
  return normalized.split("/").includes("__tests__");
}

function isDeclarationFile(filePath: string): boolean {
  return /\.d\.(?:ts|mts|cts)$/.test(posix(filePath));
}

function mapDisplayPaths(context: LanguageRuleContext): Map<string, string> {
  const sources = context.getSources();
  const displayByAbs = new Map<string, string>();
  for (const name of context.getFilenames()) {
    const unit = context.getSource(name);
    if (unit === undefined) {
      continue;
    }
    for (const [abs, src] of sources) {
      if (src === unit) {
        displayByAbs.set(abs, name);
        break;
      }
    }
  }
  return displayByAbs;
}

function collectPublicExports(sf: SourceFile, abs: string, display: string): PublicExport[] {
  const result: PublicExport[] = [];
  const push = (name: string, node: Node) => {
    result.push({
      key: `${abs}#${name}`,
      name,
      file: abs,
      display,
      range: rangeOf(node),
    });
  };

  for (const stmt of sf.getStatements()) {
    if (Node.isExportDeclaration(stmt)) {
      collectExportDeclaration(stmt, push);
      continue;
    }
    if (Node.isExportAssignment(stmt)) {
      if (!stmt.isExportEquals()) {
        push("default", defaultKeyword(stmt) ?? stmt);
      }
      continue;
    }
    if (
      Node.isFunctionDeclaration(stmt) ||
      Node.isClassDeclaration(stmt) ||
      Node.isEnumDeclaration(stmt)
    ) {
      if (!stmt.hasExportKeyword()) {
        continue;
      }
      if (stmt.isDefaultExport()) {
        push("default", defaultKeyword(stmt) ?? stmt.getNameNode() ?? stmt);
        continue;
      }
      const nameNode = stmt.getNameNode();
      const name = stmt.getName();
      if (name !== undefined && nameNode !== undefined) {
        push(name, nameNode);
      }
      continue;
    }
    if (Node.isVariableStatement(stmt) && stmt.hasExportKeyword()) {
      for (const decl of stmt.getDeclarations()) {
        push(decl.getName(), decl.getNameNode() ?? decl);
      }
    }
  }
  return result;
}

function collectExportDeclaration(
  stmt: ExportDeclaration,
  push: (name: string, node: Node) => void,
): void {
  if (stmt.isTypeOnly() || stmt.isNamespaceExport()) {
    return;
  }
  for (const spec of stmt.getNamedExports()) {
    if (spec.isTypeOnly()) {
      continue;
    }
    push(spec.compilerNode.name.text, spec.getNameNode());
  }
}

function collectReferences(
  sf: SourceFile,
  fromFile: string,
  sources: ReadonlyMap<string, unknown>,
  referenced: Set<string>,
): void {
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    const target = resolveRelativeSpecifier(fromFile, specifier, sources);
    if (target === undefined) {
      continue;
    }
    if (decl.getDefaultImport() !== undefined) {
      referenced.add(`${target}#default`);
    }
    for (const named of decl.getNamedImports()) {
      referenced.add(`${target}#${named.getName()}`);
    }
  }
}

function resolveRelativeSpecifier(
  fromFile: string,
  specifier: string,
  sources: ReadonlyMap<string, unknown>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const resolved = resolve(dirname(fromFile), specifier);
  const ext = extname(resolved);
  const stem = SWAP_EXTS.has(ext) ? resolved.slice(0, -ext.length) : resolved;
  const hits = [resolved];
  for (const tsExt of TS_EXTS) {
    hits.push(stem + tsExt);
  }
  for (const tsExt of TS_EXTS) {
    hits.push(join(resolved, `index${tsExt}`));
  }
  for (const hit of hits) {
    if (sources.has(hit)) {
      return hit;
    }
    const normalized = resolve(hit);
    if (sources.has(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

function defaultKeyword(node: Node): Node | undefined {
  return node.getFirstChildByKind(SyntaxKind.DefaultKeyword);
}

function rangeOf(node: Node): Range {
  const sf = node.getSourceFile();
  const start = sf.getLineAndColumnAtPos(node.getStart());
  const end = sf.getLineAndColumnAtPos(node.getEnd());
  return {
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

function posix(filePath: string): string {
  return filePath.split("\\").join("/");
}
