/** Unit coverage for scripts/review-kit (plan, seed, screenshot args). */
import { describe, it, expect, vi } from "vitest";
// @ts-expect-error — plain .mjs script, no types
import * as plan from "../../scripts/review-kit/plan.mjs";
// @ts-expect-error — plain .mjs script, no types
import * as seed from "../../scripts/review-kit/seed.mjs";
// @ts-expect-error — plain .mjs script, no types
import * as shots from "../../scripts/review-kit/screenshots.mjs";

const ENV = { REVIEW_EMAIL: "review@example.com", REVIEW_PASSWORD: "correct-horse-1" };

describe("plan", () => {
  it("covers every required store size at the exact pixel size", () => {
    const px = Object.fromEntries(plan.SIZES.map((s: { id: string }) => [s.id, plan.pixelSize(s)]));
    expect(px["ios-6.9"]).toEqual({ w: 1320, h: 2868 });
    expect(px["ios-6.3"]).toEqual({ w: 1206, h: 2622 });
    expect(px["ios-6.5"]).toEqual({ w: 1284, h: 2778 });
    expect(px["ios-5.5"]).toEqual({ w: 1242, h: 2208 });
    expect(px["ipad-13"]).toBeUndefined(); // iPhone-only app: no iPad set
    expect(px["play-phone"]).toEqual({ w: 1080, h: 1920 });
    expect(plan.shotPath("/o", plan.SIZES[0], plan.SCREENS[0])).toBe("/o/ios-6.9/01-game.png");
  });

  it("reads env without defaults for secrets", () => {
    expect(plan.reviewEnv({}).missing).toEqual(["REVIEW_EMAIL", "REVIEW_PASSWORD (10+ characters)"]);
    const ok = plan.reviewEnv({ ...ENV, REVIEW_USERNAME: "AppRev", REVIEW_BASE_URL: "http://x/" });
    expect(ok).toMatchObject({ missing: [], username: "apprev", appUrl: "http://x" });
  });

  it("builds deterministic, public-only seed docs", () => {
    const docs = plan.buildSeedDocs({ uid: "U", username: "appreview", appUrl: "https://a", now: new Date(0) });
    const paths = docs.map(([p]: [string]) => p);
    expect(paths).toContain("users/U");
    expect(paths).toContain("usernames/appreview");
    expect(paths.filter((p: string) => p.startsWith("games/"))).toHaveLength(10);
    expect(paths.filter((p: string) => p.startsWith("clips/"))).toHaveLength(8);
    expect(paths.filter((p: string) => p.startsWith("spots/"))).toHaveLength(6);
    expect(paths.filter((p: string) => p.startsWith("users/U/locker/"))).toHaveLength(4);
    expect(paths.filter((p: string) => p.startsWith("users/U/achievements/"))).toHaveLength(6);
    expect(paths.filter((p: string) => p.startsWith("users/U/passport/"))).toHaveLength(3);
    expect(paths).toContain("passportSettings/U");
    expect(paths.some((p: string) => p.startsWith("config/"))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
    const clip = docs.find(([p]: [string]) => p.startsWith("clips/"))[1];
    expect(clip.videoUrl).toBe("https://a/sh-video-edit.mp4");
    // The feed shows user posts only, so every seeded clip must be one.
    for (const [p, d] of docs.filter(([p]: [string]) => p.startsWith("clips/"))) {
      expect(d, p).toMatchObject({ source: "user", gameId: null, turnNumber: null, role: null });
    }
    const priv = docs.find(([p]: [string]) => p === "users/U/private/profile")[1];
    expect(priv.tipsDisabled).toBeUndefined();
  });

  it("uses the Storage clip and can turn tips off for screenshot runs", () => {
    const url = plan.storageDownloadUrl("b", plan.DEMO_VIDEO_PATH, "t");
    expect(url).toBe(
      "https://firebasestorage.googleapis.com/v0/b/b/o/review-kit%2Fsh-video-edit.mp4?alt=media&token=t",
    );
    const docs = plan.buildSeedDocs({
      uid: "U",
      username: "a",
      appUrl: "https://a",
      videoUrl: url,
      tipsDisabled: true,
    });
    const game = docs.find(([p]: [string]) => p === "games/review-demo-your-turn")[1];
    expect(game.currentTrickVideoUrl).toBe(url);
    expect(docs.find(([p]: [string]) => p === "users/U/private/profile")[1].tipsDisabled).toBe(true);
  });

  it("credits Mike White on every seeded Closet item and never seeds hidden screens", () => {
    const docs = plan.buildSeedDocs({ uid: "U", username: "a", appUrl: "https://a" });
    const locker = docs
      .filter(([p]: [string]) => p.startsWith("users/U/locker/"))
      .map(([, d]: [string, { brand: string }]) => d);
    expect(locker.every((d: { brand: string }) => d.brand === "Mike White")).toBe(true);
    expect(plan.SCREENS.some((s: { path: string }) => plan.FORBIDDEN_PATHS.includes(s.path))).toBe(false);
  });

  it("seeds letters, kai's stats and a 1–1 head-to-head with kai", () => {
    const docs = plan.buildSeedDocs({ uid: "U", username: "a", appUrl: "https://a" });
    const doc = (path: string) => docs.find(([p]: [string]) => p === path)?.[1];
    const me = doc("users/U");
    expect(me).toMatchObject({ lettersGiven: 88, lettersTaken: 58, currentWinStreak: 2 });
    // At least 5 given per win and 5 taken per loss.
    expect(me.lettersGiven).toBeGreaterThanOrEqual(me.wins * 5);
    expect(me.lettersTaken).toBeGreaterThanOrEqual(me.losses * 5);
    expect(me.recentResults.slice(-2)).toEqual(["W", "W"]);

    const kai = doc("users/review-demo-opp-1");
    expect(kai).toMatchObject({ username: "kickflip_kai", wins: 22, losses: 9, gamesPlayed: 31 });
    expect(kai.wins + kai.losses).toBe(kai.gamesPlayed);
    expect(doc("users/review-demo-opp-2").wins).toBeUndefined();

    const vsKai = docs
      .filter(([p]: [string]) => p.startsWith("games/"))
      .map(([, g]: [string, { player2Uid: string; status: string; winner: string }]) => g)
      .filter(
        (g: { player2Uid: string; status: string }) => g.player2Uid === "review-demo-opp-1" && g.status === "complete",
      );
    expect(vsKai.map((g: { winner: string }) => g.winner).sort()).toEqual(["U", "review-demo-opp-1"]);
  });
});

function fakeAdmin(exists: boolean) {
  const writes: string[] = [];
  const admin = {
    auth: {
      getUserByEmail: vi.fn(async () => {
        if (exists) return { uid: "OLD" };
        throw Object.assign(new Error("nf"), { code: "auth/user-not-found" });
      }),
      updateUser: vi.fn(async () => ({})),
      createUser: vi.fn(async () => ({ uid: "NEW" })),
    },
    db: {
      doc: (p: string) => p,
      batch: () => ({ set: (p: string) => writes.push(p), commit: vi.fn(async () => {}) }),
    },
    bucket: null as null | { name: string; file: ReturnType<typeof vi.fn> },
  };
  return { admin, writes };
}

describe("seed main", () => {
  it("requires credentials from env", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await seed.main([], {}, fakeAdmin(true).admin)).toBe(1);
  });
  it("refreshes an existing account", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeAdmin(true);
    expect(await seed.main([], ENV, f.admin)).toBe(0);
    expect(f.admin.auth.updateUser).toHaveBeenCalledWith(
      "OLD",
      expect.objectContaining({ password: ENV.REVIEW_PASSWORD }),
    );
    expect(f.writes).toContain("users/OLD");
  });
  it("creates a new account; dry run writes nothing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeAdmin(false);
    expect(await seed.main(["--dry-run"], ENV, f.admin)).toBe(0);
    expect(f.admin.auth.createUser).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    expect(await seed.main([], ENV, f.admin)).toBe(0);
    expect(f.writes).toContain("users/NEW");
  });
  it("never prints the reviewer credentials or username (CodeQL js/clear-text-logging #13)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeAdmin(false);
    const env = { ...ENV, REVIEW_USERNAME: "reviewer_x" };
    expect(await seed.main(["--dry-run"], env, f.admin)).toBe(0);
    expect(await seed.main([], env, f.admin)).toBe(0);
    const printed = JSON.stringify(log.mock.calls);
    for (const [key, value] of Object.entries(env)) {
      if (/EMAIL|PASSWORD|USERNAME/.test(key) && typeof value === "string" && value.length > 0) {
        expect(printed).not.toContain(value);
      }
    }
  });
  it("rethrows unexpected auth errors and reads the tutorial version", async () => {
    const f = fakeAdmin(true);
    f.admin.auth.getUserByEmail.mockRejectedValueOnce(new Error("boom"));
    await expect(seed.main([], ENV, f.admin)).rejects.toThrow("boom");
    expect(seed.tutorialVersion()).toBeGreaterThan(0);
  });
});

describe("seed storage and emulator", () => {
  it("uploads the demo clip with a download token", async () => {
    const save = vi.fn(async () => {});
    const admin = { bucket: { name: "bkt", file: vi.fn(() => ({ save })) } };
    const url = await seed.uploadDemoVideo(admin);
    expect(admin.bucket.file).toHaveBeenCalledWith(plan.DEMO_VIDEO_PATH);
    expect(save).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ contentType: "video/mp4" }));
    expect(url).toMatch(
      /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/bkt\/o\/review-kit%2Fsh-video-edit\.mp4\?alt=media&token=/,
    );
  });
  it("falls back to the hosted clip without a bucket", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await seed.uploadDemoVideo({ bucket: null })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
  it("targets the emulators only with --emulator", () => {
    expect(seed.emulatorTarget([], {})).toBeNull();
    expect(seed.emulatorTarget(["--emulator"], {})).toEqual({
      projectId: "demo-skatehubba",
      firestore: "127.0.0.1:8080",
      auth: "127.0.0.1:9099",
      storage: "127.0.0.1:9199",
      bucket: "demo-skatehubba.appspot.com",
    });
    expect(seed.emulatorTarget(["--emulator"], { FIRESTORE_EMULATOR_HOST: "h:1" }).firestore).toBe("h:1");
  });
});

describe("screenshots guards", () => {
  it("flags hidden screens and local URLs", () => {
    expect(shots.isForbiddenUrl("http://l/dice")).toBe(true);
    expect(shots.isForbiddenUrl("http://l/play/runner/x")).toBe(true);
    expect(shots.isForbiddenUrl("http://l/lobby")).toBe(false);
    expect(shots.isForbiddenUrl("http://l/dicey")).toBe(false);
    expect(shots.HIDE_VIDEO_CONTROLS_CSS).toContain("-webkit-media-controls");
    expect(shots.isLocalUrl("http://localhost:5173")).toBe(true);
    expect(shots.isLocalUrl("https://skatehubba.com")).toBe(false);
  });
});

describe("screenshots args", () => {
  it("defaults and filters sizes", () => {
    const all = shots.parseArgs([], {});
    expect(all.sizes).toHaveLength(plan.SIZES.length);
    expect(all.baseUrl).toBe("https://skatehubba.com");
    expect(all.out).toMatch(/store-screenshots$/);
    const one = shots.parseArgs(["--only", "ios-6.9", "--base-url", "http://l:5/", "--out", "/tmp/s"], {});
    expect(one).toMatchObject({ baseUrl: "http://l:5", out: "/tmp/s" });
    expect(one.sizes.map((s: { id: string }) => s.id)).toEqual(["ios-6.9"]);
    expect(() => shots.parseArgs(["--only", "nope"], {})).toThrow(/unknown size/);
  });
  it("requires credentials", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await shots.main([], {})).toBe(1);
  });
});

describe("App Store shot list (screenshots-plan.md)", () => {
  it("captures only the listing's promises, in store order", () => {
    expect(plan.SCREENS.map((s: { id: string }) => s.id)).toEqual([
      "01-game",
      "02-record",
      "03-vs-you",
      "04-passport",
      "05-lobby",
      "06-clock",
    ]);
    const byId = Object.fromEntries(plan.SCREENS.map((s: { id: string }) => [s.id, s]));
    expect(byId["03-vs-you"].path).toBe(`/player/${plan.DEMO_OPPONENTS[0].uid}`);
    expect(byId["06-clock"]).toMatchObject({
      path: `/challenge?to=${plan.DEMO_OPPONENTS[0].username}`,
      optional: true,
    });
    expect(byId["05-lobby"].scrollTo).not.toMatch(/whos-skating/);
    expect(shots.parseArgs(["--skip-optional"], {}).screens.map((s: { id: string }) => s.id)).not.toContain("06-clock");
    expect(shots.parseArgs([], {}).screens).toHaveLength(6);
    expect(shots.parseArgs(["--only", "ios-6.9,ios-6.3"], {}).sizes.map((s: { id: string }) => s.id)).toEqual([
      "ios-6.9",
      "ios-6.3",
    ]);
  });

  it("blocks the map, feed, Closet and trading", () => {
    for (const p of ["/map", "/feed", "/closet", "/closet/studio", "/trading", "/dice"]) {
      expect(shots.isForbiddenUrl(`http://l${p}`)).toBe(true);
    }
    expect(shots.isForbiddenUrl("http://l/challenge?to=kai")).toBe(false);
    expect(shots.isForbiddenUrl("http://l/feedback")).toBe(false);
  });

  it("fails a shot on error text, unpromised features or an open overlay", () => {
    const ok = { id: "02-record", url: "http://l/me", text: "RECORD Lifetime Wins 14", overlays: 0 };
    expect(shots.shotProblem(ok)).toBeNull();
    expect(shots.shotProblem({ ...ok, text: "Map temporarily unavailable" })).toMatch(/temporarily unavailable/);
    expect(shots.shotProblem({ ...ok, text: "No video recorded" })).toMatch(/No video recorded/);
    expect(shots.shotProblem({ ...ok, text: "ROLL DICE" })).toMatch(/ROLL DICE/);
    expect(shots.shotProblem({ ...ok, text: "Bless as pro" })).toMatch(/Bless/);
    // Post-#812 blessing copy ("put on by @x"), in all three forms.
    expect(shots.shotProblem({ ...ok, text: "Put someone on as pro" })).toMatch(/Put someone on/);
    expect(shots.shotProblem({ ...ok, text: "@kai put you on" })).toMatch(/put you on/);
    expect(shots.shotProblem({ ...ok, text: "put on by @kai" })).toMatch(/put on by/);
    // Profile-line form, as it would render in a shot.
    expect(shots.shotProblem({ ...ok, text: "Pro · Put on by @kai" })).toMatch(/Put on by/);
    expect(shots.shotProblem({ ...ok, overlays: 1 })).toMatch(/overlay/);
    expect(shots.shotProblem({ ...ok, url: "http://l/feed" })).toMatch(/must not show/);
    expect(plan.OVERLAY_SELECTOR).toContain('[role="dialog"]');
    expect(plan.OVERLAY_SELECTOR).toContain('[data-testid="toast"]');
  });

  it('runs the App Store set as 6.9" + 6.3" whatever else SIZES holds', () => {
    const appStore = plan.SIZES.filter((s: { store: string }) => s.store === "App Store").map(
      (s: { id: string }) => s.id,
    );
    expect(appStore).toEqual(expect.arrayContaining(["ios-6.9", "ios-6.3"]));
    const run = shots.parseArgs(["--only", "ios-6.9,ios-6.3"], {}).sizes.map((s: { id: string }) => s.id);
    expect(run.some((id: string) => id.startsWith("ipad"))).toBe(false);
  });
});
