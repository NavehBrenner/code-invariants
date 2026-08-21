import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { run } from "./cli.ts";

const silent = () => {};

async function writeTree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ci-cli-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

test("check with no rules exits 0 and is honest", async () => {
  const dir = await writeTree({});
  const lines: string[] = [];
  expect(await run(["check"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("check with empty rules object is honest", async () => {
  const dir = await writeTree({
    "code-invariants.config.json": JSON.stringify({
      plugins: [],
      rules: {},
    }),
  });
  const lines: string[] = [];
  expect(await run(["check"], (m) => lines.push(String(m)), silent, dir)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});

test("--help exits 0", async () => {
  expect(await run(["--help"], silent, silent)).toBe(0);
});

test("unknown flag exits 2", async () => {
  expect(await run(["check", "--nope"], silent, silent)).toBe(2);
});

test("does not accept-and-ignore --plugin", async () => {
  expect(await run(["check", "--plugin", "react"], silent, silent)).toBe(2);
});

test("unknown command exits 2", async () => {
  expect(await run(["frobnicate"], silent, silent)).toBe(2);
});

test("no arguments exits 2", async () => {
  expect(await run([], silent, silent)).toBe(2);
});
