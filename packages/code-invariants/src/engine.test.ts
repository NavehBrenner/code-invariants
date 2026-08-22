import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { check } from "./engine.ts";

const silent = () => {};

const fixturePlugin = `let seen;
let creates = 0;
export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { requires: ["typescript"], docs: { description: "always reports" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        for (const [abs, source] of parsed.sources) {
          if (source == null || typeof source.getFullText !== "function") {
            throw new Error("getArtifact(typescript) did not return parsed sources");
          }
          context.report({
            severity: "error",
            file: abs,
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "ping",
          });
        }
      },
    },
    quiet: {
      meta: { requires: ["typescript"], docs: { description: "never reports" } },
      create() {},
    },
    first: {
      meta: { requires: ["typescript"], docs: { description: "records parsed project" } },
      create(context) {
        seen = context.getArtifact("typescript");
      },
    },
    second: {
      meta: { requires: ["typescript"], docs: { description: "checks same parsed project" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        if (parsed !== seen) {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "parsed more than once",
          });
        }
        if (parsed.project !== seen.project) {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "project not shared",
          });
        }
        if (parsed.sources !== seen.sources) {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "sources map not shared",
          });
        }
      },
    },
    unusedExport: {
      meta: { requires: ["typescript"], docs: { description: "export x unused across files" } },
      create(context) {
        creates += 1;
        const files = context.getFiles();
        const parsed = context.getArtifact("typescript");
        if (creates !== 1) {
          context.report({
            severity: "error",
            file: files[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`create invoked \${creates} times\`,
          });
        }
        if (parsed.sources.size !== 2) {
          context.report({
            severity: "error",
            file: files[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected 2 sources, got \${parsed.sources.size}\`,
          });
        }
        const texts = [];
        for (const [abs, source] of parsed.sources) {
          if (source == null || typeof source.getFullText !== "function") {
            throw new Error("getArtifact(typescript) did not return parsed sources");
          }
          texts.push({ filename: abs, text: source.getFullText() });
        }
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
      meta: { docs: { description: "always reports from workspace" } },
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
      meta: { docs: { description: "checks listed files" } },
      create(context) {
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
      meta: { docs: { description: "notes.txt must be listed" } },
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
    tsOnly: {
      meta: { requires: ["typescript"], docs: { description: "language provider skips non-TS" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        const files = context.getFiles();
        if (!files.includes("notes.txt") || !files.includes("src/hello.ts")) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected notes.txt and src/hello.ts in getFiles: \${files.join(",")}\`,
          });
        }
        if (parsed.sources.size !== 1) {
          context.report({
            severity: "error",
            file: "src/hello.ts",
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: \`expected 1 TS source, got \${parsed.sources.size}\`,
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
    plugins: ["./plugin.mjs"],
    rules,
    ...extra,
  });
}

test("unknown rule id exits 2", async () => {
  const dir = await writeTree({
    "code-invariants.config.json": JSON.stringify({
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
      meta: { requires: ["typescript"], docs: { description: "hint" } },
      create(context) {
        context.report({
          severity: "error",
          file: context.getFiles()[0],
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
});

test("getFiles lists workspace files", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config({ "fixture/listed": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/not listed/);
  expect(lines.join("\n")).not.toMatch(/getCwd missing/);
});

test("getFiles includes non-TS paths", async () => {
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

test("language provider skips non-TS paths", async () => {
  const dir = await writeTree({
    "plugin.mjs": fixturePlugin,
    "code-invariants.config.json": config(
      { "fixture/tsOnly": "error" },
      { include: ["**/*.ts", "**/*.txt"] },
    ),
    "src/hello.ts": "export const n = 1;\n",
    "notes.txt": "hello\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).not.toMatch(/expected notes\.txt/);
  expect(lines.join("\n")).not.toMatch(/expected 1 TS source/);
});

test("requires python with no provider exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ requires: ["python"], docs: { description: "needs python" } }`),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/No provider for artifact "python"/);
  expect(errors.join("\n")).toMatch(/fixture\/ping/);
  expect(errors.join("\n")).not.toMatch(/No frontend/);
  expect(errors.join("\n")).not.toMatch(/reserved/);
});

test("invalid requires exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": pluginWith(`{ requires: [""], docs: { description: "bad requires" } }`),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/invalid requires/);
});

const fakeProviderPlugin = `let builds = 0;
export default {
  name: "fixture",
  provides: {
    fake: {
      async build(context) {
        builds += 1;
        return { builds, files: context.files, requiredBy: context.requiredBy };
      },
    },
  },
  rules: {
    alpha: {
      meta: { requires: ["fake"], docs: { description: "reads fake" } },
      create(context) {
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`alpha builds=\${artifact.builds} by=\${artifact.requiredBy.join(",")}\`,
          suggestion: "n/a",
        });
      },
    },
    beta: {
      meta: { requires: ["fake"], docs: { description: "reads fake too" } },
      create(context) {
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`beta builds=\${artifact.builds}\`,
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
    "plugin.mjs": pluginWith(`{ requires: ["ghost"], docs: { description: "needs ghost" } }`),
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/No provider for artifact "ghost"/);
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
      meta: { requires: ["fake"], docs: { description: "needs fake" } },
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
      meta: { requires: ["fake"], docs: { description: "needs fake" } },
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
      plugins: ["./plugin.mjs", "./other.mjs"],
      rules: { "fixture/ping": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Artifact "fake" is provided by more than one owner/);
  expect(errors.join("\n")).toMatch(/fixture/);
  expect(errors.join("\n")).toMatch(/other/);
});

test("plugin provides.typescript overrides the default provider", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: {
    typescript: {
      build() {
        return { project: "plugin", sources: new Map() };
      },
    },
  },
  rules: {
    ping: {
      meta: { requires: ["typescript"], docs: { description: "needs ts" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        if (parsed.project !== "plugin") {
          context.report({
            severity: "error",
            file: context.getFiles()[0],
            range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
            message: "default provider was used",
          });
        }
      },
    },
  },
};
`,
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  const errors: string[] = [];
  expect(
    await check(
      dir,
      (m) => lines.push(String(m)),
      (m) => errors.push(String(m)),
    ),
  ).toBe(0);
  expect(lines.join("\n")).not.toMatch(/default provider was used/);
  expect(errors.join("\n")).not.toMatch(/more than one owner/);
});

test("ruleless plugin provides an artifact another plugin requires", async () => {
  const dir = await writeTree({
    "providers.mjs": `let builds = 0;
export default {
  name: "shared",
  provides: {
    graph: {
      build() {
        builds += 1;
        return { builds };
      },
    },
  },
};
`,
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { requires: ["graph"], docs: { description: "needs graph" } },
      create(context) {
        const artifact = context.getArtifact("graph");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`graph builds=\${artifact.builds}\`,
          suggestion: "n/a",
        });
      },
    },
    again: {
      meta: { requires: ["graph"], docs: { description: "needs graph too" } },
      create(context) {
        const artifact = context.getArtifact("graph");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`again builds=\${artifact.builds}\`,
          suggestion: "n/a",
        });
      },
    },
  },
};
`,
    "code-invariants.config.json": JSON.stringify({
      plugins: ["./providers.mjs", "./plugin.mjs"],
      rules: { "fixture/ping": "error", "fixture/again": "error" },
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/ping\s+graph builds=1/);
  expect(out).toMatch(/fixture\/again\s+again builds=1/);
});

test("getArtifact without require exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { fake: { build() { return { ok: true }; } } },
  rules: {
    listed: {
      meta: { docs: { description: "no require" } },
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

test("mixed language and plugin artifacts both report", async () => {
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

test("language and plugin artifacts in one run each build once", async () => {
  const dir = await writeTree({
    "plugin.mjs": `let fakeBuilds = 0;
export default {
  name: "fixture",
  provides: {
    fake: {
      build() {
        fakeBuilds += 1;
        return { fakeBuilds };
      },
    },
  },
  rules: {
    lang: {
      meta: { requires: ["typescript"], docs: { description: "reads ts" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`lang sources=\${parsed.sources.size}\`,
          suggestion: "n/a",
        });
      },
    },
    plug: {
      meta: { requires: ["fake"], docs: { description: "reads fake" } },
      create(context) {
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`plug builds=\${artifact.fakeBuilds}\`,
          suggestion: "n/a",
        });
      },
    },
    both: {
      meta: { requires: ["typescript", "fake"], docs: { description: "reads both" } },
      create(context) {
        const parsed = context.getArtifact("typescript");
        const artifact = context.getArtifact("fake");
        context.report({
          severity: "error",
          file: context.getFiles()[0],
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          message: \`both sources=\${parsed.sources.size} builds=\${artifact.fakeBuilds}\`,
          suggestion: "n/a",
        });
      },
    },
  },
};
`,
    "code-invariants.config.json": config({
      "fixture/lang": "error",
      "fixture/plug": "error",
      "fixture/both": "error",
    }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(1);
  const out = lines.join("\n");
  expect(out).toMatch(/fixture\/lang\s+lang sources=1/);
  expect(out).toMatch(/fixture\/plug\s+plug builds=1/);
  expect(out).toMatch(/fixture\/both\s+both sources=1 builds=1/);
});

test("module export without name is not a plugin", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default { rules: {} };
`,
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/does not export a Plugin/);
});

test("empty artifact id exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { "": { build() {} } },
  rules: {
    ping: {
      meta: { docs: { description: "ping" } },
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
  expect(errors.join("\n")).toMatch(/empty artifact id/);
});

test("provider without build exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  provides: { fake: {} },
  rules: {
    ping: {
      meta: { docs: { description: "ping" } },
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
  expect(errors.join("\n")).toMatch(/without a build function/);
});

test("rule missing create exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { docs: { description: "ping" } },
    },
  },
};
`,
    "code-invariants.config.json": config({ "fixture/ping": "error" }),
    "src/hello.ts": "export const n = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(
    /Rule "fixture\/ping" is invalid: must have meta.docs.description and a create function/,
  );
});

test("rule missing docs description exits 2", async () => {
  const dir = await writeTree({
    "plugin.mjs": `export default {
  name: "fixture",
  rules: {
    ping: {
      meta: { docs: {} },
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
  expect(errors.join("\n")).toMatch(
    /Rule "fixture\/ping" is invalid: must have meta.docs.description and a create function/,
  );
});
