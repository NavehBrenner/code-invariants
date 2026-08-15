import { glob } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_FILENAMES, ConfigError, loadConfig } from "./config.ts";
import { createFrontend } from "./frontend.ts";
import type { Plugin, Rule, Severity, UserConfig, Violation } from "./index.ts";

const NOTHING_TO_CHECK = "No rules configured — nothing to check.";
const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

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

  const frontend = frontendFor(config.languages);
  const files = await listFiles(cwd, config);
  if (files.length === 0) {
    out("No files to check.");
    return 0;
  }

  const units = frontend.parseFiles(files);
  const violations: Violation[] = [];
  for (const abs of files) {
    const source = units.get(abs);
    const filename = displayPath(cwd, abs);
    for (const item of enabled) {
      item.rule.create({
        id: item.id,
        options: undefined,
        getSource: () => source,
        getFilename: () => filename,
        report(violation) {
          violations.push({
            ...violation,
            ruleId: item.id,
            severity: item.severity,
            file: displayPath(cwd, violation.file),
          });
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

function resolveEnabledRules(
  plugins: Plugin[],
  rules: Record<string, Severity>,
): { id: string; severity: Exclude<Severity, "off">; rule: Rule }[] {
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
  const enabled: { id: string; severity: Exclude<Severity, "off">; rule: Rule }[] = [];
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

function frontendFor(languages: string[]) {
  if (languages.includes("typescript")) {
    const frontend = createFrontend("typescript");
    if (frontend !== undefined) {
      return frontend;
    }
  }
  const listed = languages.length > 0 ? languages.join(", ") : "(none)";
  throw new ConfigError(`No frontend available for languages: ${listed}`);
}

async function listFiles(cwd: string, config: UserConfig): Promise<string[]> {
  const include = config.include ?? DEFAULT_INCLUDE;
  const exclude = [...new Set([...(config.exclude ?? DEFAULT_EXCLUDE), ...DEFAULT_EXCLUDE])];
  const found = new Set<string>();
  for (const pattern of include) {
    for await (const entry of glob(pattern, { cwd, exclude })) {
      const abs = resolve(cwd, entry);
      if (hasTsExtension(abs) && !isConfigFilename(abs)) {
        found.add(abs);
      }
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
  const extra = v.suggestion === undefined ? "" : `\n  suggestion: ${v.suggestion}`;
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
