import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { defineConfig, findConfigPath, loadConfig, validateConfig } from "./config.ts";
import type { UserConfig } from "./index.ts";
import { defineConfig as exportedDefineConfig } from "./index.ts";

const valid: UserConfig = { languages: ["typescript"], plugins: [], rules: {} };

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-config-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

test("defineConfig is exported and returns the validated config", () => {
  expect(exportedDefineConfig).toBe(defineConfig);
  expect(defineConfig(valid)).toEqual(valid);
});

test("defineConfig rejects unknown keys", () => {
  expect(() => defineConfig({ ...valid, architecture: {} } as UserConfig)).toThrow(
    /Unknown config key: architecture/,
  );
});

test("defineConfig rejects invalid severity", () => {
  expect(() => validateConfig({ ...valid, rules: { "ts/no-deep-import": "fatal" } })).toThrow(
    /Invalid severity for "ts\/no-deep-import"/,
  );
});

test("defineConfig requires languages, plugins, and rules", () => {
  expect(() => validateConfig({})).toThrow(/must include "languages", "plugins", and "rules"/);
});

test("loadConfig reads a JSON config", async () => {
  const dir = await writeTree({
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin"],
      rules: { "demo/ping": "error" },
    }),
  });
  const loaded = await loadConfig(dir);
  expect(loaded?.config).toEqual({
    languages: ["typescript"],
    plugins: ["./plugin"],
    rules: { "demo/ping": "error" },
  });
  expect(loaded?.path).toBe(join(dir, "code-invariants.config.json"));
});

test("loadConfig reads a JS config default export", async () => {
  const dir = await writeTree({
    "code-invariants.config.mjs": `export default {
      languages: ["typescript"],
      plugins: [],
      rules: { "demo/off": "off" },
    };
    `,
  });
  const loaded = await loadConfig(dir);
  expect(loaded?.config.rules).toEqual({ "demo/off": "off" });
});

test("loadConfig reads a TypeScript config default export", async () => {
  const dir = await writeTree({
    "code-invariants.config.ts": `export default {
      languages: ["typescript"] as string[],
      plugins: [] as string[],
      rules: {},
    };
    `,
  });
  const loaded = await loadConfig(dir);
  expect(loaded?.config).toEqual(valid);
});

test("loadConfig returns undefined when no config file exists", async () => {
  const dir = await writeTree({ "readme.txt": "no config here" });
  expect(await loadConfig(dir)).toBeUndefined();
  expect(await findConfigPath(dir)).toBeUndefined();
});

test("loadConfig rejects unknown keys in JSON", async () => {
  const dir = await writeTree({
    "code-invariants.config.json": JSON.stringify({ ...valid, extra: true }),
  });
  await expect(loadConfig(dir)).rejects.toThrow(/Unknown config key: extra/);
});
