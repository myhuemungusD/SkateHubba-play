/**
 * Tolerant parser for the FIREBASE_SERVICE_ACCOUNT_JSON env var, shared by
 * the two cron endpoints (`sweep-expired-turns`, `drain-push-dispatch`).
 *
 * The value is pasted by hand into the Vercel dashboard, and hand pastes —
 * especially from a phone — mangle Google's service-account file in one
 * specific way: the `\n` escape sequences inside the `private_key` string
 * arrive as literal newline characters, which are illegal inside a JSON
 * string literal and fail `JSON.parse` with "Expected ',' or '}' after
 * property value". Observed in production 2026-07-27: the parse error
 * pointed at line 53 of a ~12-line file because the PEM had been expanded
 * across real lines.
 *
 * Strategy: strict `JSON.parse` first, so a well-formed value never touches
 * the repair path. On failure, re-escape control characters that occur
 * inside string literals only — newlines *between* tokens are legal JSON
 * whitespace and must stay untouched — and parse again. If the repaired
 * text still fails, rethrow the strict error so the operator sees a
 * diagnostic that describes the actual paste, not the repair attempt.
 *
 * The underscore prefix keeps Vercel's filesystem router from exposing this
 * module as an endpoint.
 */

/** Shape of the fields we consume from Google's service-account JSON. */
interface RawServiceAccount {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

/** Credential fields in the camelCase form `cert()` expects, all present. */
export interface ParsedServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Re-escape control characters found inside JSON string literals.
 *
 * Walks the text tracking string/escape state. Outside strings everything is
 * copied verbatim (pretty-printed JSON stays pretty). Inside a string, a raw
 * control character is replaced with its escape sequence; characters already
 * behind a backslash are copied untouched so valid `\\`, `\"`, and `\uXXXX`
 * sequences cannot be corrupted into double escapes.
 */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Parse a service-account JSON string, repairing the known hand-paste mangle.
 *
 * Throws when the value is unparseable even after repair (with the strict
 * parse's diagnostics) or parses without the three required fields — both
 * surface as the handlers' `init_failed` 500.
 */
export function parseServiceAccountJson(raw: string): ParsedServiceAccount {
  // Some editors and clipboards prepend a byte-order mark, which JSON.parse
  // rejects before it reads the first `{`.
  const text = raw.replace(/^\uFEFF/, "");
  let parsed: RawServiceAccount;
  try {
    parsed = JSON.parse(text) as RawServiceAccount;
  } catch (strictErr) {
    try {
      parsed = JSON.parse(escapeControlCharsInStrings(text)) as RawServiceAccount;
    } catch {
      // The repair didn't help, so the value is broken beyond the known
      // mangle — the strict error's position info describes the real paste.
      throw strictErr instanceof Error ? strictErr : new Error(String(strictErr));
    }
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields");
  }
  // Google emits snake_case keys; admin's ServiceAccount type is camelCase.
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}
