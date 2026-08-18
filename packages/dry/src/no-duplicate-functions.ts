import type { ProjectRule, Range, StructuralCloneCluster, StructuralIndex } from "code-invariants";

export type DuplicateReport = {
  file: string;
  range: Range;
  message: string;
  suggestion: string;
  severity: "error";
};

export const noDuplicateFunctions: ProjectRule = {
  meta: {
    kind: "project",
    requires: ["index"],
    docs: {
      description:
        "No structurally duplicate functions or methods in included non-test, non-generated sources (dupehound; not embeddings).",
    },
  },
  create(context) {
    for (const item of reportsFromIndex(context.getIndex())) {
      context.report(item);
    }
  },
};

export function reportsFromIndex(index: StructuralIndex): DuplicateReport[] {
  const reports: DuplicateReport[] = [];
  for (const cluster of index.clusters) {
    reports.push(...reportsFromCluster(cluster));
  }
  return reports;
}

function reportsFromCluster(cluster: StructuralCloneCluster): DuplicateReport[] {
  const rep = cluster.members.find((member) => member.representative) ?? cluster.members[0];
  if (rep === undefined) {
    return [];
  }
  const reports: DuplicateReport[] = [];
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
