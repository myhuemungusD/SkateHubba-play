/**
 * Collection paths declared in a rules file, with every id segment written as
 * `{}`: `match /users/{uid}/wallet/{id}` becomes `users/{}/wallet`. Nested
 * `match` blocks are joined with their parents by tracking brace depth.
 */
export function rulesCollections(source: string): Set<string> {
  const text = source.replace(/\/\/[^\n]*/g, "");
  const stack: { depth: number; path: string }[] = [];
  const out = new Set<string>();
  let depth = 0;
  for (const m of text.matchAll(/match\s+(\/\S+)\s*\{|\{|\}/g)) {
    if (m[1] !== undefined) {
      depth += 1;
      stack.push({ depth, path: m[1] });
      const full = stack.map((s) => s.path).join("");
      const segs = full
        .replace(/^\/databases\/\{database\}\/documents/, "")
        .replace(/^\/b\/\{bucket\}\/o/, "")
        .split("/")
        .filter((s) => s.length > 0)
        .map((s) => (s.startsWith("{") ? "{}" : s));
      // `match /{path=**}/comments/{id}` is a collection-group rule over
      // collections declared elsewhere, not a collection of its own; see
      // rulesCollectionGroups.
      if (segs.length === 0 || full.includes("=**}")) continue;
      out.add((segs.length % 2 === 0 ? segs.slice(0, -1) : segs).join("/"));
    } else if (m[0] === "{") {
      depth += 1;
    } else {
      while (stack.length > 0 && stack[stack.length - 1].depth === depth) stack.pop();
      depth -= 1;
    }
  }
  return out;
}

/**
 * Collection groups with a recursive rule (`match /{path=**}/<group>/{id}`).
 * Only these can be read with a collection-group query.
 */
export function rulesCollectionGroups(source: string): Set<string> {
  const text = source.replace(/\/\/[^\n]*/g, "");
  return new Set([...text.matchAll(/match\s+\/\{[a-zA-Z]+=\*\*\}\/([A-Za-z_]+)\/\{[^}]+\}\s*\{/g)].map((m) => m[1]));
}
