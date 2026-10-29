/**
 * Shared `lib/sentry` double for the native sign-in tests: the real module
 * with `captureMessage` swapped for a spy, plus the one warning shape a sheet
 * that cannot run is allowed to send.
 *
 * Usage (the factory must import lazily — vi.mock is hoisted):
 *
 *   vi.mock("../../lib/sentry", async (importOriginal) =>
 *     (await import("./nativeSignIn.test-helpers")).sentryWithCaptureMessageSpy(importOriginal),
 *   );
 *
 * Not production code; excluded from coverage by the `*test-helpers*` pattern.
 */
import { vi, type Mock } from "vitest";
import type * as SentryModule from "../../lib/sentry";

const g = globalThis as { __captureMessageSpy?: Mock };

export const captureMessageSpy: Mock = (g.__captureMessageSpy ??= vi.fn());

export async function sentryWithCaptureMessageSpy(
  importOriginal: () => Promise<typeof SentryModule>,
): Promise<typeof SentryModule> {
  return { ...(await importOriginal()), captureMessage: captureMessageSpy };
}

const UNAVAILABLE = {
  apple: { reason: "apple_authorization_unknown", nativeCode: "1000" },
  google: { reason: "google_cannot_present", nativeCode: "-1" },
} as const;

/** The exact `captureMessage` arguments for a sheet that cannot run: fixed fields only. */
export function unavailableWarning(method: keyof typeof UNAVAILABLE): [string, object] {
  const { reason, nativeCode } = UNAVAILABLE[method];
  return [
    "sign_in_unavailable",
    {
      level: "warning",
      tags: { sign_in: "unavailable", sign_in_method: method, sign_in_reason: reason },
      extra: { method, reason, nativeCode },
    },
  ];
}
