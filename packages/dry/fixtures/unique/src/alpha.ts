export function tokenizeWords(source: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const ch of source) {
    if (/[A-Za-z0-9_]/.test(ch)) {
      current += ch.toLowerCase();
      continue;
    }
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
    if (!/\s/.test(ch)) {
      tokens.push(ch);
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens.filter((token) => token !== "--" && token !== "//");
}
