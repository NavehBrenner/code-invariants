import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { check } from "./engine.ts";

const silent = () => {};

const pingPlugin = `let seen;
export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { docs: { description: "always reports" } },
      create(context) {
        const source = context.getSource();
        if (source == null || typeof source.getFullText !== "function") {
          throw new Error("getSource() did not return a parsed SourceUnit");
        }
        context.report({
          severity: "error",
          file: context.getFilename(),
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "ping",
        });
      },
    },
    quiet: {
      meta: { docs: { description: "never reports" } },
      create() {},
    },
    first: {
      meta: { docs: { description: "records source" } },
      create(context) {
        seen = context.getSource();
      },
    },
    second: {
      meta: { docs: { description: "checks same source" } },
      create(context) {
        if (context.getSource() !== seen) {
          context.report({
            severity: "error",
            file: context.getFilename(),
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "parsed more than once",
          });
        }
      },
    },
  },
};
`;

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-engine-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

test("unknown rule id exits 2", async () => {
  const dir = await writeTree({
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: [],
      rules: { "react/data-region-exhaustive": "error" },
    }),
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown rule id: react\/data-region-exhaustive/);
});

test("all rules off is an honest empty path", async () => {
  const dir = await writeTree({
    "plugin.mjs": pingPlugin,
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin.mjs"],
      rules: { "fixture/ping": "off" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("enabled rule collects a violation and exits 1", async () => {
  const dir = await writeTree({
    "plugin.mjs": pingPlugin,
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin.mjs"],
      rules: { "fixture/ping": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/src\/hello\.ts:1:1\s+error\s+fixture\/ping\s+ping/);
});

test("enabled rule with no violations exits 0 without the empty-path message", async () => {
  const dir = await writeTree({
    "plugin.mjs": pingPlugin,
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin.mjs"],
      rules: { "fixture/quiet": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/nothing to check/);
});

test("TypeScript frontend parses each file once for all rules", async () => {
  const dir = await writeTree({
    "plugin.mjs": pingPlugin,
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin.mjs"],
      rules: { "fixture/first": "error", "fixture/second": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/parsed more than once/);
});
