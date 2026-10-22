/**
 * Account-deletion COVERAGE, from the code side (Apple 5.1.1(v)).
 *
 * `account-delete.coverage.test.ts` finds collections through firestore.rules.
 * Collections that only the Admin SDK touches (Cloud Functions, Vercel crons,
 * the api/ handlers) need no rules block, so a new one could ship user data
 * that deletion never reaches without that test noticing. This test reads the
 * source instead: every collection name the app, the api/ handlers or the
 * functions write or read must appear somewhere in `_userDataRegistry.ts`
 * (Firestore paths or Storage folders).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIRESTORE_ERASURE, STORAGE_ERASURE } from "../../../api/account/_userDataRegistry";

const ROOTS = ["src", "api", "functions/src"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test(-helpers)?\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const NAME = "([A-Za-z_][A-Za-z0-9_]*)";
const PATTERNS = [
  // Admin SDK: db.collection("x"), ref.collection("x"), db.collectionGroup("x")
  new RegExp(`\\.collection(?:Group)?\\(\\s*["'\`]${NAME}["'\`]`, "g"),
  // Web SDK: collection(db, "x"), collectionGroup(db, "x"), and the
  // collection(db, "users", uid, "x") subcollection form (last literal).
  new RegExp(`\\bcollection(?:Group)?\\([^)]*?["'\`]${NAME}["'\`]\\s*\\)`, "g"),
  // Named constants: const FOO_COLLECTION = "x"
  new RegExp(`\\b(?:\\w+_)?COLLECTION\\s*=\\s*["'\`]${NAME}["'\`]`, "g"),
  // Path templates the Functions store layer uses: `x/${id}` and `users/${uid}/x/...`
  new RegExp(`\`${NAME}/\\$\\{`, "g"),
  new RegExp(`\`users/\\$\\{[^}]+\\}/${NAME}[/\`]`, "g"),
];

/** Collection names the source refers to, with the first file that names each. */
function collectionNames(): Map<string, string> {
  const found = new Map<string, string>();
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const re of PATTERNS) {
        for (const m of text.matchAll(re)) if (!found.has(m[1])) found.set(m[1], file);
      }
    }
  }
  return found;
}

describe("every collection the code touches is classified", () => {
  // Storage folders share the `name/${id}` path shape, so they count too.
  const registered = new Set([
    ...Object.keys(FIRESTORE_ERASURE).flatMap((path) => path.split("/").filter((seg) => seg !== "{}")),
    ...Object.keys(STORAGE_ERASURE),
  ]);
  const names = collectionNames();

  it("finds the collections (scanner sanity check)", () => {
    for (const known of [
      "users",
      "games",
      "clips",
      "push_dispatch",
      "closetLimits",
      "diceCreateLimits",
      "proBlessings",
    ]) {
      expect(names.has(known)).toBe(true);
    }
  });

  it("lists every one in _userDataRegistry.ts", () => {
    const missing = [...names].filter(([name]) => !registered.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(missing).toEqual([]);
  });
});
