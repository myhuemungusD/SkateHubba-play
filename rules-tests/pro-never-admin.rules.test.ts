/**
 * Guard: pro status never grants admin.
 *
 * Admin is ONLY the `admin: true` custom claim, which only
 * scripts/set-admin-claim.mjs sets (Admin SDK). `isVerifiedPro` on a user doc
 * is a public profile flag. This suite proves a verified pro without the
 * claim fails every admin-claim path the console uses, while the same write
 * succeeds for a real admin (positive control, so a failure here means the
 * rule, not the fixture). Spec: /workspace/team/specs/pro-filmer-stats.md §3.6.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-pro-never-admin";
const [ADMIN, PRO, OTHER_PRO, TARGET, REPORT] = ["admin-uid", "pro-uid", "other-pro-uid", "target-uid", "report-1"];

// The pro is a real verified pro (isVerifiedPro on their user doc), signed in
// with a verified email and no admin claim.
const CLAIMS = { admin: { email_verified: true, admin: true }, pro: { email_verified: true } } as const;
const UIDS = { admin: ADMIN, pro: PRO } as const;
type Who = keyof typeof CLAIMS;

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env: RulesTestEnvironment) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const seed = (uid: string, username: string, extra: object = {}) =>
      fs.setDoc(fs.doc(db, "users", uid), { uid, username, stance: "regular", createdAt: new Date(), ...extra });
    await seed(ADMIN, "modsquad");
    await seed(PRO, "realpro", { isVerifiedPro: true, verifiedBy: "admin", verifiedAt: new Date() });
    await seed(OTHER_PRO, "otherpro", { isVerifiedPro: true, verifiedBy: PRO, verifiedAt: new Date() });
    await seed(TARGET, "targetskater");
    await fs.setDoc(fs.doc(db, "reports", REPORT), {
      reporterUid: "reporter-uid",
      reportedUid: TARGET,
      reportedUsername: "targetskater",
      gameId: "game-1",
      reason: "cheating",
      description: "not their footage",
      status: "pending",
    });
  });
});

const ref = (who: Who, path: string) =>
  fs.doc(
    getEnv()
      .authenticatedContext(UIDS[who], { ...CLAIMS[who] })
      .firestore(),
    path,
  );

const proFlag = (who: Who, on: boolean) => ({
  isVerifiedPro: on,
  verifiedBy: UIDS[who],
  verifiedAt: fs.serverTimestamp(),
});

// Each case runs the same write as the pro (must fail) and as an admin
// (must pass), so a failure points at the rule, not the fixture.
const CASES: Array<[string, (who: Who) => Promise<unknown>]> = [
  ["grant pro directly", (w) => fs.updateDoc(ref(w, `users/${TARGET}`), proFlag(w, true))],
  ["revoke another pro", (w) => fs.updateDoc(ref(w, `users/${OTHER_PRO}`), proFlag(w, false))],
  ["ban a skater", (w) => fs.updateDoc(ref(w, `users/${TARGET}`), { banned: true })],
  [
    "award a badge",
    (w) => fs.setDoc(ref(w, `users/${TARGET}/achievements/b1`), { earnedAt: fs.serverTimestamp(), reason: "guard" }),
  ],
  [
    "award a locker item",
    (w) =>
      fs.setDoc(ref(w, `users/${TARGET}/locker/i1`), {
        type: "deck",
        brand: "Hubba",
        name: "Guard Deck",
        imageUrl: null,
        rarity: "common",
        acquiredAt: fs.serverTimestamp(),
        provenance: { reason: "guard" },
      }),
  ],
  ["read the moderation queue", (w) => fs.getDoc(ref(w, `reports/${REPORT}`))],
];

describe("a verified pro without the admin claim gets no admin power", () => {
  it.each(CASES)("cannot %s", async (_name, run) => {
    await assertFails(run("pro"));
    await assertSucceeds(run("admin"));
  });
});
