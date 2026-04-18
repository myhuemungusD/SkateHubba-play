import { describe, it, expect } from "vitest";
import { hashUid, redactPII } from "../pii";

describe("hashUid", () => {
  it("produces a stable uid_ + 8 hex char surrogate", () => {
    const h = hashUid("abc123");
    expect(h).toMatch(/^uid_[0-9a-f]{8}$/);
  });

  it("is deterministic", () => {
    expect(hashUid("abc123")).toBe(hashUid("abc123"));
  });

  it("produces different surrogates for different inputs", () => {
    expect(hashUid("abc123")).not.toBe(hashUid("abc124"));
  });

  it("passes falsy input through unchanged", () => {
    expect(hashUid("")).toBe("");
  });
});

describe("redactPII", () => {
  it("returns undefined when data is undefined", () => {
    expect(redactPII(undefined)).toBeUndefined();
  });

  it("replaces email values with the redacted placeholder", () => {
    expect(redactPII({ email: "a@b.com" })).toEqual({ email: "[REDACTED_EMAIL]" });
  });

  it("replaces uid values with a hashed surrogate", () => {
    const out = redactPII({ uid: "abc123" }) as Record<string, unknown>;
    expect(out.uid).toBe(hashUid("abc123"));
  });

  it("hashes camelCase *Uid suffix keys", () => {
    const out = redactPII({
      challengerUid: "u1",
      winnerUid: "u2",
      viewerUid: "u3",
    }) as Record<string, unknown>;
    expect(out.challengerUid).toBe(hashUid("u1"));
    expect(out.winnerUid).toBe(hashUid("u2"));
    expect(out.viewerUid).toBe(hashUid("u3"));
  });

  it("does not hash unrelated keys whose last three letters are 'uid'", () => {
    const out = redactPII({
      uuid: "11111111-2222-3333-4444-555555555555",
      squid: "not-a-firebase-uid",
      druid: "also-fine",
    }) as Record<string, unknown>;
    expect(out.uuid).toBe("11111111-2222-3333-4444-555555555555");
    expect(out.squid).toBe("not-a-firebase-uid");
    expect(out.druid).toBe("also-fine");
  });

  it("leaves non-PII fields untouched", () => {
    const input = { gameId: "g1", trickName: "kickflip", landed: true, sizeBytes: 1024 };
    expect(redactPII(input)).toEqual(input);
  });

  it("passes non-string email/uid values through without crashing", () => {
    const input = { email: null, uid: undefined, gameId: "g1" };
    expect(redactPII(input)).toEqual(input);
  });

  it("does not match keys that merely contain 'email' (only exact match)", () => {
    const out = redactPII({ emailVerified: true }) as Record<string, unknown>;
    expect(out.emailVerified).toBe(true);
  });
});
