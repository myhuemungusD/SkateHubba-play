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
    expect(px["ios-6.5"]).toEqual({ w: 1284, h: 2778 });
    expect(px["ios-5.5"]).toEqual({ w: 1242, h: 2208 });
    expect(px["ipad-13"]).toEqual({ w: 2064, h: 2752 });
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
    expect(paths.filter((p: string) => p.startsWith("games/"))).toHaveLength(4);
    expect(paths.filter((p: string) => p.startsWith("clips/"))).toHaveLength(8);
    expect(paths.filter((p: string) => p.startsWith("spots/"))).toHaveLength(6);
    expect(paths.filter((p: string) => p.startsWith("users/U/locker/"))).toHaveLength(3);
    expect(paths.filter((p: string) => p.startsWith("users/U/achievements/"))).toHaveLength(6);
    expect(paths.filter((p: string) => p.startsWith("users/U/passport/"))).toHaveLength(3);
    expect(paths).toContain("passportSettings/U");
    expect(paths.some((p: string) => p.startsWith("config/"))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
    const clip = docs.find(([p]: [string]) => p.startsWith("clips/"))[1];
    expect(clip.videoUrl).toBe("https://a/sh-video-edit.mp4");
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
