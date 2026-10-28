/**
 * PII redaction for the logger → Sentry breadcrumb boundary.
 *
 * Call sites throughout the app attach raw `email` and Firebase `uid` values
 * to structured log events. Those payloads are forwarded to Sentry as
 * breadcrumb data, which silently ships PII to a third-party service on every
 * authenticated session. `redactPII` is applied inside the logger's breadcrumb
 * path so every current and future call site is covered without touching the
 * sites themselves. Dev console output remains raw for developer ergonomics;
 * the production console line is redacted too (src/services/logger.ts).
 * Every http(s) URL inside a string also loses its query (see stripUrlQuery).
 */

const EMAIL_PLACEHOLDER = "[REDACTED_EMAIL]";
const EMAIL_KEY_RE = /^email$/i;
// Matches the whole key `uid` OR a camelCase `*Uid` suffix. Deliberately
// case-sensitive so we don't hash innocuous keys whose last three letters
// happen to be "uid" — uuid, squid, druid, fluid, liquid.
const UID_KEY_RE = /^uid$|Uid$/;
// Usernames are public, direct identifiers. Matches `username` and camelCase
// `*Username` (playerUsername, reportedUsername, ...). The privacy policy says
// identifiers sent to vendors are hashed, so they get the same treatment.
const USERNAME_KEY_RE = /^username$|Username$/;

// Non-cryptographic 32-bit FNV-1a. Breadcrumbs need stable correlation
// (same uid → same surrogate within one Sentry trace), not secrecy, so a
// fast synchronous hash beats SubtleCrypto (which would force emit() async)
// and avoids pulling in a crypto dependency.
function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashUid(uid: string): string {
  if (!uid) return uid;
  return `uid_${fnv1a(uid)}`;
}

// Non-cryptographic 64-bit FNV-1a (BigInt). The 32-bit hashUid above is sized
// for breadcrumb correlation, where a rare collision only mislabels a single
// log line. When the same surrogate becomes a *stable identity* — the PostHog
// distinct_id and Sentry user id — a 32-bit space (~4.3B) risks birthday-bound
// collisions that would silently merge two accounts at scale. FNV-1a-64 widens
// the space to ~1.8e19 with no crypto dependency and no async boundary.
function fnv1a64(input: string): string {
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  let hash = 14695981039346656037n; // FNV-1a 64-bit offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Wider identity digest for cross-session correlation (PostHog distinct_id,
 * Sentry user id). Use {@link hashUid} for breadcrumb/event properties; use
 * this for anything that anchors a durable identity where collisions would
 * merge distinct users.
 */
export function hashIdentity(uid: string): string {
  if (!uid) return uid;
  return `uid_${fnv1a64(uid)}`;
}

// Surrogates the call site already made: hashing them again would break
// correlation with it. Each is kept only under its own kind of key, and
// neither can be a real value there: Firebase uids have no "_", and
// usernames (USERNAME_RE, [a-z0-9_]) have no "-".
const HASHED_UID_RE = /^uid_[0-9a-f]{8}(?:[0-9a-f]{8})?$/;
const HASHED_USERNAME_RE = /^name-[0-9a-f]{8}$/;

// Firebase Storage download URLs carry their access token in the query
// (?alt=media&token=...), so anyone holding the URL can fetch the clip. The
// path alone is enough to find the file when triaging, so every http(s) URL in
// a string loses its query and fragment before it reaches Sentry. "Anywhere in
// the string" matters: native errors embed the URL in prose, e.g. the
// Capacitor Filesystem reject "Error downloading file: https://...?token=...".
// The URL ends at whitespace, a quote or an angle bracket, so a URL inside a
// JSON string or HTML attribute keeps the text after it.
// This is the backstop. Capture sites still leave clip URLs (url, src,
// videoUrl) out of their extras: a label or context names the clip well
// enough, and a URL that isn't sent can't leak.
const HTTP_URL_QUERY_RE = /\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi;

export function stripUrlQuery(value: string): string {
  return value.replace(HTTP_URL_QUERY_RE, "$1");
}

// Nested data is walked this deep, which is far past any real log payload.
// Anything deeper (or a cycle) is replaced rather than shipped unredacted.
const MAX_DEPTH = 8;
const DEPTH_PLACEHOLDER = "[REDACTED_DEPTH]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    if (EMAIL_KEY_RE.test(key)) return EMAIL_PLACEHOLDER;
    if (UID_KEY_RE.test(key)) return HASHED_UID_RE.test(value) ? value : hashUid(value);
    if (USERNAME_KEY_RE.test(key)) return !value || HASHED_USERNAME_RE.test(value) ? value : `name-${fnv1a(value)}`;
    return stripUrlQuery(value);
  }
  if (Array.isArray(value)) {
    // Items take their array's key, so { uids: [...] } stays a plain list
    // but { players: [{ uid }] } hashes each uid.
    return depth >= MAX_DEPTH ? DEPTH_PLACEHOLDER : value.map((item) => redactValue(key, item, depth + 1));
  }
  if (isPlainObject(value)) {
    return depth >= MAX_DEPTH ? DEPTH_PLACEHOLDER : redactObject(value, depth + 1);
  }
  return value;
}

function redactObject(data: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) out[key] = redactValue(key, value, depth);
  return out;
}

/**
 * Redact one payload: email keys become a placeholder, uid and username keys
 * are hashed, and URLs inside every other string lose their query. Plain
 * objects and arrays are walked recursively (up to MAX_DEPTH); other objects
 * (Error, Date, class instances) pass through as they are.
 */
export function redactPII(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return data;
  return redactObject(data, 0);
}
