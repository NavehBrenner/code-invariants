import { glob } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { z } from "zod";
import { CONFIG_FILENAMES, ConfigError, loadConfig } from "./config.ts";
import { DEFAULT_PROVIDERS } from "./default-providers.ts";
import {
  type ArtifactMap,
  type ArtifactProvider,
  NO_SUGGESTION,
  type Plugin,
  type Rule,
  type RuleContext,
  type Severity,
  type UserConfig,
  type Violation,
} from "./index.ts";
import { pluginSchema } from "./schemas.ts";

const NOTHING_TO_CHECK = "No rules configured — nothing to check.";
const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];

type Enabled = {
  id: string;
  severity: Exclude<Severity, "off">;
  rule: Rule;
};

type ProviderEntry = {
  provider: ArtifactProvider;
  owner: string;
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

  const files = await listWorkspaceFiles(cwd, config);
  if (files.length === 0) {
    out("No files to check.");
    return 0;
  }

  const displayPaths = files.map((abs) => displayPath(cwd, abs));
  const artifacts = await buildRequiredArtifacts(plugins, enabled, {
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
      getArtifact: artifactGetter(allowed, artifacts),
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
  let loaded: unknown;
  try {
    loaded = await import(target);
  } catch (e) {
    throw new ConfigError(
      `Failed to load plugin "${spec}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const candidate = isRecord(loaded) ? (loaded.default ?? loaded.plugin) : undefined;
  const parsed = pluginSchema.safeParse(candidate);
  requirePlugin(spec, candidate, parsed);
  return candidate;
}

function requirePlugin(
  spec: string,
  candidate: unknown,
  parsed: ReturnType<typeof pluginSchema.safeParse>,
): asserts candidate is Plugin {
  if (!parsed.success) {
    throw mapPluginZodError(spec, candidate, parsed.error);
  }
}

function pluginDisplayName(spec: string, candidate: unknown): string {
  if (isRecord(candidate) && typeof candidate.name === "string" && candidate.name.length > 0) {
    return candidate.name;
  }
  return spec;
}

function mapPluginZodError(spec: string, candidate: unknown, error: z.ZodError): ConfigError {
  const name = pluginDisplayName(spec, candidate);
  for (const issue of error.issues) {
    if (issue.path.length === 0 || (issue.path.length === 1 && issue.path[0] === "name")) {
      return new ConfigError(`Module "${spec}" does not export a Plugin (default or "plugin")`);
    }
    if (issue.path[0] === "provides") {
      if (issue.path.length === 1) {
        return new ConfigError(`Plugin "${name}" has invalid provides.`);
      }
      const artifactId = issue.path[1];
      if (artifactId === "") {
        return new ConfigError(`Plugin "${name}" provides an empty artifact id.`);
      }
      if (typeof artifactId === "string") {
        return new ConfigError(
          `Plugin "${name}" provides "${artifactId}" without a build function.`,
        );
      }
    }
    if (issue.path[0] === "rules" && typeof issue.path[1] === "string") {
      const ruleId = `${name}/${issue.path[1]}`;
      if (issue.path[2] === "meta" && issue.path[3] === "requires") {
        return new ConfigError(
          `Rule "${ruleId}" has invalid requires; must be an array of non-empty artifact ids.`,
        );
      }
      return new ConfigError(
        `Rule "${ruleId}" is invalid: must have meta.docs.description and a create function.`,
      );
    }
  }
  return new ConfigError(`Module "${spec}" does not export a Plugin (default or "plugin")`);
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
    enabled.push({ id, severity, rule: requireCatalogRule(catalog, id) });
  }
  return enabled;
}

function requireCatalogRule(catalog: Map<string, Rule>, id: string): Rule {
  const rule = catalog.get(id);
  if (rule === undefined) {
    throw new ConfigError(`Unknown rule id: ${id}. No loaded plugin defines this rule.`);
  }
  return rule;
}

function requiresOf(item: Enabled): string[] {
  return item.rule.meta.requires ?? [];
}

async function buildRequiredArtifacts(
  plugins: Plugin[],
  enabled: Enabled[],
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
  const providers = collectProviders(plugins);
  const artifacts = new Map<string, unknown>();
  for (const [id, rules] of requiredBy) {
    const entry = providers.get(id);
    if (entry === undefined) {
      throw new ConfigError(`No provider for artifact "${id}" (required by ${rules.join(", ")}).`);
    }
    try {
      artifacts.set(
        id,
        await entry.provider.build({
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

function collectProviders(plugins: Plugin[]): Map<string, ProviderEntry> {
  const providers = new Map<string, ProviderEntry>();
  for (const plugin of plugins) {
    registerPluginProvides(plugin, providers);
  }
  for (const [id, createProvider] of Object.entries(DEFAULT_PROVIDERS)) {
    if (providers.has(id)) {
      continue;
    }
    providers.set(id, { provider: createProvider(), owner: "default" });
  }
  return providers;
}

function registerPluginProvides(plugin: Plugin, providers: Map<string, ProviderEntry>): void {
  const provides = plugin.provides;
  if (provides === undefined) {
    return;
  }
  for (const [id, provider] of Object.entries(provides)) {
    const existing = providers.get(id);
    if (existing !== undefined) {
      throw new ConfigError(
        `Artifact "${id}" is provided by more than one owner (${existing.owner}, ${plugin.name}).`,
      );
    }
    providers.set(id, { provider, owner: plugin.name });
  }
}

function artifactGetter(
  allowed: ReadonlySet<string>,
  artifacts: ReadonlyMap<string, unknown>,
): RuleContext["getArtifact"] {
  function getArtifact<Id extends string>(
    id: Id,
  ): Id extends keyof ArtifactMap ? ArtifactMap[Id] : unknown;
  function getArtifact(id: string): unknown {
    return readArtifact(id, allowed, artifacts);
  }
  return getArtifact;
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

function isConfigFilename(path: string): boolean {
  const name = basename(path);
  return CONFIG_FILENAMES.some((filename) => filename === name);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
