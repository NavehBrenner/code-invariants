import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { ArtifactBuildContext } from "qualety";
import { z } from "zod";

export const DUPEHOUND_PIN = "v0.1.2";
export const DUPEHOUND_ENV = "QUALETY_DUPEHOUND";
export const SCAN_TIMEOUT_MS = 60_000;

const memberSchema = z
  .object({
    file: z.string().min(1),
    name: z.string(),
    start_line: z.number().finite().optional(),
    end_line: z.number().finite().optional(),
    similarity: z.number().finite().optional(),
    representative: z.boolean().optional(),
    test: z.boolean().optional(),
  })
  .passthrough();

const clusterSchema = z
  .object({
    id: z.number().finite().optional(),
    similarity: z.number().finite().optional(),
    test_only: z.boolean().optional(),
    trait_impl_only: z.boolean().optional(),
    members: z.array(memberSchema),
  })
  .passthrough();

const scanReportSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(2)]),
  clusters: z.array(clusterSchema),
});

export class DupehoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DupehoundError";
  }
}

export type DupehoundMember = {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  representative: boolean;
  test: boolean;
};

export type DupehoundCluster = {
  id: number;
  similarity: number;
  testOnly: boolean;
  members: DupehoundMember[];
};

export type DupehoundIndex = {
  clusters: readonly DupehoundCluster[];
};

declare module "qualety" {
  interface ArtifactMap {
    dupehound: DupehoundIndex;
  }
}

export type BuildDupehoundOptions = ArtifactBuildContext & {
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
      throw new DupehoundError(
        `${DUPEHOUND_ENV} is set to "${override}" but that command is not on PATH.`,
      );
    }
    return found;
  }
  const found = findOnPath("dupehound", env.PATH ?? "");
  if (found === undefined) {
    throw new DupehoundError(missingBinaryMessage([]));
  }
  return found;
}

export async function buildDupehoundIndex(options: BuildDupehoundOptions): Promise<DupehoundIndex> {
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
    throw new DupehoundError(
      `dupehound timed out after ${timeoutMs / 1000}s (required by ${byLabel(requiredBy)}).`,
    );
  }
  if (result.error !== undefined) {
    throw new DupehoundError(
      `dupehound is not runnable (required by ${byLabel(requiredBy)}): ${result.error}`,
    );
  }
  if (result.code !== 0) {
    const text = `${result.stdout}\n${result.stderr}`;
    if (/no supported source files/i.test(text)) {
      return { clusters: [] };
    }
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new DupehoundError(`dupehound failed (required by ${byLabel(requiredBy)}): ${detail}`);
  }

  let parsed: ParsedScanReport;
  try {
    parsed = parseScanReport(result.stdout);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new DupehoundError(
      `dupehound produced invalid JSON (required by ${byLabel(requiredBy)}): ${detail}`,
    );
  }
  return { clusters: filterClusters(parsed.clusters, options.files) };
}

export function parseScanReport(raw: string): ParsedScanReport {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    throw new DupehoundError("stdout is not JSON");
  }
  const parsed = scanReportSchema.safeParse(value);
  if (!parsed.success) {
    throw new DupehoundError(formatScanError(value, parsed.error));
  }
  return {
    schemaVersion: parsed.data.schema_version,
    clusters: parsed.data.clusters.map((cluster, index) => ({
      id: cluster.id ?? index + 1,
      similarity: cluster.similarity ?? 1,
      testOnly: cluster.test_only === true,
      traitImplOnly: cluster.trait_impl_only === true,
      members: cluster.members.map((member) => ({
        file: member.file,
        name: member.name,
        startLine: member.start_line ?? 1,
        endLine: member.end_line ?? 1,
        similarity: member.similarity ?? 1,
        representative: member.representative === true,
        test: member.test === true,
      })),
    })),
  };
}

function formatScanError(value: unknown, error: z.ZodError): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "JSON root must be an object";
  }
  const issues = error.issues;
  const schemaIssue = issues.find((issue) => issue.path[0] === "schema_version");
  if (schemaIssue !== undefined && isRecord(value)) {
    return `unsupported schema_version ${JSON.stringify(value.schema_version)}; expected 1 or 2`;
  }
  const clustersIssue = issues.find((issue) => issue.path[0] === "clusters");
  if (clustersIssue !== undefined && (!isRecord(value) || !Array.isArray(value.clusters))) {
    return "missing clusters array";
  }
  const first = issues[0];
  if (first === undefined) {
    return "invalid scan report";
  }
  const path = first.path.map(String).join(".");
  return path.length > 0 ? `${path}: ${first.message}` : first.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function filterClusters(
  clusters: readonly RawCluster[],
  includeFiles: readonly string[],
): DupehoundCluster[] {
  const include = new Set(includeFiles.map(normalizeDisplay));
  const out: DupehoundCluster[] = [];
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

function toMember(member: RawMember): DupehoundMember {
  return {
    file: normalizeDisplay(member.file),
    name: member.name,
    startLine: member.startLine,
    endLine: member.endLine,
    representative: member.representative,
    test: member.test,
  };
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
    throw new DupehoundError(
      `${DUPEHOUND_ENV} is set to "${shown}" but that binary is not runnable.`,
    );
  }
}

function wrapMissing(e: unknown, requiredBy: readonly string[]): DupehoundError {
  if (e instanceof DupehoundError) {
    if (e.message.includes("required by") || requiredBy.length === 0) {
      return e;
    }
    if (e.message.startsWith("Cannot run ")) {
      return new DupehoundError(missingBinaryMessage(requiredBy));
    }
    return new DupehoundError(`${e.message} (required by ${byLabel(requiredBy)}).`);
  }
  return new DupehoundError(
    `dupehound is not runnable (required by ${byLabel(requiredBy)}): ${e instanceof Error ? e.message : String(e)}`,
  );
}

export function missingBinaryMessage(requiredBy: readonly string[]): string {
  const who =
    requiredBy.length > 0
      ? `Cannot run ${byLabel(requiredBy)}`
      : "Cannot run dupehound-backed rules";
  return (
    `${who}: dupehound is not installed or not runnable. ` +
    `Install ${DUPEHOUND_PIN} from https://github.com/Rafaelpta/dupehound/releases ` +
    `(or brew install rafaelpta/dupehound/dupehound / cargo install dupehound), ` +
    `put it on PATH, or set ${DUPEHOUND_ENV}.`
  );
}

function byLabel(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "a dupehound-backed rule";
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
