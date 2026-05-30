/**
 * Firestore emulator REST READ helpers for E2E specs.
 *
 * The sibling `emulator.ts` exposes WRITE helpers (writeDoc, createUser,
 * createProfile, createGame) but no READ surface — the existing specs only
 * needed to seed state, never inspect it. This file adds the missing read
 * path so back-end-state assertions can verify that a UI flow actually
 * landed the documents it claims to.
 *
 * Kept separate from `emulator.ts` so the additive PR introducing back-end
 * assertions doesn't touch any existing helper file (smallest diff rule).
 */

const PROJECT_ID = "demo-skatehubba";
const DB_NAME = "skatehubba";
const FS = "http://localhost:8080";
const AUTH = "http://localhost:9099";

/**
 * Untyped REST value envelope returned by the Firestore emulator. We only
 * decode the field types this repo's writes actually produce; anything
 * outside that set falls through as `undefined`.
 */
type FsRestValue = Record<string, unknown>;

function decode(v: FsRestValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue as boolean;
  if ("integerValue" in v) return Number(v.integerValue as string);
  if ("doubleValue" in v) return v.doubleValue as number;
  if ("stringValue" in v) return v.stringValue as string;
  if ("timestampValue" in v) return new Date(v.timestampValue as string);
  if ("arrayValue" in v) {
    const arr = (v.arrayValue as { values?: FsRestValue[] }).values ?? [];
    return arr.map(decode);
  }
  if ("mapValue" in v) {
    const fields = (v.mapValue as { fields?: Record<string, FsRestValue> }).fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, decode(val)]));
  }
  return undefined;
}

/**
 * Read a Firestore document by full path (e.g. `users/abc` or
 * `users/abc/private/profile`). Returns `null` if the doc does not exist,
 * `{}` if it exists but has no fields, otherwise the decoded field map.
 *
 * Bypasses security rules via the emulator's `Bearer owner` admin token —
 * appropriate here because the spec is asserting back-end TRUTH, not
 * exercising the read rule.
 */
export async function readDocByPath(path: string): Promise<Record<string, unknown> | null> {
  const url = `${FS}/v1/projects/${PROJECT_ID}/databases/${DB_NAME}/documents/${path}`;
  const res = await fetch(url, { headers: { Authorization: "Bearer owner" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`readDocByPath ${path} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { fields?: Record<string, FsRestValue> };
  if (!body.fields) return {};
  return Object.fromEntries(Object.entries(body.fields).map(([k, v]) => [k, decode(v)]));
}

/**
 * Resolve the Auth emulator uid for a given email. Returns the localId
 * (Firebase's term for uid) so back-end-state specs can read the user's
 * docs without having to scrape the URL or page state.
 */
export async function uidForEmail(email: string): Promise<string> {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`);
  if (!res.ok) throw new Error(`accounts lookup failed: ${res.status}`);
  const body = (await res.json()) as { userInfo?: Array<{ localId: string; email: string }> };
  const found = (body.userInfo ?? []).find((u) => u.email === email);
  if (!found) throw new Error(`No emulator user found for ${email}`);
  return found.localId;
}
