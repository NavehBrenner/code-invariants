import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../qualety/src/engine.ts";
import { NO_SUGGESTION } from "../../qualety/src/index.ts";

const silent = () => {};
const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "../fixtures");
const reactDist = join(here, "../dist/index.js");

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
  const dir = await mkdtemp(join(tmpdir(), "ci-react-query-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

function enabledConfig() {
  return JSON.stringify({
    plugins: [reactDist],
    rules: { "react/query-error-handled": "error" },
  });
}

async function runSource(src: string) {
  const dir = await writeTree({
    "qualety.config.json": enabledConfig(),
    "src/comp.ts": src,
  });
  const lines: string[] = [];
  const code = await check(dir, (m) => lines.push(String(m)), silent);
  return { code, out: lines.join("\n") };
}

test("unhandled useQuery exits 1 with concrete suggestion", async () => {
  const result = await runFixture("query-unhandled");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/comp\.ts:\d+:\d+\s+error\s+react\/query-error-handled\s+useQuery error is unhandled/,
  );
  expect(result.out).toMatch(/suggestion: Branch on isError/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("isError branch is valid", async () => {
  const result = await runFixture("query-iserror");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
});

test("throwOnError true is valid", async () => {
  const result = await runFixture("query-throw-on-error");
  expect(result.code).toBe(0);
});

test("useSuspenseQuery is not flagged", async () => {
  const result = await runFixture("suspense-query-clean");
  expect(result.code).toBe(0);
});

test("error identifier branch is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const { data, error } = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  if (error) {
    return null;
  }
  return data;
}
`);
  expect(result.code).toBe(0);
});

test("status === error branch is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const { data, status } = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  if (status === "error") {
    return null;
  }
  return data;
}
`);
  expect(result.code).toBe(0);
});

test("status === 'error' single quotes is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  return q.status === 'error' ? null : q.data;
}
`);
  expect(result.code).toBe(0);
});

test("result.isError and && branch are valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const result = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  return result.isError && null;
}
`);
  expect(result.code).toBe(0);
});

test("throwOnError function form is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery({
    queryKey: ["x"],
    queryFn: () => 1,
    throwOnError: () => true,
  });
  return q.data;
}
`);
  expect(result.code).toBe(0);
});

test("v4 second-arg throwOnError is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery(["x"], { throwOnError: true });
  return q.data;
}
`);
  expect(result.code).toBe(0);
});

test("useInfiniteQuery unhandled is invalid", async () => {
  const result = await runSource(`import { useInfiniteQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useInfiniteQuery({ queryKey: ["x"], queryFn: () => 1 });
  return q.data;
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/useInfiniteQuery error is unhandled/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("useSuspenseInfiniteQuery is not flagged", async () => {
  const result = await runSource(`import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useSuspenseInfiniteQuery({ queryKey: ["x"], queryFn: () => 1 });
  return q.data;
}
`);
  expect(result.code).toBe(0);
});

test("non-TanStack file is clean", async () => {
  const result = await runSource(`export function useQuery() {
  return { data: 1 };
}
export function Comp() {
  return useQuery();
}
`);
  expect(result.code).toBe(0);
});

test("destructure without branch is invalid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const { data, isError, error } = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  void isError;
  void error;
  return data;
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/useQuery error is unhandled/);
});

test("namespace TQ.useQuery unhandled is invalid", async () => {
  const result = await runSource(`import * as TQ from "@tanstack/react-query";
export function Comp() {
  const q = TQ.useQuery({ queryKey: ["x"], queryFn: () => 1 });
  return q.data;
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/useQuery error is unhandled/);
});

test("throwOnError identifier is not compliance", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
const throwOnError = true;
export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1, throwOnError });
  return q.data;
}
`);
  expect(result.code).toBe(1);
});

test("throwOnError false is invalid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1, throwOnError: false });
  return q.data;
}
`);
  expect(result.code).toBe(1);
});

test("unrelated isError in condition is invalid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const isError = true;
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  if (isError) {
    return null;
  }
  return q.data;
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/useQuery error is unhandled/);
});

test("unrelated error in condition is invalid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const error = new Error("nope");
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  if (error) {
    return null;
  }
  return q.data;
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/useQuery error is unhandled/);
});

test("two queries only one handled is invalid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const a = useQuery({ queryKey: ["a"], queryFn: () => 1 });
  const b = useQuery({ queryKey: ["b"], queryFn: () => 2 });
  if (a.isError) {
    return null;
  }
  return b.data;
}
`);
  expect(result.code).toBe(1);
  expect(result.out.match(/useQuery error is unhandled/g)?.length).toBe(1);
});

test("destructure isError rename is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const { data, isError: failed } = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  if (failed) {
    return null;
  }
  return data;
}
`);
  expect(result.code).toBe(0);
});

test("q.isError branch is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  if (q.isError) {
    return null;
  }
  return q.data;
}
`);
  expect(result.code).toBe(0);
});

test("local isError alias is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  const failed = q.isError;
  if (failed) {
    return null;
  }
  return q.data;
}
`);
  expect(result.code).toBe(0);
});

test("local status alias is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  const s = q.status;
  if (s === "error") {
    return null;
  }
  return q.data;
}
`);
  expect(result.code).toBe(0);
});

test("nested function isError check is not compliance", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  function inner() {
    if (q.isError) {
      return null;
    }
  }
  void inner;
  return q.data;
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/useQuery error is unhandled/);
});
