/**
 * PII redaction for the logger → Sentry breadcrumb boundary.
 *
 * Call sites throughout the app attach raw `email` and Firebase `uid` values
 * to structured log events. Those payloads are forwarded to Sentry as
 * breadcrumb data, which silently ships PII to a third-party service on every
 * authenticated session. `redactPII` is applied inside the logger's breadcrumb
 * path so every current and future call site is covered without touching the
 * sites themselves. Console output remains raw for developer ergonomics.
 */

const EMAIL_PLACEHOLDER = "[REDACTED_EMAIL]";
const EMAIL_KEY_RE = /^email$/i;
const UID_KEY_RE = /uid$/i;

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

export function redactPII(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && EMAIL_KEY_RE.test(key)) {
      out[key] = EMAIL_PLACEHOLDER;
    } else if (typeof value === "string" && UID_KEY_RE.test(key)) {
      out[key] = hashUid(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
