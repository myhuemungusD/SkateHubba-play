import { describe, expect, it } from "vitest";
import { safeErrorCode } from "./safeError.js";

const withCode = (code: unknown) => Object.assign(new RangeError("games/g/turn-1/set-SECRETUID.mp4"), { code });

describe("safeErrorCode (functions)", () => {
  it.each([
    ["a Storage HTTP status", 403, "code-403"],
    ["a gRPC status", 5, "code-5"],
    ["a Firebase code", "storage/object-not-found", "storage/object-not-found"],
    ["a Node errno", "ECONNRESET", "ECONNRESET"],
  ])("returns %s", (_label, code, expected) => {
    expect(safeErrorCode(withCode(code))).toBe(expected);
  });

  it.each([
    ["free text", "denied games/g/x.mp4"],
    ["a mixed-case uid", "DVpY1kJYXsYEJN8j3jr3r0wITl72"],
    ["an out-of-range number", 1000],
    ["a fraction", 1.5],
  ])("falls back to the class for %s", (_label, code) => {
    expect(safeErrorCode(withCode(code))).toBe("RangeError");
  });

  it("handles odd names and primitive throws", () => {
    expect(safeErrorCode(Object.assign(new Error("x"), { name: "bad name" }))).toBe("Error");
    expect(safeErrorCode("games/x")).toBe("string");
    expect(safeErrorCode(null)).toBe("object");
  });
});
