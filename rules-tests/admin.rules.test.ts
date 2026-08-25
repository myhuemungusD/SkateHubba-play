/**
 * Admin custom-claim write paths.
 *
 * `admin: true` is minted on the ID token by the Admin SDK (out-of-band
 * console tooling) and can never be self-assigned by a client, so it is the
 * authorization signal for the four privileged surfaces the admin console
 * touches:
 *
 *   1. users/{uid}                              — Verified-Pro grant / revoke
 *   2. users/{uid}/achievements/{achievementId} — badge award / revoke
 *   3. users/{uid}/locker/{itemId}              — gear award / revoke
 *   4. reports/{reportId}                       — moderation queue read + close
 *
 * The claim widens WHO may write, never WHAT may be written: every path stays
 * field-scoped, so this suite spends most of its assertions on the negative
 * cases — a non-admin doing the same write, an `admin: false` token, and an
 * admin trying to exceed the field guard (riding a `wins` edit along with a
 * pro grant, stuffing an extra key into a badge, reopening a report, …).
 *
 * Regression coverage: the pre-existing owner-update path on users/{uid} must
 * behave EXACTLY as before — the admin clause is an additional `allow update`,
 * not a relaxation of the owner one.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertSucceeds, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-admin";

const ADMIN_UID = "admin-uid";
const OTHER_ADMIN_UID = "other-admin-uid";
/** Owner of the profile / subcollection docs under test. */
const TARGET_UID = "target-uid";
/** Signed-in user with no elevated claim at all. */
const PLAIN_UID = "plain-uid";
/** Signed-in user whose token carries `admin: false`. */
const FALSE_CLAIM_UID = "false-claim-uid";
const REPORTER_UID = "reporter-uid";

const BADGE_ID = "hundred-clips";
const ITEM_ID = "og-deck";
const SEEDED_BADGE_ID = "seeded-badge";
const SEEDED_ITEM_ID = "seeded-item";
const REPORT_ID = "report-1";
/** A report another admin already adjudicated — its verdict is final. */
const CLOSED_REPORT_ID = "report-closed";

/** Every caller shape this suite exercises, keyed by name for readability. */
const CALLERS = {
  admin: { uid: ADMIN_UID, claims: { email_verified: true, admin: true } },
  otherAdmin: { uid: OTHER_ADMIN_UID, claims: { email_verified: true, admin: true } },
  target: { uid: TARGET_UID, claims: { email_verified: true } },
  plain: { uid: PLAIN_UID, claims: { email_verified: true } },
  adminFalse: { uid: FALSE_CLAIM_UID, claims: { email_verified: true, admin: false } },
  reporter: { uid: REPORTER_UID, claims: { email_verified: true } },
} as const;

type CallerName = keyof typeof CALLERS;

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env: RulesTestEnvironment) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", TARGET_UID), {
      uid: TARGET_UID,
      username: "targetskater",
      stance: "regular",
      wins: 3,
      losses: 1,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "users", TARGET_UID, "achievements", SEEDED_BADGE_ID), {
      earnedAt: new Date(),
      reason: "seeded by the award pipeline",
    });
    await setDoc(doc(db, "users", TARGET_UID, "locker", SEEDED_ITEM_ID), {
      type: "deck",
      brand: "Hubba",
      name: "Seeded Deck",
      imageUrl: null,
      rarity: "rare",
      acquiredAt: new Date(),
      provenance: { reason: "seeded by the award pipeline" },
    });
    await setDoc(doc(db, "reports", REPORT_ID), makeReport());
    await setDoc(
      doc(db, "reports", CLOSED_REPORT_ID),
      makeReport({ status: "resolved", resolvedBy: OTHER_ADMIN_UID, resolvedAt: new Date() }),
    );
    // The acting admin's own profile — the self-grant prohibition needs a real
    // doc at users/{adminUid} to attempt the update against.
    await setDoc(doc(db, "users", ADMIN_UID), {
      uid: ADMIN_UID,
      username: "modsquad",
      stance: "regular",
      createdAt: new Date(),
    });
  });
});

/** A filed report; overrides carry it into its post-moderation state. */
function makeReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporterUid: REPORTER_UID,
    reportedUid: TARGET_UID,
    reportedUsername: "targetskater",
    gameId: "game-1",
    reason: "cheating",
    description: "clip is not their own footage",
    status: "pending",
    ...overrides,
  };
}

/** A doc reference at `path`, resolved through the named caller's context. */
function as(caller: CallerName, ...path: string[]): DocumentReference<DocumentData> {
  const { uid, claims } = CALLERS[caller];
  const db = getEnv()
    .authenticatedContext(uid, { ...claims })
    .firestore();
  return doc(db, path[0], ...path.slice(1));
}

/** The signed-out caller — used to prove the claim, not just sign-in, is required. */
function asAnon(...path: string[]): DocumentReference<DocumentData> {
  const db = getEnv().unauthenticatedContext().firestore();
  return doc(db, path[0], ...path.slice(1));
}

const userDoc = (caller: CallerName) => as(caller, "users", TARGET_UID);
const badgeDoc = (caller: CallerName, id: string = BADGE_ID) => as(caller, "users", TARGET_UID, "achievements", id);
const lockerDoc = (caller: CallerName, id: string = ITEM_ID) => as(caller, "users", TARGET_UID, "locker", id);
const reportDoc = (caller: CallerName) => as(caller, "reports", REPORT_ID);
/** The acting admin's OWN profile — target of the self-grant prohibition. */
const ownUserDoc = () => as("admin", "users", ADMIN_UID);
/** A report another admin already closed out. */
const closedReportDoc = (caller: CallerName) => as(caller, "reports", CLOSED_REPORT_ID);

/** Verified-Pro grant payload: the exact three fields the admin clause allows. */
function proGrant(by: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { isVerifiedPro: true, verifiedBy: by, verifiedAt: serverTimestamp(), ...overrides };
}

/** Badge award payload — exactly ['earnedAt', 'reason']. */
function badgeAward(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { earnedAt: serverTimestamp(), reason: "100 clips posted", ...overrides };
}

/** Locker award payload — exactly the seven allowed keys. */
function lockerAward(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "deck",
    brand: "Hubba",
    name: "OG Deck",
    imageUrl: null,
    rarity: "legendary",
    acquiredAt: serverTimestamp(),
    provenance: { reason: "season 1 top 10" },
    ...overrides,
  };
}

/** Moderation close-out payload — exactly ['status', 'resolvedBy', 'resolvedAt']. */
function resolution(by: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "resolved", resolvedBy: by, resolvedAt: serverTimestamp(), ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. users/{uid} — Verified-Pro granting
// ─────────────────────────────────────────────────────────────────────────────

describe("users/{uid} — admin Verified-Pro grant", () => {
  it("admin CAN grant verified pro (isVerifiedPro + verifiedBy + verifiedAt)", async () => {
    await assertSucceeds(updateDoc(userDoc("admin"), proGrant(ADMIN_UID)));
  });

  it("admin CAN revoke verified pro (isVerifiedPro is bool, not just true)", async () => {
    await assertSucceeds(updateDoc(userDoc("admin"), proGrant(ADMIN_UID, { isVerifiedPro: false })));
  });

  it("plain signed-in user CANNOT grant verified pro to another user", async () => {
    await assertFails(updateDoc(userDoc("plain"), proGrant(PLAIN_UID)));
  });

  it("the target CANNOT self-grant verified pro", async () => {
    await assertFails(updateDoc(userDoc("target"), proGrant(TARGET_UID)));
  });

  it("a token with admin:false is treated as a NON-admin", async () => {
    await assertFails(updateDoc(userDoc("adminFalse"), proGrant(FALSE_CLAIM_UID)));
  });

  it("anonymous CANNOT grant verified pro", async () => {
    await assertFails(updateDoc(asAnon("users", TARGET_UID), proGrant(ADMIN_UID)));
  });
});

describe("users/{uid} — admin cannot exceed the pro-grant field guard", () => {
  it("CANNOT ride a wins edit along with the grant", async () => {
    await assertFails(updateDoc(userDoc("admin"), proGrant(ADMIN_UID, { wins: 99 })));
  });

  it("CANNOT rewrite the username along with the grant", async () => {
    await assertFails(updateDoc(userDoc("admin"), proGrant(ADMIN_UID, { username: "stolenhandle" })));
  });

  it("CANNOT attribute the grant to a different admin", async () => {
    await assertFails(updateDoc(userDoc("admin"), proGrant(OTHER_ADMIN_UID)));
  });

  it("CANNOT back-date verifiedAt with a client clock value", async () => {
    await assertFails(updateDoc(userDoc("admin"), proGrant(ADMIN_UID, { verifiedAt: new Date(0) })));
  });

  it("CANNOT set a non-bool isVerifiedPro", async () => {
    await assertFails(updateDoc(userDoc("admin"), proGrant(ADMIN_UID, { isVerifiedPro: "yes" })));
  });

  it("CANNOT delete the user doc via the claim", async () => {
    await assertFails(deleteDoc(userDoc("admin")));
  });
});

describe("users/{uid} — admin CANNOT self-grant verified pro", () => {
  // A compromised admin token must not be able to mint its own Verified-Pro
  // badge; every client-reachable grant is attributable to a DIFFERENT
  // operator than its subject. Founder self-verification stays possible via
  // scripts/grant-pro.ts (Admin SDK, bypasses rules).
  it("admin CANNOT grant verified pro to their own uid", async () => {
    await assertFails(updateDoc(ownUserDoc(), proGrant(ADMIN_UID)));
  });

  it("admin CANNOT revoke verified pro on their own uid either", async () => {
    await assertFails(updateDoc(ownUserDoc(), proGrant(ADMIN_UID, { isVerifiedPro: false })));
  });

  it("admin CANNOT self-grant by attributing it to another admin", async () => {
    await assertFails(updateDoc(ownUserDoc(), proGrant(OTHER_ADMIN_UID)));
  });
});

describe("users/{uid} — owner update path unchanged (regression)", () => {
  it("owner CAN still make a benign profile edit", async () => {
    await assertSucceeds(updateDoc(userDoc("target"), { stance: "goofy" }));
  });

  it("owner still CANNOT touch the pro fields", async () => {
    await assertFails(updateDoc(userDoc("target"), { isVerifiedPro: true }));
  });

  it("owner still CANNOT inflate their own wins", async () => {
    await assertFails(updateDoc(userDoc("target"), { wins: 99 }));
  });

  it("a stranger still CANNOT edit someone else's profile", async () => {
    await assertFails(updateDoc(userDoc("plain"), { stance: "goofy" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. users/{uid}/achievements/{achievementId} — badge awarding
// ─────────────────────────────────────────────────────────────────────────────

describe("users/{uid}/achievements — admin award", () => {
  it("admin CAN award a badge", async () => {
    await assertSucceeds(setDoc(badgeDoc("admin"), badgeAward()));
  });

  it("plain signed-in user CANNOT award a badge", async () => {
    await assertFails(setDoc(badgeDoc("plain"), badgeAward()));
  });

  it("the owner CANNOT self-award a badge", async () => {
    await assertFails(setDoc(badgeDoc("target"), badgeAward()));
  });

  it("a token with admin:false CANNOT award a badge", async () => {
    await assertFails(setDoc(badgeDoc("adminFalse"), badgeAward()));
  });
});

describe("users/{uid}/achievements — admin cannot exceed the award shape", () => {
  it("CANNOT include an extra key", async () => {
    await assertFails(setDoc(badgeDoc("admin"), badgeAward({ tier: "gold" })));
  });

  it("CANNOT back-date earnedAt with a client clock value", async () => {
    await assertFails(setDoc(badgeDoc("admin"), badgeAward({ earnedAt: new Date(0) })));
  });

  it("CANNOT write a reason longer than 200 chars", async () => {
    await assertFails(setDoc(badgeDoc("admin"), badgeAward({ reason: "x".repeat(201) })));
  });

  it("CANNOT write a non-string reason", async () => {
    await assertFails(setDoc(badgeDoc("admin"), badgeAward({ reason: 42 })));
  });

  it("CANNOT omit the reason", async () => {
    await assertFails(setDoc(badgeDoc("admin"), { earnedAt: serverTimestamp() }));
  });

  it("CANNOT update an existing badge (re-issue, never edit)", async () => {
    await assertFails(updateDoc(badgeDoc("admin", SEEDED_BADGE_ID), { reason: "tampered" }));
  });
});

describe("users/{uid}/achievements — delete is owner OR admin", () => {
  it("admin CAN revoke a badge", async () => {
    await assertSucceeds(deleteDoc(badgeDoc("admin", SEEDED_BADGE_ID)));
  });

  it("owner CAN still delete their own badge (account-deletion batch)", async () => {
    await assertSucceeds(deleteDoc(badgeDoc("target", SEEDED_BADGE_ID)));
  });

  it("plain signed-in user CANNOT delete someone else's badge", async () => {
    await assertFails(deleteDoc(badgeDoc("plain", SEEDED_BADGE_ID)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. users/{uid}/locker/{itemId} — gear awarding
// ─────────────────────────────────────────────────────────────────────────────

describe("users/{uid}/locker — admin award", () => {
  it("admin CAN award a locker item", async () => {
    await assertSucceeds(setDoc(lockerDoc("admin"), lockerAward()));
  });

  it("admin CAN award an item with a string imageUrl", async () => {
    await assertSucceeds(setDoc(lockerDoc("admin"), lockerAward({ imageUrl: "https://cdn.example.com/deck.webp" })));
  });

  it("plain signed-in user CANNOT award a locker item", async () => {
    await assertFails(setDoc(lockerDoc("plain"), lockerAward()));
  });

  it("the owner CANNOT self-mint gear", async () => {
    await assertFails(setDoc(lockerDoc("target"), lockerAward()));
  });

  it("a token with admin:false CANNOT award a locker item", async () => {
    await assertFails(setDoc(lockerDoc("adminFalse"), lockerAward()));
  });
});

describe("users/{uid}/locker — admin cannot exceed the award shape", () => {
  it("CANNOT include an extra key", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ equipped: true })));
  });

  it("CANNOT write an empty name", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ name: "" })));
  });

  it("CANNOT write a name longer than 100 chars", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ name: "x".repeat(101) })));
  });

  it("CANNOT write a non-string rarity", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ rarity: 3 })));
  });

  it("CANNOT back-date acquiredAt with a client clock value", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ acquiredAt: new Date(0) })));
  });

  it("CANNOT write a provenance with an extra key", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ provenance: { reason: "ok", grantedBy: "someone" } })));
  });

  it("CANNOT write a provenance reason longer than 200 chars", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ provenance: { reason: "x".repeat(201) } })));
  });

  it("CANNOT write a non-map provenance", async () => {
    await assertFails(setDoc(lockerDoc("admin"), lockerAward({ provenance: "season 1" })));
  });

  it("CANNOT update an existing locker item", async () => {
    await assertFails(updateDoc(lockerDoc("admin", SEEDED_ITEM_ID), { rarity: "legendary" }));
  });
});

describe("users/{uid}/locker — delete is owner OR admin", () => {
  it("admin CAN revoke a locker item", async () => {
    await assertSucceeds(deleteDoc(lockerDoc("admin", SEEDED_ITEM_ID)));
  });

  it("owner CAN still delete their own locker item (account-deletion batch)", async () => {
    await assertSucceeds(deleteDoc(lockerDoc("target", SEEDED_ITEM_ID)));
  });

  it("plain signed-in user CANNOT delete someone else's locker item", async () => {
    await assertFails(deleteDoc(lockerDoc("plain", SEEDED_ITEM_ID)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. reports/{reportId} — moderation queue
// ─────────────────────────────────────────────────────────────────────────────

describe("reports/{reportId} — admin read access", () => {
  it("admin CAN read a report they did not file", async () => {
    const snap = await assertSucceeds(getDoc(reportDoc("admin")));
    expect(snap.data()?.status).toBe("pending");
  });

  it("the reporter CAN still read their own report (regression)", async () => {
    await assertSucceeds(getDoc(reportDoc("reporter")));
  });

  it("an unrelated signed-in user still CANNOT read a report", async () => {
    await assertFails(getDoc(reportDoc("plain")));
  });

  it("the reported user still CANNOT read the report against them", async () => {
    await assertFails(getDoc(reportDoc("target")));
  });

  it("a token with admin:false CANNOT read someone else's report", async () => {
    await assertFails(getDoc(reportDoc("adminFalse")));
  });

  it("anonymous CANNOT read a report", async () => {
    await assertFails(getDoc(asAnon("reports", REPORT_ID)));
  });
});

describe("reports/{reportId} — admin close-out", () => {
  it("admin CAN resolve a report", async () => {
    await assertSucceeds(updateDoc(reportDoc("admin"), resolution(ADMIN_UID)));
  });

  it("admin CAN dismiss a report", async () => {
    await assertSucceeds(updateDoc(reportDoc("admin"), resolution(ADMIN_UID, { status: "dismissed" })));
  });

  it("the reporter CANNOT resolve their own report", async () => {
    await assertFails(updateDoc(reportDoc("reporter"), resolution(REPORTER_UID)));
  });

  it("a token with admin:false CANNOT resolve a report", async () => {
    await assertFails(updateDoc(reportDoc("adminFalse"), resolution(FALSE_CLAIM_UID)));
  });
});

describe("reports/{reportId} — close-out is one-way (audit-trail overwrite)", () => {
  it("a pending report CAN be closed out", async () => {
    const before = await assertSucceeds(getDoc(reportDoc("admin")));
    expect(before.data()?.status).toBe("pending");
    await assertSucceeds(updateDoc(reportDoc("admin"), resolution(ADMIN_UID)));
  });

  it("an already-resolved report CANNOT be flipped to dismissed", async () => {
    await assertFails(updateDoc(closedReportDoc("admin"), resolution(ADMIN_UID, { status: "dismissed" })));
  });

  it("an already-resolved report CANNOT be re-stamped with a new adjudicator", async () => {
    await assertFails(updateDoc(closedReportDoc("admin"), resolution(ADMIN_UID)));
  });
});

describe("reports/{reportId} — admin cannot exceed the close-out field guard", () => {
  it("CANNOT set status back to pending", async () => {
    await assertFails(updateDoc(reportDoc("admin"), resolution(ADMIN_UID, { status: "pending" })));
  });

  it("CANNOT set an unknown status", async () => {
    await assertFails(updateDoc(reportDoc("admin"), resolution(ADMIN_UID, { status: "escalated" })));
  });

  it("CANNOT rewrite the reason while resolving", async () => {
    await assertFails(updateDoc(reportDoc("admin"), resolution(ADMIN_UID, { reason: "spam" })));
  });

  it("CANNOT rewrite the description while resolving", async () => {
    await assertFails(updateDoc(reportDoc("admin"), resolution(ADMIN_UID, { description: "rewritten" })));
  });

  it("CANNOT attribute the close-out to a different admin", async () => {
    await assertFails(updateDoc(reportDoc("admin"), resolution(OTHER_ADMIN_UID)));
  });

  it("CANNOT back-date resolvedAt with a client clock value", async () => {
    await assertFails(updateDoc(reportDoc("admin"), resolution(ADMIN_UID, { resolvedAt: new Date(0) })));
  });

  it("CANNOT delete a report", async () => {
    await assertFails(deleteDoc(reportDoc("admin")));
  });
});
