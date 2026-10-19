/** trickLibrary + trickVotes: verified users submit pending tricks, admins decide, one vote per user per approved trick. */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getCountFromServer } from "firebase/firestore";
import { getDoc, getDocs, query, serverTimestamp } from "firebase/firestore";
import { setDoc, updateDoc, where } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-trick-library", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { difficulty: "beginner", submittedBy: "author", submittedAt: new Date(), name: "x" };
    await setDoc(doc(db, "trickLibrary", "approved1"), { ...base, name: "Kickflip", status: "approved" });
    await setDoc(doc(db, "trickLibrary", "pending1"), { ...base, name: "Heelflip", status: "pending" });
    await setDoc(doc(db, "bans", "banned"), { reason: "spam" });
  });
});

const as = (uid: string, claims: Record<string, unknown> = { email_verified: true }) =>
  getEnv().authenticatedContext(uid, claims).firestore();
const admin = () => as("admin", { email_verified: true, admin: true });
const pro = () => as("pro", { email_verified: true, pro: true });

const submission = (uid: string, extra: Record<string, unknown> = {}) => ({
  name: "Varial flip",
  difficulty: "intermediate",
  submittedBy: uid,
  submittedAt: serverTimestamp(),
  status: "pending",
  ...extra,
});

describe("trickLibrary", () => {
  it("a verified user can submit a pending trick", async () => {
    await assertSucceeds(addDoc(collection(as("u1"), "trickLibrary"), submission("u1", { description: "scoop" })));
  });

  it("blocks unverified, banned, spoofed, pre-approved, or padded submissions", async () => {
    await assertFails(addDoc(collection(as("u1", { email_verified: false }), "trickLibrary"), submission("u1")));
    await assertFails(addDoc(collection(as("banned"), "trickLibrary"), submission("banned")));
    await assertFails(addDoc(collection(as("u1"), "trickLibrary"), submission("someone-else")));
    await assertFails(addDoc(collection(as("u1"), "trickLibrary"), submission("u1", { status: "approved" })));
    await assertFails(addDoc(collection(as("u1"), "trickLibrary"), submission("u1", { upvotes: 999 })));
    await assertFails(addDoc(collection(as("u1"), "trickLibrary"), submission("u1", { name: "" })));
    await assertFails(addDoc(collection(as("u1"), "trickLibrary"), submission("u1", { difficulty: "god" })));
    await assertFails(addDoc(collection(as("u1"), "trickLibrary"), submission("u1", { submittedAt: new Date(0) })));
    await assertFails(
      addDoc(collection(as("u1"), "trickLibrary"), submission("u1", { videoUrl: "https://evil.example/v.mp4" })),
    );
    await assertFails(
      addDoc(collection(getEnv().unauthenticatedContext().firestore(), "trickLibrary"), submission("u1")),
    );
  });

  it("approved tricks are readable; pending ones only by the author or an admin", async () => {
    await assertSucceeds(getDoc(doc(as("u1"), "trickLibrary", "approved1")));
    await assertSucceeds(getDocs(query(collection(as("u1"), "trickLibrary"), where("status", "==", "approved"))));
    await assertFails(getDoc(doc(as("u1"), "trickLibrary", "pending1")));
    await assertSucceeds(getDoc(doc(as("author"), "trickLibrary", "pending1")));
    await assertSucceeds(
      getDocs(query(collection(as("author"), "trickLibrary"), where("submittedBy", "==", "author"))),
    );
    await assertSucceeds(getDocs(query(collection(admin(), "trickLibrary"), where("status", "==", "pending"))));
    await assertFails(getDocs(query(collection(as("u1"), "trickLibrary"), where("status", "==", "pending"))));
  });

  it("only an admin can approve or reject, once, field-scoped; pros cannot", async () => {
    const decision = { status: "approved", moderatedBy: "admin", moderatedAt: serverTimestamp() };
    await assertFails(updateDoc(doc(as("author"), "trickLibrary", "pending1"), { ...decision, moderatedBy: "author" }));
    await assertFails(updateDoc(doc(pro(), "trickLibrary", "pending1"), { ...decision, moderatedBy: "pro" }));
    await assertFails(updateDoc(doc(admin(), "trickLibrary", "pending1"), { ...decision, name: "renamed" }));
    await assertFails(updateDoc(doc(admin(), "trickLibrary", "pending1"), { ...decision, moderatedBy: "someone" }));
    await assertSucceeds(updateDoc(doc(admin(), "trickLibrary", "pending1"), decision));
    await assertFails(updateDoc(doc(admin(), "trickLibrary", "pending1"), { ...decision, status: "rejected" }));
    await assertFails(deleteDoc(doc(admin(), "trickLibrary", "approved1")));
  });
});

describe("trickVotes", () => {
  const vote = (uid: string, trickId: string, v = "up") => ({
    trickId,
    userId: uid,
    vote: v,
    createdAt: serverTimestamp(),
  });

  it("one vote per user per approved trick, changeable and removable by its owner", async () => {
    const ref = doc(as("u1"), "trickVotes", "u1_approved1");
    await assertSucceeds(setDoc(ref, vote("u1", "approved1")));
    await assertSucceeds(setDoc(ref, vote("u1", "approved1", "down")));
    await assertFails(deleteDoc(doc(as("u2"), "trickVotes", "u1_approved1")));
    await assertSucceeds(
      getCountFromServer(
        query(collection(as("u2"), "trickVotes"), where("trickId", "==", "approved1"), where("vote", "==", "down")),
      ),
    );
    await assertSucceeds(deleteDoc(ref));
  });

  it("rejects votes on pending tricks, wrong ids, spoofed users, bad values, and banned users", async () => {
    await assertFails(setDoc(doc(as("u1"), "trickVotes", "u1_pending1"), vote("u1", "pending1")));
    await assertFails(setDoc(doc(as("u1"), "trickVotes", "u1_missing"), vote("u1", "missing")));
    await assertFails(setDoc(doc(as("u1"), "trickVotes", "u2_approved1"), vote("u2", "approved1")));
    await assertFails(setDoc(doc(as("u1"), "trickVotes", "x_approved1"), vote("u1", "approved1")));
    await assertFails(setDoc(doc(as("u1"), "trickVotes", "u1_approved1"), vote("u1", "approved1", "meh")));
    await assertFails(setDoc(doc(as("u1"), "trickVotes", "u1_approved1"), { ...vote("u1", "approved1"), weight: 5 }));
    await assertFails(setDoc(doc(as("banned"), "trickVotes", "banned_approved1"), vote("banned", "approved1")));
    await assertFails(
      setDoc(doc(as("u1", { email_verified: false }), "trickVotes", "u1_approved1"), vote("u1", "approved1")),
    );
  });
});
