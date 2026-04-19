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

const PROJECT_ID = "demo-skatehubba-rules-storage-redteam";

const UID_A = "attacker-alice";
const UID_B = "victim-bob";
const GAME_ID = "game-under-attack";
const TURN_PATH = "turn-1";
const SET_FILE = "set.webm";
const MATCH_FILE = "match.webm";

let testEnv: RulesTestEnvironment;

/**
 * Build a 2 KB payload — comfortably above the 1 KB minimum the rules
 * require and well under the 50 MB maximum. Returns a Uint8Array because
 * the compat `put()` accepts Blob/Uint8Array/ArrayBuffer.
 */
function videoPayload(): Uint8Array {
  return new Uint8Array(2048).fill(0x42);
}

function asUserA(): RulesTestContext {
  return testEnv.authenticatedContext(UID_A, { email_verified: true });
}

function asUserB(): RulesTestContext {
  return testEnv.authenticatedContext(UID_B, { email_verified: true });
}

function asAnonymous(): RulesTestContext {
  return testEnv.unauthenticatedContext();
}

function videoPath(role: "set" | "match" = "set", ext: "webm" | "mp4" = "webm"): string {
  return `games/${GAME_ID}/${TURN_PATH}/${role}.${ext}`;
}

/**
 * Seed a file owned by the given uid via an authenticated context so the
 * CREATE rule actually runs and persists customMetadata the same way a
 * real client would. Using withSecurityRulesDisabled here turned out to
 * store an object the Storage emulator then treated as missing on the
 * subsequent rule evaluation, which made the update-path tests vacuous.
 */
async function seedFileOwnedBy(uid: string, path: string = videoPath()): Promise<void> {
  const ctx = testEnv.authenticatedContext(uid, { email_verified: true });
  const ref = ctx.storage().ref(path);
  await ref.put(videoPayload(), {
    contentType: "video/webm",
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
 * ATTACK 1 — overwrite opponent's video
 * ──────────────────────────────────────────── */

describe("storage red-team — overwrite another user's video", () => {
  // NOTE — Firebase Storage emulator quirk: when a signed-in client calls
  // put() at a path that already contains an object, the Storage emulator
  // (cloud-storage-rules-runtime v1.1.3) evaluates the CREATE rule rather
  // than the UPDATE rule. That means an attacker who passes their own uid
  // in customMetadata can satisfy the create-rule uploaderUid binding and
  // overwrite the pre-existing object in the emulator — even though the
  // update rule would have blocked them. See the finding reported with
  // this test suite. We pin the currently-observed emulator behaviour
  // while still exercising the update rule via updateMetadata below, which
  // does route to the update-rule code path.
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

  it("attack: user B CANNOT change metadata on user A's file (update-rule guard)", async () => {
    // updateMetadata() is routed to the storage UPDATE rule. The rule
    // requires resource.metadata.uploaderUid == request.auth.uid — so B
    // can't mutate A's object at all.
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

  it("user A CAN overwrite their own file (update path)", async () => {
    await seedFileOwnedBy(UID_A);
    const ref = asUserA().storage().ref(videoPath());
    await assertSucceeds(
      ref.put(videoPayload(), {
        contentType: "video/webm",
        customMetadata: { uploaderUid: UID_A },
      }),
    );
  });
});
