import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const severitySchema = z.enum(["error", "warn", "off"]);

export const userConfigSchema = z
  .object({
    plugins: z.array(z.string()),
    rules: z.record(z.string(), severitySchema),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .strict();

export type UserConfig = z.infer<typeof userConfigSchema>;

export const CONFIG_FILENAMES = [
  "qualety.config.ts",
  "qualety.config.mts",
  "qualety.config.js",
  "qualety.config.mjs",
  "qualety.config.json",
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
  const result = userConfigSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  throw mapConfigZodError(raw, result.error);
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
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (e) {
    throw new ConfigError(`Failed to load ${path}: ${messageOf(e)}`);
  }
  if (!isRecord(loaded) || !("default" in loaded)) {
    throw new ConfigError(`${path} must have a default export`);
  }
  return validateConfig(loaded.default);
}

function mapConfigZodError(raw: unknown, error: z.ZodError): ConfigError {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return new ConfigError("Config must be an object");
  }

  const extraKeys = unrecognizedConfigKeys(error);
  if (extraKeys.length > 0) {
    const allowed = Object.keys(userConfigSchema.shape).join(", ");
    return new ConfigError(
      `Unknown config key${extraKeys.length > 1 ? "s" : ""}: ${extraKeys.join(", ")}. Allowed keys: ${allowed}.`,
    );
  }

  const issues = error.issues;
  const missingRequired = issues.some((issue) => {
    const key = issue.path[0];
    return (key === "plugins" || key === "rules") && isMissingIssue(issue, raw);
  });
  if (missingRequired) {
    return new ConfigError('Config must include "plugins" and "rules"');
  }

  for (const issue of issues) {
    const key = issue.path[0];
    if (key === "plugins" || key === "include" || key === "exclude") {
      return new ConfigError(`"${String(key)}" must be an array of strings`);
    }
    if (key === "rules") {
      if (issue.path.length === 1) {
        return new ConfigError('"rules" must be an object of rule ids to "error" | "warn" | "off"');
      }
      const id = issue.path[1];
      if (typeof id === "string") {
        const received = valueAt(raw, issue.path);
        return new ConfigError(
          `Invalid severity for "${id}": ${JSON.stringify(received)}. Use "error", "warn", or "off".`,
        );
      }
    }
  }

  const first = issues[0];
  return new ConfigError(first?.message ?? "Invalid config");
}

function unrecognizedConfigKeys(error: z.ZodError): string[] {
  const keys: string[] = [];
  for (const issue of error.issues) {
    if (issue.code !== "unrecognized_keys") {
      continue;
    }
    keys.push(...issue.keys);
  }
  return keys;
}

function isMissingIssue(issue: z.ZodIssue, raw: unknown): boolean {
  return issue.code === "invalid_type" && valueAt(raw, issue.path) === undefined;
}

function valueAt(raw: unknown, path: PropertyKey[]): unknown {
  let current: unknown = raw;
  for (const key of path) {
    if (!isRecord(current)) {
      return current;
    }
    current = current[String(key)];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
