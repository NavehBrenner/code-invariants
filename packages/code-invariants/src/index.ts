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
  getSource(): SourceUnit;
  getFilename(): string;
}

/** Returned by `create` when a rule wants per-node visiting instead of a one-shot pass. */
export type RuleListener = Record<string, (node: unknown) => void>;

export interface Rule {
  meta: {
    docs: { description: string; url?: string };
    schema?: JSONSchema;
    fixable?: "code" | "whitespace";
  };
  /** `void`, not `undefined`: a `create` with no return statement must type-check. */
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

export { defineConfig } from "./config.ts";
