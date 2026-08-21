import { glob } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_FILENAMES, ConfigError, loadConfig } from "./config.ts";
import { createFrontend, hasFrontend } from "./frontend.ts";
import {
  type ArtifactProvider,
  NO_SUGGESTION,
  type ParsedProject,
  type Plugin,
  type Rule,
  type Severity,
  type UserConfig,
  type Violation,
} from "./index.ts";

const NOTHING_TO_CHECK = "No rules configured — nothing to check.";
const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

type Enabled = {
  id: string;
  severity: Exclude<Severity, "off">;
  rule: Rule;
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

  for (const item of enabled) {
    validateRequires(item.id, asMeta(item.rule));
  }

  const files = await listWorkspaceFiles(cwd, config);
  if (files.length === 0) {
    out("No files to check.");
    return 0;
  }

  const displayPaths = files.map((abs) => displayPath(cwd, abs));
  const artifacts = await buildRequiredArtifacts(plugins, enabled, config, {
    cwd,
    files: displayPaths,
    exclude: mergedExclude(config),
  });

  const violations: Violation[] = [];
  const report = (item: Enabled, violation: Omit<Violation, "ruleId">) => {
    violations.push({
      ...violation,
      ruleId: item.id,
      severity: item.severity,
      file: displayPath(cwd, violation.file),
      suggestion: violation.suggestion ?? NO_SUGGESTION,
    });
  };

  for (const item of enabled) {
    const allowed = new Set(requiresOf(item));
    item.rule.create({
      id: item.id,
      options: undefined,
      getCwd: () => cwd,
      getFiles: () => displayPaths,
      getArtifact: (id) => readArtifact(id, allowed, artifacts),
      report(violation) {
        report(item, violation);
      },
    });
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

function resolveEnabledRules(plugins: Plugin[], rules: Record<string, Severity>): Enabled[] {
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
  const enabled: Enabled[] = [];
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

function asMeta(rule: Rule): Record<string, unknown> {
  const meta = (rule as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  return meta as Record<string, unknown>;
}

function validateRequires(id: string, meta: Record<string, unknown>): void {
  const requires = meta.requires;
  if (requires === undefined) {
    return;
  }
  if (
    !Array.isArray(requires) ||
    requires.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new ConfigError(
      `Rule "${id}" has invalid requires; must be an array of non-empty artifact ids.`,
    );
  }
}

function requiresOf(item: Enabled): string[] {
  const requires = asMeta(item.rule).requires;
  return Array.isArray(requires) ? (requires as string[]) : [];
}

async function buildRequiredArtifacts(
  plugins: Plugin[],
  enabled: Enabled[],
  config: UserConfig,
  base: { cwd: string; files: readonly string[]; exclude: readonly string[] },
): Promise<Map<string, unknown>> {
  const requiredBy = new Map<string, string[]>();
  for (const item of enabled) {
    for (const id of requiresOf(item)) {
      const list = requiredBy.get(id) ?? [];
      list.push(item.id);
      requiredBy.set(id, list);
    }
  }
  const providers = collectProviders(plugins, config.languages);
  const artifacts = new Map<string, unknown>();
  for (const [id, rules] of requiredBy) {
    if (isLanguageArtifact(id, config.languages)) {
      artifacts.set(id, buildLanguageArtifact(id, rules, config.languages, base));
      continue;
    }
    const provider = providers.get(id);
    if (provider === undefined) {
      throw new ConfigError(
        `No plugin provides artifact "${id}" (required by ${rules.join(", ")}).`,
      );
    }
    try {
      artifacts.set(
        id,
        await provider.build({
          cwd: base.cwd,
          files: base.files,
          exclude: base.exclude,
          requiredBy: rules,
        }),
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (rules.some((ruleId) => detail.includes(ruleId))) {
        throw e instanceof ConfigError ? e : new ConfigError(detail);
      }
      throw new ConfigError(
        `Failed to build artifact "${id}" (required by ${rules.join(", ")}): ${detail}`,
      );
    }
  }
  return artifacts;
}

function isLanguageArtifact(id: string, configLanguages: string[]): boolean {
  return hasFrontend(id) || configLanguages.includes(id);
}

function buildLanguageArtifact(
  language: string,
  rules: string[],
  configLanguages: string[],
  base: { cwd: string; files: readonly string[] },
): ParsedProject {
  if (!configLanguages.includes(language)) {
    throw new ConfigError(
      `Artifact "${language}" is not in config.languages (required by ${rules.join(", ")}).`,
    );
  }
  const frontend = createFrontend(language);
  if (frontend === undefined) {
    throw new ConfigError(`No frontend for ${language} (required by ${rules.join(", ")}).`);
  }
  const absolutePaths = base.files
    .map((file) => resolve(base.cwd, file))
    .filter((abs) => languageAccepts(language, abs));
  return frontend.parseFiles(absolutePaths);
}

function languageAccepts(language: string, path: string): boolean {
  if (language === "typescript") {
    return hasTsExtension(path);
  }
  return true;
}

function collectProviders(
  plugins: Plugin[],
  configLanguages: string[],
): Map<string, ArtifactProvider> {
  const owners = new Map<string, string>();
  const providers = new Map<string, ArtifactProvider>();
  for (const plugin of plugins) {
    const provides = plugin.provides;
    if (provides === undefined) {
      continue;
    }
    if (provides === null || typeof provides !== "object" || Array.isArray(provides)) {
      throw new ConfigError(`Plugin "${plugin.name}" has invalid provides.`);
    }
    for (const [id, provider] of Object.entries(provides)) {
      if (id.length === 0) {
        throw new ConfigError(`Plugin "${plugin.name}" provides an empty artifact id.`);
      }
      if (isLanguageArtifact(id, configLanguages)) {
        throw new ConfigError(
          `Artifact "${id}" is reserved for the language frontend (plugin "${plugin.name}").`,
        );
      }
      if (
        provider === null ||
        typeof provider !== "object" ||
        typeof (provider as ArtifactProvider).build !== "function"
      ) {
        throw new ConfigError(`Plugin "${plugin.name}" provides "${id}" without a build function.`);
      }
      const existing = owners.get(id);
      if (existing !== undefined) {
        throw new ConfigError(
          `Artifact "${id}" is provided by more than one plugin (${existing}, ${plugin.name}).`,
        );
      }
      owners.set(id, plugin.name);
      providers.set(id, provider as ArtifactProvider);
    }
  }
  return providers;
}

function readArtifact(
  id: string,
  allowed: ReadonlySet<string>,
  artifacts: ReadonlyMap<string, unknown>,
): unknown {
  if (!allowed.has(id)) {
    throw new ConfigError(
      `getArtifact(${JSON.stringify(id)}) requires meta.requires to include ${JSON.stringify(id)}`,
    );
  }
  if (!artifacts.has(id)) {
    throw new ConfigError(`Artifact ${JSON.stringify(id)} is not available.`);
  }
  return artifacts.get(id);
}

function mergedExclude(config: UserConfig): string[] {
  return [...new Set([...(config.exclude ?? DEFAULT_EXCLUDE), ...DEFAULT_EXCLUDE])];
}

async function listWorkspaceFiles(cwd: string, config: UserConfig): Promise<string[]> {
  const include = config.include ?? DEFAULT_INCLUDE;
  const exclude = mergedExclude(config);
  const found = new Set<string>();
  for (const pattern of include) {
    for await (const entry of glob(pattern, { cwd, exclude })) {
      const abs = resolve(cwd, entry);
      if (isConfigFilename(abs)) {
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
