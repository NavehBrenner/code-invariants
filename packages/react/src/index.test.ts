import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../code-invariants/src/engine.ts";
import { NO_SUGGESTION } from "../../code-invariants/src/index.ts";
import plugin from "./index.ts";

const silent = () => {};
const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const reactDist = join(here, "../dist/index.js");
const tsDist = join(here, "../../typescript/dist/index.js");

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
  const dir = await mkdtemp(join(tmpdir(), "ci-react-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

test("plugin exports name, rules, and recommended", () => {
  expect(plugin.name).toBe("react");
  expect(plugin.rules?.["no-fetch-in-useeffect"]).toBeDefined();
  expect(plugin.rules?.["query-error-handled"]).toBeDefined();
  expect(plugin.configs?.recommended?.rules?.["react/no-fetch-in-useeffect"]).toBe("error");
  expect(plugin.configs?.recommended?.rules?.["react/query-error-handled"]).toBe("error");
});

test("multi-plugin run attributes ts/ and react/ violations with suggestions", async () => {
  const result = await runFixture("multi-plugin");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/widget\.ts:\d+:\d+\s+error\s+react\/no-fetch-in-useeffect\s+Do not call fetch inside useEffect or useLayoutEffect/,
  );
  expect(result.out).toMatch(/suggestion: Load this data with TanStack Query/);
  expect(result.out).toMatch(
    /src\/widget\.ts:\d+:\d+\s+error\s+react\/query-error-handled\s+useQuery error is unhandled/,
  );
  expect(result.out).toMatch(/suggestion: Branch on isError/);
  expect(result.out).toMatch(
    /src\/widget\.ts:\d+:\d+\s+error\s+ts\/public-exports-tested\s+Public export "Widget"/,
  );
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("unknown rule id with react plugin loaded exits 2 naming the id", async () => {
  const dir = await writeTree({
    "code-invariants.config.json": JSON.stringify({
      plugins: [reactDist],
      rules: { "react/no-such-rule": "error" },
    }),
    "src/a.ts": "export const a = 1;\n",
  });
  const errors: string[] = [];
  expect(await check(dir, silent, (m) => errors.push(String(m)))).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown rule id: react\/no-such-rule/);
});

test("loading both plugins without enabling rules is an empty path", async () => {
  const dir = await writeTree({
    "code-invariants.config.json": JSON.stringify({
      plugins: [tsDist, reactDist],
      rules: {},
    }),
    "src/a.ts": "export const a = 1;\n",
  });
  const lines: string[] = [];
  expect(await check(dir, (m) => lines.push(String(m)), silent)).toBe(0);
  expect(lines.join("\n")).toMatch(/No rules configured — nothing to check/);
});
