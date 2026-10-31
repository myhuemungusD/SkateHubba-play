import { afterEach, describe, expect, it, vi } from "vitest";
import { errorLogFields } from "../errors";

describe("errorLogFields", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds the stack for an Error in dev builds", () => {
    vi.stubEnv("DEV", true);
    const err = new Error("texture fetch failed");
    expect(errorLogFields(err)).toEqual({ error: "texture fetch failed", stack: err.stack });
  });

  it("keeps only the message in production builds", () => {
    vi.stubEnv("DEV", false);
    expect(errorLogFields(new Error("texture fetch failed"))).toEqual({ error: "texture fetch failed" });
  });

  it("has no stack for non-Error values, even in dev", () => {
    vi.stubEnv("DEV", true);
    expect(errorLogFields({ code: "storage/unauthorized" })).toEqual({ error: "storage/unauthorized" });
    expect(errorLogFields("plain string")).toEqual({ error: "plain string" });
  });

  it("skips an empty stack", () => {
    vi.stubEnv("DEV", true);
    const err = new Error("no trace");
    err.stack = "";
    expect(errorLogFields(err)).toEqual({ error: "no trace" });
  });
});
