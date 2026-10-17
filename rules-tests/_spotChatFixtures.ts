/**
 * Shared fixtures for the spot-chat rules suites. Writes mirror the client
 * shapes in src/services/spotChats.*.ts so a passing positive case proves
 * the production write path, and negative cases fail for the guard they
 * target.
 */
import type { RulesTestContext, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, writeBatch, type Firestore } from "firebase/firestore";

export const SPOT = "spotChatSpot1";
export const CREATOR = "creatorUid";
export const ALICE = "aliceUid";
export const BOB = "bobUid";
export const MOD = "modUid";
export const CAROL = "carolUid";

export const LONG_AGO = (): Date => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

export function asUser(env: RulesTestEnvironment, uid: string): RulesTestContext {
  return env.authenticatedContext(uid, { email_verified: true });
}

export function db(env: RulesTestEnvironment, uid: string): Firestore {
  return asUser(env, uid).firestore();
}

/** Seed writes with rules disabled. */
export async function seed(env: RulesTestEnvironment, fn: (fs: Firestore) => Promise<void>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

export function seedSpot(fs: Firestore, overrides: Record<string, unknown> = {}): Promise<void> {
  return setDoc(doc(fs, "spots", SPOT), { createdBy: CREATOR, isActive: true, name: "Hubba", ...overrides });
}

/** A member doc plus a consistent chatMemberships counter. */
export async function seedMember(
  fs: Firestore,
  uid: string,
  role: "member" | "moderator" = "member",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await setDoc(doc(fs, "spotChats", SPOT, "members", uid), {
    joinedAt: LONG_AGO(),
    lastRead: LONG_AGO(),
    role,
    ...extra,
  });
  await setDoc(doc(fs, "chatMemberships", uid), { count: 1, lastSpotId: SPOT });
}

export function seedMessage(fs: Firestore, messageId: string, userId: string, content = "hello"): Promise<void> {
  return setDoc(doc(fs, "spotChats", SPOT, "messages", messageId), {
    userId,
    content,
    createdAt: LONG_AGO(),
    isDeleted: false,
    moderatedBy: null,
    isHidden: false,
    hiddenReason: null,
  });
}

export function messageRef(fs: Firestore, messageId: string) {
  return doc(fs, "spotChats", SPOT, "messages", messageId);
}

export function memberRef(fs: Firestore, uid: string) {
  return doc(fs, "spotChats", SPOT, "members", uid);
}

export function makeMessage(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: uid,
    content: "first try kickflip",
    createdAt: serverTimestamp(),
    isDeleted: false,
    moderatedBy: null,
    isHidden: false,
    hiddenReason: null,
    ...overrides,
  };
}

/** The sendMessage batch: message + member anchor naming it. */
export function sendBatch(
  fs: Firestore,
  uid: string,
  messageId: string,
  overrides: Record<string, unknown> = {},
  anchorMessageId: string = messageId,
): Promise<void> {
  const batch = writeBatch(fs);
  batch.set(messageRef(fs, messageId), makeMessage(uid, overrides));
  batch.update(memberRef(fs, uid), {
    lastMessageAt: serverTimestamp(),
    lastMessageId: anchorMessageId,
    lastRead: serverTimestamp(),
  });
  return batch.commit();
}

/** The joinChat transaction's writes. */
export function joinBatch(
  fs: Firestore,
  uid: string,
  nextCount: number,
  role: "member" | "moderator" = "member",
): Promise<void> {
  const batch = writeBatch(fs);
  batch.set(memberRef(fs, uid), { joinedAt: serverTimestamp(), lastRead: serverTimestamp(), role });
  batch.set(doc(fs, "chatMemberships", uid), { count: nextCount, lastSpotId: SPOT });
  return batch.commit();
}
