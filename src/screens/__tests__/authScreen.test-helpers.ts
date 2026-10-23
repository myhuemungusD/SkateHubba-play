import { vi } from "vitest";

/**
 * Baseline AuthScreen props shared by the AuthScreen suites. Named
 * `*.test-helpers.ts` so it stays out of Vitest's include glob and the
 * coverage report (see vite.config.ts).
 */
export function makeAuthScreenProps() {
  return {
    mode: "signin" as "signin" | "signup",
    onDone: vi.fn(),
    onToggle: vi.fn(),
    onGoogle: vi.fn(),
    googleLoading: false,
    onApple: vi.fn(),
    appleLoading: false,
    googleError: "",
    onGoogleErrorDismiss: vi.fn(),
    // Default: no pending second factor, and every error is a normal error.
    mfaChallenge: null,
    onMfaBegin: () => false,
    onMfaCancel: vi.fn(),
  };
}
