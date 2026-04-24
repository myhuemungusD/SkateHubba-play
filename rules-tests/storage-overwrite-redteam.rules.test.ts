/**
 * Storage overwrite red-team tests.
 *
 * These pin the invariant that `allow update` has been removed from
 * `storage.rules` for game-video paths, so once a video object is
 * committed its bytes cannot be swapped without a delete + create
 * cycle. This backs the immutability of `clips/*` in Firestore — clip
 * documents point at a storage URL, and `firestore.rules` enforces
 * `allow update: if false` on the clip. If Storage rules let the
 * uploader silently overwrite the bytes behind that URL, the App Store
 * content-moderation audit trail would be broken.
 *
 * Companion to `storage-redteam.rules.test.ts`, which covers the
 * uploaderUid binding at create/delete. This file focuses on the
 * no-update guarantee and the supported delete-then-create retry path.
 *
 * ─── Emulator quirk (important) ────────────────────────────────────
 * Firebase Storage emulator (cloud-storage-rules-runtime v1.1.3) routes
 * a client `put()` at a path that already contains an object through
 * the CREATE rule, not the UPDATE rule — unlike production. That means
 * an emulator `put()` over an existing object that carries the caller's
 * own uid in customMetadata will satisfy the create-rule binding and
 * succeed. In production the same call hits the UPDATE rule, which is
 * now implicitly denied and therefore rejected.
 *
 * To deterministically exercise the UPDATE rule under the emulator we
 * use `updateMetadata()`, which does route to UPDATE. Every test below
 * that claims the "update rule is gone" is written against
 * `updateMetadata()` so the assertion is real, not vacuous. The tests
 * that target `put()` only assert outcomes the emulator is actually
 * capable of distinguishing (e.g. wrong-uid in metadata fails via
 * CREATE).
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROJECT_ID = "demo-skatehubba-rules-storage-overwrite-redteam";

const UID_A = "uploader-alice";
const UID_B = "stranger-bob";
const GAME_ID = "game-overwrite-redteam";
const TURN_PATH = "turn-1";

let testEnv: RulesTestEnvironment;

/**
 * Build a payload of the given size. Default 2 KB is comfortably above
 * the 1 KB minimum the rules require and well under the 50 MB maximum.
 */
function videoPayload(sizeBytes: number = 2048): Uint8Array {
  return new Uint8Array(sizeBytes).fill(0x42);
}

function asUserA(): RulesTestContext {
  return testEnv.authenticatedContext(UID_A, { email_verified: true });
}

function asUserB(): RulesTestContext {
  return testEnv.authenticatedContext(UID_B, { email_verified: true });
}

function videoPath(role: "set" | "match" = "set", ext: "webm" | "mp4" = "webm"): string {
  return `games/${GAME_ID}/${TURN_PATH}/${role}.${ext}`;
}

/**
 * Seed a file owned by the given uid via an authenticated context so
 * the CREATE rule actually runs and persists customMetadata. Mirrors
 * the seeding helper in `storage-redteam.rules.test.ts` — using
 * withSecurityRulesDisabled produces an object the emulator then
 * treats as missing on subsequent rule evaluations, which makes the
 * update-path tests vacuous.
 */
async function seedFileOwnedBy(
  uid: string,
  path: string = videoPath(),
  contentType: "video/webm" | "video/mp4" = "video/webm",
): Promise<void> {
  const ctx = testEnv.authenticatedContext(uid, { email_verified: true });
  const ref = ctx.storage().ref(path);
  await ref.put(videoPayload(), {
    contentType,
    customMetadata: { uploaderUid: uid },
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

/* ────────────────────────────────────────────
 * ATTACK 1 — uploader tries to mutate their own committed video
 *   The clips audit-trail invariant: once committed, the bytes and
 *   metadata are locked. Exercised via updateMetadata() which routes
 *   deterministically to the UPDATE rule in the emulator. Covers all
 *   four (set|match) x (webm|mp4) filename combinations so the guard
 *   is proven for every legitimate game-video path.
 * ──────────────────────────────────────────── */

describe("storage overwrite red-team — uploader cannot mutate their own committed video", () => {
  it("attack: user A CANNOT updateMetadata on their own set.webm (update rule removed)", async () => {
    await seedFileOwnedBy(UID_A, videoPath("set", "webm"));
    const ref = asUserA().storage().ref(videoPath("set", "webm"));
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_A } }));
  });

  it("attack: user A CANNOT updateMetadata on their own match.webm (update rule removed)", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "webm"));
    const ref = asUserA().storage().ref(videoPath("match", "webm"));
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_A } }));
  });

  it("attack: user A CANNOT updateMetadata on their own set.mp4 (update rule removed)", async () => {
    await seedFileOwnedBy(UID_A, videoPath("set", "mp4"), "video/mp4");
    const ref = asUserA().storage().ref(videoPath("set", "mp4"));
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_A } }));
  });

  it("attack: user A CANNOT updateMetadata on their own match.mp4 (update rule removed)", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "mp4"), "video/mp4");
    const ref = asUserA().storage().ref(videoPath("match", "mp4"));
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_A } }));
  });

  it("attack: user A CANNOT rebind uploaderUid on their own file via updateMetadata", async () => {
    // Belt-and-suspenders: even when A tries to rebind to someone else
    // (a gift to a teammate? a laundering attempt?) the update is denied.
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_B } }));
  });
});

/* ────────────────────────────────────────────
 * LEGITIMATE — delete + create fresh is the only supported retry path
 *   Covers all four (set|match) x (webm|mp4) combinations so every
 *   real-world upload path has an end-to-end happy retry proven.
 * ──────────────────────────────────────────── */

describe("storage overwrite red-team — delete then create fresh is the supported retry", () => {
  it("user A CAN delete then re-create set.webm at the same path", async () => {
    await seedFileOwnedBy(UID_A, videoPath("set", "webm"));
    const ref = asUserA().storage().ref(videoPath("set", "webm"));
    await assertSucceeds(ref.delete());
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("user A CAN delete then re-create match.webm at the same path", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "webm"));
    const ref = asUserA().storage().ref(videoPath("match", "webm"));
    await assertSucceeds(ref.delete());
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("user A CAN delete then re-create set.mp4 at the same path", async () => {
    await seedFileOwnedBy(UID_A, videoPath("set", "mp4"), "video/mp4");
    const ref = asUserA().storage().ref(videoPath("set", "mp4"));
    await assertSucceeds(ref.delete());
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("user A CAN delete then re-create match.mp4 at the same path", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "mp4"), "video/mp4");
    const ref = asUserA().storage().ref(videoPath("match", "mp4"));
    await assertSucceeds(ref.delete());
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * ATTACK 2 — a different user cannot overwrite or delete
 *   Overwrite-via-put() for user B is asserted against the CREATE-rule
 *   code path (which is what the emulator runs): B leaves A's uid in
 *   metadata so the uploaderUid == auth.uid check rejects. Covers
 *   both set and match filename patterns.
 * ──────────────────────────────────────────── */

describe("storage overwrite red-team — stranger cannot overwrite or delete", () => {
  it("attack: user B CANNOT overwrite user A's set.webm while preserving A's uid", async () => {
    await seedFileOwnedBy(UID_A, videoPath("set", "webm"));
    const ref = asUserB().storage().ref(videoPath("set", "webm"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("attack: user B CANNOT overwrite user A's match.mp4 while preserving A's uid", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "mp4"), "video/mp4");
    const ref = asUserB().storage().ref(videoPath("match", "mp4"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("attack: user B CANNOT updateMetadata on user A's set.webm (update rule removed)", async () => {
    // Update rule is gone globally — B can't mutate A's metadata regardless
    // of which uid they claim in the new metadata.
    await seedFileOwnedBy(UID_A, videoPath("set", "webm"));
    const ref = asUserB().storage().ref(videoPath("set", "webm"));
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_B } }));
  });

  it("attack: user B CANNOT updateMetadata on user A's match.mp4 (update rule removed)", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "mp4"), "video/mp4");
    const ref = asUserB().storage().ref(videoPath("match", "mp4"));
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_B } }));
  });

  it("attack: user B CANNOT delete user A's set.webm", async () => {
    await seedFileOwnedBy(UID_A, videoPath("set", "webm"));
    await assertFails(asUserB().storage().ref(videoPath("set", "webm")).delete());
  });

  it("attack: user B CANNOT delete user A's match.webm", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "webm"));
    await assertFails(asUserB().storage().ref(videoPath("match", "webm")).delete());
  });

  it("attack: user B CANNOT delete user A's set.mp4", async () => {
    await seedFileOwnedBy(UID_A, videoPath("set", "mp4"), "video/mp4");
    await assertFails(asUserB().storage().ref(videoPath("set", "mp4")).delete());
  });

  it("attack: user B CANNOT delete user A's match.mp4", async () => {
    await seedFileOwnedBy(UID_A, videoPath("match", "mp4"), "video/mp4");
    await assertFails(asUserB().storage().ref(videoPath("match", "mp4")).delete());
  });
});

/* ────────────────────────────────────────────
 * ATTACK 3 — size / MIME / filename invariants still enforced on
 *   the fresh create. Delete-then-create must not become a loophole.
 * ──────────────────────────────────────────── */

describe("storage overwrite red-team — fresh create still enforces size / MIME / filename", () => {
  it("after delete, create with too-small payload (<1 KB) is rejected", async () => {
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertSucceeds(ref.delete());
    // 512 bytes — below the 1 KB minimum.
    await assertFails(
      ref.put(videoPayload(512), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("after delete, create with wrong contentType (image/png) is rejected", async () => {
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertSucceeds(ref.delete());
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "image/png",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("after delete, create with spoofed uploaderUid (UID_B) is rejected", async () => {
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertSucceeds(ref.delete());
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_B },
      }),
    );
  });

  it("after delete, create with missing uploaderUid is rejected", async () => {
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertSucceeds(ref.delete());
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: {},
      }),
    );
  });

  it("after delete, create at a path with a bad filename is rejected", async () => {
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertSucceeds(ref.delete());
    const badRef = asUserA().storage().ref(`games/${GAME_ID}/${TURN_PATH}/evil.webm`);
    await assertFails(
      badRef.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });
});
