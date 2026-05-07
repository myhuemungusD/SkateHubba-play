/**
 * Onboarding — private profile field validation red-team tests.
 *
 * The `users/{uid}/private/{docId}` block previously validated only
 * `fcmTokens`. The onboarding service (src/services/onboarding.ts) writes
 * three additional fields to `users/{uid}/private/profile`:
 *   - onboardingTutorialVersion (int >= 0)
 *   - onboardingCompletedAt     (serverTimestamp() | null | timestamp)
 *   - onboardingSkippedAt       (serverTimestamp() | null | timestamp)
 *
 * Without rule enforcement, a malicious client could stuff arbitrary
 * shapes into the doc ("attack", { nested: true }, negative ints, etc.)
 * and wedge consumers that duck-type the values. These tests verify the
 * tightened rule rejects those shapes while leaving every legitimate
 * write path untouched.
 *
 * Allowlist regression: the rule also enforces that only the documented
 * keys (emailVerified, dob, parentalConsent, fcmTokens, and the three
 * onboarding fields) may live on this doc.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { Timestamp, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const OWNER_UID = "owner-uid";
const STRANGER_UID = "stranger-uid";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-onboarding");

function asOwner(): RulesTestContext {
  return getEnv().authenticatedContext(OWNER_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return getEnv().authenticatedContext(STRANGER_UID, { email_verified: true });
}

function ownerPrivateRef() {
  return doc(asOwner().firestore(), "users", OWNER_UID, "private", "profile");
}

/**
 * Write the canonical "completed onboarding" payload (version + one timestamp
 * field + the other reset to null). Repeated across positive and co-existence
 * tests; collapsed here so the dup-check gate stays green.
 */
function writeOnboardingPayload(extra: Record<string, unknown> = {}): Promise<void> {
  return setDoc(
    ownerPrivateRef(),
    {
      onboardingTutorialVersion: 2,
      onboardingCompletedAt: serverTimestamp(),
      onboardingSkippedAt: null,
      ...extra,
    },
    { merge: true },
  );
}

describe("users/{uid}/private/profile — onboarding field shape (positive)", () => {
  it("legitimate: owner CAN write valid onboardingTutorialVersion: 1", async () => {
    await assertSucceeds(setDoc(ownerPrivateRef(), { onboardingTutorialVersion: 1 }, { merge: true }));
  });

  it("legitimate: owner CAN write onboardingCompletedAt: serverTimestamp()", async () => {
    await assertSucceeds(writeOnboardingPayload());
  });

  it("legitimate: owner CAN write onboardingSkippedAt: serverTimestamp()", async () => {
    await assertSucceeds(
      setDoc(
        ownerPrivateRef(),
        {
          onboardingTutorialVersion: 2,
          onboardingCompletedAt: null,
          onboardingSkippedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  });

  it("legitimate: owner CAN reset onboarding fields to null (replay tour flow)", async () => {
    // Seed prior completion via rules-disabled context so we can exercise the
    // reset path against the real rule.
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OWNER_UID, "private", "profile"), {
        onboardingTutorialVersion: 1,
        onboardingCompletedAt: Timestamp.now(),
      });
    });
    await assertSucceeds(
      setDoc(
        ownerPrivateRef(),
        {
          onboardingTutorialVersion: null,
          onboardingCompletedAt: null,
          onboardingSkippedAt: null,
        },
        { merge: true },
      ),
    );
  });
});

describe("users/{uid}/private/profile — onboarding field shape (attacks)", () => {
  it("attack: owner CANNOT write onboardingCompletedAt: 'attack' (string)", async () => {
    await assertFails(setDoc(ownerPrivateRef(), { onboardingCompletedAt: "attack" }, { merge: true }));
  });

  it("attack: owner CANNOT write onboardingSkippedAt: 'attack' (string)", async () => {
    await assertFails(setDoc(ownerPrivateRef(), { onboardingSkippedAt: "attack" }, { merge: true }));
  });

  it("attack: owner CANNOT write onboardingTutorialVersion: -1", async () => {
    await assertFails(setDoc(ownerPrivateRef(), { onboardingTutorialVersion: -1 }, { merge: true }));
  });

  it("attack: owner CANNOT write onboardingTutorialVersion: { nested: true }", async () => {
    await assertFails(setDoc(ownerPrivateRef(), { onboardingTutorialVersion: { nested: true } }, { merge: true }));
  });

  it("attack: owner CANNOT write onboardingTutorialVersion as a string", async () => {
    await assertFails(setDoc(ownerPrivateRef(), { onboardingTutorialVersion: "2" }, { merge: true }));
  });

  it("attack: owner CANNOT write a far-future onboardingCompletedAt timestamp", async () => {
    // 10 minutes in the future — well past the 5s skew window.
    const farFuture = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
    await assertFails(setDoc(ownerPrivateRef(), { onboardingCompletedAt: farFuture }, { merge: true }));
  });
});

describe("users/{uid}/private/profile — cross-user isolation regression guard", () => {
  it("attack: a stranger CANNOT write to another user's private profile doc", async () => {
    await assertFails(
      setDoc(
        doc(asStranger().firestore(), "users", OWNER_UID, "private", "profile"),
        { onboardingTutorialVersion: 1 },
        { merge: true },
      ),
    );
  });
});

describe("users/{uid}/private/profile — legitimate co-existence with fcmTokens", () => {
  it("legitimate: owner CAN update fcmTokens without touching onboarding fields", async () => {
    // Regression guard: the new onboarding predicates short-circuit when
    // their fields are absent, so a pure FCM write must still succeed.
    await assertSucceeds(setDoc(ownerPrivateRef(), { fcmTokens: ["device-1", "device-2"] }, { merge: true }));
  });

  it("legitimate: owner CAN update onboarding fields and fcmTokens in a single setDoc merge", async () => {
    await assertSucceeds(writeOnboardingPayload({ fcmTokens: ["device-1"] }));
  });
});

describe("users/{uid}/private/profile — allowlist of accepted keys", () => {
  it("attack: owner CANNOT inject an unknown key", async () => {
    await assertFails(setDoc(ownerPrivateRef(), { isAdmin: true }, { merge: true }));
  });

  it("attack: owner CANNOT inject an unknown key alongside legitimate ones", async () => {
    await assertFails(
      setDoc(
        ownerPrivateRef(),
        {
          onboardingTutorialVersion: 2,
          fcmTokens: ["device-1"],
          attackerControlledRole: "admin",
        },
        { merge: true },
      ),
    );
  });

  it("legitimate: every documented key together passes the allowlist", async () => {
    await assertSucceeds(
      setDoc(
        ownerPrivateRef(),
        {
          emailVerified: true,
          dob: "2000-01-15",
          parentalConsent: false,
          fcmTokens: ["device-1"],
          onboardingTutorialVersion: 2,
          onboardingCompletedAt: serverTimestamp(),
          onboardingSkippedAt: null,
        },
        { merge: true },
      ),
    );
  });
});
