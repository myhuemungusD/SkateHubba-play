/**
 * Shared firestore mock surface for FCM + push-notification service tests.
 *
 * Both services exercise the same minimal slice of `firebase/firestore`
 * (setDoc, doc, arrayUnion, arrayRemove). Centralizing the surface keeps
 * the test files aligned and prevents the duplicate-block check from
 * flagging two near-identical mock declarations as a regression.
 *
 * Usage (per test file):
 *
 *   import { firestoreNotifMocks } from "../../__tests__/harness/firestoreNotifMock";
 *   vi.mock(
 *     "firebase/firestore",
 *     async () => (await import("../../__tests__/harness/firestoreNotifMock")).notifFirestoreModule,
 *   );
 *   const { setDoc: mockSetDoc } = firestoreNotifMocks;
 *
 * Destructure only the refs you assert on — the SUT pulls the rest from the
 * mocked module surface automatically. The dynamic `await import` inside the
 * `vi.mock` factory is required because `vi.mock` is hoisted above static
 * imports, so the factory cannot reference `firestoreNotifMocks` synchronously.
 * Vitest awaits the factory, making this the canonical pattern in this repo
 * (see also harness/mockServices.ts).
 */
import { vi } from "vitest";

type AnyFn = (...args: unknown[]) => unknown;

export const firestoreNotifMocks = {
  setDoc: vi.fn<AnyFn>(() => Promise.resolve(undefined)),
  doc: vi.fn<AnyFn>((...args: unknown[]) => (args.slice(1) as string[]).join("/")),
  arrayUnion: vi.fn((v: string) => ({ _op: "arrayUnion", value: v })),
  arrayRemove: vi.fn((v: string) => ({ _op: "arrayRemove", value: v })),
};

export const notifFirestoreModule = {
  setDoc: (...args: unknown[]) => firestoreNotifMocks.setDoc(...args),
  doc: (...args: unknown[]) => firestoreNotifMocks.doc(...args),
  arrayUnion: (v: string) => firestoreNotifMocks.arrayUnion(v),
  arrayRemove: (v: string) => firestoreNotifMocks.arrayRemove(v),
};
