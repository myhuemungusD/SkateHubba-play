/**
 * Users — public single-doc GET for shared `/player/{uid}` links.
 *
 * `users/{uid}` read used to be `allow read: if isSignedIn()`, which made a
 * shared profile link fail with permission-denied for a logged-out visitor.
 * The rule is now split:
 *
 *   allow get:  if true;          // one doc, uid already known (the link)
 *   allow list: if isSignedIn();  // collection queries stay signed-in only
 *
 * The split is the whole point. A blanket `allow read: if true` would also
 * grant `list`, letting an anonymous client enumerate every account in the
 * app. These tests pin both halves — the positive public GET *and* the
 * negative anonymous LIST — plus the invariants the loosened read must not
 * have widened:
 *
 *   • the owner-only subcollections (`private`, `achievements`,
 *     `blocked_users`) do NOT inherit the parent's public get, and
 *   • no write path (create / update / delete) opened up for anonymous users.
 *
 * The two signed-in list assertions mirror the exact production query shapes
 * in src/services/users.ts — getPlayerDirectory (`orderBy("createdAt","desc")`,
 * limit 100) and getLeaderboard (`orderBy("wins","desc")`, limit 200) — so a
 * future tightening of `list` breaks here rather than in the Lobby.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestContext } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-users-public-read";

const SUBJECT_UID = "subject-uid";
const OTHER_UID = "other-uid";
const VISITOR_UID = "visitor-uid";

/** Mirrors getLeaderboard's LEADERBOARD_CANDIDATE_POOL (LEADERBOARD_SIZE * 4). */
const LEADERBOARD_POOL = 200;

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Two public profiles so a collection query has something to enumerate.
    await setDoc(doc(db, "users", SUBJECT_UID), {
      uid: SUBJECT_UID,
      username: "alice",
      stance: "Regular",
      createdAt: new Date(),
      wins: 4,
      losses: 1,
    });
    await setDoc(doc(db, "users", OTHER_UID), {
      uid: OTHER_UID,
      username: "bob",
      stance: "Goofy",
      createdAt: new Date(),
      wins: 2,
      losses: 3,
    });
    // Owner-only surfaces that must NOT inherit the parent's public get.
    await setDoc(doc(db, "users", SUBJECT_UID, "private", "profile"), {
      dob: "2000-01-15",
      parentalConsent: true,
      fcmTokens: ["token-1"],
    });
    await setDoc(doc(db, "users", SUBJECT_UID, "achievements", "first-win"), {
      earnedAt: new Date(),
    });
    await setDoc(doc(db, "users", SUBJECT_UID, "blocked_users", OTHER_UID), {
      blockedUid: OTHER_UID,
    });
  });
});

function anon(): RulesTestContext {
  return getEnv().unauthenticatedContext();
}

function signedIn(): RulesTestContext {
  return getEnv().authenticatedContext(VISITOR_UID, { email_verified: true });
}

describe("users/{uid} — public GET, signed-in LIST", () => {
  it("signed-OUT visitor CAN get a single public profile doc (shared /player/{uid} link)", async () => {
    await assertSucceeds(getDoc(doc(anon().firestore(), "users", SUBJECT_UID)));
  });

  it("signed-in user CAN still get a single public profile doc", async () => {
    await assertSucceeds(getDoc(doc(signedIn().firestore(), "users", SUBJECT_UID)));
  });

  it("attack: signed-OUT enumeration of the users collection is DENIED", async () => {
    await assertFails(getDocs(collection(anon().firestore(), "users")));
  });

  it("attack: signed-OUT player-directory query (orderBy createdAt) is DENIED", async () => {
    await assertFails(
      getDocs(query(collection(anon().firestore(), "users"), orderBy("createdAt", "desc"), limit(100))),
    );
  });

  it("attack: signed-OUT leaderboard query (orderBy wins) is DENIED", async () => {
    await assertFails(
      getDocs(query(collection(anon().firestore(), "users"), orderBy("wins", "desc"), limit(LEADERBOARD_POOL))),
    );
  });

  it("signed-in player-directory query still SUCCEEDS (getPlayerDirectory shape)", async () => {
    await assertSucceeds(
      getDocs(query(collection(signedIn().firestore(), "users"), orderBy("createdAt", "desc"), limit(100))),
    );
  });

  it("signed-in leaderboard query still SUCCEEDS (getLeaderboard shape)", async () => {
    await assertSucceeds(
      getDocs(query(collection(signedIn().firestore(), "users"), orderBy("wins", "desc"), limit(LEADERBOARD_POOL))),
    );
  });
});

describe("users/{uid} subcollections do not inherit the public get", () => {
  it("attack: signed-OUT read of users/{uid}/private/profile is DENIED", async () => {
    await assertFails(getDoc(doc(anon().firestore(), "users", SUBJECT_UID, "private", "profile")));
  });

  it("attack: signed-OUT read of users/{uid}/achievements/* is DENIED", async () => {
    await assertFails(getDoc(doc(anon().firestore(), "users", SUBJECT_UID, "achievements", "first-win")));
  });

  it("attack: signed-OUT read of users/{uid}/blocked_users/* is DENIED", async () => {
    await assertFails(getDoc(doc(anon().firestore(), "users", SUBJECT_UID, "blocked_users", OTHER_UID)));
  });

  it("attack: signed-in NON-owner read of users/{uid}/private/profile is DENIED", async () => {
    await assertFails(getDoc(doc(signedIn().firestore(), "users", SUBJECT_UID, "private", "profile")));
  });
});

describe("users/{uid} — the loosened read did not widen writes", () => {
  it("attack: signed-OUT create of a new profile doc is DENIED", async () => {
    await assertFails(
      setDoc(doc(anon().firestore(), "users", "anon-minted-uid"), {
        uid: "anon-minted-uid",
        username: "intruder",
        stance: "Regular",
      }),
    );
  });

  it("attack: signed-OUT update of an existing profile doc is DENIED", async () => {
    await assertFails(updateDoc(doc(anon().firestore(), "users", SUBJECT_UID), { stance: "Goofy" }));
  });

  it("attack: signed-OUT delete of an existing profile doc is DENIED", async () => {
    await assertFails(deleteDoc(doc(anon().firestore(), "users", SUBJECT_UID)));
  });
});
