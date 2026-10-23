/**
 * PII redaction for the logger → Sentry breadcrumb boundary.
 *
 * Call sites throughout the app attach raw `email` and Firebase `uid` values
 * to structured log events. Those payloads are forwarded to Sentry as
 * breadcrumb data, which silently ships PII to a third-party service on every
 * authenticated session. `redactPII` is applied inside the logger's breadcrumb
 * path so every current and future call site is covered without touching the
 * sites themselves. Console output remains raw for developer ergonomics.
 * http(s) URL values also lose their query string (see stripUrlQuery).
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
// path alone is enough to find the file when triaging, so http(s) URLs lose
// their query and fragment before they reach Sentry.
const HTTP_URL_RE = /^https?:\/\//i;

export function stripUrlQuery(value: string): string {
  return HTTP_URL_RE.test(value) ? value.replace(/[?#].*$/s, "") : value;
}

export function redactPII(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && EMAIL_KEY_RE.test(key)) {
      out[key] = EMAIL_PLACEHOLDER;
    } else if (typeof value === "string" && UID_KEY_RE.test(key)) {
      out[key] = HASHED_UID_RE.test(value) ? value : hashUid(value);
    } else if (typeof value === "string" && USERNAME_KEY_RE.test(key)) {
      out[key] = !value || HASHED_USERNAME_RE.test(value) ? value : `name-${fnv1a(value)}`;
    } else if (typeof value === "string") {
      out[key] = stripUrlQuery(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
