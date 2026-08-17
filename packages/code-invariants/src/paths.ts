/** Helpers for deciding whether a file is covered by a rule. */

/**
 * True when `path` is covered by any of `patterns`.
 * Patterns are directory prefixes, e.g. "src/generated".
 */
export function isPathIgnored(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (path.startsWith(pattern)) {
      return true;
    }
  }
  return false;
}

/** Depth of a path below the repo root. "a/b/c.ts" -> 2 */
export function pathDepth(path: string): number {
  return path.split("/").length - 1;
}
