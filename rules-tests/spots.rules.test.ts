/**
 * Firestore rules tests for the spots collection.
 *
 * Charter section 2.2 puts the entire map feature on Firestore — no custom
 * backend, no API server. The rules in firestore.rules are the only thing
 * standing between a malicious client and the data model, so they get the
 * full integration-test treatment here.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  setLogLevel,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-spots";

const OWNER_UID = "owner-uid";
const OTHER_UID = "stranger-uid";
const SPOT_ID = "11111111-2222-3333-4444-555555555555";

let testEnv: RulesTestEnvironment;

function makeValidSpot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    createdBy: OWNER_UID,
    name: "Hollenbeck Hubba",
    description: null,
    latitude: 34.0522,
    longitude: -118.2437,
    gnarRating: 3,
    bustRisk: 2,
    obstacles: ["ledge", "hubba"],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeValidComment(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: uid,
    content: "good spot",
    createdAt: new Date(),
    ...overrides,
  };
}

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

function asOtherVerified(): RulesTestContext {
  return testEnv.authenticatedContext(OTHER_UID, { email_verified: true });
}

function asUnverified(): RulesTestContext {
  return testEnv.authenticatedContext("unverified-uid", { email_verified: false });
}

function asAnonymous(): RulesTestContext {
  return testEnv.unauthenticatedContext();
}

/** Seed a minimal users/{uid} profile, optionally carrying a cooldown anchor. */
async function seedUser(uid: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", uid), {
      uid,
      username: uid.replace(/-/g, ""),
      wins: 0,
      losses: 0,
      ...overrides,
    });
  });
}

/**
 * Mirrors createSpot in src/services/spots.ts: the spot and the
 * users/{uid}.lastSpotCreatedAt cooldown anchor commit in ONE batch.
 */
function createSpot(ctx: RulesTestContext, spot: Record<string, unknown>, uid = OWNER_UID): Promise<void> {
  const db = ctx.firestore();
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "spots")), spot);
  batch.set(doc(db, "users", uid), { lastSpotCreatedAt: serverTimestamp() }, { merge: true });
  return batch.commit();
}

/** Ban `uid` by seeding the authoritative `bans/{uid}` tombstone (notBanned()). */
async function ban(uid: string): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "bans", uid), { bannedBy: "u-admin", bannedAt: new Date() });
  });
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/* ────────────────────────────────────────────
 * READ
 * ──────────────────────────────────────────── */

describe("spots — read", () => {
  it("an anonymous user CANNOT read a spot (auth now required)", async () => {
    // H-R4 hardening (April 2026): `isSignedIn()` is now required to close
    // the anonymous-scraping attack against user-location data. Previously
    // active spots were publicly readable.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot());
    });
    await assertFails(getDoc(doc(asAnonymous().firestore(), "spots", SPOT_ID)));
  });

  it("a signed-in user can read an active spot", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot());
    });
    await assertSucceeds(getDoc(doc(asOtherVerified().firestore(), "spots", SPOT_ID)));
  });

  it("a signed-in user can list active spots by createdBy", async () => {
    // Profile "spots you've added" query. The read rule requires isActive,
    // so the query has to constrain it or Firestore rejects the whole list.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot({ createdAt: new Date("2026-04-02") }));
      await setDoc(
        doc(ctx.firestore(), "spots", "older-spot"),
        makeValidSpot({ name: "Older", createdAt: new Date("2026-04-01") }),
      );
      await setDoc(doc(ctx.firestore(), "spots", "inactive-spot"), makeValidSpot({ isActive: false, name: "Gone" }));
      await setDoc(
        doc(ctx.firestore(), "spots", "other-spot"),
        makeValidSpot({ createdBy: OTHER_UID, name: "Theirs" }),
      );
    });
    const listed = query(
      collection(asOwner().firestore(), "spots"),
      where("createdBy", "==", OWNER_UID),
      where("isActive", "==", true),
      orderBy("createdAt", "desc"),
    );
    const snap = await assertSucceeds(getDocs(listed));
    expect(snap.docs.map((d) => d.id)).toEqual([SPOT_ID, "older-spot"]);
  });

  it("rejects a createdBy list that does not constrain isActive", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot());
    });
    const listed = query(collection(asOwner().firestore(), "spots"), where("createdBy", "==", OWNER_UID));
    await assertFails(getDocs(listed));
  });

  it("nobody can read an inactive (soft-deleted) spot", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot({ isActive: false }));
    });
    await assertFails(getDoc(doc(asAnonymous().firestore(), "spots", SPOT_ID)));
    await assertFails(getDoc(doc(asOtherVerified().firestore(), "spots", SPOT_ID)));
  });
});

/* ────────────────────────────────────────────
 * CREATE
 * ──────────────────────────────────────────── */

describe("spots — create", () => {
  beforeEach(async () => {
    await seedUser(OWNER_UID);
    await seedUser("unverified-uid");
  });

  it("rejects an anonymous create", async () => {
    await assertFails(createSpot(asAnonymous(), makeValidSpot()));
  });

  it("rejects a signed-in but unverified-email create", async () => {
    await assertFails(createSpot(asUnverified(), makeValidSpot({ createdBy: "unverified-uid" }), "unverified-uid"));
  });

  it("accepts an email-verified create when createdBy matches the auth uid", async () => {
    await assertSucceeds(createSpot(asOwner(), makeValidSpot()));
  });

  it("rejects a create where createdBy doesn't match the caller", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ createdBy: OTHER_UID })));
  });

  it("rejects a create from a banned account (notBanned() guard)", async () => {
    await ban(OWNER_UID);
    await assertFails(createSpot(asOwner(), makeValidSpot()));
  });

  it("rejects an empty name", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ name: "" })));
  });

  it("rejects a name longer than 80 characters", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ name: "x".repeat(81) })));
  });

  it("accepts a description that is null", async () => {
    await assertSucceeds(createSpot(asOwner(), makeValidSpot({ description: null })));
  });

  it("rejects a non-string non-null description", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ description: 42 })));
  });

  it("rejects a description longer than 500 characters", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ description: "x".repeat(501) })));
  });

  it("rejects out-of-range latitude", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ latitude: 91 })));
    await assertFails(createSpot(asOwner(), makeValidSpot({ latitude: -91 })));
  });

  it("rejects out-of-range longitude", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ longitude: 181 })));
    await assertFails(createSpot(asOwner(), makeValidSpot({ longitude: -181 })));
  });

  it("rejects ratings outside 1-5", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ gnarRating: 0 })));
    await assertFails(createSpot(asOwner(), makeValidSpot({ bustRisk: 6 })));
  });

  it("rejects more than 5 photoUrls", async () => {
    const photoUrls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.jpg`);
    await assertFails(createSpot(asOwner(), makeValidSpot({ photoUrls })));
  });

  it("rejects a client that tries to self-verify", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ isVerified: true })));
  });

  it("rejects a client that creates with isActive=false", async () => {
    await assertFails(createSpot(asOwner(), makeValidSpot({ isActive: false })));
  });

  it("rejects a create that omits the cooldown anchor write (bare addDoc)", async () => {
    // P1-4: before the getAfter() binding, skipping the anchor skipped the cooldown.
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot()));
  });

  it("rejects a create inside the 30s cooldown", async () => {
    await seedUser(OWNER_UID, { lastSpotCreatedAt: new Date(Date.now() - 5_000) });
    await assertFails(createSpot(asOwner(), makeValidSpot()));
  });

  it("accepts a create once the 30s cooldown has elapsed", async () => {
    await seedUser(OWNER_UID, { lastSpotCreatedAt: new Date(Date.now() - 60_000) });
    await assertSucceeds(createSpot(asOwner(), makeValidSpot()));
  });

  it("rejects a create from a caller with no users/{uid} profile", async () => {
    await assertFails(createSpot(asOtherVerified(), makeValidSpot({ createdBy: OTHER_UID }), OTHER_UID));
  });
});

/* ────────────────────────────────────────────
 * UPDATE
 * ──────────────────────────────────────────── */

describe("spots — update", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot());
    });
  });

  it("the owner can update the name", async () => {
    await assertSucceeds(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ name: "Renamed" })));
  });

  it("a stranger cannot update", async () => {
    await assertFails(
      setDoc(doc(asOtherVerified().firestore(), "spots", SPOT_ID), makeValidSpot({ name: "Hijacked" })),
    );
  });

  it("rejects a coordinate change even by the owner", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ latitude: 0 })));
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ longitude: 0 })));
  });

  it("rejects an owner trying to self-verify via update", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ isVerified: true })));
  });

  it("rejects an owner trying to soft-delete via isActive=false", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ isActive: false })));
  });

  it("rejects a name longer than 80 chars on update", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ name: "x".repeat(81) })));
  });
});

/* ────────────────────────────────────────────
 * DELETE
 * ──────────────────────────────────────────── */

describe("spots — delete", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot());
    });
  });

  it("the owner can delete their own spot", async () => {
    await assertSucceeds(deleteDoc(doc(asOwner().firestore(), "spots", SPOT_ID)));
  });

  it("a stranger cannot delete someone else's spot", async () => {
    await assertFails(deleteDoc(doc(asOtherVerified().firestore(), "spots", SPOT_ID)));
  });
});

/* ────────────────────────────────────────────
 * COMMENTS subcollection
 * ──────────────────────────────────────────── */

describe("spots/{id}/comments", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot());
    });
  });

  it("any signed-in user can read the comment thread", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID, "comments", "c1"), makeValidComment(OWNER_UID));
    });
    await assertSucceeds(getDocs(collection(asOtherVerified().firestore(), "spots", SPOT_ID, "comments")));
  });

  it("an unverified user cannot post a comment", async () => {
    await assertFails(
      addDoc(collection(asUnverified().firestore(), "spots", SPOT_ID, "comments"), makeValidComment("unverified-uid")),
    );
  });

  it("a verified user can post their own comment", async () => {
    await assertSucceeds(
      addDoc(collection(asOtherVerified().firestore(), "spots", SPOT_ID, "comments"), makeValidComment(OTHER_UID)),
    );
  });

  it("rejects a comment from a banned account (notBanned() guard)", async () => {
    await ban(OTHER_UID);
    await assertFails(
      addDoc(collection(asOtherVerified().firestore(), "spots", SPOT_ID, "comments"), makeValidComment(OTHER_UID)),
    );
  });

  it("rejects a comment whose userId doesn't match the caller", async () => {
    await assertFails(
      addDoc(collection(asOtherVerified().firestore(), "spots", SPOT_ID, "comments"), makeValidComment(OWNER_UID)),
    );
  });

  it("rejects an empty comment", async () => {
    await assertFails(
      addDoc(
        collection(asOtherVerified().firestore(), "spots", SPOT_ID, "comments"),
        makeValidComment(OTHER_UID, { content: "" }),
      ),
    );
  });

  it("rejects a comment longer than 300 chars", async () => {
    await assertFails(
      addDoc(
        collection(asOtherVerified().firestore(), "spots", SPOT_ID, "comments"),
        makeValidComment(OTHER_UID, { content: "x".repeat(301) }),
      ),
    );
  });

  it("comments are immutable — owner cannot edit", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID, "comments", "c1"), makeValidComment(OWNER_UID));
    });
    await assertFails(
      setDoc(
        doc(asOwner().firestore(), "spots", SPOT_ID, "comments", "c1"),
        makeValidComment(OWNER_UID, { content: "edited" }),
      ),
    );
  });

  it("the comment author can delete their own comment", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID, "comments", "c1"), makeValidComment(OWNER_UID));
    });
    await assertSucceeds(deleteDoc(doc(asOwner().firestore(), "spots", SPOT_ID, "comments", "c1")));
  });

  it("a stranger cannot delete someone else's comment", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "spots", SPOT_ID, "comments", "c1"), makeValidComment(OWNER_UID));
    });
    await assertFails(deleteDoc(doc(asOtherVerified().firestore(), "spots", SPOT_ID, "comments", "c1")));
  });
});
