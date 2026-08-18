import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { check } from "../../code-invariants/src/engine.ts";
import { NO_SUGGESTION } from "../../code-invariants/src/index.ts";

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
  const dir = await mkdtemp(join(tmpdir(), "ci-react-fetch-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  return dir;
}

function enabledConfig() {
  return JSON.stringify({
    languages: ["typescript"],
    plugins: [reactDist],
    rules: { "react/no-fetch-in-useeffect": "error" },
  });
}

async function runSource(src: string) {
  const dir = await writeTree({
    "code-invariants.config.json": enabledConfig(),
    "src/comp.ts": src,
  });
  const lines: string[] = [];
  const code = await check(dir, (m) => lines.push(String(m)), silent);
  return { code, out: lines.join("\n") };
}

test("fetch in useEffect exits 1 with concrete suggestion", async () => {
  const result = await runFixture("fetch-in-useeffect");
  expect(result.err).toBe("");
  expect(result.code).toBe(1);
  expect(result.out).toMatch(
    /src\/comp\.ts:\d+:\d+\s+error\s+react\/no-fetch-in-useeffect\s+Do not call fetch inside useEffect or useLayoutEffect/,
  );
  expect(result.out).toMatch(/suggestion: Load this data with TanStack Query/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("effect without HTTP exits 0", async () => {
  const result = await runFixture("effect-without-http");
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).not.toMatch(/react\/no-fetch-in-useeffect/);
});

test("fetch in useLayoutEffect is invalid", async () => {
  const result = await runSource(`import { useLayoutEffect } from "react";
export function Comp() {
  useLayoutEffect(() => {
    fetch("/api");
  }, []);
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Do not call fetch/);
  expect(result.out).not.toMatch(NO_SUGGESTION);
});

test("React.useEffect fetch is invalid", async () => {
  const result = await runSource(`import React from "react";
export function Comp() {
  React.useEffect(() => {
    fetch("/api");
  }, []);
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Do not call fetch/);
});

test("namespace React.useEffect fetch is invalid", async () => {
  const result = await runSource(`import * as React from "react";
export function Comp() {
  React.useEffect(() => {
    fetch("/api");
  }, []);
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Do not call fetch/);
});

test("axios in effect is invalid", async () => {
  const result = await runSource(`import { useEffect } from "react";
import axios from "axios";
export function Comp() {
  useEffect(() => {
    axios("/api");
  }, []);
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Do not call axios inside useEffect or useLayoutEffect/);
});

test("ky and got in effect are invalid", async () => {
  const ky = await runSource(`import { useEffect } from "react";
import ky from "ky";
export function Comp() {
  useEffect(() => {
    ky("/api");
  }, []);
}
`);
  expect(ky.code).toBe(1);
  expect(ky.out).toMatch(/Do not call ky /);
  const got = await runSource(`import { useEffect } from "react";
import got from "got";
export function Comp() {
  useEffect(() => {
    got("/api");
  }, []);
}
`);
  expect(got.code).toBe(1);
  expect(got.out).toMatch(/Do not call got /);
});

test("axios.get in effect is invalid", async () => {
  const result = await runSource(`import { useEffect } from "react";
import axios from "axios";
export function Comp() {
  useEffect(() => {
    axios.get("/api");
  }, []);
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Do not call axios\.get inside useEffect or useLayoutEffect/);
});

test("fetch in if/try inside effect is invalid", async () => {
  const result = await runSource(`import { useEffect } from "react";
export function Comp() {
  useEffect(() => {
    if (true) {
      try {
        fetch("/api");
      } catch {}
    }
  }, []);
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Do not call fetch/);
});

test("fetch in IIFE inside effect is invalid", async () => {
  const result = await runSource(`import { useEffect } from "react";
export function Comp() {
  useEffect(() => {
    (() => {
      fetch("/api");
    })();
  }, []);
}
`);
  expect(result.code).toBe(1);
  expect(result.out).toMatch(/Do not call fetch/);
});

test("useQuery outside effect is valid", async () => {
  const result = await runSource(`import { useQuery } from "@tanstack/react-query";
export function Comp() {
  return useQuery({ queryKey: ["x"], queryFn: () => fetch("/x") });
}
`);
  expect(result.code).toBe(0);
});

test("fetch in onClick is valid", async () => {
  const result = await runSource(`import { useEffect } from "react";
export function Comp() {
  useEffect(() => {}, []);
  function onClick() {
    fetch("/api");
  }
  return onClick;
}
`);
  expect(result.code).toBe(0);
});

test("fetch in nested non-IIFE function inside effect is valid", async () => {
  const result = await runSource(`import { useEffect } from "react";
export function Comp() {
  useEffect(() => {
    function onClick() {
      fetch("/api");
    }
    const handler = () => {
      fetch("/other");
    };
    void onClick;
    void handler;
  }, []);
}
`);
  expect(result.code).toBe(0);
});

test("axios outside effect is valid", async () => {
  const result = await runSource(`import { useEffect } from "react";
import axios from "axios";
export function Comp() {
  useEffect(() => {}, []);
  return axios.get("/api");
}
`);
  expect(result.code).toBe(0);
});

test("identifier callback is a known miss", async () => {
  const result = await runSource(`import { useEffect } from "react";
function load() {
  fetch("/api");
}
export function Comp() {
  useEffect(load, []);
}
`);
  expect(result.code).toBe(0);
});

test("local useEffect is not flagged", async () => {
  const result = await runSource(`function useEffect(cb: () => void) {
  cb();
}
export function Comp() {
  useEffect(() => {
    fetch("/api");
  });
}
`);
  expect(result.code).toBe(0);
});
