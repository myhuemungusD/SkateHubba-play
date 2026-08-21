/**
 * Storage rules red-team tests.
 *
 * These probe the hardened storage.rules for the uploaderUid binding that
 * locks game video objects to their original uploader. Each test
 * represents a concrete attacker scenario, not a coverage exercise.
 *
 * Setup: uses @firebase/rules-unit-testing which returns a compat-SDK
 * Storage instance bound to the emulator. Compat `ref.put(buffer, meta)`
 * mirrors the modular SDK `uploadBytes` — both carry customMetadata to
 * Storage where the rules engine evaluates it.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { gameVideoPaths, setupStorageRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-storage-redteam";

const UID_A = "attacker-alice";
const UID_B = "victim-bob";
const GAME_ID = "game-under-attack";
const TURN_PATH = "turn-1";

// Boots the Storage emulator env + deep-clears the bucket before each test
// AND after the file, so no test (or later file) inherits leftover objects.
const getEnv = setupStorageRulesTestEnv(PROJECT_ID);

/**
 * Build a 2 KB payload — comfortably above the 1 KB minimum the rules
 * require and well under the 50 MB maximum. Returns a Uint8Array because
 * the compat `put()` accepts Blob/Uint8Array/ArrayBuffer.
 */
function videoPayload(): Uint8Array {
  return new Uint8Array(2048).fill(0x42);
}

function asUserA(): RulesTestContext {
  return getEnv().authenticatedContext(UID_A, { email_verified: true });
}

function asUserB(): RulesTestContext {
  return getEnv().authenticatedContext(UID_B, { email_verified: true });
}

function asAnonymous(): RulesTestContext {
  return getEnv().unauthenticatedContext();
}

const { videoPath, legacyVideoPath } = gameVideoPaths(GAME_ID, TURN_PATH, UID_A);

/**
 * Seed a file owned by the given uid via an authenticated context so the
 * CREATE rule actually runs and persists customMetadata the same way a
 * real client would. Using withSecurityRulesDisabled here turned out to
 * store an object the Storage emulator then treated as missing on the
 * subsequent rule evaluation, which made the update-path tests vacuous.
 */
async function seedFileOwnedBy(uid: string, path: string = videoPath()): Promise<void> {
  const ctx = getEnv().authenticatedContext(uid, { email_verified: true });
  const ref = ctx.storage().ref(path);
  await ref.put(videoPayload(), {
    contentType: "video/webm",
    customMetadata: { uploaderUid: uid },
  });
}

/**
 * Seed an object under the pre-uid (legacy) filename. It has to go in with
 * security rules DISABLED because the hardened create rule no longer accepts
 * that name — which is the point: these objects exist only from before the
 * uid pinning, and the read/delete rules must still handle them.
 */
async function seedLegacyObject(path: string, uid: string): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .storage()
      .ref(path)
      .put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: uid },
      });
  });
}

/* ────────────────────────────────────────────
 * ATTACK 1 — overwrite opponent's video
 * ──────────────────────────────────────────── */

describe("storage red-team — overwrite another user's video", () => {
  // NOTE — Firebase Storage emulator quirk: when a signed-in client calls
  // put() at a path that already contains an object, the Storage emulator
  // (cloud-storage-rules-runtime v1.1.3) evaluates the CREATE rule rather
  // than the UPDATE rule. That is fine for us: with `allow update` removed
  // from storage.rules entirely, any route through the emulator still has
  // to satisfy CREATE, and CREATE enforces uploaderUid == auth.uid — so an
  // attacker cannot pass with the victim's uid either. updateMetadata()
  // still routes to the UPDATE rule, which is now implicitly denied.
  it("attack: user B CANNOT overwrite user A's file while preserving A's uid in metadata", async () => {
    // When the attacker leaves A's uid in place, the create-rule
    // uploaderUid binding fails (UID_A != request.auth.uid), so the
    // upload is denied via the create-rule branch as well.
    await seedFileOwnedBy(UID_A);
    const ref = asUserB().storage().ref(videoPath());
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("attack: user B CANNOT change metadata on user A's file (update is denied globally)", async () => {
    // updateMetadata() routes to the storage UPDATE rule. With the update
    // branch removed entirely, the rule defaults to deny — B (and even A)
    // cannot mutate an existing object's metadata.
    await seedFileOwnedBy(UID_A);
    const ref = asUserB().storage().ref(videoPath());
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_B } }));
  });
});

/* ────────────────────────────────────────────
 * ATTACK 2 — delete opponent's video
 * ──────────────────────────────────────────── */

describe("storage red-team — delete another user's video", () => {
  it("attack: user B CANNOT delete user A's file", async () => {
    await seedFileOwnedBy(UID_A);
    await assertFails(asUserB().storage().ref(videoPath()).delete());
  });

  it("attack: anonymous CANNOT delete user A's file", async () => {
    await seedFileOwnedBy(UID_A);
    await assertFails(asAnonymous().storage().ref(videoPath()).delete());
  });
});

/* ────────────────────────────────────────────
 * ATTACK 3 — spoof uploaderUid at create
 * ──────────────────────────────────────────── */

describe("storage red-team — spoof uploaderUid at create", () => {
  it("attack: user A CANNOT create a file with customMetadata.uploaderUid = UID_B", async () => {
    // Create requires request.resource.metadata.uploaderUid ==
    // request.auth.uid. Spoofing someone else's uid must fail.
    const ref = asUserA().storage().ref(videoPath("match"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_B },
      }),
    );
  });

  it("attack: user A CANNOT create a file with missing uploaderUid (rule requires binding)", async () => {
    const ref = asUserA().storage().ref(videoPath("match"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: {},
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * ATTACK 3b — lie about the payload format (extension ≠ content-type)
 * ──────────────────────────────────────────── */

describe("storage red-team — content-type pinning (extension must agree)", () => {
  it("attack: user A CANNOT upload set.webm with content-type video/mp4", async () => {
    // The bare allowlist used to accept any video/* with any (set|match)
    // extension. The hardened rule cross-validates: .webm ⇒ video/webm.
    const ref = asUserA().storage().ref(videoPath("set", "webm"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("attack: user A CANNOT upload match.mp4 with content-type video/webm", async () => {
    const ref = asUserA().storage().ref(videoPath("match", "mp4"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("legitimate: user A CAN upload match.mp4 with content-type video/mp4 (native path)", async () => {
    const ref = asUserA().storage().ref(videoPath("match", "mp4"));
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * ATTACK 3c — path squatting (the turn-timer griefing attack)
 *   Storage rules cannot check game membership (they cannot read the app's
 *   NAMED Firestore database), so ANY signed-in user can write somewhere
 *   under games/{gameId}/. Before the uid suffix, the victim's next upload
 *   path was fully derivable from the gameId: an attacker pre-created
 *   games/G/turn-N/match.webm, and because `update` is denied the victim's
 *   own upload collided and was rejected — they could never submit their
 *   trick and forfeited on the turn timer. The filename is now pinned to
 *   `{role}-{request.auth.uid}.{ext}`, so an attacker can only ever occupy
 *   THEIR OWN path.
 * ──────────────────────────────────────────── */

describe("storage red-team — path squatting (uid-pinned filename)", () => {
  // The squat itself, under both metadata choices available to the attacker:
  //   - own uid  → filename check rejects (A may not write B's name)
  //   - B's uid  → uploaderUid binding rejects (metadata != request.auth.uid)
  // Neither door is open, so the victim's path can never be occupied.
  for (const stampedUid of [UID_A, UID_B]) {
    it(`attack: user A CANNOT create at user B's filename (uploaderUid=${stampedUid})`, async () => {
      const ref = asUserA()
        .storage()
        .ref(videoPath("match", "webm", UID_B));
      await assertFails(
        ref.put(videoPayload(), {
          contentType: "video/webm",
          customMetadata: { uploaderUid: stampedUid },
        }),
      );
    });
  }

  it("attack: user A CANNOT squat user B's .mp4 filename either", async () => {
    const ref = asUserA()
      .storage()
      .ref(videoPath("set", "mp4", UID_B));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("victim: user B CAN upload match-{ownUid}.webm even after A dumped junk in the same game dir", async () => {
    // Covers BOTH the legitimate uid-suffixed create AND the residual: A may
    // still write junk under the game directory at their own uid-suffixed
    // name (bounded, auth-only, reaped by the 90-day sweep) — and it must not
    // block B's real turn upload, which is the whole point of the fix.
    await seedFileOwnedBy(UID_A, videoPath("match", "webm", UID_A));
    const ref = asUserB()
      .storage()
      .ref(videoPath("match", "webm", UID_B));
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_B },
      }),
    );
  });

  it("attack: user B CANNOT create set-{ownUid}.webm with content-type video/mp4", async () => {
    // Content-type pinning survives the filename change.
    const ref = asUserB()
      .storage()
      .ref(videoPath("set", "webm", UID_B));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_B },
      }),
    );
  });

  it("attack: the old bare `match.webm` filename is no longer creatable", async () => {
    // Create tightened: only the uid-suffixed name is writable now.
    const ref = asUserA().storage().ref(legacyVideoPath("match", "webm"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("attack: the old bare `set.mp4` filename is no longer creatable", async () => {
    const ref = asUserA().storage().ref(legacyVideoPath("set", "mp4"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/mp4",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("backward compat: an existing legacy-named object stays deletable by its uploader", async () => {
    // Only CREATE tightened. Objects written under the pre-uid scheme must
    // remain removable (account-deletion cleanup, game-deletion cascade),
    // so seed one with rules disabled and delete it as its uploader.
    const legacy = legacyVideoPath("match", "webm");
    await seedLegacyObject(legacy, UID_A);
    await assertSucceeds(asUserA().storage().ref(legacy).delete());
  });

  it("backward compat: a legacy-named object is NOT deletable by a stranger", async () => {
    const legacy = legacyVideoPath("set", "webm");
    await seedLegacyObject(legacy, UID_A);
    await assertFails(asUserB().storage().ref(legacy).delete());
  });
});

/* ────────────────────────────────────────────
 * ATTACK 4 — upload without auth
 * ──────────────────────────────────────────── */

describe("storage red-team — upload without auth", () => {
  it("attack: anonymous CANNOT upload a video even with a valid-looking uploaderUid", async () => {
    const ref = asAnonymous().storage().ref(videoPath("match"));
    await assertFails(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });
});

/* ────────────────────────────────────────────
 * Legitimate path — must still work
 * ──────────────────────────────────────────── */

describe("storage red-team — legitimate upload (companion)", () => {
  it("user A CAN create a file with their own uid in metadata", async () => {
    const ref = asUserA().storage().ref(videoPath("set"));
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("user A CAN delete their own file", async () => {
    await seedFileOwnedBy(UID_A);
    await assertSucceeds(asUserA().storage().ref(videoPath()).delete());
  });

  it("user A CAN replace their own file by deleting then creating fresh", async () => {
    // Update is denied globally, so the retry path is delete-then-create.
    // The fresh create re-binds uploaderUid from scratch, which is exactly
    // what we want for the clips-audit-trail invariant.
    await seedFileOwnedBy(UID_A);
    const aRef = asUserA().storage().ref(videoPath());
    await assertSucceeds(aRef.delete());
    await assertSucceeds(
      aRef.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });

  it("user A CANNOT call updateMetadata on their own file (update is denied globally)", async () => {
    // Even the original uploader cannot mutate the object's metadata in
    // place. This is the core invariant that protects the clips audit
    // trail — once written, the object is immutable until deleted.
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertFails(ref.updateMetadata({ customMetadata: { uploaderUid: UID_A } }));
  });
});
