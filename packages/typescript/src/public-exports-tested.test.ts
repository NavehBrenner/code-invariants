import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";
import plugin from "./index.ts";

const silent = () => {};
const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const pluginDist = join(here, "../dist/index.js");

async function runFixture(name: string) {
  const lines: string[] = [];
  const errors: string[] = [];
  const code = await check(
    join(fixtures, name),
    (m) => lines.push(String(m)),
    (m) => errors.push(String(m)),
  );
  return { code, out: lines.join("\n"), err: errors.join("\n") };
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-ts-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

function enabledConfig(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    plugins: [pluginDist],
    rules: { "ts/public-exports-tested": "error" },
    ...extra,
  });
}

test("plugin exports name, rule, and recommended", () => {
  expect(plugin.name).toBe("ts");
  expect(plugin.rules?.["public-exports-tested"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["ts/public-exports-tested"]).toBe("error");
});

test("named export used from a test file exits 0", async () => {
  const result = await runFixture("named-used");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/ts\/public-exports-tested/);
});

test("named export with no test reference exits 1", async () => {
  const result = await runFixture("named-unused");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/foo\.ts:1:\d+\s+error\s+ts\/public-exports-tested\s+Public export "foo" in src\/foo\.ts is not referenced from a test file/,
  );
  expect(result.out).toMatch(/Import "foo" from a test path/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("default export used from a test file exits 0", async () => {
  const result = await runFixture("default-used");
  expect(result.code).toBe(0);
});

test("default export with no test reference exits 1", async () => {
  const result = await runFixture("default-unused");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/foo\.ts:1:\d+\s+error\s+ts\/public-exports-tested\s+Public export "default" in src\/foo\.ts is not referenced from a test file/,
  );
});

test("unused type-only exports are skipped", async () => {
  const result = await runFixture("type-only-unused");
  expect(result.code).toBe(0);
});

test("unused named re-export is a violation", async () => {
  const result = await runFixture("reexport-unused");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/barrel\.ts:1:\d+\s+error\s+ts\/public-exports-tested\s+Public export "x" in src\/barrel\.ts/,
  );
});

test("named re-export imported from the barrel exits 0", async () => {
  const result = await runFixture("reexport-used");
  expect(result.code).toBe(0);
});

test("export * and export * as ns are skipped", async () => {
  const result = await runFixture("export-star");
  expect(result.code).toBe(0);
});

test("exports only in a spec file are skipped", async () => {
  const result = await runFixture("export-in-spec");
  expect(result.code).toBe(0);
});

test("exports only under __tests__/ are skipped", async () => {
  const result = await runFixture("export-in-tests-dir");
  expect(result.code).toBe(0);
});

test("excluded production file is not reported", async () => {
  const result = await runFixture("production-excluded");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Public export "kept" in src\/kept\.ts/);
  expect(result.out).not.toMatch(/dropped/);
});

test("loading the plugin without enabling the rule is an empty path", async () => {
  const dir = await writeTree({
    "qualety.config.json": JSON.stringify({
      plugins: [pluginDist],
      rules: {},
    }),
    "src/foo.ts": "export const foo = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("excluding test paths makes a referenced export fail", async () => {
  const dir = await writeTree({
    "qualety.config.json": enabledConfig({ exclude: ["**/*.test.*"] }),
    "src/foo.ts": "export const foo = 1;\n",
    "src/foo.test.ts": 'import { foo } from "./foo";\n',
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/Public export "foo" in src\/foo\.ts/);
});

test("import * does not satisfy a named export", async () => {
  const dir = await writeTree({
    "qualety.config.json": enabledConfig(),
    "src/foo.ts": "export const foo = 1;\n",
    "src/foo.test.ts": 'import * as ns from "./foo";\nvoid ns;\n',
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/Public export "foo"/);
});

test("bare specifiers do not count as references", async () => {
  const dir = await writeTree({
    "qualety.config.json": enabledConfig(),
    "src/foo.ts": "export const foo = 1;\n",
    "src/foo.test.ts": 'import { foo } from "foo";\nvoid foo;\n',
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/Public export "foo"/);
});

test("dynamic import does not count as a reference", async () => {
  const dir = await writeTree({
    "qualety.config.json": enabledConfig(),
    "src/foo.ts": "export const foo = 1;\n",
    "src/foo.test.ts": 'const m = await import("./foo");\nvoid m;\n',
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/Public export "foo"/);
});
