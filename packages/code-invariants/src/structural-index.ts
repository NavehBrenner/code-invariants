import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { StructuralCloneCluster, StructuralCloneMember, StructuralIndex } from "./index.ts";

export const DUPEHOUND_PIN = "v0.1.2";
export const DUPEHOUND_ENV = "CODE_INVARIANTS_DUPEHOUND";
export const SCAN_TIMEOUT_MS = 60_000;

const ACCEPTED_SCHEMA_VERSIONS = new Set([1, 2]);

export class IndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexError";
  }
}

export type LoadStructuralIndexOptions = {
  cwd: string;
  exclude: readonly string[];
  includeFiles: readonly string[];
  requiredBy: readonly string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

type RawMember = {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  similarity: number;
  representative: boolean;
  test: boolean;
};

type RawCluster = {
  id: number;
  similarity: number;
  testOnly: boolean;
  traitImplOnly: boolean;
  members: RawMember[];
};

export type ParsedScanReport = {
  schemaVersion: number;
  clusters: RawCluster[];
};

export function resolveDupehoundBinary(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  const override = env[DUPEHOUND_ENV]?.trim();
  if (override !== undefined && override.length > 0) {
    if (override.includes("/") || override.includes("\\") || isAbsolute(override)) {
      const path = isAbsolute(override) ? override : join(cwd, override);
      assertRunnable(path, override);
      return path;
    }
    const found = findOnPath(override, env.PATH ?? "");
    if (found === undefined) {
      throw new IndexError(
        `${DUPEHOUND_ENV} is set to "${override}" but that command is not on PATH.`,
      );
    }
    return found;
  }
  const found = findOnPath("dupehound", env.PATH ?? "");
  if (found === undefined) {
    throw new IndexError(missingBinaryMessage([]));
  }
  return found;
}

export async function loadStructuralIndex(
  options: LoadStructuralIndexOptions,
): Promise<StructuralIndex> {
  const requiredBy = options.requiredBy;
  const env = options.env ?? process.env;
  let bin: string;
  try {
    bin = resolveDupehoundBinary(env, options.cwd);
  } catch (e) {
    throw wrapMissing(e, requiredBy);
  }

  const args = ["scan", "--json", "--exclude-tests"];
  for (const glob of options.exclude) {
    args.push("--exclude", glob);
  }
  args.push(".");

  const timeoutMs = options.timeoutMs ?? SCAN_TIMEOUT_MS;
  const result = await runCommand(bin, args, options.cwd, timeoutMs);
  if (result.timedOut) {
    throw new IndexError(
      `dupehound timed out after ${timeoutMs / 1000}s (required by ${byLabel(requiredBy)}).`,
    );
  }
  if (result.error !== undefined) {
    throw new IndexError(
      `dupehound is not runnable (required by ${byLabel(requiredBy)}): ${result.error}`,
    );
  }
  if (result.code !== 0) {
    const text = `${result.stdout}\n${result.stderr}`;
    if (/no supported source files/i.test(text)) {
      return { kind: "structural", clusters: [] };
    }
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new IndexError(`dupehound failed (required by ${byLabel(requiredBy)}): ${detail}`);
  }

  let parsed: ParsedScanReport;
  try {
    parsed = parseScanReport(result.stdout);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new IndexError(
      `dupehound produced invalid JSON (required by ${byLabel(requiredBy)}): ${detail}`,
    );
  }
  return { kind: "structural", clusters: filterClusters(parsed.clusters, options.includeFiles) };
}

export function parseScanReport(raw: string): ParsedScanReport {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    throw new IndexError("stdout is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new IndexError("JSON root must be an object");
  }
  const rec = value as Record<string, unknown>;
  const schemaVersion = rec.schema_version;
  if (typeof schemaVersion !== "number" || !ACCEPTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    throw new IndexError(
      `unsupported schema_version ${JSON.stringify(schemaVersion)}; expected 1 or 2`,
    );
  }
  if (!Array.isArray(rec.clusters)) {
    throw new IndexError("missing clusters array");
  }
  return {
    schemaVersion,
    clusters: rec.clusters.map((cluster, i) => parseCluster(cluster, i)),
  };
}

export function filterClusters(
  clusters: readonly RawCluster[],
  includeFiles: readonly string[],
): StructuralCloneCluster[] {
  const include = new Set(includeFiles.map(normalizeDisplay));
  const out: StructuralCloneCluster[] = [];
  for (const cluster of clusters) {
    if (cluster.testOnly || cluster.traitImplOnly) {
      continue;
    }
    const members = cluster.members
      .filter((member) => !member.test && include.has(normalizeDisplay(member.file)))
      .map(toMember);
    if (members.length < 2) {
      continue;
    }
    if (!members.some((member) => member.representative)) {
      const first = members[0];
      if (first !== undefined) {
        first.representative = true;
      }
    }
    out.push({
      id: cluster.id,
      similarity: cluster.similarity,
      testOnly: false,
      members,
    });
  }
  return out;
}

function parseCluster(value: unknown, index: number): RawCluster {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new IndexError(`clusters[${index}] must be an object`);
  }
  const rec = value as Record<string, unknown>;
  if (!Array.isArray(rec.members)) {
    throw new IndexError(`clusters[${index}] missing members array`);
  }
  const members = rec.members.map((member, i) => parseMember(member, index, i));
  return {
    id: asFiniteNumber(rec.id, `clusters[${index}].id`, index + 1),
    similarity: asFiniteNumber(rec.similarity, `clusters[${index}].similarity`, 1),
    testOnly: rec.test_only === true,
    traitImplOnly: rec.trait_impl_only === true,
    members,
  };
}

function parseMember(value: unknown, cluster: number, index: number): RawMember {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new IndexError(`clusters[${cluster}].members[${index}] must be an object`);
  }
  const rec = value as Record<string, unknown>;
  const prefix = `clusters[${cluster}].members[${index}]`;
  if (typeof rec.file !== "string" || rec.file.length === 0) {
    throw new IndexError(`${prefix}.file must be a string`);
  }
  if (typeof rec.name !== "string") {
    throw new IndexError(`${prefix}.name must be a string`);
  }
  return {
    file: rec.file,
    name: rec.name,
    startLine: asFiniteNumber(rec.start_line, `${prefix}.start_line`, 1),
    endLine: asFiniteNumber(rec.end_line, `${prefix}.end_line`, 1),
    similarity: asFiniteNumber(rec.similarity, `${prefix}.similarity`, 1),
    representative: rec.representative === true,
    test: rec.test === true,
  };
}

function toMember(member: RawMember): StructuralCloneMember {
  return {
    file: normalizeDisplay(member.file),
    name: member.name,
    startLine: member.startLine,
    endLine: member.endLine,
    representative: member.representative,
    test: member.test,
  };
}

function asFiniteNumber(value: unknown, label: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IndexError(`${label} must be a number`);
  }
  return value;
}

function normalizeDisplay(file: string): string {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

function findOnPath(cmd: string, pathVar: string): string | undefined {
  for (const dir of pathVar.split(delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate = join(dir, cmd);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function assertRunnable(path: string, shown: string): void {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new IndexError(`${DUPEHOUND_ENV} is set to "${shown}" but that binary is not runnable.`);
  }
}

function wrapMissing(e: unknown, requiredBy: readonly string[]): IndexError {
  if (e instanceof IndexError) {
    if (e.message.includes("required by") || requiredBy.length === 0) {
      return e;
    }
    if (e.message.startsWith("Cannot run ")) {
      return new IndexError(missingBinaryMessage(requiredBy));
    }
    return new IndexError(`${e.message} (required by ${byLabel(requiredBy)}).`);
  }
  return new IndexError(
    `dupehound is not runnable (required by ${byLabel(requiredBy)}): ${e instanceof Error ? e.message : String(e)}`,
  );
}

export function missingBinaryMessage(requiredBy: readonly string[]): string {
  const who =
    requiredBy.length > 0 ? `Cannot run ${byLabel(requiredBy)}` : "Cannot run index-backed rules";
  return (
    `${who}: dupehound is not installed or not runnable. ` +
    `Install ${DUPEHOUND_PIN} from https://github.com/Rafaelpta/dupehound/releases ` +
    `(or brew install rafaelpta/dupehound/dupehound / cargo install dupehound), ` +
    `put it on PATH, or set ${DUPEHOUND_ENV}.`
  );
}

function byLabel(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "an index-backed rule";
}

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
};

function runCommand(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { cwd });
    } catch (e) {
      finish({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        error: e.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, timedOut });
    });
  });
}
