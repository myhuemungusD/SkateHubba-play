/**
 * Ban enforcement — `bans/{uid}` tombstones.
 *
 * The ban is the kill switch for UGC writes (user clips, clip votes, clip
 * comments), so the FIRST question is always "can the subject shed it?".
 *
 * An earlier revision of this feature stored the flag as
 * `users/{uid}.banned`. That was fully bypassable and the bypass is
 * regression-guarded below: users/{uid} is owner-DELETABLE (GDPR erasure),
 * so a banned user could delete their profile — which alone re-opened
 * comments and votes, because a missing profile can't prove a ban — and
 * then re-create it clean (the create rule forbids seeding `banned`),
 * restoring uploads too. Enforcement therefore keys off `bans/{uid}`,
 * which the subject cannot read-modify-write, delete, or outlive.
 *
 * `users/{uid}.banned` survives as an admin-writable DISPLAY mirror only;
 * its admin clause and owner backstop are still asserted here so the
 * console field can't become a self-serve toggle.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const TARGET = "u-target";
const ADMIN = "u-admin";
const CLIP_ID = "some-clip-id";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-users-banned", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: false });
    await setDoc(doc(ctx.firestore(), "users", ADMIN), { uid: ADMIN, username: "admin", banned: false });
    await setDoc(doc(ctx.firestore(), "clips", CLIP_ID), {
      source: "user",
      gameId: null,
      turnNumber: null,
      role: null,
      playerUid: "someone-else",
      playerUsername: "vic",
      trickName: "nollie flip",
      videoUrl: "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/userClips%2Fx%2Fc.webm",
      spotId: null,
      moderationStatus: "active",
      upvoteCount: 0,
      downvoteCount: 0,
      createdAt: new Date(),
    });
  });
});

function adminCtx(): RulesTestContext {
  return getEnv().authenticatedContext(ADMIN, { email_verified: true, admin: true });
}

function userCtx(uid: string): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: true });
}

function userRef(ctx: RulesTestContext, uid: string) {
  return doc(ctx.firestore(), "users", uid);
}

function banRef(ctx: RulesTestContext, uid: string) {
  return doc(ctx.firestore(), "bans", uid);
}

/** Seed the authoritative ban tombstone (rules-disabled). */
async function seedBan(uid: string): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "bans", uid), {
      bannedBy: ADMIN,
      bannedAt: new Date(),
      reason: "non-skate spam",
    });
  });
}

/** A clip comment write by `uid` — one of the three gated UGC surfaces. */
function comment(ctx: RulesTestContext, uid: string, id = "c1"): Promise<void> {
  return setDoc(doc(ctx.firestore(), "clips", CLIP_ID, "comments", id), {
    userId: uid,
    username: "target",
    text: "still here",
    createdAt: serverTimestamp(),
  });
}

/** A clip vote by `uid`. */
function vote(ctx: RulesTestContext, uid: string): Promise<void> {
  return setDoc(doc(ctx.firestore(), "clipVotes", `${uid}_${CLIP_ID}`), {
    uid,
    clipId: CLIP_ID,
    value: 1,
    createdAt: serverTimestamp(),
  });
}

/** A user-clip publish by `uid`, with the mandatory cooldown companion write. */
function publishClip(ctx: RulesTestContext, uid: string): Promise<void> {
  const batch = writeBatch(ctx.firestore());
  batch.set(doc(ctx.firestore(), "clips", `${uid}-new-clip`), {
    source: "user",
    gameId: null,
    turnNumber: null,
    role: null,
    playerUid: uid,
    playerUsername: "target",
    trickName: "switch heel",
    videoUrl: `https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/userClips%2F${uid}%2Fc1.webm`,
    spotId: null,
    moderationStatus: "active",
    upvoteCount: 0,
    downvoteCount: 0,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(ctx.firestore(), "users", uid), { lastClipCreatedAt: serverTimestamp() });
  return batch.commit();
}

describe("bans/{uid} — admin-only tombstone", () => {
  it("an admin CAN ban another user", async () => {
    await assertSucceeds(
      setDoc(banRef(adminCtx(), TARGET), {
        bannedBy: ADMIN,
        bannedAt: serverTimestamp(),
        reason: "non-skate spam",
      }),
    );
  });

  it("an admin CAN unban (delete the tombstone)", async () => {
    await seedBan(TARGET);
    await assertSucceeds(deleteDoc(banRef(adminCtx(), TARGET)));
  });

  it("attack: the SUBJECT cannot delete their own ban", async () => {
    await seedBan(TARGET);
    await assertFails(deleteDoc(banRef(userCtx(TARGET), TARGET)));
  });

  it("attack: the subject cannot overwrite their own ban doc", async () => {
    await seedBan(TARGET);
    await assertFails(setDoc(banRef(userCtx(TARGET), TARGET), { bannedBy: TARGET, bannedAt: serverTimestamp() }));
  });

  it("attack: a normal user cannot ban someone else", async () => {
    await assertFails(setDoc(banRef(userCtx(TARGET), "u-victim"), { bannedBy: TARGET, bannedAt: serverTimestamp() }));
  });

  it("attack: an admin cannot ban THEMSELVES then clear it (four-eyes on both verbs)", async () => {
    await assertFails(setDoc(banRef(adminCtx(), ADMIN), { bannedBy: ADMIN, bannedAt: serverTimestamp() }));
    await seedBan(ADMIN);
    await assertFails(deleteDoc(banRef(adminCtx(), ADMIN)));
  });

  it("attack: bannedBy cannot be forged onto another moderator", async () => {
    await assertFails(setDoc(banRef(adminCtx(), TARGET), { bannedBy: "u-other-admin", bannedAt: serverTimestamp() }));
  });

  it("attack: bannedAt cannot be back-dated", async () => {
    await assertFails(setDoc(banRef(adminCtx(), TARGET), { bannedBy: ADMIN, bannedAt: new Date(0) }));
  });

  it("attack: unknown keys are rejected", async () => {
    await assertFails(
      setDoc(banRef(adminCtx(), TARGET), {
        bannedBy: ADMIN,
        bannedAt: serverTimestamp(),
        expiresAt: new Date(0),
      }),
    );
  });

  it("attack: a ban is immutable in place (re-ban is delete + create)", async () => {
    await seedBan(TARGET);
    await assertFails(updateDoc(banRef(adminCtx(), TARGET), { reason: "rewritten" }));
  });

  it("the subject CAN read their own ban (so the client can explain the rejection)", async () => {
    await seedBan(TARGET);
    await assertSucceeds(getDoc(banRef(userCtx(TARGET), TARGET)));
  });

  it("attack: a third party cannot read someone else's ban", async () => {
    await seedBan(TARGET);
    await assertFails(getDoc(banRef(userCtx("u-nosy"), TARGET)));
  });
});

describe("ban enforcement — UGC surfaces", () => {
  it("a non-banned user can comment, vote and publish (positive control)", async () => {
    await assertSucceeds(comment(userCtx(TARGET), TARGET));
    await assertSucceeds(vote(userCtx(TARGET), TARGET));
    await assertSucceeds(publishClip(userCtx(TARGET), TARGET));
  });

  it("a banned user can do NONE of the three", async () => {
    await seedBan(TARGET);
    await assertFails(comment(userCtx(TARGET), TARGET));
    await assertFails(vote(userCtx(TARGET), TARGET));
    await assertFails(publishClip(userCtx(TARGET), TARGET));
  });

  it("a banned user can still READ the feed (a ban silences, it doesn't exile)", async () => {
    await seedBan(TARGET);
    await assertSucceeds(getDoc(doc(userCtx(TARGET).firestore(), "clips", CLIP_ID)));
  });
});

/* ────────────────────────────────────────────
 * REGRESSION: the users/{uid}.banned bypass
 * ──────────────────────────────────────────── */

describe("ban survives profile deletion (regression guard)", () => {
  it("attack: deleting your own profile does NOT lift the ban on comments or votes", async () => {
    await seedBan(TARGET);
    const ctx = userCtx(TARGET);
    // The GDPR erasure path is genuinely open — that's intentional.
    await assertSucceeds(deleteDoc(userRef(ctx, TARGET)));
    // ...but the tombstone outlives the profile.
    await assertFails(comment(ctx, TARGET));
    await assertFails(vote(ctx, TARGET));
  });

  it("attack: delete-then-recreate the profile does NOT restore clip uploads", async () => {
    await seedBan(TARGET);
    const ctx = userCtx(TARGET);
    await assertSucceeds(deleteDoc(userRef(ctx, TARGET)));
    // Re-signup on the same UID. The create rule forbids seeding `banned`,
    // so the profile legitimately comes back "clean" — which is exactly
    // why the profile must not be the enforcement point.
    await assertSucceeds(setDoc(userRef(ctx, TARGET), { uid: TARGET, username: "target" }));
    await assertFails(publishClip(ctx, TARGET));
    await assertFails(comment(ctx, TARGET, "c2"));
    await assertFails(vote(ctx, TARGET));
  });

  it("attack: a banned user cannot vote-flip either (the flip clause is gated too)", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clipVotes", `${TARGET}_${CLIP_ID}`), {
        uid: TARGET,
        clipId: CLIP_ID,
        value: 1,
        createdAt: new Date(Date.now() - 60_000),
      });
    });
    await seedBan(TARGET);
    await assertFails(
      setDoc(doc(userCtx(TARGET).firestore(), "clipVotes", `${TARGET}_${CLIP_ID}`), {
        uid: TARGET,
        clipId: CLIP_ID,
        value: -1,
        createdAt: serverTimestamp(),
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * users/{uid}.banned — display mirror only
 * ──────────────────────────────────────────── */

describe("users.banned — admin-only display mirror", () => {
  it("an admin CAN set and clear the mirror on another user", async () => {
    await assertSucceeds(updateDoc(userRef(adminCtx(), TARGET), { banned: true }));
    await assertSucceeds(updateDoc(userRef(adminCtx(), TARGET), { banned: false }));
  });

  it("attack: a normal user CANNOT set the mirror on someone else", async () => {
    await assertFails(updateDoc(userRef(userCtx(ADMIN), TARGET), { banned: true }));
  });

  it("attack: a user CANNOT self-clear the mirror", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: true });
    });
    await assertFails(updateDoc(userRef(userCtx(TARGET), TARGET), { banned: false }));
  });

  it("attack: a user CANNOT clear the mirror by dropping it in a full overwrite", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: true });
    });
    await assertFails(setDoc(userRef(userCtx(TARGET), TARGET), { uid: TARGET, username: "target" }));
  });

  it("attack: an ADMIN cannot clear their OWN mirror (four-eyes)", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", ADMIN), { uid: ADMIN, username: "admin", banned: true });
    });
    await assertFails(updateDoc(userRef(adminCtx(), ADMIN), { banned: false }));
  });

  it("attack: an admin cannot ride a username rewrite along with the mirror", async () => {
    await assertFails(updateDoc(userRef(adminCtx(), TARGET), { banned: true, username: "seized" }));
  });

  it("attack: a non-bool mirror value is rejected", async () => {
    await assertFails(updateDoc(userRef(adminCtx(), TARGET), { banned: "true" }));
  });

  it("attack: the mirror cannot be seeded at profile-create time", async () => {
    const ctx = userCtx("u-fresh");
    await assertFails(setDoc(userRef(ctx, "u-fresh"), { uid: "u-fresh", username: "fresh", banned: false }));
    await assertSucceeds(setDoc(userRef(ctx, "u-fresh"), { uid: "u-fresh", username: "fresh" }));
  });

  it("a user with only the MIRROR set (no tombstone) is NOT actually gated", async () => {
    // Proves the mirror is inert: enforcement is bans/{uid} alone, so a
    // console that forgets to write the tombstone has NOT banned anyone.
    // This is the trap the service contract has to avoid.
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: true });
    });
    await assertSucceeds(comment(userCtx(TARGET), TARGET));
  });
});
