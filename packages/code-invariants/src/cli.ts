#!/usr/bin/env node
import { parseArgs } from "node:util";
import { check } from "./engine.ts";

const USAGE = `code-invariants — executable code invariants

Usage:
  code-invariants check [options]

Options:
  -h, --help  Show this help

Exit codes: 0 clean, 1 violations found, 2 usage or internal error.`;

/**
 * Returns the process exit code. Kept pure (no `process.exit`) so it is
 * testable without spawning a subprocess.
 *
 * ponytail: only `check` exists so far. --plugin/--rule/--diff land with the
 * engine that actually honours them, so an accepted-but-ignored flag can never
 * make CI look green when it did nothing.
 */
export async function run(
  argv: string[],
  out = console.log,
  err = console.error,
  cwd = process.cwd(),
): Promise<number> {
  let positionals: string[];
  let values: { help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h" } },
      allowPositionals: true,
    }));
  } catch (e) {
    err(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (values.help || positionals.length === 0) {
    out(USAGE);
    return values.help ? 0 : 2;
  }

  const [command, ...rest] = positionals;
  if (command !== "check" || rest.length > 0) {
    err(`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`);
    return 2;
  }

  return check(cwd, out, err);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exitCode = await run(process.argv.slice(2));
}
