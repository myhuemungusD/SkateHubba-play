/**
 * Tolerant parser for the FIREBASE_SERVICE_ACCOUNT_JSON env var, shared by
 * the two cron endpoints (`sweep-expired-turns`, `drain-push-dispatch`).
 *
 * The value is pasted by hand into the Vercel dashboard, and hand pastes —
 * especially from a phone — damage Google's service-account file in known,
 * mechanical ways (observed in the 2026-07-27 outage where both crons 500'd
 * on `init_failed`):
 *
 *   • `\n` escapes inside `private_key` expanded to real newlines — illegal
 *     inside a JSON string literal ("Bad control character").
 *   • Smart punctuation: straight quotes converted to curly quotes, which
 *     terminate strings early ("Expected ',' or '}' after property value")
 *     or break delimiters; non-breaking spaces; zero-width characters.
 *   • A real newline inserted *inside* an escape sequence (`\` + LF + `n`).
 *   • CRLF / lone-CR line endings inside the key, which parse but then fail
 *     OpenSSL's PEM decoder far from the real cause.
 *
 * Strategy — strict-first, repair, validate, or fail loud:
 *
 *   1. Strict `JSON.parse`. A well-formed value never touches the repair
 *      path, so a correct paste behaves byte-for-byte as it always has.
 *   2. On failure, normalize typography (curly quotes → straight, NBSP →
 *      space, zero-width stripped — none of these characters can appear in
 *      a legitimate Google service-account file), then re-escape control
 *      characters found INSIDE string literals only (structural newlines
 *      between tokens are legal JSON and stay untouched), normalizing line
 *      endings to LF, and parse again.
 *   3. A repaired credential is validated for plausibility (see
 *      `validateRepaired`) so the repair can only ever reproduce the value
 *      a correct paste would have carried — never silently invent a
 *      different one. Fields this module does not consume are not checked;
 *      they are also never used.
 *   4. If repair doesn't help, rethrow the strict error with a safe
 *      structural fingerprint (counts only, no content) so the next
 *      occurrence is diagnosable from the 500 body alone.
 *
 * The underscore prefix keeps Vercel's filesystem router from exposing this
 * module as an endpoint (verified against @vercel/fs-detectors: any path
 * containing "/_" gets no builder).
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

export interface ParseResult {
  account: ParsedServiceAccount;
  /** True when the strict parse failed and the repair path produced the credential. */
  repaired: boolean;
}

/**
 * Undo smart-punctuation substitutions a phone or rich-text editor applies.
 * Safe for this file type only: a legitimate Google service-account value
 * never contains curly quotes, non-breaking spaces, or zero-width characters,
 * so every occurrence is paste damage. Applied on the repair path only.
 */
function normalizeTypography(text: string): string {
  return text
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u00A0/g, " ");
}

/**
 * Re-escape control characters found inside JSON string literals.
 *
 * Walks the text tracking string/escape state. Outside strings everything is
 * copied verbatim (pretty-printed JSON stays pretty). Inside a string:
 *
 *   • CRLF, lone CR, and LF all become `\n` — uniform line endings, because
 *     OpenSSL accepts LF PEM unconditionally while lone-CR PEM fails to
 *     decode long after parsing succeeded.
 *   • Tab becomes `\t`; any other control character becomes `\u00XX`.
 *   • A character already behind a backslash is copied untouched so valid
 *     `\\`, `\"`, and `\uXXXX` sequences cannot be corrupted into double
 *     escapes — except a control character behind a backslash, which is a
 *     line break inserted *inside* the escape sequence (`\` + LF + `n`):
 *     the break is dropped and the escape state kept, restoring `\n`.
 */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      if (ch.charCodeAt(0) < 0x20) continue; // break inside an escape: drop it, stay escaped
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
      if (ch === "\r") {
        if (text[i + 1] === "\n") i++; // CRLF collapses to one newline
        out += "\\n";
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\t") out += "\\t";
      else out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Safe structural fingerprint of an unparseable value — counts only, never
 * content — appended to the rethrown parse error so the operator can
 * diagnose the paste from the 500 body without anyone seeing the secret.
 */
function diagnose(text: string): string {
  const count = (re: RegExp): number => (text.match(re) ?? []).length;
  // Control characters are counted by charCode: eslint's no-control-regex is
  // right that control chars in a pattern are usually a mistake, and here
  // counting without a pattern avoids disabling the rule.
  let controlChars = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) controlChars++;
  }
  return (
    ` [value diagnostics: chars=${text.length}` +
    ` lines=${text.split("\n").length}` +
    ` quotes=${count(/"/g)}` +
    ` curlyQuotes=${count(/[\u201C\u201D\u201E]/g)}` +
    ` backslashes=${count(/\\/g)}` +
    ` controlChars=${controlChars}]`
  );
}

/**
 * A repaired credential must be one a correct paste could have produced.
 * Without this, paste damage in `project_id` or `client_email` (fields that
 * may never contain control characters) would be absorbed into a
 * successfully-initialized admin app holding wrong credentials — a silent
 * misconfiguration, strictly worse than the loud 500 it replaced. Applied to
 * the repair path only; the strict path is exactly as permissive as the
 * inline code this module replaced.
 */
function validateRepaired(account: ParsedServiceAccount, strictErr: Error, diag: string): void {
  const implausible = (field: string): Error =>
    new Error(
      `FIREBASE_SERVICE_ACCOUNT_JSON repair produced an implausible ${field}; ` +
        `fix the stored value. Original parse error: ${strictErr.message}${diag}`,
    );
  if (!/^[A-Za-z0-9._-]+$/.test(account.projectId)) throw implausible("project_id");
  if (!/^[\x21-\x7e]+@[\x21-\x7e]+$/.test(account.clientEmail)) throw implausible("client_email");
  if (
    !/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END [A-Z0-9 ]*PRIVATE KEY-----\n?$/.test(
      account.privateKey,
    )
  ) {
    throw implausible("private_key");
  }
}

/** Extract and camelCase the consumed fields, throwing if any is absent or empty. */
function toAccount(parsed: unknown): ParsedServiceAccount {
  const record =
    parsed !== null && typeof parsed === "object" ? (parsed as RawServiceAccount) : ({} as RawServiceAccount);
  if (!record.project_id || !record.client_email || !record.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields");
  }
  // Google emits snake_case keys; admin's ServiceAccount type is camelCase.
  return {
    projectId: record.project_id,
    clientEmail: record.client_email,
    privateKey: record.private_key,
  };
}

/**
 * Parse a service-account JSON string, repairing known hand-paste damage.
 *
 * Throws when the value is unparseable even after repair (with the strict
 * parse's diagnostics plus a structural fingerprint), when required fields
 * are absent, or when a repair would produce an implausible credential —
 * all surface as the handlers' `init_failed` 500.
 */
export function parseServiceAccountJson(raw: string): ParseResult {
  // A leading byte-order mark breaks JSON.parse before it reads the `{`.
  const text = raw.replace(/^\uFEFF/, "");
  try {
    return { account: toAccount(JSON.parse(text)), repaired: false };
  } catch (caught) {
    const strictErr = caught instanceof Error ? caught : new Error(String(caught));
    // Missing-fields on a value that PARSED must not fall through to repair —
    // there is nothing to repair and the message would get replaced.
    if (!(strictErr instanceof SyntaxError)) throw strictErr;
    let parsed: unknown;
    try {
      parsed = JSON.parse(escapeControlCharsInStrings(normalizeTypography(text)));
    } catch {
      // Repair didn't help: the value is broken beyond the known damage
      // classes. Surface the strict error — its position information
      // describes the real paste — plus the fingerprint.
      throw new SyntaxError(`${strictErr.message}${diagnose(text)}`);
    }
    const account = toAccount(parsed);
    validateRepaired(account, strictErr, diagnose(text));
    return { account, repaired: true };
  }
}
