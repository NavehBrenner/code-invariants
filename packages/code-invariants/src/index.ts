/**
 * Public plugin contract. See docs/SPECS.md § 2 — this file is the executable
 * copy of that section and must stay in sync with it.
 */

export type Severity = "error" | "warn" | "off";

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
  suggestion?: string;
}

/** ponytail: options schemas are validated at runtime, not type-checked here. */
export type JSONSchema = Record<string, unknown>;

/**
 * Language-specific AST handle produced by a frontend (ts-morph `SourceFile`
 * for TypeScript). The core never narrows this; rules cast it to the type
 * their frontend documents.
 */
export type SourceUnit = unknown;

export interface RuleContext {
  id: string;
  /** Already validated against `meta.schema`. */
  options: unknown;
  report(violation: Omit<Violation, "ruleId">): void;
  /** Native project (cast to ts-morph `Project` in TS rules). */
  getProject(): unknown;
  /** All parsed units for this run (same Map instance for every rule). */
  getSources(): ReadonlyMap<string, SourceUnit>;
  /** Display paths under check (stable order). */
  getFilenames(): readonly string[];
  /** Lookup one unit by display or absolute path; undefined if not in the run. */
  getSource(filename: string): SourceUnit | undefined;
}

/** Returned by `create` when a rule wants per-node visiting instead of a one-shot pass. */
export type RuleListener = Record<string, (node: unknown) => void>;

export interface Rule {
  meta: {
    docs: { description: string; url?: string };
    schema?: JSONSchema;
    fixable?: "code" | "whitespace";
  };
  /**
   * Project-scoped: invoked once per enabled rule per language run, not once
   * per file. `void`, not `undefined`: a `create` with no return statement
   * must type-check.
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
