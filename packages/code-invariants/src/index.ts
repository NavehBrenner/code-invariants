/**
 * Public plugin contract. See docs/SPECS.md § 2 — this file is the executable
 * copy of that section and must stay in sync with it.
 */

export type Severity = "error" | "warn" | "off";

/** Exact string locked in docs/SPECS.md §1. Use only when a rule has nothing to suggest. */
export const NO_SUGGESTION = "No suggestion available for this rule.";

export interface Range {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface Violation {
  ruleId: string;
  severity: Severity;
  file: string;
  range: Range;
  message: string;
  /** Required. Product rules must use concrete text, not `NO_SUGGESTION`. */
  suggestion: string;
}

/** ponytail: options schemas are validated at runtime, not type-checked here. */
export type JSONSchema = Record<string, unknown>;

/**
 * Language-specific AST handle produced by a frontend (ts-morph `SourceFile`
 * for TypeScript). The core never narrows this; rules cast it to the type
 * their frontend documents.
 */
export type SourceUnit = unknown;

export interface RuleDocs {
  description: string;
  url?: string;
}

export interface RuleMeta {
  docs: RuleDocs;
  schema?: JSONSchema;
  fixable?: "code" | "whitespace";
  /**
   * Artifact ids this rule needs (e.g. `"typescript"`, `"dupehound"`).
   * Engine builds each id once from the single provider map.
   */
  requires?: string[];
}

export interface RuleContext {
  id: string;
  /** Already validated against `meta.schema`. */
  options: unknown;
  report(violation: Omit<Violation, "ruleId">): void;
  getCwd(): string;
  /** Workspace paths under include/exclude (display paths, stable order). */
  getFiles(): readonly string[];
  /**
   * Artifact built for this run. Only ids listed in `meta.requires`
   * may be requested; others get an exit-2 error.
   */
  getArtifact(id: string): unknown;
}

/** Input to a plugin `provides` build. Built once per required id per check. */
export interface ArtifactBuildContext {
  cwd: string;
  /** Display paths under include/exclude (stable order). */
  files: readonly string[];
  exclude: readonly string[];
  /** Enabled rule ids that listed this artifact in `meta.requires`. */
  requiredBy: readonly string[];
}

export interface ArtifactProvider {
  build(context: ArtifactBuildContext): Promise<unknown> | unknown;
}

/** Returned by `create` when a rule wants per-node visiting instead of a one-shot pass. */
export type RuleListener = Record<string, (node: unknown) => void>;

export interface Rule {
  meta: RuleMeta;
  /**
   * Once per enabled rule. `void`, not `undefined`: a `create`
   * with no return statement must type-check.
   */
  create(context: RuleContext): void | RuleListener;
}

export interface UserConfig {
  languages: string[];
  plugins: string[];
  rules: Record<string, Severity>;
  include?: string[];
  exclude?: string[];
}

export interface Plugin {
  name: string;
  version?: string;
  rules?: Record<string, Rule>;
  /**
   * Artifact providers merged into the same map as core language seeds.
   * Duplicate ids (including a plugin colliding with a core-seeded
   * language provider) fail closed. Engine unions `requires` from enabled
   * rules, invokes matching providers once, and caches results.
   */
  provides?: Record<string, ArtifactProvider>;
  configs?: {
    recommended?: Partial<UserConfig>;
  };
}

/** Opaque to core; TS frontend uses ts-morph Project + SourceFiles. */
export interface ParsedProject {
  /** Native project handle (ts-morph `Project` for TypeScript). */
  readonly project: unknown;
  /** absolute path → native source unit (ts-morph `SourceFile`). */
  readonly sources: ReadonlyMap<string, SourceUnit>;
}

export interface LanguageFrontend {
  readonly language: string;
  /** Parse all paths once. Same project/sources object is reused for every rule. */
  parseFiles(absolutePaths: readonly string[]): ParsedProject;
}

/**
 * Plugins augment via interface merging. Engine still uses Map<string, unknown>.
 */
export interface ArtifactMap {
  typescript: ParsedProject;
}

export { defineConfig } from "./config.ts";
export { defineRule } from "./define-rule.ts";
