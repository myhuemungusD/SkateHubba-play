/**
 * Closet system Firestore rules tests — catalog, drops, trading, audit.
 *
 * Data model:
 *   catalog/{itemDefId}            — read: signed-in, write: false
 *   serials/{serialId}             — read: signed-in, write: false
 *   drops/{dropId}                 — read: signed-in, write: false
 *     claims/{uid}                 — read: owner, write: false
 *     entries/{uid}                — read: owner, write: false
 *   trades/{tradeId}               — read: participants, write: false
 *   closetAudit/{autoId}           — read: admin, write: false
 *
 * All writes are server-side (Cloud Functions). Client reads are scoped:
 * - Public collections (catalog, serials, drops) are signed-in-only.
 * - User-scoped subcollections (claims, entries) are owner-only.
 * - Trades are readable by both proposer and recipient.
 * - Audit logs are admin-only.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertSucceeds, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, type DocumentReference } from "firebase/firestore";
import { setupRulesTestEnv, authedContext } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-closet";

const ALICE_UID = "alice-uid";
const BOB_UID = "bob-uid";
const ADMIN_UID = "admin-uid";

const CATALOG_ITEM_ID = "limited-og-deck";
const SERIAL_ID = "serial-123";
const DROP_ID = "drop-2024-w42";
const TRADE_ID = "trade-abc123";
const AUDIT_ID = "audit-xyz789";

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env: RulesTestEnvironment) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    // Seed catalog item
    await setDoc(doc(ctx.firestore(), "catalog", CATALOG_ITEM_ID), {
      name: "OG Deck",
      rarity: "limited",
      editionKind: "limited_drop",
      slot: "deck",
      imageUrl: "https://example.com/og-deck.png",
      source: "drop",
    });

    // Seed serial
    await setDoc(doc(ctx.firestore(), "serials", SERIAL_ID), {
      itemDefId: CATALOG_ITEM_ID,
      serialNum: 37,
      editionSize: 250,
      dropId: DROP_ID,
      ownerUid: ALICE_UID,
    });

    // Seed drop with subcollections
    await setDoc(doc(ctx.firestore(), "drops", DROP_ID), {
      itemDefId: CATALOG_ITEM_ID,
      releaseTimestamp: new Date(),
      stock: 250,
      claimed: 37,
      soldOut: false,
      editionKind: "limited_drop",
    });
    await setDoc(doc(ctx.firestore(), "drops", DROP_ID, "claims", ALICE_UID), {
      serialId: SERIAL_ID,
      claimedAt: new Date(),
    });
    await setDoc(doc(ctx.firestore(), "drops", DROP_ID, "entries", BOB_UID), {
      enteredAt: new Date(),
      windowEndsAt: new Date(Date.now() + 86400 * 1000),
    });

    // Seed trade
    await setDoc(doc(ctx.firestore(), "trades", TRADE_ID), {
      proposerUid: ALICE_UID,
      recipientUid: BOB_UID,
      proposerCopyIds: ["copy1"],
      recipientCopyIds: ["copy2"],
      status: "pending",
      createdAt: new Date(),
    });

    // Seed audit log
    await setDoc(doc(ctx.firestore(), "closetAudit", AUDIT_ID), {
      action: "drop_claimed",
      uid: ALICE_UID,
      timestamp: new Date(),
      details: { dropId: DROP_ID, serialId: SERIAL_ID },
    });

    // Seed admin user with custom claim
    await env.withSecurityRulesDisabled(async () => {
      await setDoc(doc(ctx.firestore(), "users", ADMIN_UID), {
        uid: ADMIN_UID,
        username: "admin",
        isAdmin: true,
      });
    });
  });
});

function refAs(uid: string | null, path: string, docId: string): DocumentReference {
  const env = getEnv();
  const ctx = uid === null ? env.unauthenticatedContext() : authedContext(env, uid);
  return doc(ctx.firestore(), path, docId);
}

describe("catalog — public read, no writes", () => {
  it("signed-in user CAN read catalog item", async () => {
    const snap = await assertSucceeds(getDoc(refAs(ALICE_UID, "catalog", CATALOG_ITEM_ID)));
    expect(snap.exists()).toBe(true);
  });

  it("anonymous CANNOT read catalog", async () => {
    await assertFails(getDoc(refAs(null, "catalog", CATALOG_ITEM_ID)));
  });

  it("client CANNOT create catalog item", async () => {
    await assertFails(
      setDoc(refAs(ALICE_UID, "catalog", "new-item"), {
        name: "Forged Item",
        rarity: "grail",
      }),
    );
  });

  it("client CANNOT update catalog item", async () => {
    await assertFails(updateDoc(refAs(ALICE_UID, "catalog", CATALOG_ITEM_ID), { rarity: "grail" }));
  });

  it("client CANNOT delete catalog item", async () => {
    await assertFails(deleteDoc(refAs(ALICE_UID, "catalog", CATALOG_ITEM_ID)));
  });
});

describe("serials — public read, no writes", () => {
  it("signed-in user CAN read serial", async () => {
    const snap = await assertSucceeds(getDoc(refAs(BOB_UID, "serials", SERIAL_ID)));
    expect(snap.exists()).toBe(true);
  });

  it("anonymous CANNOT read serial", async () => {
    await assertFails(getDoc(refAs(null, "serials", SERIAL_ID)));
  });

  it("client CANNOT create serial", async () => {
    await assertFails(
      setDoc(refAs(ALICE_UID, "serials", "forged-serial"), {
        itemDefId: CATALOG_ITEM_ID,
        serialNum: 999,
        editionSize: 250,
      }),
    );
  });

  it("owner CANNOT update their serial", async () => {
    await assertFails(updateDoc(refAs(ALICE_UID, "serials", SERIAL_ID), { ownerUid: BOB_UID }));
  });

  it("client CANNOT delete serial", async () => {
    await assertFails(deleteDoc(refAs(ALICE_UID, "serials", SERIAL_ID)));
  });
});

describe("drops — public read, no writes", () => {
  it("signed-in user CAN read drop", async () => {
    const snap = await assertSucceeds(getDoc(refAs(BOB_UID, "drops", DROP_ID)));
    expect(snap.exists()).toBe(true);
  });

  it("anonymous CANNOT read drop", async () => {
    await assertFails(getDoc(refAs(null, "drops", DROP_ID)));
  });

  it("client CANNOT create drop", async () => {
    await assertFails(
      setDoc(refAs(ALICE_UID, "drops", "fake-drop"), {
        itemDefId: CATALOG_ITEM_ID,
        releaseTimestamp: new Date(),
        stock: 100,
      }),
    );
  });

  it("client CANNOT update drop", async () => {
    await assertFails(updateDoc(refAs(ALICE_UID, "drops", DROP_ID), { stock: 0 }));
  });

  it("client CANNOT delete drop", async () => {
    await assertFails(deleteDoc(refAs(ALICE_UID, "drops", DROP_ID)));
  });
});

describe("drops/{id}/claims — owner read, no writes", () => {
  const claimRef = (uid: string | null) => {
    const env = getEnv();
    const ctx = uid === null ? env.unauthenticatedContext() : authedContext(env, uid);
    return doc(ctx.firestore(), "drops", DROP_ID, "claims", ALICE_UID);
  };

  it("owner CAN read their own claim", async () => {
    const snap = await assertSucceeds(getDoc(claimRef(ALICE_UID)));
    expect(snap.exists()).toBe(true);
  });

  it("stranger CANNOT read someone else's claim", async () => {
    await assertFails(getDoc(claimRef(BOB_UID)));
  });

  it("anonymous CANNOT read claim", async () => {
    await assertFails(getDoc(claimRef(null)));
  });

  it("client CANNOT create claim", async () => {
    const env = getEnv();
    const ctx = authedContext(env, ALICE_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), "drops", DROP_ID, "claims", ALICE_UID), {
        serialId: "forged-serial",
        claimedAt: new Date(),
      }),
    );
  });

  it("owner CANNOT update their claim", async () => {
    const env = getEnv();
    const ctx = authedContext(env, ALICE_UID);
    await assertFails(updateDoc(doc(ctx.firestore(), "drops", DROP_ID, "claims", ALICE_UID), { serialId: "xxx" }));
  });
});

describe("drops/{id}/entries — owner read, no writes", () => {
  const entryRef = (uid: string | null) => {
    const env = getEnv();
    const ctx = uid === null ? env.unauthenticatedContext() : authedContext(env, uid);
    return doc(ctx.firestore(), "drops", DROP_ID, "entries", BOB_UID);
  };

  it("owner CAN read their own entry", async () => {
    const snap = await assertSucceeds(getDoc(entryRef(BOB_UID)));
    expect(snap.exists()).toBe(true);
  });

  it("stranger CANNOT read someone else's entry", async () => {
    await assertFails(getDoc(entryRef(ALICE_UID)));
  });

  it("anonymous CANNOT read entry", async () => {
    await assertFails(getDoc(entryRef(null)));
  });

  it("client CANNOT create entry", async () => {
    const env = getEnv();
    const ctx = authedContext(env, BOB_UID);
    await assertFails(
      setDoc(doc(ctx.firestore(), "drops", DROP_ID, "entries", BOB_UID), {
        enteredAt: new Date(),
        windowEndsAt: new Date(Date.now() + 86400 * 1000),
      }),
    );
  });
});

describe("trades — participant read, no writes", () => {
  it("proposer CAN read trade", async () => {
    const snap = await assertSucceeds(getDoc(refAs(ALICE_UID, "trades", TRADE_ID)));
    expect(snap.exists()).toBe(true);
  });

  it("recipient CAN read trade", async () => {
    const snap = await assertSucceeds(getDoc(refAs(BOB_UID, "trades", TRADE_ID)));
    expect(snap.exists()).toBe(true);
  });

  it("stranger CANNOT read trade", async () => {
    await assertFails(getDoc(refAs("stranger-uid", "trades", TRADE_ID)));
  });

  it("anonymous CANNOT read trade", async () => {
    await assertFails(getDoc(refAs(null, "trades", TRADE_ID)));
  });

  it("participant CANNOT create trade", async () => {
    await assertFails(
      setDoc(refAs(ALICE_UID, "trades", "forged-trade"), {
        proposerUid: ALICE_UID,
        recipientUid: BOB_UID,
        status: "pending",
      }),
    );
  });

  it("participant CANNOT update trade", async () => {
    await assertFails(updateDoc(refAs(ALICE_UID, "trades", TRADE_ID), { status: "accepted" }));
  });

  it("participant CANNOT delete trade", async () => {
    await assertFails(deleteDoc(refAs(ALICE_UID, "trades", TRADE_ID)));
  });
});

describe("closetAudit — admin read, no writes", () => {
  it("admin CANNOT read audit (server-only in production)", async () => {
    // In production, audit logs are server-only. Rules deny all client access.
    await assertFails(getDoc(refAs(ADMIN_UID, "closetAudit", AUDIT_ID)));
  });

  it("non-admin CANNOT read audit", async () => {
    await assertFails(getDoc(refAs(ALICE_UID, "closetAudit", AUDIT_ID)));
  });

  it("anonymous CANNOT read audit", async () => {
    await assertFails(getDoc(refAs(null, "closetAudit", AUDIT_ID)));
  });

  it("client CANNOT create audit log", async () => {
    await assertFails(
      setDoc(refAs(ALICE_UID, "closetAudit", "fake-audit"), {
        action: "drop_claimed",
        uid: ALICE_UID,
        timestamp: new Date(),
      }),
    );
  });
});
