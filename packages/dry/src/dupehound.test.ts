import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import {
  buildDupehoundIndex,
  DUPEHOUND_ENV,
  filterClusters,
  parseScanReport,
  resolveDupehoundBinary,
} from "./dupehound.ts";

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
  const dir = await mkdtemp(join(tmpdir(), "ci-dupehound-"));
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

function loadOpts(
  dir: string,
  stub: string,
  files: readonly string[],
): Parameters<typeof buildDupehoundIndex>[0] {
  return {
    cwd: dir,
    files,
    exclude: [],
    requiredBy: ["dry/no-duplicate-functions"],
    env: { [DUPEHOUND_ENV]: stub, PATH: "" },
  };
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

test("filterClusters promotes a new representative when the original is dropped", () => {
  const parsed = parseScanReport(
    JSON.stringify({
      schema_version: 2,
      clusters: [
        {
          id: 9,
          similarity: 0.91,
          test_only: false,
          members: [
            {
              file: "src/dropped.ts",
              name: "original",
              start_line: 1,
              end_line: 10,
              representative: true,
              test: false,
            },
            {
              file: "src/invoice.ts",
              name: "keptA",
              start_line: 2,
              end_line: 12,
              representative: false,
              test: false,
            },
            {
              file: "src/billing.ts",
              name: "keptB",
              start_line: 3,
              end_line: 13,
              representative: false,
              test: false,
            },
          ],
        },
      ],
    }),
  );
  const kept = filterClusters(parsed.clusters, ["src/invoice.ts", "src/billing.ts"]);
  expect(kept).toHaveLength(1);
  expect(kept[0]?.members.map((m) => m.name)).toEqual(["keptA", "keptB"]);
  expect(kept[0]?.members[0]?.representative).toBe(true);
  expect(kept[0]?.members[1]?.representative).toBe(false);
});

test("resolveDupehoundBinary fails closed when missing", () => {
  expect(() => resolveDupehoundBinary({ PATH: "/nonexistent" })).toThrow(/dupehound/i);
  expect(() =>
    resolveDupehoundBinary({ [DUPEHOUND_ENV]: "/no/such/dupehound", PATH: "/nonexistent" }),
  ).toThrow(/QUALETY_DUPEHOUND/);
});

test("buildDupehoundIndex maps stub empty report", async () => {
  const dir = await writeTree({ "src/a.ts": "export const n = 1;\n" });
  const stub = await writeStub(dir, emptyReport);
  const index = await buildDupehoundIndex(loadOpts(dir, stub, ["src/a.ts"]));
  expect(index).toEqual({ clusters: [] });
});

test("buildDupehoundIndex maps stub cluster and post-filters", async () => {
  const dir = await writeTree({ "src/invoice.ts": "export const n = 1;\n" });
  const stub = await writeStub(
    dir,
    JSON.stringify({ schema_version: 2, clusters: [sampleCluster] }),
  );
  const index = await buildDupehoundIndex(
    loadOpts(dir, stub, ["src/invoice.ts", "src/billing.ts"]),
  );
  expect(index.clusters).toHaveLength(1);
  expect(index.clusters[0]?.members.map((m) => m.name)).toEqual([
    "computeOrderTotal",
    "calculateBillingTotal",
  ]);
});

test("buildDupehoundIndex fails closed on bad JSON and tool errors", async () => {
  const dir = await writeTree({ "src/a.ts": "export const n = 1;\n" });
  const bad = await writeStub(dir, "not-json");
  await expect(buildDupehoundIndex(loadOpts(dir, bad, ["src/a.ts"]))).rejects.toThrow(
    /invalid JSON|dupehound/i,
  );

  const fail = await writeStub(dir, "", 2, "dupehound-fail.mjs");
  await expect(buildDupehoundIndex(loadOpts(dir, fail, ["src/a.ts"]))).rejects.toThrow(
    /dupehound failed|required by dry\/no-duplicate-functions/,
  );
});

test("buildDupehoundIndex treats no supported files as empty", async () => {
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
  const index = await buildDupehoundIndex(loadOpts(dir, path, ["src/a.ts"]));
  expect(index.clusters).toEqual([]);
});

test("buildDupehoundIndex fails closed on timeout", async () => {
  const dir = await writeTree({ "src/a.ts": "export const n = 1;\n" });
  const path = join(dir, "hang-stub.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
setInterval(() => {}, 1 << 30);
`,
    { mode: 0o755 },
  );
  await expect(
    buildDupehoundIndex({ ...loadOpts(dir, path, ["src/a.ts"]), timeoutMs: 200 }),
  ).rejects.toThrow(/timed out|required by dry\/no-duplicate-functions/);
});

test("buildDupehoundIndex fails closed when the binary is missing", async () => {
  const dir = await writeTree({ "src/a.ts": "export const n = 1;\n" });
  await expect(
    buildDupehoundIndex({
      cwd: dir,
      files: ["src/a.ts"],
      exclude: [],
      requiredBy: ["dry/no-duplicate-functions"],
      env: { PATH: "/nonexistent" },
    }),
  ).rejects.toThrow(/dupehound is not installed|dry\/no-duplicate-functions/);
});
