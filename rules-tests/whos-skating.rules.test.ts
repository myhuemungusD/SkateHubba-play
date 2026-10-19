// Who's skating (skaterActivity/{uid}) rules. Run with `npm run test:rules`.
// Server-written, no location, and a skater who hid their online status
// can't be listed or read by others.
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import * as fx from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules";
const ME = "p1-alice";
const OTHER = "p2-bob";

const getEnv = fx.setupRulesTestEnv(PROJECT_ID, fx.seedGameProfiles);

async function seed(uid: string, visible: boolean): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await fs.setDoc(fs.doc(ctx.firestore(), "skaterActivity", uid), {
      uid,
      username: uid,
      spotId: "s1",
      spotName: "Cherry Park",
      lastAt: fs.Timestamp.now(),
      hereUntil: fs.Timestamp.fromMillis(Date.now() + 600_000),
      visible,
    });
  });
}

const db = (uid: string) => fx.authedContext(getEnv(), uid).firestore();
const feed = (uid: string, n = 30) =>
  fs.query(
    fs.collection(db(uid), "skaterActivity"),
    fs.where("visible", "==", true),
    fs.orderBy("lastAt", "desc"),
    fs.limit(n),
  );

describe("skaterActivity", () => {
  it("lists visible skaters for signed-in users only", async () => {
    await seed(OTHER, true);
    await assertSucceeds(fs.getDocs(feed(ME)));
    await assertFails(
      fs.getDocs(fs.query(fs.collection(getEnv().unauthenticatedContext().firestore(), "skaterActivity"))),
    );
  });

  it("refuses a list that could include hidden skaters or is too big", async () => {
    await seed(OTHER, false);
    await assertFails(fs.getDocs(fs.query(fs.collection(db(ME), "skaterActivity"), fs.limit(30))));
    await assertFails(fs.getDocs(feed(ME, 51)));
  });

  it("hides a hidden skater's doc from others but not from the owner", async () => {
    await seed(OTHER, false);
    await assertFails(fs.getDoc(fs.doc(db(ME), "skaterActivity", OTHER)));
    await assertSucceeds(fs.getDoc(fs.doc(db(OTHER), "skaterActivity", OTHER)));
    await seed(ME, true);
    await assertSucceeds(fs.getDoc(fs.doc(db(OTHER), "skaterActivity", ME)));
  });

  it("lets only the owner flip visible, and nothing else", async () => {
    await seed(ME, true);
    await assertSucceeds(fs.updateDoc(fs.doc(db(ME), "skaterActivity", ME), { visible: false }));
    await assertFails(fs.updateDoc(fs.doc(db(ME), "skaterActivity", ME), { visible: "no" }));
    await assertFails(fs.updateDoc(fs.doc(db(ME), "skaterActivity", ME), { spotName: "Somewhere" }));
    await assertFails(fs.updateDoc(fs.doc(db(OTHER), "skaterActivity", ME), { visible: true }));
  });

  it("never lets a client create one, and only the owner deletes", async () => {
    await assertFails(
      fs.setDoc(fs.doc(db(ME), "skaterActivity", ME), {
        uid: ME,
        spotId: "s1",
        visible: true,
        lastAt: fs.Timestamp.now(),
      }),
    );
    await seed(ME, true);
    await assertFails(fs.deleteDoc(fs.doc(db(OTHER), "skaterActivity", ME)));
    await assertSucceeds(fs.deleteDoc(fs.doc(db(ME), "skaterActivity", ME)));
  });
});
