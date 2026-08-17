import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { check } from "./engine.ts";

const silent = () => {};

const pingPlugin = `let seen;
let seenProject;
let creates = 0;
export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { docs: { description: "always reports" } },
      create(context) {
        for (const filename of context.getFilenames()) {
          const source = context.getSource(filename);
          if (source == null || typeof source.getFullText !== "function") {
            throw new Error("getSource() did not return a parsed SourceUnit");
          }
          context.report({
            severity: "error",
            file: filename,
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "ping",
          });
        }
      },
    },
    quiet: {
      meta: { docs: { description: "never reports" } },
      create() {},
    },
    first: {
      meta: { docs: { description: "records source" } },
      create(context) {
        seen = context.getSource(context.getFilenames()[0]);
      },
    },
    second: {
      meta: { docs: { description: "checks same source" } },
      create(context) {
        if (context.getSource(context.getFilenames()[0]) !== seen) {
          context.report({
            severity: "error",
            file: context.getFilenames()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "parsed more than once",
          });
        }
      },
    },
    projectFirst: {
      meta: { docs: { description: "records project" } },
      create(context) {
        seenProject = context.getProject();
      },
    },
    projectSecond: {
      meta: { docs: { description: "checks same project" } },
      create(context) {
        if (context.getProject() !== seenProject) {
          context.report({
            severity: "error",
            file: context.getFilenames()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "project not shared",
          });
        }
      },
    },
    unusedExport: {
      meta: { docs: { description: "export x unused across files" } },
      create(context) {
        creates += 1;
        const filenames = context.getFilenames();
        if (creates !== 1) {
          context.report({
            severity: "error",
            file: filenames[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`create invoked \${creates} times\`,
          });
        }
        if (context.getSources().size !== 2) {
          context.report({
            severity: "error",
            file: filenames[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected 2 sources, got \${context.getSources().size}\`,
          });
        }
        const texts = filenames.map((filename) => {
          const source = context.getSource(filename);
          if (source == null || typeof source.getFullText !== "function") {
            throw new Error("getSource() did not return a parsed SourceUnit");
          }
          return { filename, text: source.getFullText() };
        });
        const exporter = texts.find((item) => /export const x\\b/.test(item.text));
        const importer = texts.find((item) => /import\\s+\\{\\s*x\\s*\\}/.test(item.text));
        if (exporter !== undefined && importer === undefined) {
          context.report({
            severity: "error",
            file: exporter.filename,
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "export x is unused across files",
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

test("getProject returns the same object for every rule", async () => {
  const dir = await writeTree({
    "plugin.mjs": pingPlugin,
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin.mjs"],
      rules: { "fixture/projectFirst": "error", "fixture/projectSecond": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/project not shared/);
});

test("create runs once and can report a cross-file violation", async () => {
  const dir = await writeTree({
    "plugin.mjs": pingPlugin,
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin.mjs"],
      rules: { "fixture/unusedExport": "error" },
    }),
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": "export const y = 2;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(
    /src\/a\.ts:1:1\s+error\s+fixture\/unusedExport\s+export x is unused across files/,
  );
  expect(out).not.toMatch(/create invoked/);
  expect(out).not.toMatch(/expected 2 sources/);
});
