/** Unit coverage for scripts/testers-sync.mjs and scripts/lib/functions-env.mjs. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import * as sync from "../../scripts/testers-sync.mjs";
// @ts-expect-error — plain .mjs script, no types
import * as fenv from "../../scripts/lib/functions-env.mjs";

const JASON = "DVpY1kJYXsYEJN8j3jr3r0wITl72";
const MIKE = "v5quZlBLijQYsQhwDqqmRkw6uzR2";

describe("functions-env helpers", () => {
  it("parses, sets and normalizes", () => {
    expect(fenv.parseDotenv('# c\nA=1\nB="x y"\n\nbad line\nC=')).toEqual({ A: "1", B: "x y", C: "" });
    expect(fenv.setDotenv("# keep\nA=1\nB=2\n", { B: "3", D: "4" })).toBe("# keep\nA=1\nB=3\nD=4\n");
    expect(fenv.setDotenv("", { A: "1" })).toBe("A=1\n");
    expect(fenv.normalizeUids(" b, a ,,b")).toEqual(["a", "b"]);
    expect(fenv.normalizeUids(["z", "a"])).toEqual(["a", "z"]);
    expect(fenv.normalizeUids(undefined)).toEqual([]);
    expect(fenv.functionsEnvPath({ SKATEHUBBA_FUNCTIONS_ENV: "/x.env" })).toBe("/x.env");
    expect(fenv.functionsEnvPath({})).toMatch(/functions\.sk8hub-d7806\.env$/);
  });
});

describe("discoverLists / unknownLists", () => {
  it("finds every list in the real repo and all are known", () => {
    const found = sync.discoverLists();
    for (const k of [
      "XP_TESTER_UIDS",
      "DICE_TESTER_UIDS",
      "MAP_TESTER_UIDS",
      "CLOSET_TESTER_UIDS",
      "PRO_BLESSING_TESTER_UIDS",
    ]) {
      expect(found[k]?.length).toBeGreaterThan(0);
    }
    expect(found.XP_TESTER_UIDS).toContain("api/cron/resolve-expired-disputes.ts");
    expect(sync.unknownLists(found)).toEqual([]);
  });

  it("flags a new list and ignores tests", () => {
    const root = mkdtempSync(join(tmpdir(), "testers-"));
    mkdirSync(join(root, "functions/src/__tests__"), { recursive: true });
    writeFileSync(join(root, "functions/src/x.ts"), 'defineString("SPOT_TESTER_UIDS")');
    writeFileSync(join(root, "functions/src/x.test.ts"), "OTHER_TESTER_UIDS");
    writeFileSync(join(root, "functions/src/__tests__/y.ts"), "THIRD_TESTER_UIDS");
    const found = sync.discoverLists(root);
    expect(found).toEqual({ SPOT_TESTER_UIDS: ["functions/src/x.ts"] });
    expect(sync.unknownLists(found)).toEqual(["SPOT_TESTER_UIDS"]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("planSync", () => {
  it("classifies ok / drift / missing / unreadable", () => {
    const known = {
      A_TESTER_UIDS: ["functions", "vercel"],
      B_TESTER_UIDS: ["functions"],
      C_TESTER_UIDS: ["functions"],
    };
    const rows = sync.planSync(
      [MIKE, JASON],
      { functions: { A_TESTER_UIDS: `${JASON},${MIKE}`, B_TESTER_UIDS: JASON }, vercel: null },
      known,
    );
    expect(rows.map((r: { status: string }) => r.status)).toEqual(["ok", "unreadable", "drift", "missing"]);
  });
});

describe("main", () => {
  let dir: string;
  let files: Record<string, string>;
  let io: Record<string, ReturnType<typeof vi.fn>>;
  const out = () => io.log.mock.calls.flat().join("\n");
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testers-main-"));
    files = {};
    io = {
      readFeatureTesters: vi.fn(async () => [JASON, MIKE]),
      readVercel: vi.fn(() => ({ XP_TESTER_UIDS: JASON })),
      writeVercel: vi.fn(),
      readFile: vi.fn((p: string) => files[p] ?? null),
      writeFile: vi.fn((p: string, t: string) => (files[p] = t)),
      log: vi.fn(),
      error: vi.fn(),
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const env = () => ({ SKATEHUBBA_FUNCTIONS_ENV: join(dir, "f.env") });

  it("--check passes on the repo", async () => {
    expect(await sync.main(["--check"], io, env())).toBe(0);
  });

  it("--check fails on an unknown list", async () => {
    mkdirSync(join(dir, "api"), { recursive: true });
    writeFileSync(join(dir, "api/a.ts"), "process.env.NEW_TESTER_UIDS");
    expect(await sync.main(["--check"], io, { TESTERS_SYNC_ROOT: dir })).toBe(1);
    expect(io.error.mock.calls.flat().join(" ")).toContain("NEW_TESTER_UIDS");
  });

  it("dry run reports and writes nothing", async () => {
    expect(await sync.main([], io, env())).toBe(0);
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.writeVercel).not.toHaveBeenCalled();
    expect(out()).toContain("dry run");
  });

  it("--apply writes functions file and Vercel", async () => {
    files[env().SKATEHUBBA_FUNCTIONS_ENV] = `XP_ENABLED=false\nDICE_TESTER_UIDS=${MIKE},${JASON}\n`;
    expect(await sync.main(["--apply"], io, env())).toBe(0);
    const text = files[env().SKATEHUBBA_FUNCTIONS_ENV];
    const want = [JASON, MIKE].sort().join(",");
    expect(text).toContain("XP_ENABLED=false");
    expect(text).toContain(`MAP_TESTER_UIDS=${want}`);
    expect(io.writeVercel).toHaveBeenCalledWith("XP_TESTER_UIDS", want);
  });

  it("reports when everything matches, honors --uids and --skip-vercel", async () => {
    const want = [JASON, MIKE].sort().join(",");
    files[env().SKATEHUBBA_FUNCTIONS_ENV] = ["XP", "DICE", "MAP", "CLOSET", "PRO_BLESSING", "SPOT_PRESENCE"]
      .map((k) => `${k}_TESTER_UIDS=${want}`)
      .join("\n");
    expect(await sync.main(["--uids", `${MIKE},${JASON}`, "--skip-vercel"], io, env())).toBe(0);
    expect(io.readFeatureTesters).not.toHaveBeenCalled();
    expect(out()).toContain("everything matches");
  });

  it("refuses an empty source and handles read failures", async () => {
    io.readFeatureTesters.mockResolvedValueOnce([]);
    expect(await sync.main([], io, env())).toBe(1);
    io.readFeatureTesters.mockRejectedValueOnce(new Error("no creds"));
    expect(await sync.main([], io, env())).toBe(1);
    expect(io.error.mock.calls.flat().join(" ")).toContain("no creds");
  });
});
