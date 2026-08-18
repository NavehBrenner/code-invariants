import { glob } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_FILENAMES, ConfigError, loadConfig } from "./config.ts";
import { createFrontend, hasFrontend } from "./frontend.ts";
import {
  type LanguageRule,
  NO_SUGGESTION,
  type Plugin,
  type ProjectRule,
  type Rule,
  type Severity,
  type SourceUnit,
  type UserConfig,
  type Violation,
} from "./index.ts";

const NOTHING_TO_CHECK = "No rules configured — nothing to check.";
const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

type Enabled<T extends Rule> = {
  id: string;
  severity: Exclude<Severity, "off">;
  rule: T;
};

export async function check(
  cwd: string,
  out: (msg: string) => void,
  err: (msg: string) => void,
): Promise<number> {
  try {
    return await runCheck(cwd, out);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

async function runCheck(cwd: string, out: (msg: string) => void): Promise<number> {
  const loaded = await loadConfig(cwd);
  if (loaded === undefined) {
    out(NOTHING_TO_CHECK);
    return 0;
  }
  const { path: configPath, config } = loaded;
  const ruleEntries = Object.entries(config.rules);
  if (ruleEntries.length === 0) {
    out(NOTHING_TO_CHECK);
    return 0;
  }

  const plugins = await loadPlugins(config.plugins, dirname(configPath));
  const enabled = resolveEnabledRules(plugins, config.rules);
  if (enabled.length === 0) {
    out(NOTHING_TO_CHECK);
    return 0;
  }

  const { languageRules, projectRules } = partitionEnabled(enabled, config.languages);

  const langPipelines: { language: string; rules: Enabled<LanguageRule>[]; files: string[] }[] = [];
  for (const language of config.languages) {
    const matching = languageRules.filter((item) => item.rule.meta.languages.includes(language));
    if (matching.length === 0) {
      continue;
    }
    langPipelines.push({
      language,
      rules: matching,
      files: await listLanguageFiles(cwd, config),
    });
  }

  const workspaceFiles =
    projectRules.length > 0 ? await listWorkspaceFiles(cwd, config) : undefined;
  const anyFiles =
    langPipelines.some((pipeline) => pipeline.files.length > 0) ||
    (workspaceFiles !== undefined && workspaceFiles.length > 0);
  if (!anyFiles) {
    out("No files to check.");
    return 0;
  }

  const violations: Violation[] = [];
  const report = (item: Enabled<Rule>, violation: Omit<Violation, "ruleId">) => {
    violations.push({
      ...violation,
      ruleId: item.id,
      severity: item.severity,
      file: displayPath(cwd, violation.file),
      suggestion: violation.suggestion ?? NO_SUGGESTION,
    });
  };

  for (const pipeline of langPipelines) {
    if (pipeline.files.length === 0) {
      continue;
    }
    const frontend = createFrontend(pipeline.language);
    if (frontend === undefined) {
      const requiredBy = pipeline.rules[0]?.id ?? pipeline.language;
      throw new ConfigError(`No frontend for ${pipeline.language} (required by ${requiredBy}).`);
    }
    const parsed = frontend.parseFiles(pipeline.files);
    const displayPaths = pipeline.files.map((abs) => displayPath(cwd, abs));
    const lookup = createSourceLookup(parsed.sources, cwd);
    for (const item of pipeline.rules) {
      item.rule.create({
        id: item.id,
        options: undefined,
        language: pipeline.language,
        getProject: () => parsed.project,
        getSources: () => parsed.sources,
        getFilenames: () => displayPaths,
        getSource: (name) => lookup(name),
        report(violation) {
          report(item, violation);
        },
      });
    }
  }

  if (workspaceFiles !== undefined && workspaceFiles.length > 0) {
    const displayPaths = workspaceFiles.map((abs) => displayPath(cwd, abs));
    for (const item of projectRules) {
      item.rule.create({
        id: item.id,
        options: undefined,
        getCwd: () => cwd,
        getFiles: () => displayPaths,
        report(violation) {
          report(item, violation);
        },
      });
    }
  }

  violations.sort(compareViolations);
  for (const violation of violations) {
    out(formatViolation(violation));
  }
  return violations.length > 0 ? 1 : 0;
}

export async function loadPlugins(specs: string[], fromDir: string): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  for (const spec of specs) {
    plugins.push(await loadPlugin(spec, fromDir));
  }
  return plugins;
}

async function loadPlugin(spec: string, fromDir: string): Promise<Plugin> {
  const target =
    spec.startsWith(".") || spec.startsWith("/")
      ? pathToFileURL(resolve(fromDir, spec)).href
      : spec;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(target)) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigError(
      `Failed to load plugin "${spec}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const candidate = mod.default ?? mod.plugin;
  if (!isPlugin(candidate)) {
    throw new ConfigError(`Module "${spec}" does not export a Plugin (default or "plugin")`);
  }
  return candidate;
}

function isPlugin(value: unknown): value is Plugin {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return typeof rec.name === "string";
}

function resolveEnabledRules(plugins: Plugin[], rules: Record<string, Severity>): Enabled<Rule>[] {
  const catalog = new Map<string, Rule>();
  for (const plugin of plugins) {
    for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
      catalog.set(`${plugin.name}/${name}`, rule);
    }
  }
  const unknown = Object.keys(rules).filter((id) => !catalog.has(id));
  if (unknown.length > 0) {
    throw new ConfigError(
      `Unknown rule id${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. No loaded plugin defines ${unknown.length > 1 ? "these rules" : "this rule"}.`,
    );
  }
  const enabled: Enabled<Rule>[] = [];
  for (const [id, severity] of Object.entries(rules)) {
    if (severity === "off") {
      continue;
    }
    const rule = catalog.get(id);
    if (rule === undefined) {
      continue;
    }
    enabled.push({ id, severity, rule });
  }
  return enabled;
}

function partitionEnabled(
  enabled: Enabled<Rule>[],
  configLanguages: string[],
): { languageRules: Enabled<LanguageRule>[]; projectRules: Enabled<ProjectRule>[] } {
  const languageRules: Enabled<LanguageRule>[] = [];
  const projectRules: Enabled<ProjectRule>[] = [];
  for (const item of enabled) {
    const meta = asMeta(item.rule);
    const kind = meta.kind;
    if (kind !== "language" && kind !== "project") {
      throw new ConfigError(
        `Rule "${item.id}" meta.kind must be "language" or "project"${kind === undefined ? "" : `; got ${JSON.stringify(kind)}`}.`,
      );
    }
    if (kind === "language") {
      validateLanguageMeta(item.id, meta, configLanguages);
      languageRules.push(item as Enabled<LanguageRule>);
    } else {
      validateProjectMeta(item.id, meta);
      projectRules.push(item as Enabled<ProjectRule>);
    }
  }
  return { languageRules, projectRules };
}

function asMeta(rule: Rule): Record<string, unknown> {
  const meta = (rule as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  return meta as Record<string, unknown>;
}

function validateLanguageMeta(
  id: string,
  meta: Record<string, unknown>,
  configLanguages: string[],
): void {
  const languages = meta.languages;
  if (
    !Array.isArray(languages) ||
    languages.length === 0 ||
    languages.some((item) => typeof item !== "string")
  ) {
    throw new ConfigError(`Rule "${id}" kind "language" requires a non-empty languages array.`);
  }
  if ("requires" in meta && meta.requires !== undefined) {
    throw new ConfigError(`Rule "${id}" is a language rule and must not set requires.`);
  }
  const intersection = languages.filter((language) => configLanguages.includes(language));
  if (intersection.length === 0) {
    const configured = configLanguages.length > 0 ? configLanguages.join(", ") : "(none)";
    throw new ConfigError(
      `Rule "${id}" languages (${languages.join(", ")}) do not intersect config.languages (${configured}).`,
    );
  }
  for (const language of intersection) {
    if (!hasFrontend(language)) {
      throw new ConfigError(`No frontend for ${language} (required by ${id}).`);
    }
  }
}

function validateProjectMeta(id: string, meta: Record<string, unknown>): void {
  const requires = meta.requires;
  if (requires === undefined) {
    return;
  }
  if (!Array.isArray(requires) || requires.some((item) => typeof item !== "string")) {
    throw new ConfigError(
      `Rule "${id}" has invalid requires; must be an array of known capability names.`,
    );
  }
  for (const capability of requires) {
    if (capability !== "index") {
      throw new ConfigError(
        `Rule "${id}" has invalid requires value: ${JSON.stringify(capability)}.`,
      );
    }
  }
  if (requires.includes("index")) {
    throw new ConfigError(`Index not implemented (required by ${id}).`);
  }
}

async function listLanguageFiles(cwd: string, config: UserConfig): Promise<string[]> {
  return collectFiles(cwd, config, true);
}

async function listWorkspaceFiles(cwd: string, config: UserConfig): Promise<string[]> {
  return collectFiles(cwd, config, false);
}

async function collectFiles(cwd: string, config: UserConfig, tsOnly: boolean): Promise<string[]> {
  const include = config.include ?? DEFAULT_INCLUDE;
  const exclude = [...new Set([...(config.exclude ?? DEFAULT_EXCLUDE), ...DEFAULT_EXCLUDE])];
  const found = new Set<string>();
  for (const pattern of include) {
    for await (const entry of glob(pattern, { cwd, exclude })) {
      const abs = resolve(cwd, entry);
      if (isConfigFilename(abs)) {
        continue;
      }
      if (tsOnly && !hasTsExtension(abs)) {
        continue;
      }
      found.add(abs);
    }
  }
  return [...found].sort();
}

function hasTsExtension(path: string): boolean {
  return TS_EXTENSIONS.has(extname(path));
}

function isConfigFilename(path: string): boolean {
  return (CONFIG_FILENAMES as readonly string[]).includes(basename(path));
}

function createSourceLookup(
  sources: ReadonlyMap<string, SourceUnit>,
  cwd: string,
): (name: string) => SourceUnit | undefined {
  const aliases = new Map<string, SourceUnit>();
  for (const [abs, unit] of sources) {
    aliases.set(abs, unit);
    aliases.set(displayPath(cwd, abs), unit);
  }
  return (name) => aliases.get(name) ?? aliases.get(resolve(cwd, name));
}

function displayPath(cwd: string, file: string): string {
  const abs = resolve(cwd, file);
  const rel = relative(cwd, abs);
  return (rel === "" ? file : rel).split(sep).join("/");
}

function formatViolation(v: Violation): string {
  const loc = `${v.file}:${v.range.start.line}:${v.range.start.column}`;
  const extra = v.suggestion === NO_SUGGESTION ? "" : `\n  suggestion: ${v.suggestion}`;
  return `${loc}  ${v.severity}  ${v.ruleId}  ${v.message}${extra}`;
}

function compareViolations(a: Violation, b: Violation): number {
  return (
    a.file.localeCompare(b.file) ||
    a.range.start.line - b.range.start.line ||
    a.range.start.column - b.range.start.column ||
    a.ruleId.localeCompare(b.ruleId)
  );
}
