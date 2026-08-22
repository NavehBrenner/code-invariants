export function walkDepthSum(nodes: ReadonlyArray<{ value: number; kids: number[] }>): number {
  const seen = new Set<number>();
  const stack = nodes.map((_, i) => ({ i, depth: 1 }));
  let total = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined || seen.has(frame.i)) {
      continue;
    }
    seen.add(frame.i);
    const node = nodes[frame.i];
    if (node === undefined) {
      continue;
    }
    total += node.value * frame.depth;
    for (const kid of node.kids) {
      stack.push({ i: kid, depth: frame.depth + 1 });
    }
  }
  return total;
}
