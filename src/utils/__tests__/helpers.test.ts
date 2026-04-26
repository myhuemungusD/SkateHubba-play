import { describe, it, expect } from "vitest";
import {
  getErrorCode,
  parseFirebaseError,
  EMAIL_RE,
  LETTERS,
  isFirebaseStorageUrl,
  pwStrength,
  newGameShell,
  clipExportFormat,
} from "../helpers";

describe("getErrorCode", () => {
  it("extracts code from Firebase-like error objects", () => {
    expect(getErrorCode({ code: "auth/email-already-in-use" })).toBe("auth/email-already-in-use");
  });

  it("returns empty string when code is not a string", () => {
    expect(getErrorCode({ code: 42 })).toBe("");
  });

  it("returns empty string for null", () => {
    expect(getErrorCode(null)).toBe("");
  });

  it("returns empty string for primitive", () => {
    expect(getErrorCode("string")).toBe("");
  });

  it("returns empty string for object without code", () => {
    expect(getErrorCode({ message: "no code" })).toBe("");
  });
});

describe("parseFirebaseError", () => {
  it("returns message from Error instances", () => {
    expect(parseFirebaseError(new Error("boom"))).toBe("boom");
  });

  it("returns message field from objects with message", () => {
    expect(parseFirebaseError({ message: "firebase error" })).toBe("firebase error");
  });

  it("returns code field from objects without message but with code", () => {
    expect(parseFirebaseError({ code: "auth/error" })).toBe("auth/error");
  });

  it("returns JSON.stringify for objects without message or code", () => {
    expect(parseFirebaseError({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  it("returns String() for primitive non-object values", () => {
    expect(parseFirebaseError("string error")).toBe("string error");
  });
});

describe("EMAIL_RE", () => {
  it("matches valid emails", () => {
    expect(EMAIL_RE.test("user@example.com")).toBe(true);
    expect(EMAIL_RE.test("a@b.co")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(EMAIL_RE.test("notanemail")).toBe(false);
    expect(EMAIL_RE.test("@no.com")).toBe(false);
    expect(EMAIL_RE.test("no@.com")).toBe(false);
    expect(EMAIL_RE.test("a@b.c")).toBe(false);
  });
});

describe("LETTERS", () => {
  it("contains S.K.A.T.E.", () => {
    expect(LETTERS).toEqual(["S", "K", "A", "T", "E"]);
  });
});

describe("isFirebaseStorageUrl", () => {
  it("accepts firebasestorage.googleapis.com URLs", () => {
    expect(isFirebaseStorageUrl("https://firebasestorage.googleapis.com/v0/b/bucket/o/file.webm")).toBe(true);
  });

  it("accepts *.firebasestorage.app URLs", () => {
    expect(isFirebaseStorageUrl("https://my-app.firebasestorage.app/v0/b/bucket/o/file.webm")).toBe(true);
  });

  it("rejects non-https URLs", () => {
    expect(isFirebaseStorageUrl("http://firebasestorage.googleapis.com/v0/b/bucket/o/file.webm")).toBe(false);
  });

  it("rejects non-firebase URLs", () => {
    expect(isFirebaseStorageUrl("https://evil.com/redirect?url=firebasestorage.googleapis.com")).toBe(false);
  });

  it("returns false for invalid URLs (catch branch)", () => {
    expect(isFirebaseStorageUrl("not-a-url")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isFirebaseStorageUrl("")).toBe(false);
  });
});

describe("pwStrength", () => {
  it("returns 1 for short passwords", () => {
    expect(pwStrength("abc")).toBe(1);
    expect(pwStrength("1234567")).toBe(1);
  });

  it("returns 1 for 8+ char lowercase-only passwords", () => {
    expect(pwStrength("abcdefgh")).toBe(1);
  });

  it("returns 2 for 8+ chars with uppercase", () => {
    expect(pwStrength("Abcdefgh")).toBe(2);
  });

  it("returns 2 for 8+ chars with digit", () => {
    expect(pwStrength("abcdefg1")).toBe(2);
  });

  it("returns 2 for 8+ chars with symbol", () => {
    expect(pwStrength("abcdefg!")).toBe(2);
  });

  it("returns 3 for 12+ chars with upper/digit and symbol", () => {
    expect(pwStrength("Abcdefghijk!")).toBe(3);
  });

  it("returns 3 for 12+ chars with digit and symbol", () => {
    expect(pwStrength("abcdefghijk1!")).toBe(3);
  });
});

describe("newGameShell", () => {
  it("creates a game shell with correct structure", () => {
    const shell = newGameShell("g1", "u1", "sk8r", "u2", "rival");
    expect(shell.id).toBe("g1");
    expect(shell.player1Uid).toBe("u1");
    expect(shell.player2Uid).toBe("u2");
    expect(shell.player1Username).toBe("sk8r");
    expect(shell.player2Username).toBe("rival");
    expect(shell.p1Letters).toBe(0);
    expect(shell.p2Letters).toBe(0);
    expect(shell.status).toBe("active");
    expect(shell.phase).toBe("setting");
    expect(shell.currentTurn).toBe("u1");
    expect(shell.currentSetter).toBe("u1");
    expect(shell.winner).toBeNull();
    expect(shell.turnNumber).toBe(1);
  });

  it("defaults spotId to null when not provided", () => {
    const shell = newGameShell("g1", "u1", "sk8r", "u2", "rival");
    expect(shell.spotId).toBeNull();
  });

  it("carries the spotId when one is passed in", () => {
    const validSpotId = "11111111-2222-3333-4444-555555555555";
    const shell = newGameShell("g1", "u1", "sk8r", "u2", "rival", validSpotId);
    expect(shell.spotId).toBe(validSpotId);
  });
});

describe("clipExportFormat", () => {
  it("maps video/mp4 blobs to mp4 + video/mp4 (native clips)", () => {
    expect(clipExportFormat(new Blob([], { type: "video/mp4" }))).toEqual({
      ext: "mp4",
      mimeType: "video/mp4",
    });
  });

  it("maps video/webm blobs to webm + video/webm (web clips)", () => {
    expect(clipExportFormat(new Blob([], { type: "video/webm" }))).toEqual({
      ext: "webm",
      mimeType: "video/webm",
    });
  });

  it("falls back to webm when blob.type is empty (CDN stripped header)", () => {
    expect(clipExportFormat(new Blob([]))).toEqual({
      ext: "webm",
      mimeType: "video/webm",
    });
  });
});
