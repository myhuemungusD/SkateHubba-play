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
import { addDoc, collection, doc, getDoc, getDocs, setDoc, deleteDoc, setLogLevel } from "firebase/firestore";

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
  it("rejects an anonymous create", async () => {
    await assertFails(addDoc(collection(asAnonymous().firestore(), "spots"), makeValidSpot()));
  });

  it("rejects a signed-in but unverified-email create", async () => {
    await assertFails(addDoc(collection(asUnverified().firestore(), "spots"), makeValidSpot()));
  });

  it("accepts an email-verified create when createdBy matches the auth uid", async () => {
    await assertSucceeds(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot()));
  });

  it("rejects a create where createdBy doesn't match the caller", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ createdBy: OTHER_UID })));
  });

  it("rejects an empty name", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ name: "" })));
  });

  it("rejects a name longer than 80 characters", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ name: "x".repeat(81) })));
  });

  it("accepts a description that is null", async () => {
    await assertSucceeds(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ description: null })));
  });

  it("rejects a non-string non-null description", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ description: 42 })));
  });

  it("rejects a description longer than 500 characters", async () => {
    await assertFails(
      addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ description: "x".repeat(501) })),
    );
  });

  it("rejects out-of-range latitude", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ latitude: 91 })));
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ latitude: -91 })));
  });

  it("rejects out-of-range longitude", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ longitude: 181 })));
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ longitude: -181 })));
  });

  it("rejects ratings outside 1-5", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ gnarRating: 0 })));
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ bustRisk: 6 })));
  });

  it("rejects more than 5 photoUrls", async () => {
    const photoUrls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.jpg`);
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ photoUrls })));
  });

  it("rejects a client that tries to self-verify", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ isVerified: true })));
  });

  it("rejects a client that creates with isActive=false", async () => {
    await assertFails(addDoc(collection(asOwner().firestore(), "spots"), makeValidSpot({ isActive: false })));
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
