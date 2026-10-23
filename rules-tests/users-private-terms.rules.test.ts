/**
 * users/{uid}/private/profile.termsAcceptedAt — App Review 1.2 (G1).
 *
 * ProfileSetup now requires a "I agree to the Terms of Service and Privacy
 * Policy" checkbox and createProfile stamps `termsAcceptedAt` with server
 * time on the owner-only private doc. The rule must:
 *   - accept the stamp only as request.time (no backdating, no client clock),
 *   - keep accepting writes that never mention the field, so every account
 *     created before 1.2.0 (no termsAcceptedAt) keeps working unchanged,
 *   - keep an existing stamp stable (no removal, no rewrite to a fake time).
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Timestamp, deleteField, doc, serverTimestamp, setDoc, updateDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-private-terms";
const OWNER_UID = "owner-uid";
const STRANGER_UID = "stranger-uid";
const SEEDED_AT = Timestamp.fromMillis(Date.UTC(2026, 0, 1));

let testEnv: RulesTestEnvironment;

function privateRef(uid: string, asUid = uid) {
  return doc(
    testEnv.authenticatedContext(asUid, { email_verified: true }).firestore(),
    "users",
    uid,
    "private",
    "profile",
  );
}

async function seedPrivateDoc(data: Record<string, unknown>): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER_UID, "private", "profile"), data);
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

describe("private profile termsAcceptedAt — create", () => {
  it("legitimate: createProfile's shape (dob + server-time termsAcceptedAt) is allowed", async () => {
    await assertSucceeds(
      setDoc(privateRef(OWNER_UID), { dob: "2000-01-15", termsAcceptedAt: serverTimestamp() }, { merge: true }),
    );
  });

  it("legitimate: a create without termsAcceptedAt still works (pre-1.2.0 clients, other writers)", async () => {
    await assertSucceeds(setDoc(privateRef(OWNER_UID), { dob: "2000-01-15" }, { merge: true }));
  });

  it("attack: a backdated client timestamp is denied", async () => {
    await assertFails(setDoc(privateRef(OWNER_UID), { dob: "2000-01-15", termsAcceptedAt: SEEDED_AT }));
  });

  it("attack: a non-timestamp value is denied", async () => {
    await assertFails(setDoc(privateRef(OWNER_UID), { dob: "2000-01-15", termsAcceptedAt: true }));
  });

  it("attack: a stranger cannot stamp another user's acceptance", async () => {
    await assertFails(
      setDoc(privateRef(OWNER_UID, STRANGER_UID), { termsAcceptedAt: serverTimestamp() }, { merge: true }),
    );
  });
});

describe("private profile termsAcceptedAt — existing accounts", () => {
  it("legitimate: a pre-1.2.0 doc (no termsAcceptedAt) keeps accepting unrelated updates", async () => {
    await seedPrivateDoc({ dob: "2000-01-15", fcmTokens: ["tok-1"] });
    await assertSucceeds(updateDoc(privateRef(OWNER_UID), { fcmTokens: ["tok-1", "tok-2"] }));
  });

  it("legitimate: createProfile's merge onto a pre-existing private doc can add the stamp", async () => {
    await seedPrivateDoc({ fcmTokens: ["tok-1"] });
    await assertSucceeds(
      setDoc(privateRef(OWNER_UID), { dob: "2000-01-15", termsAcceptedAt: serverTimestamp() }, { merge: true }),
    );
  });

  it("legitimate: updates that leave an existing stamp alone are allowed", async () => {
    await seedPrivateDoc({ dob: "2000-01-15", termsAcceptedAt: SEEDED_AT });
    await assertSucceeds(updateDoc(privateRef(OWNER_UID), { fcmTokens: ["tok-1"] }));
  });

  it("legitimate: re-stamping with server time is allowed", async () => {
    await seedPrivateDoc({ dob: "2000-01-15", termsAcceptedAt: SEEDED_AT });
    await assertSucceeds(updateDoc(privateRef(OWNER_UID), { termsAcceptedAt: serverTimestamp() }));
  });

  it("attack: removing an existing stamp is denied", async () => {
    await seedPrivateDoc({ dob: "2000-01-15", termsAcceptedAt: SEEDED_AT });
    await assertFails(updateDoc(privateRef(OWNER_UID), { termsAcceptedAt: deleteField() }));
  });

  it("attack: rewriting an existing stamp to a client-chosen time is denied", async () => {
    await seedPrivateDoc({ dob: "2000-01-15", termsAcceptedAt: SEEDED_AT });
    await assertFails(
      updateDoc(privateRef(OWNER_UID), { termsAcceptedAt: Timestamp.fromMillis(Date.UTC(2020, 0, 1)) }),
    );
  });

  it("attack: adding a client-chosen stamp to a pre-1.2.0 doc is denied", async () => {
    await seedPrivateDoc({ dob: "2000-01-15" });
    await assertFails(updateDoc(privateRef(OWNER_UID), { termsAcceptedAt: SEEDED_AT }));
  });
});
