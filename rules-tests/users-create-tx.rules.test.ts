/**
 * createProfile — 3-write transaction shape regression test.
 *
 * Production code red, May 2026: a 3-month-stale `firestore.rules` deploy
 * caused `src/services/users.ts:createProfile` to fail with
 * `permission-denied` for every new signup. The rules pipeline regression
 * was the root cause, but no emulator-backed test exercised the EXACT
 * three-write transaction shape that createProfile runs, so even with a
 * working rules pipeline CI couldn't have caught a divergence between the
 * service contract and the rules.
 *
 * This suite mirrors `createProfile` byte-for-byte:
 *   tx.set(usernames/{name},      { uid, reservedAt: serverTimestamp() })
 *   tx.set(users/{uid},           { uid, username, stance, createdAt: serverTimestamp() })
 *   tx.set(users/{uid}/private/profile, { emailVerified, dob, parentalConsent? }, {merge:true})
 *
 * Each negative test isolates ONE rule predicate that, if relaxed or
 * reverted, would silently break signup in production. The positive test
 * is the canary: if the rules drift away from the service contract in any
 * way (added required field, removed allowed field, tighter type check),
 * this fails first.
 *
 * Predicates exercised (firestore.rules):
 *   - users/{uid} create: uid == path, username regex, no sensitive fields,
 *     !exists() pre-condition (lines 200-253)
 *   - users/{uid}/private/{docId} create: owner-only, allowlisted keys
 *     (lines 521-544)
 *   - usernames/{username} create: uid == auth.uid, username regex (lines 573-580)
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { doc, runTransaction, serverTimestamp, setDoc, setLogLevel } from "firebase/firestore";
import { bootRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-users-create-tx";

const ALICE_UID = "alice-uid";
const BOB_UID = "bob-uid";
const ALICE_USERNAME = "alice";
const VALID_DOB = "2000-01-15";

let testEnv: RulesTestEnvironment;

function asAlice(): RulesTestContext {
  return testEnv.authenticatedContext(ALICE_UID, { email_verified: true });
}

function asBob(): RulesTestContext {
  return testEnv.authenticatedContext(BOB_UID, { email_verified: true });
}

/**
 * Run the EXACT three-write transaction that `createProfile` performs in
 * src/services/users.ts:214-285. Per-call overrides let each negative test
 * mutate ONE field at a time so the failure can be attributed to a single
 * predicate.
 */
interface CreateProfileTxOpts {
  ctx: RulesTestContext;
  pathUid: string;
  username: string;
  // Allow each of the three doc bodies to be overridden independently.
  usernameDocOverride?: Record<string, unknown>;
  userDocOverride?: Record<string, unknown>;
  privateDocOverride?: Record<string, unknown>;
  // Optional: drop the username pre-check (an attacker who skips the
  // existence read still has to satisfy the create rule). Default true to
  // match production.
  readUsernameFirst?: boolean;
}

async function runCreateProfileTx(opts: CreateProfileTxOpts): Promise<void> {
  const {
    ctx,
    pathUid,
    username,
    usernameDocOverride = {},
    userDocOverride = {},
    privateDocOverride = {},
    readUsernameFirst = true,
  } = opts;
  const db = ctx.firestore();
  await runTransaction(db, async (tx) => {
    const usernameRef = doc(db, "usernames", username);
    if (readUsernameFirst) {
      const snap = await tx.get(usernameRef);
      if (snap.exists()) {
        throw new Error("Username is already taken");
      }
    }
    tx.set(usernameRef, {
      uid: pathUid,
      reservedAt: serverTimestamp(),
      ...usernameDocOverride,
    });
    const userRef = doc(db, "users", pathUid);
    tx.set(userRef, {
      uid: pathUid,
      username,
      stance: "Regular",
      createdAt: serverTimestamp(),
      ...userDocOverride,
    });
    const privateRef = doc(db, "users", pathUid, "private", "profile");
    tx.set(
      privateRef,
      {
        emailVerified: false,
        dob: VALID_DOB,
        ...privateDocOverride,
      },
      { merge: true },
    );
  });
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await bootRulesTestEnv(PROJECT_ID);
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("createProfile 3-write transaction — happy path", () => {
  it("authenticated user CAN run the exact production transaction shape", async () => {
    // This is the canary. If the rules drift in a way that breaks signup
    // (e.g. another sensitive field is mistakenly required at the top
    // level), this test fails first — same failure mode as the May 2026
    // production code red would have produced.
    await assertSucceeds(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
      }),
    );
  });

  it("authenticated user CAN include optional parentalConsent on the private doc", async () => {
    // Mirrors the COPPA path: a minor's signup writes parentalConsent=true
    // alongside the standard fields. The private-doc keys allowlist must
    // accept it (firestore.rules lines 527-537).
    await assertSucceeds(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
        privateDocOverride: { parentalConsent: true },
      }),
    );
  });
});

describe("createProfile 3-write transaction — predicate isolation (negatives)", () => {
  it("DENIED: uid in users doc body differs from path uid", async () => {
    // firestore.rules line 205: `request.resource.data.uid == uid`.
    // Alice is authenticated and writing to users/{ALICE_UID}, but the
    // body's uid claims to be Bob — must fail.
    await assertFails(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
        userDocOverride: { uid: BOB_UID },
      }),
    );
  });

  it("DENIED: username contains a hyphen (invalid char per USERNAME_RE)", async () => {
    // firestore.rules line 210: `username.matches('[a-z0-9_]+')`.
    // A hyphen is the canonical invalid-char case (people try "first-last"
    // handles all the time). Both the usernames/{key} matcher and the
    // users body username field must reject it.
    await assertFails(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: "alice-cool",
      }),
    );
  });

  it("DENIED: usernames doc body uid != auth.uid (Alice tries to reserve a name FOR Bob)", async () => {
    // firestore.rules line 576: `request.resource.data.uid == request.auth.uid`.
    // Alice is signed in but the usernames doc body claims the reservation
    // belongs to Bob — must fail. Without this, Alice could squat handles
    // on other users' behalf.
    await assertFails(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
        usernameDocOverride: { uid: BOB_UID },
      }),
    );
  });

  it("DENIED: private profile carries a forbidden key (role: 'admin')", async () => {
    // firestore.rules lines 527-537: `keys().hasOnly([...])` — any unknown
    // key fails the create. `role` is a classic privilege-escalation
    // attempt; the allowlist is the only thing standing between a hostile
    // client and a server-side admin flag.
    await assertFails(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
        privateDocOverride: { role: "admin" },
      }),
    );
  });

  it("DENIED: second user tries to claim the same username (collision)", async () => {
    // firestore.rules: usernames/{username} has no `update` rule so a second
    // create against the same doc id is rejected (resource exists). This is
    // the uniqueness invariant; the in-transaction `tx.get(usernameRef)`
    // existence check is defense-in-depth — even if the client skipped it,
    // the rule still blocks the collision.
    await assertSucceeds(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
      }),
    );
    await assertFails(
      runCreateProfileTx({
        ctx: asBob(),
        pathUid: BOB_UID,
        username: ALICE_USERNAME, // collision: Bob claims Alice's handle
        // Skip the in-transaction existence check so the assertion proves
        // the RULE rejects the collision (defense in depth) — without this
        // the helper throws "Username is already taken" client-side and we
        // never get to see the permission denied.
        readUsernameFirst: false,
      }),
    );
  });

  it("DENIED: unauthenticated caller cannot run the transaction", async () => {
    // firestore.rules lines 202 + 539 + 575 all require isSignedIn() /
    // isOwner(uid). With no auth.uid, every branch of every write fails.
    await assertFails(
      runCreateProfileTx({
        ctx: testEnv.unauthenticatedContext(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
        // Skip the read — unauthenticated reads against the rule are
        // themselves denied, and we want to prove the WRITE path is gated.
        readUsernameFirst: false,
      }),
    );
  });

  it("DENIED: returning user with an existing users/{uid} doc cannot re-create", async () => {
    // firestore.rules line 204: `!exists(/databases/$(database)/documents/users/$(uid))`.
    // Seed a pre-existing public doc, then attempt the canonical
    // createProfile flow — must fail. Without this, a logged-in user could
    // wipe their own wins/losses by re-running createProfile.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", ALICE_UID), {
        uid: ALICE_UID,
        username: "alice_old",
        stance: "Regular",
        wins: 5,
        losses: 2,
      });
    });
    await assertFails(
      runCreateProfileTx({
        ctx: asAlice(),
        pathUid: ALICE_UID,
        username: ALICE_USERNAME,
        readUsernameFirst: false, // skip read so we isolate the write-side denial
      }),
    );
  });
});
