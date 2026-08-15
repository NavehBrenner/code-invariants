import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Severity, UserConfig } from "./index.ts";

const ALLOWED_KEYS = ["languages", "plugins", "rules", "include", "exclude"] as const;
const ALLOWED_KEY_SET = new Set<string>(ALLOWED_KEYS);
const SEVERITIES = new Set<Severity>(["error", "warn", "off"]);

export const CONFIG_FILENAMES = [
  "code-invariants.config.ts",
  "code-invariants.config.mts",
  "code-invariants.config.js",
  "code-invariants.config.mjs",
  "code-invariants.config.json",
] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Typed config helper. Validates unknown keys and value shapes at runtime. */
export function defineConfig(config: UserConfig): UserConfig {
  return validateConfig(config);
}

export function validateConfig(raw: unknown): UserConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError("Config must be an object");
  }
  const rec = raw as Record<string, unknown>;
  const unknown = Object.keys(rec).filter((key) => !ALLOWED_KEY_SET.has(key));
  if (unknown.length > 0) {
    throw new ConfigError(
      `Unknown config key${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Allowed keys: ${ALLOWED_KEYS.join(", ")}.`,
    );
  }
  if (!("languages" in rec) || !("plugins" in rec) || !("rules" in rec)) {
    throw new ConfigError('Config must include "languages", "plugins", and "rules"');
  }
  const languages = assertStringArray(rec.languages, "languages");
  const plugins = assertStringArray(rec.plugins, "plugins");
  const rules = assertRules(rec.rules);
  const config: UserConfig = { languages, plugins, rules };
  if ("include" in rec) {
    config.include = assertStringArray(rec.include, "include");
  }
  if ("exclude" in rec) {
    config.exclude = assertStringArray(rec.exclude, "exclude");
  }
  return config;
}

export async function findConfigPath(cwd: string): Promise<string | undefined> {
  let dir = cwd;
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      try {
        await access(candidate);
        return candidate;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

export async function loadConfig(
  cwd: string,
): Promise<{ path: string; config: UserConfig } | undefined> {
  const path = await findConfigPath(cwd);
  if (path === undefined) {
    return undefined;
  }
  return { path, config: await readConfigFile(path) };
}

export async function readConfigFile(path: string): Promise<UserConfig> {
  if (path.endsWith(".json")) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      throw new ConfigError(`Failed to read ${path}: ${messageOf(e)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new ConfigError(`Invalid JSON in ${path}: ${messageOf(e)}`);
    }
    return validateConfig(parsed);
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigError(`Failed to load ${path}: ${messageOf(e)}`);
  }
  if (!("default" in mod)) {
    throw new ConfigError(`${path} must have a default export`);
  }
  return validateConfig(mod.default);
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ConfigError(`"${key}" must be an array of strings`);
  }
  return value;
}

function assertRules(value: unknown): Record<string, Severity> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError('"rules" must be an object of rule ids to "error" | "warn" | "off"');
  }
  const rules: Record<string, Severity> = {};
  for (const [id, severity] of Object.entries(value as Record<string, unknown>)) {
    if (typeof severity !== "string" || !SEVERITIES.has(severity as Severity)) {
      throw new ConfigError(
        `Invalid severity for "${id}": ${JSON.stringify(severity)}. Use "error", "warn", or "off".`,
      );
    }
    rules[id] = severity as Severity;
  }
  return rules;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
