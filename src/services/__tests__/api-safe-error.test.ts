/**
 * Log-safe error helpers (`api/_safeError.ts`) and the WTT cron failure path
 * (`api/cron/_wttFailure.ts`): a caught error's message must never reach a
 * log line or a response body, because it can quote secrets or uids.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { safeErrorCode, safeErrorName } from "../../../api/_safeError.js";
import { wttFailureResponse } from "../../../api/cron/_wttFailure.js";
import { MALFORMED_KEY_JSON } from "./cron.test-helpers";

/** An error whose message quotes a secret, the way JSON.parse does. */
function quotingError(): Error {
  try {
    JSON.parse(MALFORMED_KEY_JSON);
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected JSON.parse to throw");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeErrorName", () => {
  it("returns an identifier class name", () => {
    expect(safeErrorName(new TypeError("PRIVATE KEY"))).toBe("TypeError");
    expect(safeErrorName(quotingError())).toBe("SyntaxError");
  });

  it("falls back for a non-identifier name and reports the type of a non-Error", () => {
    expect(safeErrorName(Object.assign(new Error("x"), { name: "PRIVATE KEY leak" }))).toBe("Error");
    expect(safeErrorName("PRIVATE KEY")).toBe("string");
    expect(safeErrorName(undefined)).toBe("undefined");
  });
});

describe("safeErrorCode", () => {
  it.each([
    ["a Firebase auth code", { code: "auth/id-token-expired" }, "auth/id-token-expired"],
    ["a bare code", { code: "ENOTFOUND" }, "ENOTFOUND"],
  ])("returns %s", (_label, fields, expected) => {
    expect(safeErrorCode(Object.assign(new Error("Firebase ID token has expired."), fields))).toBe(expected);
  });

  it.each([
    ["a code with free text", { code: "auth/expired PRIVATE KEY" }],
    ["a non-string code", { code: 401 }],
    ["no code", {}],
  ])("falls back to the class for %s", (_label, fields) => {
    expect(safeErrorCode(Object.assign(new RangeError("PRIVATE KEY"), fields))).toBe("RangeError");
  });

  it("handles null and primitive throws", () => {
    expect(safeErrorCode(null)).toBe("object");
    expect(safeErrorCode("PRIVATE KEY")).toBe("string");
  });
});

describe("wttFailureResponse", () => {
  it("logs and returns a fixed 500 with no part of the message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = quotingError();
    expect(err.message).toContain("PRIVATE KEY");
    const res = wttFailureResponse("wtt_build_items_failed", err, "Failed to build WTT items");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ error: "Failed to build WTT items", message: "Internal error." });
    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "wtt_build_items_failed", errorName: "SyntaxError" }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("PRIVATE KEY");
  });
});
