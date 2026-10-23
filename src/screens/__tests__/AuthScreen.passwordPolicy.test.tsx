import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
import { AuthScreen } from "../AuthScreen";
import { NotificationProvider } from "../../context/NotificationContext";
import { MIRRORED_PASSWORD_POLICY, type SignupPasswordPolicy } from "../../utils/passwordPolicy";

/*
 * The fetched signup password policy, and the stale-result guard on it.
 * AuthScreen.test.tsx uses the real loader, which settles in a microtask, so
 * whether a load ever landed after its effect was cleaned up depended on
 * timing and the guard's "drop it" branch flipped in and out of coverage.
 * Here each load is a promise the test settles by hand.
 */

const mockLoadPolicy = vi.fn<() => Promise<SignupPasswordPolicy>>();
vi.mock("../../services/passwordPolicy", () => ({
  loadSignupPasswordPolicy: () => mockLoadPolicy(),
}));
vi.mock("../../services/auth", () => ({ signUp: vi.fn(), signIn: vi.fn(), resetPassword: vi.fn() }));
vi.mock("../../services/analytics", () => ({
  analytics: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  metrics: new Proxy({}, { get: () => vi.fn() }),
}));
vi.mock("../../lib/sentry", () => ({ captureException: vi.fn() }));
vi.mock("../../services/mfa", () => ({
  startSmsMfaSignIn: vi.fn(),
  completeSmsMfaSignIn: vi.fn(),
  completeTotpMfaSignIn: vi.fn(),
  hintPhoneNumber: () => "",
  isPhoneHint: () => false,
  isTotpHint: () => false,
}));

/** A project policy far stricter than the mirrored one: 12+ characters. */
const STRICT: SignupPasswordPolicy = { ...MIRRORED_PASSWORD_POLICY, minLength: 12 };

const props = {
  mode: "signup" as const,
  onDone: vi.fn(),
  onToggle: vi.fn(),
  onGoogle: vi.fn(),
  googleLoading: false,
  onApple: vi.fn(),
  appleLoading: false,
  googleError: "",
  onGoogleErrorDismiss: vi.fn(),
  mfaChallenge: null,
  onMfaBegin: () => false,
  onMfaCancel: vi.fn(),
};

function deferred(): { promise: Promise<SignupPasswordPolicy>; resolve: (p: SignupPasswordPolicy) => void } {
  let resolve: (p: SignupPasswordPolicy) => void = () => {};
  const promise = new Promise<SignupPasswordPolicy>((r) => (resolve = r));
  return { promise, resolve };
}

function renderSignup(wrap: (ui: ReactNode) => ReactNode = (ui) => ui) {
  return render(
    wrap(
      <NotificationProvider uid="u1">
        <AuthScreen {...props} />
      </NotificationProvider>,
    ),
  );
}

beforeEach(() => {
  mockLoadPolicy.mockReset();
  localStorage.clear();
});

describe("AuthScreen fetched password policy", () => {
  it("applies the project policy once it loads", async () => {
    const load = deferred();
    mockLoadPolicy.mockReturnValueOnce(load.promise);
    renderSignup();
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "abcde1");
    // Mirrored policy (6+ with a number) until the fetch lands.
    expect(screen.getByText("Fair")).toBeInTheDocument();

    await act(async () => load.resolve(STRICT));
    expect(screen.getByText("Too short")).toBeInTheDocument();
  });

  it("ignores a policy load whose effect was already cleaned up", async () => {
    // StrictMode mounts, cleans up and re-mounts the effect, so there are two
    // loads: the first belongs to the discarded effect.
    const stale = deferred();
    const live = deferred();
    mockLoadPolicy.mockReturnValueOnce(stale.promise).mockReturnValueOnce(live.promise);
    renderSignup((ui) => <StrictMode>{ui}</StrictMode>);
    expect(mockLoadPolicy).toHaveBeenCalledTimes(2);
    await userEvent.type(screen.getAllByPlaceholderText(/•/)[0], "abcde1");

    await act(async () => live.resolve(MIRRORED_PASSWORD_POLICY));
    await act(async () => stale.resolve(STRICT));
    // The stale strict policy must not overwrite the live one.
    expect(screen.getByText("Fair")).toBeInTheDocument();
    expect(screen.queryByText("Too short")).not.toBeInTheDocument();
  });
});
