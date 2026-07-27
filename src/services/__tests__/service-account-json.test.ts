/**
 * Unit tests for the tolerant FIREBASE_SERVICE_ACCOUNT_JSON parser
 * (`api/cron/_serviceAccount.ts`).
 *
 * The headline case reproduces the 2026-07-27 production outage: a
 * service-account JSON hand-pasted into Vercel from a phone, with every
 * `\n` escape inside `private_key` converted to a real newline. That value
 * must parse; a value broken in any *other* way must still fail loudly.
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
  it("parses a canonical single-line service account", () => {
    const out = parseServiceAccountJson(JSON.stringify(ACCOUNT));
    expect(out).toEqual({
      projectId: "demo",
      clientEmail: "svc@demo.iam.gserviceaccount.com",
      privateKey: PEM,
    });
  });

  it("parses pretty-printed JSON — newlines between tokens are legal", () => {
    const out = parseServiceAccountJson(JSON.stringify(ACCOUNT, null, 2));
    expect(out.privateKey).toBe(PEM);
  });

  it("strips a leading BOM before parsing", () => {
    const out = parseServiceAccountJson("﻿" + JSON.stringify(ACCOUNT));
    expect(out.projectId).toBe("demo");
  });
});

describe("repair path", () => {
  it("repairs the production mangle: real newlines inside private_key", () => {
    // Pretty-printed THEN mangled — the exact shape that failed in prod
    // ("line 53 column 31" of a ~12-line file).
    const out = parseServiceAccountJson(mangle(JSON.stringify(ACCOUNT, null, 2)));
    expect(out.privateKey).toBe(PEM);
    expect(out.clientEmail).toBe("svc@demo.iam.gserviceaccount.com");
  });

  it("repairs the single-line variant of the mangle", () => {
    const out = parseServiceAccountJson(mangle(JSON.stringify(ACCOUNT)));
    expect(out.privateKey).toBe(PEM);
  });

  it("repairs CRLF line endings inside the key", () => {
    const crlf = JSON.stringify(ACCOUNT).replace(/\\n/g, "\r\n");
    const out = parseServiceAccountJson(crlf);
    expect(out.privateKey).toBe(PEM.replace(/\n/g, "\r\n"));
  });

  it("escapes tabs and other control characters inside strings", () => {
    const withCtl = JSON.stringify(ACCOUNT).replace('"demo"', '"de\tmo"');
    const out = parseServiceAccountJson(withCtl);
    expect(out.projectId).toBe("de\tmo");
  });

  it("never corrupts escape sequences adjacent to a mangled newline", () => {
    // A partially-mangled key: one escape survived, one became real.
    const partial = '{"project_id":"demo","client_email":"e@x.i","private_key":"a\\nb\nc"}';
    const out = parseServiceAccountJson(partial);
    expect(out.privateKey).toBe("a\nb\nc");
  });

  it("leaves structural newlines alone while repairing string interiors", () => {
    // Pretty-printed (structural newlines) AND a mangled key interior.
    const pretty = JSON.stringify(ACCOUNT, null, 2);
    const mangled = mangle(pretty);
    expect(parseServiceAccountJson(mangled).projectId).toBe("demo");
  });
});

describe("failure modes stay loud", () => {
  it("throws the strict parse error when repair cannot help", () => {
    expect(() => parseServiceAccountJson("{not json at all")).toThrow(SyntaxError);
  });

  it("throws on truncated JSON — repair must not mask a cut-off paste", () => {
    const cut = JSON.stringify(ACCOUNT).slice(0, 40);
    expect(() => parseServiceAccountJson(cut)).toThrow();
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
