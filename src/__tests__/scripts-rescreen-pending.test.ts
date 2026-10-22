/** Unit coverage for scripts/moderation/rescreen-pending.mjs (flags, switch, log file, refusals). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import * as rescreen from "../../scripts/moderation/rescreen-pending.mjs";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rescreen-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parseArgs", () => {
  it("defaults to a dry run with safe batch settings", () => {
    expect(rescreen.parseArgs([], new Date("2026-10-22T06:30:00Z"))).toEqual({
      apply: false,
      limit: 25,
      delayMs: 5000,
      minAgeMinutes: 10,
      maxErrors: 2,
      log: "rescreen-2026-10-21.md",
      database: "skatehubba",
      redact: false,
      summary: "",
    });
  });

  it("reads every flag, in both --flag value and --flag=value form", () => {
    expect(
      rescreen.parseArgs([
        "--apply",
        "--limit",
        "3",
        "--delay-ms=0",
        "--min-age-minutes",
        "0",
        "--max-errors=5",
        "--log",
        "/x/r.md",
        "--database=other",
        "--redact",
        "--summary",
        "/x/s.md",
      ]),
    ).toEqual({
      apply: true,
      limit: 3,
      delayMs: 0,
      minAgeMinutes: 0,
      maxErrors: 5,
      log: "/x/r.md",
      database: "other",
      redact: true,
      summary: "/x/s.md",
    });
    expect(rescreen.parseArgs(["--apply", "--dry-run"]).apply).toBe(false);
  });

  it("rejects bad numbers, missing values and unknown flags", () => {
    expect(() => rescreen.parseArgs(["--limit", "0"])).toThrow("--limit needs a whole number above 0");
    expect(() => rescreen.parseArgs(["--limit"])).toThrow('got ""');
    expect(() => rescreen.parseArgs(["--delay-ms", "-1"])).toThrow("--delay-ms needs a whole number");
    expect(() => rescreen.parseArgs(["--log"])).toThrow("--log needs a path");
    expect(() => rescreen.parseArgs(["--database"])).toThrow("--database needs an id");
    expect(() => rescreen.parseArgs(["--summary"])).toThrow("--summary needs a path");
    expect(() => rescreen.parseArgs(["--no-redact"])).toThrow("Unknown flag --no-redact");
    expect(() => rescreen.parseArgs(["--force"])).toThrow("Unknown flag --force");
  });
});

describe("moderationSwitch (same strict parse as defineBoolean, default off)", () => {
  it("only the exact word true is on; the environment wins", () => {
    expect(rescreen.moderationSwitch({ MODERATION_ENABLED: "true" })).toEqual({ on: true, source: "environment" });
    expect(rescreen.moderationSwitch({ MODERATION_ENABLED: "TRUE" }).on).toBe(false);
    expect(rescreen.moderationSwitch({ MODERATION_ENABLED: "1" }).on).toBe(false);
  });

  it("falls back to the functions parameter file, then to off", () => {
    const file = join(dir, "functions.env");
    writeFileSync(file, "DICE_ENABLED=true\nMODERATION_ENABLED=true\n");
    expect(rescreen.moderationSwitch({ SKATEHUBBA_FUNCTIONS_ENV: file })).toEqual({
      on: true,
      source: "functions parameter file",
    });
    writeFileSync(file, "DICE_ENABLED=true\n");
    expect(rescreen.moderationSwitch({ SKATEHUBBA_FUNCTIONS_ENV: file })).toMatchObject({ on: false });
    expect(rescreen.moderationSwitch({ SKATEHUBBA_FUNCTIONS_ENV: join(dir, "missing.env") }).source).toMatch(
      /^default \(off/,
    );
  });
});

describe("defaultLogPath", () => {
  it("is relative to the cwd and dated by the Pacific day, never a box path", () => {
    expect(rescreen.defaultLogPath(new Date("2026-10-22T06:30:00Z"))).toBe("rescreen-2026-10-21.md");
    expect(rescreen.defaultLogPath(new Date("2026-10-22T08:00:00Z"))).toBe("rescreen-2026-10-22.md");
    expect(rescreen.parseArgs([]).log).toMatch(/^rescreen-\d{4}-\d{2}-\d{2}\.md$/);
  });
});

describe("redactFrom (public CI logs never carry owners)", () => {
  it("is on with --redact, and always on when GITHUB_ACTIONS=true", () => {
    expect(rescreen.redactFrom(rescreen.parseArgs([]), {})).toBe(false);
    expect(rescreen.redactFrom(rescreen.parseArgs(["--redact"]), {})).toBe(true);
    expect(rescreen.redactFrom(rescreen.parseArgs([]), { GITHUB_ACTIONS: "true" })).toBe(true);
    expect(rescreen.redactFrom(rescreen.parseArgs([]), { GITHUB_ACTIONS: "false" })).toBe(false);
  });
});

describe("projectIdFrom", () => {
  it("prefers GOOGLE_CLOUD_PROJECT, then GCLOUD_PROJECT, else empty (ADC decides)", () => {
    expect(rescreen.projectIdFrom({ GOOGLE_CLOUD_PROJECT: " sk8hub-d7806 ", GCLOUD_PROJECT: "other" })).toBe(
      "sk8hub-d7806",
    );
    expect(rescreen.projectIdFrom({ GCLOUD_PROJECT: "demo-skatehubba" })).toBe("demo-skatehubba");
    expect(rescreen.projectIdFrom({})).toBe("");
  });
});

describe("appendLog", () => {
  it("creates the file with a header once, then appends runs", () => {
    const log = join(dir, "nested", "rescreen.md");
    rescreen.appendLog(log, "## run 1\n");
    rescreen.appendLog(log, "## run 2\n");
    const text = readFileSync(log, "utf8");
    expect(text.match(/# Clip moderation rescreen log/g)).toHaveLength(1);
    expect(text.indexOf("## run 1")).toBeLessThan(text.indexOf("## run 2"));
  });

  it("formats times in Pacific", () => {
    expect(rescreen.pacific(new Date("2026-10-22T06:00:00Z"))).toBe("10/21/2026, 23:00:00 PT");
  });
});

describe("main refusals", () => {
  it("fails closed on --apply while MODERATION_ENABLED is off, before touching Firestore", async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    const log = join(dir, "r.md");
    const code = await rescreen.main(
      ["--apply", "--log", log],
      { MODERATION_ENABLED: "false", SKATEHUBBA_FUNCTIONS_ENV: join(dir, "none.env") },
      io,
    );
    expect(code).toBe(2);
    expect(io.error.mock.calls[0][0]).toContain("Refusing --apply: MODERATION_ENABLED is off (environment)");
    expect(existsSync(log)).toBe(false);
  });

  it("points at the build step when the compiled functions code is missing", async () => {
    if (existsSync(rescreen.COMPILED)) return; // a local build is present; CI runs without it
    const io = { log: vi.fn(), error: vi.fn() };
    expect(await rescreen.main([], {}, io)).toBe(2);
    expect(io.error.mock.calls[0][0]).toContain("npm --prefix functions run build");
  });
});
