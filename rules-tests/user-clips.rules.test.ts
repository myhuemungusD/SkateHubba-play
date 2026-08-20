/**
 * Firestore rules tests for USER-UPLOADED clips (`source: "user"`).
 *
 * Unlike game clips, a user clip has no backing game to authorize against:
 * the doc id is random, gameId/turnNumber/role are null, and the only
 * authorization signals are the caller's uid, the storage prefix the video
 * URL points at, the ban flag, and a 30s companion-write rate limit.
 * Every one of those is red-teamed below.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const UID = "u-alice";
const OTHER_UID = "u-bob";
const CLIP_ID = "random-clip-id";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-user-clips", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", UID), { uid: UID, username: "alice" });
    await setDoc(doc(ctx.firestore(), "users", OTHER_UID), { uid: OTHER_UID, username: "bob" });
  });
});

function authed(uid: string, emailVerified = true): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: emailVerified });
}

function videoUrl(uid: string, name = "clip1"): string {
  return `https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/userClips%2F${uid}%2F${name}.webm?alt=media&token=abc`;
}

function makeUserClip(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "user",
    gameId: null,
    turnNumber: null,
    role: null,
    playerUid: uid,
    playerUsername: "alice",
    trickName: "switch heel",
    videoUrl: videoUrl(uid),
    spotId: null,
    moderationStatus: "active",
    upvoteCount: 0,
    downvoteCount: 0,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

/**
 * The production write shape: the clip doc plus the MANDATORY
 * users/{uid}.lastClipCreatedAt companion write that advances the 30s
 * cooldown anchor. `omitCompanion` drops the second write to prove the
 * rate-limit gate actually rejects instead of silently passing.
 */
function createUserClip(
  ctx: RulesTestContext,
  uid: string,
  overrides: Record<string, unknown> = {},
  opts: { omitCompanion?: boolean; anchor?: unknown; omitSource?: boolean } = {},
): Promise<void> {
  const batch = writeBatch(ctx.firestore());
  const clip = makeUserClip(uid, overrides);
  if (opts.omitSource) delete clip.source;
  batch.set(doc(ctx.firestore(), "clips", CLIP_ID), clip);
  if (!opts.omitCompanion) {
    batch.update(doc(ctx.firestore(), "users", uid), {
      lastClipCreatedAt: opts.anchor ?? serverTimestamp(),
    });
  }
  return batch.commit();
}

async function ban(uid: string): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", uid), { uid, username: "alice", banned: true });
  });
}

describe("clips — user-source create (positive)", () => {
  it("a verified user CAN publish a clip to their own uid with the companion anchor write", async () => {
    await assertSucceeds(createUserClip(authed(UID), UID));
  });

  it("accepts an .mp4 (native) video URL under the caller's own prefix", async () => {
    await assertSucceeds(createUserClip(authed(UID), UID, { videoUrl: videoUrl(UID).replace(".webm", ".mp4") }));
  });

  it("accepts an optional spotId within the 64-char budget", async () => {
    await assertSucceeds(createUserClip(authed(UID), UID, { spotId: "x".repeat(64) }));
  });
});

describe("clips — user-source create (red team)", () => {
  it("attack: CANNOT attribute a clip to another user's uid", async () => {
    await assertFails(createUserClip(authed(UID), UID, { playerUid: OTHER_UID }));
  });

  it("attack: CANNOT publish a clip pointing at ANOTHER user's storage prefix", async () => {
    await assertFails(createUserClip(authed(UID), UID, { videoUrl: videoUrl(OTHER_UID) }));
  });

  it("attack: CANNOT publish a clip pointing at an attacker-hosted URL", async () => {
    await assertFails(createUserClip(authed(UID), UID, { videoUrl: "https://attacker.com/payload.html" }));
  });

  it("attack: CANNOT publish a clip pointing outside the userClips/ prefix (game video reuse)", async () => {
    await assertFails(
      createUserClip(authed(UID), UID, {
        videoUrl:
          "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/games%2Fg1%2Fturn-1%2Fset.webm",
      }),
    );
  });

  it("attack: CANNOT mislabel a user clip as source 'game' without game coordinates", async () => {
    await assertFails(createUserClip(authed(UID), UID, { source: "game" }));
  });

  it("attack: CANNOT omit source entirely (legacy shape is read-only, not writable)", async () => {
    await assertFails(createUserClip(authed(UID), UID, {}, { omitSource: true }));
  });

  it("attack: CANNOT smuggle game coordinates onto a user clip", async () => {
    await assertFails(createUserClip(authed(UID), UID, { gameId: "g1", turnNumber: 1, role: "set" }));
  });

  it("attack: CANNOT seed a non-zero upvoteCount", async () => {
    await assertFails(createUserClip(authed(UID), UID, { upvoteCount: 99 }));
  });

  it("attack: CANNOT seed a negative downvoteCount to fake a ranking floor", async () => {
    await assertFails(createUserClip(authed(UID), UID, { downvoteCount: -5 }));
  });

  it("attack: CANNOT start a clip in 'hidden' moderation state", async () => {
    await assertFails(createUserClip(authed(UID), UID, { moderationStatus: "hidden" }));
  });

  it("attack: CANNOT back-date createdAt", async () => {
    await assertFails(createUserClip(authed(UID), UID, { createdAt: new Date(Date.now() - 60_000) }));
  });

  it("rejects a trickName over 80 chars", async () => {
    await assertFails(createUserClip(authed(UID), UID, { trickName: "x".repeat(81) }));
  });

  it("rejects an empty trickName", async () => {
    await assertFails(createUserClip(authed(UID), UID, { trickName: "" }));
  });

  it("attack: an unverified-email account CANNOT publish", async () => {
    await assertFails(createUserClip(authed(UID, false), UID));
  });

  it("attack: an anonymous caller CANNOT publish", async () => {
    await assertFails(createUserClip(getEnv().unauthenticatedContext(), UID));
  });

  it("attack: a BANNED user CANNOT publish", async () => {
    await ban(UID);
    await assertFails(createUserClip(authed(UID), UID));
  });

  it("attack: omitting the companion anchor write bypasses nothing — the create is denied", async () => {
    await assertFails(createUserClip(authed(UID), UID, {}, { omitCompanion: true }));
  });

  it("attack: a back-dated anchor (epoch 0) cannot satisfy the cooldown", async () => {
    await assertFails(createUserClip(authed(UID), UID, {}, { anchor: new Date(0) }));
  });

  it("attack: a second clip inside the 30s cooldown is denied", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", UID), {
        uid: UID,
        username: "alice",
        lastClipCreatedAt: new Date(),
      });
    });
    await assertFails(createUserClip(authed(UID), UID));
  });

  it("a clip is allowed again once the 30s cooldown has elapsed", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", UID), {
        uid: UID,
        username: "alice",
        lastClipCreatedAt: new Date(Date.now() - 60_000),
      });
    });
    await assertSucceeds(createUserClip(authed(UID), UID));
  });
});

describe("clips — user-source delete", () => {
  it("the author CAN delete their own user clip; a stranger CANNOT", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clips", CLIP_ID), makeUserClip(UID, { createdAt: new Date() }));
    });
    await assertFails(deleteDoc(doc(authed(OTHER_UID).firestore(), "clips", CLIP_ID)));
    await assertSucceeds(deleteDoc(doc(authed(UID).firestore(), "clips", CLIP_ID)));
  });
});

describe("users — lastClipCreatedAt anchor is not client-forgeable", () => {
  it("attack: an owner CANNOT write an arbitrary lastClipCreatedAt outside a clip create", async () => {
    const ctx = authed(UID);
    await assertFails(setDoc(doc(ctx.firestore(), "users", UID), { lastClipCreatedAt: new Date(0) }, { merge: true }));
  });

  it("attack: lastClipCreatedAt cannot be seeded at profile-create time", async () => {
    const ctx = authed("u-new");
    await assertFails(
      setDoc(doc(ctx.firestore(), "users", "u-new"), {
        uid: "u-new",
        username: "newbie",
        lastClipCreatedAt: new Date(0),
      }),
    );
    // Positive control: the same create without the anchor is fine.
    await assertSucceeds(setDoc(doc(ctx.firestore(), "users", "u-new"), { uid: "u-new", username: "newbie" }));
  });
});

describe("clips/{id}/comments", () => {
  const COMMENT_PATH = ["clips", CLIP_ID, "comments"] as const;

  function commentRef(ctx: RulesTestContext, id = "c1") {
    return doc(ctx.firestore(), COMMENT_PATH[0], COMMENT_PATH[1], COMMENT_PATH[2], id);
  }

  function makeComment(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      userId: uid,
      username: "alice",
      text: "sick clip",
      createdAt: serverTimestamp(),
      ...overrides,
    };
  }

  async function seedComment(uid: string, id = "c1"): Promise<void> {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clips", CLIP_ID, "comments", id), makeComment(uid, { createdAt: new Date() }));
    });
  }

  it("a verified, non-banned user CAN comment", async () => {
    await assertSucceeds(setDoc(commentRef(authed(OTHER_UID)), makeComment(OTHER_UID)));
  });

  it("attack: CANNOT post a comment attributed to another user", async () => {
    await assertFails(setDoc(commentRef(authed(OTHER_UID)), makeComment(UID)));
  });

  it("rejects text over 300 chars", async () => {
    await assertFails(setDoc(commentRef(authed(OTHER_UID)), makeComment(OTHER_UID, { text: "x".repeat(301) })));
  });

  it("rejects empty text", async () => {
    await assertFails(setDoc(commentRef(authed(OTHER_UID)), makeComment(OTHER_UID, { text: "" })));
  });

  it("attack: CANNOT back-date createdAt", async () => {
    await assertFails(
      setDoc(commentRef(authed(OTHER_UID)), makeComment(OTHER_UID, { createdAt: new Date(Date.now() - 60_000) })),
    );
  });

  it("attack: an unverified-email account CANNOT comment", async () => {
    await assertFails(setDoc(commentRef(authed(OTHER_UID, false)), makeComment(OTHER_UID)));
  });

  it("attack: a BANNED user CANNOT comment", async () => {
    await ban(UID);
    await assertFails(setDoc(commentRef(authed(UID)), makeComment(UID)));
  });

  it("comments are immutable — even the author cannot edit", async () => {
    await seedComment(OTHER_UID);
    await assertFails(setDoc(commentRef(authed(OTHER_UID)), makeComment(OTHER_UID, { text: "edited" })));
  });

  it("the author CAN delete their own comment", async () => {
    await seedComment(OTHER_UID);
    await assertSucceeds(deleteDoc(commentRef(authed(OTHER_UID))));
  });

  it("attack: a non-author CANNOT delete someone else's comment", async () => {
    await seedComment(OTHER_UID);
    await assertFails(deleteDoc(commentRef(authed(UID))));
  });

  it("an admin CAN delete any comment (moderation takedown)", async () => {
    await seedComment(OTHER_UID);
    const adminCtx = getEnv().authenticatedContext("admin-uid", { email_verified: true, admin: true });
    await assertSucceeds(deleteDoc(commentRef(adminCtx)));
  });

  it("anonymous users can neither read nor comment", async () => {
    await seedComment(OTHER_UID);
    const anon = getEnv().unauthenticatedContext();
    await assertFails(getDoc(commentRef(anon)));
    await assertFails(setDoc(commentRef(anon, "c2"), makeComment(OTHER_UID)));
  });

  it("signed-in users can read comments", async () => {
    await seedComment(OTHER_UID);
    const snap = await assertSucceeds(getDoc(commentRef(authed(UID))));
    expect(snap).toBeDefined();
  });
});
