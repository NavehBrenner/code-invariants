import type { Rule, Violation } from "code-invariants";
import type { DupehoundCluster, DupehoundIndex } from "./dupehound.ts";

export const noDuplicateFunctions: Rule = {
  meta: {
    requires: ["dupehound"],
    docs: {
      description:
        "No structurally duplicate functions or methods in included non-test, non-generated sources (dupehound; not embeddings).",
    },
  },
  create(context) {
    const index = context.getArtifact("dupehound") as DupehoundIndex;
    for (const item of reportsFromIndex(index)) {
      context.report(item);
    }
  },
};

export function reportsFromIndex(index: DupehoundIndex): Omit<Violation, "ruleId">[] {
  const reports: Omit<Violation, "ruleId">[] = [];
  for (const cluster of index.clusters) {
    reports.push(...reportsFromCluster(cluster));
  }
  return reports;
}

function reportsFromCluster(cluster: DupehoundCluster): Omit<Violation, "ruleId">[] {
  const rep = cluster.members.find((member) => member.representative) ?? cluster.members[0];
  if (rep === undefined) {
    return [];
  }
  const reports: Omit<Violation, "ruleId">[] = [];
  for (const member of cluster.members) {
    if (member === rep || member.representative) {
      continue;
    }
    const pct = Math.round(cluster.similarity * 100);
    reports.push({
      severity: "error",
      file: member.file,
      range: {
        start: { line: member.startLine, column: 1 },
        end: { line: member.endLine, column: 1 },
      },
      message: `"${member.name}" is a structural duplicate of "${rep.name}" in ${rep.file}:${rep.startLine} (${pct}% similar).`,
      suggestion: `Reuse "${rep.name}" from ${rep.file}:${rep.startLine} instead of reimplementing it.`,
    });
  }
  return reports;
}
