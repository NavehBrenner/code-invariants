import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { check } from "./engine.ts";

const silent = () => {};

const fixturePlugin = `const lang = (description) => ({
  kind: "language",
  languages: ["typescript"],
  docs: { description },
});
let seen;
let seenProject;
let seenSources;
let creates = 0;
export default {
  name: "fixture",
  rules: {
    ping: {
      meta: lang("always reports"),
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
      meta: lang("never reports"),
      create() {},
    },
    first: {
      meta: lang("records source"),
      create(context) {
        seen = context.getSource(context.getFilenames()[0]);
        seenSources = context.getSources();
      },
    },
    second: {
      meta: lang("checks same source"),
      create(context) {
        if (context.getSource(context.getFilenames()[0]) !== seen) {
          context.report({
            severity: "error",
            file: context.getFilenames()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "parsed more than once",
          });
        }
        if (context.getSources() !== seenSources) {
          context.report({
            severity: "error",
            file: context.getFilenames()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "sources map not shared",
          });
        }
      },
    },
    projectFirst: {
      meta: lang("records project"),
      create(context) {
        seenProject = context.getProject();
      },
    },
    projectSecond: {
      meta: lang("checks same project"),
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
      meta: lang("export x unused across files"),
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
        if (context.language !== "typescript") {
          context.report({
            severity: "error",
            file: filenames[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected language typescript, got \${context.language}\`,
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
    workspacePing: {
      meta: { kind: "project", docs: { description: "always reports from workspace" } },
      create(context) {
        const files = context.getFiles();
        context.report({
          severity: "error",
          file: files[0] ?? ".",
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "workspace ping",
        });
      },
    },
    listed: {
      meta: { kind: "project", docs: { description: "checks listed files" } },
      create(context) {
        if ("getProject" in context || "getSources" in context || "getFilenames" in context) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "project rule received language AST context",
          });
        }
        if (typeof context.getCwd() !== "string" || context.getCwd().length === 0) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "getCwd missing",
          });
        }
        if (!context.getFiles().includes("src/hello.ts")) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "src/hello.ts not listed",
          });
        }
      },
    },
    hasNotes: {
      meta: { kind: "project", docs: { description: "notes.txt must be listed" } },
      create(context) {
        if (!context.getFiles().includes("notes.txt")) {
          context.report({
            severity: "error",
            file: "notes.txt",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`notes.txt not listed: \${context.getFiles().join(",")}\`,
          });
        }
      },
    },
  },
};
`;

function pluginWith(meta: string): string {
  return `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: ${meta},
      create() {},
    },
  },
};
`;
}

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-engine-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

function config(rules: Record<string, string>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    languages: ["typescript"],
    plugins: ["./plugin.mjs"],
    rules,
    ...extra,
  });
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
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/ping": "off" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("enabled rule collects a violation and exits 1", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/src\/hello\.ts:1:1\s+error\s+fixture\/ping\s+ping/);
  expect(lines.join("\n")).not.toMatch(/suggestion:/);
});

test("prints suggestion line only when it is not the sentinel", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    hint: {
      meta: { kind: "language", languages: ["typescript"], docs: { description: "hint" } },
      create(context) {
        context.report({
          severity: "error",
          file: context.getFilenames()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: "hint",
          suggestion: "Do the thing.",
        });
      },
    },
  },
};
`,
    "code-invariants.config.json": config({ "fixture/hint": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  expect(lines.join("\n")).toMatch(/suggestion: Do the thing\./);
});

test("enabled rule with no violations exits 0 without the empty-path message", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/quiet": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/nothing to check/);
});

test("no matching files is an honest empty path", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No files to check/);
});

test("TypeScript frontend parses each file once for all rules", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/first": "error", "fixture/second": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/parsed more than once/);
  expect(lines.join("\n")).not.toMatch(/sources map not shared/);
});

test("getProject returns the same object for every rule", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({
      "fixture/projectFirst": "error",
      "fixture/projectSecond": "error",
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/project not shared/);
});

test("create runs once and can report a cross-file violation", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/unusedExport": "error" }),
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
  expect(out).not.toMatch(/expected language typescript/);
});

test("project rule lists workspace files without AST APIs", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/listed": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/language AST context/);
  expect(lines.join("\n")).not.toMatch(/not listed/);
  expect(lines.join("\n")).not.toMatch(/getCwd missing/);
});

test("only project rules can run against non-TS files", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config(
      { "fixture/hasNotes": "error" },
      { include: ["**/*.txt"] },
    ),
    "notes.txt": "hello\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/notes\.txt not listed/);
});

test("missing kind exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ docs: { description: "no kind" } }`),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/meta\.kind must be "language" or "project"/);
});

test("invalid kind exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ kind: "workspace", docs: { description: "bad kind" } }`),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/meta\.kind must be "language" or "project"/);
});

test("language rule without languages exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ kind: "language", docs: { description: "no languages" } }`),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/requires a non-empty languages array/);
});

test("language rule whose languages miss config.languages exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(
      `{ kind: "language", languages: ["python"], docs: { description: "python only" } }`,
    ),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/do not intersect config\.languages/);
});

test("language rule for a language with no frontend exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(
      `{ kind: "language", languages: ["python"], docs: { description: "python only" } }`,
    ),
    "code-invariants.config.json": JSON.stringify({
      languages: ["python"],
      plugins: ["./plugin.mjs"],
      rules: { "fixture/ping": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/No frontend for python \(required by fixture\/ping\)/);
});

test("requires on a language rule exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(
      `{ kind: "language", languages: ["typescript"], requires: ["dupehound"], docs: { description: "bad requires" } }`,
    ),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/must not set requires/);
});

const fakeProviderPlugin = `let builds = 0;
export default {
  name: "fixture",
  provides: {
    fake: {
      async build(ctx) {
        builds += 1;
        return { builds, files: ctx.files, requiredBy: ctx.requiredBy };
      },
    },
  },
  rules: {
    alpha: {
      meta: { kind: "project", requires: ["fake"], docs: { description: "reads fake" } },
      create(context) {
        const art = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`alpha builds=\${art.builds} by=\${art.requiredBy.join(",")}\`,
          suggestion: "n/a",
        });
      },
    },
    beta: {
      meta: { kind: "project", requires: ["fake"], docs: { description: "reads fake too" } },
      create(context) {
        const art = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`beta builds=\${art.builds}\`,
          suggestion: "n/a",
        });
      },
    },
  },
};
`;

test("artifact provider builds once and exposes getArtifact", async () => {
  const dir = await writeTree({
    "plugin.mjs": fakeProviderPlugin,
    "code-invariants.config.json": config({
      "fixture/alpha": "error",
      "fixture/beta": "error",
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/alpha\s+alpha builds=1 by=fixture\/alpha,fixture\/beta/);
  expect(out).toMatch(/fixture\/beta\s+beta builds=1/);
});

test("missing provider exits 2 and names the rule", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(
      `{ kind: "project", requires: ["ghost"], docs: { description: "needs ghost" } }`,
    ),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/No plugin provides artifact "ghost"/);
  expect(errors.join("\n")).toMatch(/fixture\/ping/);
});

test("provider build throw exits 2 and names the rule", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: {
    fake: {
      build() {
        throw new Error("provider exploded");
      },
    },
  },
  rules: {
    ping: {
      meta: { kind: "project", requires: ["fake"], docs: { description: "needs fake" } },
      create() {},
    },
  },
};
`,
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/provider exploded/);
  expect(errors.join("\n")).toMatch(/fixture\/ping/);
});

test("duplicate artifact id exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { fake: { build() { return 1; } } },
  rules: {
    ping: {
      meta: { kind: "project", requires: ["fake"], docs: { description: "needs fake" } },
      create() {},
    },
  },
};
`,
    "other.mjs": `export default {
  name: "other",
  provides: { fake: { build() { return 2; } } },
  rules: {},
};
`,
    "code-invariants.config.json": JSON.stringify({
      languages: ["typescript"],
      plugins: ["./plugin.mjs", "./other.mjs"],
      rules: { "fixture/ping": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Artifact "fake" is provided by more than one plugin/);
});

test("getArtifact without require exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { fake: { build() { return { ok: true }; } } },
  rules: {
    listed: {
      meta: { kind: "project", docs: { description: "no require" } },
      create(context) {
        context.getArtifact("fake");
      },
    },
  },
};
`,
    "code-invariants.config.json": config({ "fixture/listed": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/getArtifact\("fake"\) requires meta.requires/);
});

test("mixed language and project rules both report", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({
      "fixture/unusedExport": "error",
      "fixture/workspacePing": "error",
    }),
    "src/a.ts": "export const x = 1;\n",
    "src/b.ts": "export const y = 2;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/unusedExport\s+export x is unused across files/);
  expect(out).toMatch(/fixture\/workspacePing\s+workspace ping/);
  expect(out).not.toMatch(/create invoked/);
});
