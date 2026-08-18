import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import {
  DUPEHOUND_ENV,
  filterClusters,
  loadStructuralIndex,
  parseScanReport,
  resolveDupehoundBinary,
} from "./structural-index.ts";

const emptyReport = JSON.stringify({ schema_version: 2, clusters: [] });

const sampleCluster = {
  id: 1,
  copies: 2,
  similarity: 0.94,
  test_only: false,
  members: [
    {
      file: "src/invoice.ts",
      name: "computeOrderTotal",
      start_line: 1,
      end_line: 20,
      lines: 20,
      similarity: 1,
      representative: true,
      test: false,
    },
    {
      file: "src/billing.ts",
      name: "calculateBillingTotal",
      start_line: 3,
      end_line: 22,
      lines: 20,
      similarity: 0.94,
      representative: false,
      test: false,
    },
  ],
};

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-index-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

async function writeStub(
  dir: string,
  stdout: string,
  exit = 0,
  name = "dupehound-stub.mjs",
): Promise<string> {
  const path = join(dir, name);
  await writeFile(
    path,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(stdout)});
process.stderr.write(${JSON.stringify(exit === 0 ? "" : "dupehound stub error")});
process.exit(${exit});
`,
    { mode: 0o755 },
  );
  return path;
}

test("parseScanReport accepts schema 1 and 2", () => {
  const v1 = parseScanReport(JSON.stringify({ schema_version: 1, clusters: [] }));
  const v2 = parseScanReport(JSON.stringify({ schema_version: 2, clusters: [sampleCluster] }));
  expect(v1.schemaVersion).toBe(1);
  expect(v1.clusters).toEqual([]);
  expect(v2.schemaVersion).toBe(2);
  expect(v2.clusters).toHaveLength(1);
  expect(v2.clusters[0]?.members[1]?.name).toBe("calculateBillingTotal");
});

test("parseScanReport rejects bad payloads", () => {
  expect(() => parseScanReport("not-json")).toThrow(/not JSON/);
  expect(() => parseScanReport(JSON.stringify({ schema_version: 3, clusters: [] }))).toThrow(
    /schema_version/,
  );
  expect(() => parseScanReport(JSON.stringify({ schema_version: 2 }))).toThrow(/clusters/);
});

test("filterClusters drops tests, trait impls, and members outside include", () => {
  const parsed = parseScanReport(
    JSON.stringify({
      schema_version: 2,
      clusters: [
        sampleCluster,
        { ...sampleCluster, id: 2, test_only: true },
        { ...sampleCluster, id: 3, trait_impl_only: true },
        {
          ...sampleCluster,
          id: 4,
          members: [{ ...sampleCluster.members[0], test: true }, sampleCluster.members[1]],
        },
      ],
    }),
  );
  const kept = filterClusters(parsed.clusters, ["src/invoice.ts", "src/billing.ts"]);
  expect(kept.map((c) => c.id)).toEqual([1]);
  const clipped = filterClusters(parsed.clusters, ["src/invoice.ts"]);
  expect(clipped).toEqual([]);
});

test("resolveDupehoundBinary fails closed when missing", () => {
  expect(() => resolveDupehoundBinary({ PATH: "/nonexistent" })).toThrow(/dupehound/i);
  expect(() =>
    resolveDupehoundBinary({ [DUPEHOUND_ENV]: "/no/such/dupehound", PATH: "/nonexistent" }),
  ).toThrow(/CODE_INVARIANTS_DUPEHOUND/);
});

test("loadStructuralIndex maps stub empty report", async () => {
  const dir = await writeTree({ "src/a.ts": "export const n = 1;\n" });
  const stub = await writeStub(dir, emptyReport);
  const index = await loadStructuralIndex({
    cwd: dir,
    exclude: ["**/node_modules/**"],
    includeFiles: ["src/a.ts"],
    requiredBy: ["dry/no-duplicate-functions"],
    env: { [DUPEHOUND_ENV]: stub, PATH: "" },
  });
  expect(index).toEqual({ kind: "structural", clusters: [] });
});

test("loadStructuralIndex maps stub cluster and post-filters", async () => {
  const dir = await writeTree({ "src/invoice.ts": "export const n = 1;\n" });
  const stub = await writeStub(
    dir,
    JSON.stringify({ schema_version: 2, clusters: [sampleCluster] }),
  );
  const index = await loadStructuralIndex({
    cwd: dir,
    exclude: [],
    includeFiles: ["src/invoice.ts", "src/billing.ts"],
    requiredBy: ["dry/no-duplicate-functions"],
    env: { [DUPEHOUND_ENV]: stub, PATH: "" },
  });
  expect(index.clusters).toHaveLength(1);
  expect(index.clusters[0]?.members.map((m) => m.name)).toEqual([
    "computeOrderTotal",
    "calculateBillingTotal",
  ]);
});

test("loadStructuralIndex fails closed on bad JSON and tool errors", async () => {
  const dir = await writeTree({ "src/a.ts": "export const n = 1;\n" });
  const bad = await writeStub(dir, "not-json");
  await expect(
    loadStructuralIndex({
      cwd: dir,
      exclude: [],
      includeFiles: ["src/a.ts"],
      requiredBy: ["dry/no-duplicate-functions"],
      env: { [DUPEHOUND_ENV]: bad, PATH: "" },
    }),
  ).rejects.toThrow(/invalid JSON|dupehound/i);

  const fail = await writeStub(dir, "", 2, "dupehound-fail.mjs");
  await expect(
    loadStructuralIndex({
      cwd: dir,
      exclude: [],
      includeFiles: ["src/a.ts"],
      requiredBy: ["dry/no-duplicate-functions"],
      env: { [DUPEHOUND_ENV]: fail, PATH: "" },
    }),
  ).rejects.toThrow(/dupehound failed|required by dry\/no-duplicate-functions/);
});

test("loadStructuralIndex treats no supported files as empty", async () => {
  const dir = await writeTree({ "src/a.ts": "export const n = 1;\n" });
  const path = join(dir, "empty-stub.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
process.stderr.write("no supported source files found under .\\n");
process.exit(2);
`,
    { mode: 0o755 },
  );
  const index = await loadStructuralIndex({
    cwd: dir,
    exclude: [],
    includeFiles: ["src/a.ts"],
    requiredBy: ["dry/no-duplicate-functions"],
    env: { [DUPEHOUND_ENV]: path, PATH: "" },
  });
  expect(index.clusters).toEqual([]);
});
