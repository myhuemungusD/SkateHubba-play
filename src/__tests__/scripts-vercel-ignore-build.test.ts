/**
 * scripts/vercel-ignore-build.mjs decides which pushes Vercel builds.
 * Exit 0 = skip, exit 1 = build. A wrong "skip" would leave production
 * stale, so every unknown case must build.
 */
import { describe, it, expect, vi } from "vitest";
import {
  isNonAppPath,
  decide,
  changedFilesSince,
  mainMergeBase,
  main,
  // @ts-expect-error — plain .mjs script, no types
} from "../../scripts/vercel-ignore-build.mjs";

const SHA = "a".repeat(40);
type Res = { status: number; stdout: string };
const ok = (stdout = ""): Res => ({ status: 0, stdout });
const fail: Res = { status: 1, stdout: "" };

/** Fake spawnSync keyed by the git subcommand. */
function fakeGit(map: Record<string, Res | Res[]>) {
  return vi.fn((_cmd: string, args: string[]) => {
    const v = map[args[0]] ?? fail;
    return Array.isArray(v) ? (v.shift() ?? fail) : v;
  });
}

describe("isNonAppPath", () => {
  it.each([
    "README.md",
    "docs/CHARTER.md",
    ".github/workflows/main.yml",
    "scripts/testers-sync.mjs",
    "functions/src/index.ts",
    "e2e/game.spec.ts",
    "rules-tests/x.test.ts",
    "ios/App/Info.plist",
    "android/app/build.gradle",
    "src/services/foo.test.ts",
    "src/components/Bar.test.tsx",
    "src/__tests__/setup.ts",
    "src/hooks/__tests__/x.ts",
    "firestore.rules",
    "firebase.json",
    "firebase.emulator.json",
    "release-please-config.json",
    ".release-please-manifest.json",
    "capacitor.config.ts",
    ".gitignore",
    ".env.example",
  ])("skippable: %s", (f) => expect(isNonAppPath(f)).toBe(true));

  it.each([
    "src/App.tsx",
    "src/services/foo.ts",
    "public/og-image.png",
    "api/player-meta.ts",
    "index.html",
    "vite.config.ts",
    "package.json",
    "package-lock.json",
    "vercel.json",
    "tsconfig.app.json",
    ".nvmrc",
    "design/closet/x.png",
    "scripts/check-bundle-budget.mjs",
    "scripts/deferAppCss.ts",
    "some-new-file.ts",
  ])("builds: %s", (f) => expect(isNonAppPath(f)).toBe(false));
});

describe("decide", () => {
  it("always skips release-please and dependabot branches", () => {
    expect(decide({ branch: "release-please--branches--main", changedFiles: ["src/App.tsx"] }).build).toBe(false);
    expect(decide({ branch: "dependabot/npm_and_yarn/vite-7", changedFiles: null }).build).toBe(false);
  });

  it("builds when the diff base is unavailable", () => {
    expect(decide({ branch: "feat/x", changedFiles: null })).toEqual({
      build: true,
      reason: expect.stringContaining("no diff base"),
    });
    expect(decide({ branch: undefined, changedFiles: null }).build).toBe(true);
  });

  it("builds on an empty diff (manual redeploy)", () => {
    expect(decide({ branch: "main", changedFiles: [] }).build).toBe(true);
  });

  it("builds main and PR branches when app files change", () => {
    expect(decide({ branch: "main", changedFiles: ["docs/a.md", "src/App.tsx"] }).build).toBe(true);
    const many = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"];
    expect(decide({ branch: "feat/x", changedFiles: many }).reason).toMatch(/e\.ts, \.\.\.$/);
    expect(decide({ branch: "feat/x", changedFiles: ["a.ts"] }).reason).toBe("app files changed: a.ts");
  });

  it("skips main and PR branches when only non-app files change", () => {
    expect(decide({ branch: "main", changedFiles: ["docs/a.md", ".github/x.yml"] })).toEqual({
      build: false,
      reason: "only non-app files changed (2)",
    });
  });
});

describe("changedFilesSince", () => {
  it("returns null for a missing or malformed base", () => {
    const run = fakeGit({});
    expect(changedFilesSince(undefined, run)).toBeNull();
    expect(changedFilesSince("", run)).toBeNull();
    expect(changedFilesSince("HEAD; rm -rf /", run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("diffs when the base commit is present", () => {
    const run = fakeGit({ "cat-file": ok(), diff: ok("src/App.tsx\n docs/a.md \n\n") });
    expect(changedFilesSince(SHA, run)).toEqual(["src/App.tsx", "docs/a.md"]);
    expect(run.mock.calls.map((c) => c[1][0])).toEqual(["cat-file", "diff"]);
  });

  it("fetches a base missing from the shallow clone", () => {
    const run = fakeGit({ "cat-file": fail, fetch: ok(), diff: ok("README.md\n") });
    expect(changedFilesSince(SHA, run)).toEqual(["README.md"]);
    expect(run.mock.calls.map((c) => c[1][0])).toEqual(["cat-file", "fetch", "diff"]);
  });

  it("returns null when the diff fails", () => {
    expect(changedFilesSince(SHA, fakeGit({ "cat-file": fail, fetch: fail, diff: fail }))).toBeNull();
  });

  it("defaults to the real spawnSync", () => {
    // A sha that cannot exist: real git fails, so the result is null.
    expect(changedFilesSince("0".repeat(40))).toBeNull();
  });
});

describe("mainMergeBase", () => {
  it("returns the merge-base with origin/main", () => {
    expect(mainMergeBase(fakeGit({ fetch: ok(), "merge-base": ok(`${SHA}\n`) }))).toBe(SHA);
  });

  it("returns null when main can't be fetched or has no merge-base", () => {
    expect(mainMergeBase(fakeGit({ fetch: fail }))).toBeNull();
    expect(mainMergeBase(fakeGit({ fetch: ok(), "merge-base": fail }))).toBeNull();
  });

  it("defaults to the real spawnSync", () => {
    expect(() => mainMergeBase()).not.toThrow();
  });
});

describe("main", () => {
  it("diffs a first-push PR branch against its merge-base with main", () => {
    const run = fakeGit({ fetch: ok(), "merge-base": ok(SHA), "cat-file": ok(), diff: ok("docs/a.md\n") });
    expect(main({ VERCEL_GIT_COMMIT_REF: "docs/x" }, run, vi.fn())).toBe(0);
    expect(run.mock.calls.map((c) => c[1][0])).toEqual(["fetch", "merge-base", "cat-file", "diff"]);
  });

  it("builds main with no previous sha without guessing a base", () => {
    const run = fakeGit({});
    expect(main({ VERCEL_GIT_COMMIT_REF: "main" }, run, vi.fn())).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 0 (skip) for a dependabot branch without touching git", () => {
    const run = fakeGit({});
    const log = vi.fn();
    expect(main({ VERCEL_GIT_COMMIT_REF: "dependabot/x" }, run, log)).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("SKIP"));
  });

  it("returns 1 (build) when app files changed", () => {
    const run = fakeGit({ "cat-file": ok(), diff: ok("src/App.tsx\n") });
    const log = vi.fn();
    expect(main({ VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_PREVIOUS_SHA: SHA }, run, log)).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("BUILD"));
  });

  it("returns 0 (skip) for a docs-only PR and 1 with no previous sha", () => {
    const run = fakeGit({ "cat-file": ok(), diff: ok("docs/a.md\n") });
    expect(main({ VERCEL_GIT_COMMIT_REF: "docs/x", VERCEL_GIT_PREVIOUS_SHA: SHA }, run, vi.fn())).toBe(0);
    expect(main({}, fakeGit({}), vi.fn())).toBe(1);
  });

  it("uses process.env and console.log by default", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prev = process.env.VERCEL_GIT_COMMIT_REF;
    process.env.VERCEL_GIT_COMMIT_REF = "release-please--branches--main";
    try {
      expect(main()).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.VERCEL_GIT_COMMIT_REF;
      else process.env.VERCEL_GIT_COMMIT_REF = prev;
      spy.mockRestore();
    }
  });
});
