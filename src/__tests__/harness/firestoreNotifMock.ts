/**
 * Shared firestore mock surface for FCM + push-notification service tests.
 *
 * Both services exercise the same minimal slice of `firebase/firestore`
 * (setDoc, doc, arrayUnion, arrayRemove, serverTimestamp). Centralizing
 * the surface keeps the test files aligned and prevents the duplicate-block
 * check from flagging two near-identical mock declarations as a regression.
 *
 * Usage (per test file):
 *
 *   import { firestoreNotifMocks } from "../../__tests__/harness/firestoreNotifMock";
 *   vi.mock("firebase/firestore", async () =>
 *     (await import("../../__tests__/harness/firestoreNotifMock")).notifFirestoreModule,
 *   );
 *   const { setDoc: mockSetDoc, doc: mockDoc, arrayUnion: mockArrayUnion, arrayRemove: mockArrayRemove } =
 *     firestoreNotifMocks;
 *
 * The dynamic `await import` inside the `vi.mock` factory is required because
 * `vi.mock` is hoisted above static imports — the factory cannot reference
 * `firestoreNotifMocks` synchronously. Vitest awaits the factory so this is
 * the canonical pattern in this repo (see also harness/mockServices.ts).
 */
import { vi } from "vitest";

export const firestoreNotifMocks = {
  setDoc: vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(undefined)),
  doc: vi.fn<(...args: unknown[]) => unknown>((..._args: unknown[]) => (_args.slice(1) as string[]).join("/")),
  arrayUnion: vi.fn((v: string) => ({ _op: "arrayUnion", value: v })),
  arrayRemove: vi.fn((v: string) => ({ _op: "arrayRemove", value: v })),
  // serverTimestamp() — fcm.ts and pushNotifications.ts call it when writing
  // the /pushTargets mirror. A string sentinel is fine for assertions; the
  // real Firestore SDK returns a FieldValue marker that's only resolved on
  // the server, so neither value is comparable beyond identity.
  serverTimestamp: vi.fn<() => unknown>(() => "SERVER_TS"),
};

export const notifFirestoreModule = {
  setDoc: (...args: unknown[]) => firestoreNotifMocks.setDoc(...args),
  doc: (...args: unknown[]) => firestoreNotifMocks.doc(...args),
  arrayUnion: (v: string) => firestoreNotifMocks.arrayUnion(v),
  arrayRemove: (v: string) => firestoreNotifMocks.arrayRemove(v),
  serverTimestamp: () => firestoreNotifMocks.serverTimestamp(),
};
