import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../code-invariants/src/engine.ts";
import { NO_SUGGESTION } from "../../code-invariants/src/index.ts";
import { resolveDupehoundBinary } from "../../code-invariants/src/structural-index.ts";
import { reportsFromIndex } from "./no-duplicate-functions.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");

const canned = {
  kind: "structural" as const,
  clusters: [
    {
      id: 1,
      similarity: 0.94,
      testOnly: false,
      members: [
        {
          file: "src/invoice.ts",
          name: "computeOrderTotal",
          startLine: 1,
          endLine: 20,
          representative: true,
          test: false,
        },
        {
          file: "src/billing.ts",
          name: "calculateBillingTotal",
          startLine: 3,
          endLine: 22,
          representative: false,
          test: false,
        },
      ],
    },
  ],
};

const cannedReport = {
  schema_version: 2,
  clusters: [
    {
      id: 1,
      similarity: 0.94,
      test_only: false,
      members: [
        {
          file: "src/invoice.ts",
          name: "computeOrderTotal",
          start_line: 1,
          end_line: 20,
          representative: true,
          test: false,
        },
        {
          file: "src/billing.ts",
          name: "calculateBillingTotal",
          start_line: 3,
          end_line: 22,
          representative: false,
          test: false,
        },
      ],
    },
  ],
};

async function writeStub(dir: string, report: unknown): Promise<string> {
  const path = join(dir, "dupehound-stub.mjs");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(JSON.stringify(report))});
`,
    { mode: 0o755 },
  );
  return path;
}

async function runFixture(name: string, report: unknown) {
  const stubDir = await mkdtemp(join(tmpdir(), "ci-dry-stub-"));
  const stub = await writeStub(stubDir, report);
  const prevBin = process.env.CODE_INVARIANTS_DUPEHOUND;
  const lines: string[] = [];
  const errors: string[] = [];
  try {
    process.env.CODE_INVARIANTS_DUPEHOUND = stub;
    const code = await check(
      join(fixtures, name),
      (m) => lines.push(String(m)),
      (m) => errors.push(String(m)),
    );
    return { code, out: lines.join("\n"), err: errors.join("\n") };
  } finally {
    if (prevBin === undefined) {
      delete process.env.CODE_INVARIANTS_DUPEHOUND;
    } else {
      process.env.CODE_INVARIANTS_DUPEHOUND = prevBin;
    }
  }
}

function hasRealDupehound(): boolean {
  try {
    resolveDupehoundBinary({ PATH: process.env.PATH });
    return true;
  } catch {
    return false;
  }
}

test("reportsFromIndex maps a cluster to a concrete suggestion", () => {
  const reports = reportsFromIndex(canned);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.file).toBe("src/billing.ts");
  expect(reports[0]?.message).toMatch(
    /"calculateBillingTotal" is a structural duplicate of "computeOrderTotal"/,
  );
  expect(reports[0]?.suggestion).toMatch(/Reuse "computeOrderTotal" from src\/invoice\.ts:1/);
  expect(reports[0]?.suggestion).not.toBe(NO_SUGGESTION);
  expect(reports[0]?.range.start).toEqual({ line: 3, column: 1 });
});

test("duplicate pair exits 1 with concrete suggestion", async () => {
  const result = await runFixture("duplicate-pair", cannedReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/billing\.ts:3:1\s+error\s+dry\/no-duplicate-functions\s+"calculateBillingTotal" is a structural duplicate/,
  );
  expect(result.out).toMatch(/suggestion: Reuse "computeOrderTotal"/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("unique functions exit 0", async () => {
  const result = await runFixture("unique", { schema_version: 2, clusters: [] });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-functions/);
});

test("tests are excluded", async () => {
  const result = await runFixture("tests-excluded", {
    schema_version: 2,
    clusters: [
      {
        ...cannedReport.clusters[0],
        test_only: true,
        members: cannedReport.clusters[0]?.members.map((m) => ({
          ...m,
          file: m.file.replace("src/", "src/").replace(".ts", ".test.ts"),
          test: true,
        })),
      },
    ],
  });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-functions/);
});

test("generated files are excluded", async () => {
  const result = await runFixture("generated-excluded", { schema_version: 2, clusters: [] });
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/dry\/no-duplicate-functions/);
});

test("warn severity prints warn and still exits 1", async () => {
  const result = await runFixture("warn-severity", cannedReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/\swarn\s+dry\/no-duplicate-functions\s+/);
  expect(result.out).not.toMatch(/\serror\s+dry\/no-duplicate-functions\s+/);
});

test("multi-plugin run attributes ts/, react/, and dry/ without cross-talk", async () => {
  const result = await runFixture("multi-plugin", cannedReport);
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/react\/no-fetch-in-useeffect/);
  expect(result.out).toMatch(/react\/query-error-handled/);
  expect(result.out).toMatch(/ts\/public-exports-tested/);
  expect(result.out).toMatch(/dry\/no-duplicate-functions/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test.skipIf(!hasRealDupehound())(
  "live dupehound scan flags duplicate-pair and not unique",
  async () => {
    const prevBin = process.env.CODE_INVARIANTS_DUPEHOUND;
    try {
      delete process.env.CODE_INVARIANTS_DUPEHOUND;
      const dupLines: string[] = [];
      const dupErr: string[] = [];
      const dup = await check(
        join(fixtures, "duplicate-pair"),
        (m) => dupLines.push(String(m)),
        (m) => dupErr.push(String(m)),
      );
      expect(dupErr.join("\n")).toBe("");
      expect(dup).toBe(1);
      expect(dupLines.join("\n")).toMatch(/dry\/no-duplicate-functions/);
      expect(dupLines.join("\n")).toMatch(/suggestion: Reuse/);

      const uniqLines: string[] = [];
      const uniqErr: string[] = [];
      const uniq = await check(
        join(fixtures, "unique"),
        (m) => uniqLines.push(String(m)),
        (m) => uniqErr.push(String(m)),
      );
      expect(uniqErr.join("\n")).toBe("");
      expect(uniq).toBe(0);
      expect(uniqLines.join("\n")).not.toMatch(/dry\/no-duplicate-functions/);
    } finally {
      if (prevBin === undefined) {
        delete process.env.CODE_INVARIANTS_DUPEHOUND;
      } else {
        process.env.CODE_INVARIANTS_DUPEHOUND = prevBin;
      }
    }
  },
);
