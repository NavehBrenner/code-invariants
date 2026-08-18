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

export type RuleKind = "language" | "project";

export interface RuleDocs {
  description: string;
  url?: string;
}

export interface RuleMetaBase {
  docs: RuleDocs;
  schema?: JSONSchema;
  fixable?: "code" | "whitespace";
}

export interface LanguageRuleMeta extends RuleMetaBase {
  kind: "language";
  /** Required, non-empty. Same product idea on two languages ⇒ two rules. */
  languages: string[];
}

/**
 * Workspace-level rule. `kind: "project"` is **not** a ts-morph `Project` —
 * language rules use `getProject()` for that.
 */
export interface ProjectRuleMeta extends RuleMetaBase {
  kind: "project";
  /**
   * Optional seam. `"index"` is a structural clone snapshot via dupehound
   * (`getIndex()`), not embeddings.
   */
  requires?: Array<"index">;
}

export interface StructuralCloneMember {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  representative: boolean;
  test: boolean;
}

export interface StructuralCloneCluster {
  id: number;
  similarity: number;
  testOnly: boolean;
  members: StructuralCloneMember[];
}

/** Ephemeral structural clone snapshot. Not a vector store. */
export interface StructuralIndex {
  kind: "structural";
  clusters: readonly StructuralCloneCluster[];
}

export interface LanguageRuleContext {
  id: string;
  /** Already validated against `meta.schema`. */
  options: unknown;
  report(violation: Omit<Violation, "ruleId">): void;
  /** The pipeline language for this invocation. */
  language: string;
  /** Native project for **this** language only (ts-morph `Project` for TypeScript). */
  getProject(): unknown;
  /** All parsed units for this language run (same Map instance for every rule). */
  getSources(): ReadonlyMap<string, SourceUnit>;
  /** Display paths under check (stable order). */
  getFilenames(): readonly string[];
  /** Lookup one unit by display or absolute path; undefined if not in the run. */
  getSource(filename: string): SourceUnit | undefined;
}

/**
 * Workspace-level context. No language AST APIs (`getProject` / `getSources`).
 * `kind: "project"` ≠ `getProject()`.
 */
export interface ProjectRuleContext {
  id: string;
  /** Already validated against `meta.schema`. */
  options: unknown;
  report(violation: Omit<Violation, "ruleId">): void;
  getCwd(): string;
  /** Workspace paths under include/exclude (display paths, stable order). */
  getFiles(): readonly string[];
  /**
   * Structural clone snapshot. Only rules with `meta.requires: ["index"]`
   * may call this; others get an exit-2 error.
   */
  getIndex(): StructuralIndex;
}

/** Returned by `create` when a rule wants per-node visiting instead of a one-shot pass. */
export type RuleListener = Record<string, (node: unknown) => void>;

export interface LanguageRule {
  meta: LanguageRuleMeta;
  /**
   * Once per enabled rule per language. `void`, not `undefined`: a `create`
   * with no return statement must type-check.
   */
  create(context: LanguageRuleContext): void | RuleListener;
}

export interface ProjectRule {
  meta: ProjectRuleMeta;
  /**
   * Once per enabled workspace rule. `void`, not `undefined`: a `create`
   * with no return statement must type-check.
   */
  create(context: ProjectRuleContext): void | RuleListener;
}

/** Discriminated on `meta.kind`. No default — missing/invalid kind is an error. */
export type Rule = LanguageRule | ProjectRule;

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

export { defineConfig } from "./config.ts";
