/**
 * Unit tests for the tolerant FIREBASE_SERVICE_ACCOUNT_JSON parser
 * (`api/cron/_serviceAccount.ts`).
 *
 * The headline cases reproduce the 2026-07-27 production outage classes: a
 * service-account JSON hand-pasted into Vercel from a phone, damaged by
 * escape expansion (`\n` → real newline) and/or smart punctuation. Those
 * must repair; a value broken any other way must still fail loudly, and a
 * repair must never fabricate a credential a correct paste couldn't have
 * produced.
 */
import { describe, it, expect } from "vitest";
import { parseServiceAccountJson } from "../../../api/cron/_serviceAccount.js";

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n";

const ACCOUNT = {
  project_id: "demo",
  client_email: "svc@demo.iam.gserviceaccount.com",
  private_key: PEM,
};

/** The mobile-paste mangle: every `\n` ESCAPE in the text becomes a real newline. */
function mangle(json: string): string {
  return json.replace(/\\n/g, "\n");
}

describe("strict path", () => {
  it("parses a canonical single-line service account, repaired=false", () => {
    const out = parseServiceAccountJson(JSON.stringify(ACCOUNT));
    expect(out.repaired).toBe(false);
    expect(out.account).toEqual({
      projectId: "demo",
      clientEmail: "svc@demo.iam.gserviceaccount.com",
      privateKey: PEM,
    });
  });

  it("parses pretty-printed JSON — newlines between tokens are legal", () => {
    const out = parseServiceAccountJson(JSON.stringify(ACCOUNT, null, 2));
    expect(out.repaired).toBe(false);
    expect(out.account.privateKey).toBe(PEM);
  });

  it("strips a leading BOM before parsing", () => {
    const out = parseServiceAccountJson("\uFEFF" + JSON.stringify(ACCOUNT));
    expect(out.account.projectId).toBe("demo");
    expect(out.repaired).toBe(false);
  });
});

describe("repair path — escape expansion", () => {
  it("repairs the newline mangle in pretty-printed form, repaired=true", () => {
    const out = parseServiceAccountJson(mangle(JSON.stringify(ACCOUNT, null, 2)));
    expect(out.repaired).toBe(true);
    expect(out.account.privateKey).toBe(PEM);
    expect(out.account.clientEmail).toBe("svc@demo.iam.gserviceaccount.com");
  });

  it("repairs the single-line variant of the newline mangle", () => {
    const out = parseServiceAccountJson(mangle(JSON.stringify(ACCOUNT)));
    expect(out.account.privateKey).toBe(PEM);
  });

  it("normalizes CRLF inside the key to LF — OpenSSL-safe PEM", () => {
    const crlf = JSON.stringify(ACCOUNT).replace(/\\n/g, "\r\n");
    expect(parseServiceAccountJson(crlf).account.privateKey).toBe(PEM);
  });

  it("normalizes lone-CR inside the key to LF — CR-only PEM fails OpenSSL", () => {
    const cr = JSON.stringify(ACCOUNT).replace(/\\n/g, "\r");
    expect(parseServiceAccountJson(cr).account.privateKey).toBe(PEM);
  });

  it("repairs a line break inserted INSIDE an escape sequence (backslash + LF + n)", () => {
    const split = JSON.stringify(ACCOUNT).replace("\\n", "\\\nn");
    expect(parseServiceAccountJson(split).account.privateKey).toBe(PEM);
  });

  it("preserves escaped quotes while repairing later newlines — state machine stays in sync", () => {
    // The escaped quote comes BEFORE the mangled key: if the `\"` were
    // mis-tracked, every following repair would target the wrong regions.
    const acct = { ...ACCOUNT, client_email: 'a"b@x.i' };
    const out = parseServiceAccountJson(mangle(JSON.stringify(acct)));
    expect(out.account.clientEmail).toBe('a"b@x.i');
    expect(out.account.privateKey).toBe(PEM);
  });

  it("preserves escaped backslashes in unconsumed fields while repairing the key", () => {
    const acct = { type: "a\\b", ...ACCOUNT };
    const out = parseServiceAccountJson(mangle(JSON.stringify(acct)));
    expect(out.account.privateKey).toBe(PEM);
  });

  it("escapes non-newline control characters via the \\u00XX fallback", () => {
    // JSON.stringify escapes a control char itself, so inject the raw byte
    // at TEXT level, into a field the plausibility check ignores.
    const text = mangle(JSON.stringify({ type: "aXb", ...ACCOUNT })).replace("aXb", "a\u0001b");
    const out = parseServiceAccountJson(text);
    expect(out.account.privateKey).toBe(PEM);
    expect(out.repaired).toBe(true);
  });
});

describe("repair path — smart punctuation", () => {
  it("repairs a curly closing quote that swallowed the rest of the document", () => {
    // The error class the production 500 actually reported ("Expected ','
    // or '}' after property value"): a string terminated by U+201D instead
    // of a straight quote, combined with the newline mangle.
    const curly = mangle(JSON.stringify(ACCOUNT, null, 2)).replace(
      '-----END PRIVATE KEY-----\n"',
      "-----END PRIVATE KEY-----\n\u201D",
    );
    const out = parseServiceAccountJson(curly);
    expect(out.repaired).toBe(true);
    expect(out.account.privateKey).toBe(PEM);
  });

  it("repairs a fully smart-quoted document — every delimiter converted", () => {
    const allCurly = JSON.stringify(ACCOUNT).replace(/"/g, "\u201C");
    expect(parseServiceAccountJson(allCurly).account.privateKey).toBe(PEM);
  });

  it("strips zero-width characters and converts NBSP", () => {
    const seeded = "\u200B" + JSON.stringify(ACCOUNT).replace("PRIVATE KEY", "PRIVATE\u00A0KEY");
    // Zero-width forces the repair path; NBSP inside the PEM header must
    // come back as a plain space or the PEM envelope check would reject it.
    const out = parseServiceAccountJson(seeded);
    expect(out.repaired).toBe(true);
    expect(out.account.privateKey).toBe(PEM);
  });
});

describe("repair must not fabricate credentials", () => {
  it("rejects a repaired client_email that contains a line break", () => {
    // The confirmed review defect: paste damage inside client_email must
    // throw, not initialize an admin app with a corrupted credential.
    const acct = { ...ACCOUNT, client_email: "svc@demo.iam.\ngserviceaccount.com" };
    expect(() => parseServiceAccountJson(mangle(JSON.stringify(acct, null, 2)))).toThrow(/implausible client_email/);
  });

  it("rejects a repaired project_id that contains a line break", () => {
    const acct = { ...ACCOUNT, project_id: "ska\ntehubba" };
    expect(() => parseServiceAccountJson(mangle(JSON.stringify(acct)))).toThrow(/implausible project_id/);
  });

  it("rejects a repaired private_key that is not PEM-shaped", () => {
    const acct = { ...ACCOUNT, private_key: "not a pem\nat all" };
    expect(() => parseServiceAccountJson(mangle(JSON.stringify(acct)))).toThrow(/implausible private_key/);
  });
});

describe("failure modes stay loud", () => {
  it("rethrows the STRICT parse error, not the repair attempt's", () => {
    // Truncated document with a mangled newline: the strict error points at
    // the control character; the repair attempt's error would point at the
    // unexpected end of input. The operator must see the former.
    expect(() => parseServiceAccountJson('{"a":"x\ny"')).toThrow(/Bad control character/);
  });

  it("appends safe structural diagnostics when repair cannot help", () => {
    expect(() => parseServiceAccountJson("{not json at all")).toThrow(/value diagnostics: chars=16/);
  });

  it("throws SyntaxError type for unparseable values", () => {
    expect(() => parseServiceAccountJson("{not json at all")).toThrow(SyntaxError);
  });

  it("throws on truncated JSON — repair must not mask a cut-off paste", () => {
    const cut = JSON.stringify(ACCOUNT).slice(0, 40);
    expect(() => parseServiceAccountJson(cut)).toThrow();
  });

  it("throws missing-fields on JSON null — not a TypeError", () => {
    expect(() => parseServiceAccountJson("null")).toThrow("FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields");
  });

  it("throws missing-fields on a non-object value", () => {
    expect(() => parseServiceAccountJson("123")).toThrow("FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields");
  });

  it("throws when a required field is missing", () => {
    expect(() => parseServiceAccountJson(JSON.stringify({ project_id: "demo" }))).toThrow(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields",
    );
  });

  it("throws when a required field is empty", () => {
    expect(() => parseServiceAccountJson(JSON.stringify({ ...ACCOUNT, private_key: "" }))).toThrow(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields",
    );
  });

  it("throws missing-fields even when the value needed repair first", () => {
    const mangledIncomplete = mangle(JSON.stringify({ project_id: "demo", private_key: PEM }, null, 2));
    expect(() => parseServiceAccountJson(mangledIncomplete)).toThrow(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields",
    );
  });
});
