/**
 * Log-safe error helpers (`api/_safeError.ts`) and the WTT cron failure path
 * (`api/cron/_wttFailure.ts`): a caught error's message must never reach a
 * log line or a response body, because it can quote secrets or uids.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { safeErrorCode, safeErrorName } from "../../../api/_safeError.js";
import { wttFailureResponse } from "../../../api/cron/_wttFailure.js";
import buildWttItems from "../../../api/cron/build-wtt-items.js";
import wttNightlyEm from "../../../api/cron/wtt-nightly-em.js";
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
    ["a bare Firebase code", { code: "permission-denied" }, "permission-denied"],
    ["a Node errno code", { code: "ENOTFOUND" }, "ENOTFOUND"],
    ["a Node errno code with an underscore", { code: "EAI_AGAIN" }, "EAI_AGAIN"],
    ["a Node ERR_ code", { code: "ERR_REQUIRE_ESM" }, "ERR_REQUIRE_ESM"],
    ["a Node ERR_ code with digits", { code: "ERR_HTTP2_STREAM_ERROR" }, "ERR_HTTP2_STREAM_ERROR"],
    ["a TLS code", { code: "CERT_HAS_EXPIRED" }, "CERT_HAS_EXPIRED"],
    ["an undici code", { code: "UND_ERR_SOCKET" }, "UND_ERR_SOCKET"],
    [
      "the longest Firebase Auth code",
      { code: "auth/account-exists-with-different-credential" },
      "auth/account-exists-with-different-credential",
    ],
    ["a gRPC status as grpc-<n>", { code: 5 }, "grpc-5"],
    ["gRPC status 0", { code: 0 }, "grpc-0"],
  ])("returns %s", (_label, fields, expected) => {
    expect(safeErrorCode(Object.assign(new Error("Firebase ID token has expired."), fields))).toBe(expected);
  });

  it.each([
    ["a code with free text", { code: "auth/expired PRIVATE KEY" }],
    ["an out-of-range number", { code: 401 }],
    ["a fractional number", { code: 1.5 }],
    ["a negative number", { code: -1 }],
    // Synthetic uid-shaped values (28 chars): never a real uid in this public repo.
    ["a mixed-case uid", { code: "Ab3dEf6hIj9kLm2nOp5qRs8tUv1w" }],
    ["an all-lowercase uid", { code: "ab3def6hij9klm2nop5qrs8tuv1w" }],
    ["an all-uppercase uid starting with E", { code: "EB3DEF6HIJ9KLM2NOP5QRS8TUV1W" }],
    ["a code with digits", { code: "auth/error-42" }],
    ["an uppercase uid with digits but no underscore", { code: "AB3DEF6HIJ9KLM2NOP5QRS8TUV1W" }],
    ["an underscore code with a lowercase letter", { code: "ERR_Http2" }],
    ["an over-long code", { code: `auth/${"a".repeat(60)}` }],
    ["a mixed-case word", { code: "Auth/Expired" }],
    ["a non-string, non-number code", { code: true }],
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

describe.each([
  ["build-wtt-items", buildWttItems],
  ["wtt-nightly-em", wttNightlyEm],
])("%s (stub, WTT disabled)", (_name, handler) => {
  it("refuses other verbs with 405", async () => {
    const res = await handler(new Request("https://example.test/", { method: "DELETE" }));
    expect(res.status).toBe(405);
  });

  it("is a no-op while WTT is disabled", async () => {
    const res = await handler(new Request("https://example.test/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "WTT disabled", processed: 0 });
  });
});
