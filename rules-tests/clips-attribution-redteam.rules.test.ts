/**
 * Red team: clip ATTRIBUTION and moderation enforcement (security audit
 * 2026-10-21, findings H1 + H2).
 *
 * H1 — forged game clips. Any participant of a game could create a clip for
 * the OTHER player (playerUid = victim) with any video in the bucket and any
 * display name. A game needs no acceptance from player2, so an attacker could
 * challenge anyone and publish videos the victim never filmed, under the
 * victim's name, straight to the public feed. User clips and clip comments
 * had the same display-name hole: `playerUsername` / `username` were free
 * text, so anyone could post as "@anyone".
 *
 * H2 — moderation bypass. With moderation on, a client could still create a
 * user clip as `moderationStatus: 'active'` and skip review entirely. When
 * config/moderation.enabled is true the rule now only accepts 'pending'.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { makeValidGame, setupRulesTestEnv } from "./_fixtures";

const P1 = "p1-alice";
const P2 = "p2-bob";
const GAME_ID = "game1";
const TURN = 3;
const BUCKET_O = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-clip-attribution", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", P1), { uid: P1, username: "alice" });
    await setDoc(doc(db, "users", P2), { uid: P2, username: "bob" });
    await setDoc(doc(db, "games", GAME_ID), makeValidGame({ player1Uid: P1, player2Uid: P2 }));
  });
});

function as(uid: string): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: true });
}

function gameVideo(role: string, uid: string, turn = TURN, gameId = GAME_ID, ext = "webm"): string {
  return `${BUCKET_O}games%2F${gameId}%2Fturn-${turn}%2F${role}-${uid}.${ext}?alt=media&token=t`;
}

function gameClip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "game",
    gameId: GAME_ID,
    turnNumber: TURN,
    role: "set",
    playerUid: P1,
    playerUsername: "alice",
    trickName: "tre flip",
    videoUrl: gameVideo("set", P1),
    spotId: null,
    createdAt: serverTimestamp(),
    moderationStatus: "active",
    upvoteCount: 0,
    downvoteCount: 0,
    ...overrides,
  };
}

function createGameClip(ctx: RulesTestContext, data: Record<string, unknown>): Promise<void> {
  const id = `${String(data.gameId)}_${String(data.turnNumber)}_${String(data.role)}`;
  return setDoc(doc(ctx.firestore(), "clips", id), data);
}

describe("game clips — attribution (H1)", () => {
  it("positive: the matcher records the setter's clip with the setter's own upload", async () => {
    await assertSucceeds(createGameClip(as(P2), gameClip()));
  });

  it("positive: a player records their own match clip (.mp4 native upload)", async () => {
    await assertSucceeds(
      createGameClip(
        as(P2),
        gameClip({
          role: "match",
          playerUid: P2,
          playerUsername: "bob",
          videoUrl: gameVideo("match", P2, TURN, GAME_ID, "mp4"),
        }),
      ),
    );
  });

  it("attack: CANNOT publish the attacker's own upload as the victim's clip", async () => {
    // Attacker (alice) uploaded set-p1-alice.webm into the game folder and
    // stamps it on a clip attributed to bob.
    await assertFails(
      createGameClip(as(P1), gameClip({ playerUid: P2, playerUsername: "bob", videoUrl: gameVideo("set", P1) })),
    );
  });

  it("attack: CANNOT point a game clip at an arbitrary object in the bucket", async () => {
    await assertFails(
      createGameClip(as(P2), gameClip({ videoUrl: `${BUCKET_O}users%2Fp1-alice%2Favatar.webp?alt=media` })),
    );
  });

  it("attack: CANNOT reuse a video from a different game or turn", async () => {
    await assertFails(createGameClip(as(P2), gameClip({ videoUrl: gameVideo("set", P1, TURN, "other-game") })));
    await assertFails(createGameClip(as(P2), gameClip({ videoUrl: gameVideo("set", P1, TURN + 1) })));
  });

  it("attack: CANNOT swap the role in the file name", async () => {
    await assertFails(createGameClip(as(P2), gameClip({ videoUrl: gameVideo("match", P1) })));
  });

  it("attack: CANNOT stamp a display name that is not the player's", async () => {
    await assertFails(createGameClip(as(P2), gameClip({ playerUsername: "tonyhawk" })));
    await assertFails(createGameClip(as(P2), gameClip({ playerUsername: "bob" })));
  });
});

// ── User clips ──

const USER_CLIP_ID = "user-clip-1";

function userVideo(uid: string, prefix = "userClips"): string {
  return `${BUCKET_O}${prefix}%2F${uid}%2Fclip1.webm?alt=media&token=t`;
}

function createUserClip(ctx: RulesTestContext, uid: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const db = ctx.firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "clips", USER_CLIP_ID), {
    source: "user",
    gameId: null,
    turnNumber: null,
    role: null,
    playerUid: uid,
    playerUsername: "alice",
    trickName: "switch heel",
    videoUrl: userVideo(uid),
    spotId: null,
    moderationStatus: "active",
    upvoteCount: 0,
    downvoteCount: 0,
    createdAt: serverTimestamp(),
    ...overrides,
  });
  batch.update(doc(db, "users", uid), { lastClipCreatedAt: serverTimestamp() });
  return batch.commit();
}

async function setModeration(enabled: boolean): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "config", "moderation"), { enabled });
  });
}

describe("user clips — display name (H1)", () => {
  it("positive: posts under the caller's real username", async () => {
    await assertSucceeds(createUserClip(as(P1), P1));
  });

  it("attack: CANNOT post a user clip under someone else's username", async () => {
    await assertFails(createUserClip(as(P1), P1, { playerUsername: "bob" }));
  });
});

describe("user clips — moderation enforced server-side (H2)", () => {
  it("moderation off (no config doc): an active clip is accepted, as before", async () => {
    await assertSucceeds(createUserClip(as(P1), P1));
  });

  it("moderation explicitly off: an active clip is accepted", async () => {
    await setModeration(false);
    await assertSucceeds(createUserClip(as(P1), P1, { videoUrl: userVideo(P1, "approvedClips") }));
  });

  it("moderation on: a pending clip is accepted", async () => {
    await setModeration(true);
    await assertSucceeds(createUserClip(as(P1), P1, { moderationStatus: "pending", moderation: "pending" }));
  });

  it("attack: moderation on, CANNOT skip review by posting straight to active", async () => {
    await setModeration(true);
    await assertFails(createUserClip(as(P1), P1));
    await assertFails(createUserClip(as(P1), P1, { videoUrl: userVideo(P1, "approvedClips") }));
  });
});

// ── Clip comments ──

describe("clip comments — display name (H1)", () => {
  async function seedClip(): Promise<void> {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "clips", "c1"), gameClip());
    });
  }

  function comment(ctx: RulesTestContext, username: string): Promise<void> {
    return setDoc(doc(ctx.firestore(), "clips", "c1", "comments", "m1"), {
      userId: P2,
      username,
      text: "clean",
      createdAt: serverTimestamp(),
    });
  }

  it("positive: comments under the caller's real username", async () => {
    await seedClip();
    await assertSucceeds(comment(as(P2), "bob"));
  });

  it("attack: CANNOT comment under someone else's username", async () => {
    await seedClip();
    await assertFails(comment(as(P2), "alice"));
  });
});
