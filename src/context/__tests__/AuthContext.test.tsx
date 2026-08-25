import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { useAuthContext, AuthProvider } from "../AuthContext";
import type { UserProfile } from "../../services/users";
import { hashIdentity } from "../../utils/pii";

// Widened return shape so mockReturnValue can swap user/profile to non-null
// values mid-test (the initial () => null literals would otherwise narrow the
// inferred return to { user: null; profile: null } and reject any override).
type AuthState = {
  loading: boolean;
  user: { uid: string } | null;
  profile: { uid: string; username: string } | null;
  refreshProfile: () => void;
};

const {
  mockUseAuth,
  mockDeleteAccount,
  mockDeleteUserData,
  mockLoggerError,
  mockLoggerInfo,
  mockCaptureException,
  mockPosthogIdentify,
  mockPosthogReset,
  mockSetSentryUser,
  mockConsent,
  mockSignInWithGoogle,
  mockResolveGoogleRedirect,
  mockGetMfaChallenge,
  mockAnalyticsSignIn,
  mockAnalyticsSignInFailure,
  mockMetricsSignIn,
  mockMetricsSignInFailure,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn<() => AuthState>(() => ({
    loading: false,
    user: null,
    profile: null,
    refreshProfile: vi.fn(),
  })),
  mockDeleteAccount: vi.fn(),
  mockDeleteUserData: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockCaptureException: vi.fn(),
  mockPosthogIdentify: vi.fn(),
  mockPosthogReset: vi.fn(),
  mockSetSentryUser: vi.fn(),
  // Default: no analytics consent. Individual tests flip this to true.
  mockConsent: vi.fn<() => boolean>(() => false),
  mockSignInWithGoogle: vi.fn(),
  mockResolveGoogleRedirect: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
  // Default: nothing is a second-factor challenge (matches the real total
  // function's behaviour for every non-MFA error).
  mockGetMfaChallenge: vi.fn<(err: unknown) => unknown>(() => null),
  mockAnalyticsSignIn: vi.fn(),
  mockAnalyticsSignInFailure: vi.fn(),
  mockMetricsSignIn: vi.fn(),
  mockMetricsSignInFailure: vi.fn(),
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("../../services/auth", () => ({
  signOut: vi.fn(),
  signInWithGoogle: (...args: unknown[]) => mockSignInWithGoogle(...args),
  resolveGoogleRedirect: () => mockResolveGoogleRedirect(),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));
vi.mock("../../services/mfa", () => ({
  getMfaChallenge: (err: unknown) => mockGetMfaChallenge(err),
}));
vi.mock("../../services/users", () => ({
  deleteUserData: (...args: unknown[]) => mockDeleteUserData(...args),
}));
vi.mock("../../services/fcm", () => ({
  removeCurrentFcmToken: vi.fn().mockResolvedValue(undefined),
  refreshWebPushTokenIfGranted: vi.fn().mockResolvedValue(null),
}));
// Native push service is fully gated via isPushSupported(); the AuthContext
// tests run in jsdom where Capacitor.isNativePlatform() is false, so the
// real helpers would short-circuit. Mock anyway to stay insulated from
// accidental side effects (the plugin import graph pulls @capacitor/core).
vi.mock("../../services/pushNotifications", () => ({
  isPushSupported: vi.fn().mockReturnValue(false),
  registerPushToken: vi.fn().mockResolvedValue(undefined),
  registerPushTokenIfGranted: vi.fn().mockResolvedValue(undefined),
  unregisterPushToken: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/userData", () => ({
  exportUserData: vi.fn(),
  serializeUserData: vi.fn(() => "{}"),
  userDataFilename: vi.fn(() => "export.json"),
}));
vi.mock("../../services/analytics", () => ({
  analytics: {
    signIn: (...args: unknown[]) => mockAnalyticsSignIn(...args),
    signInAttempt: vi.fn(),
    signInFailure: (...args: unknown[]) => mockAnalyticsSignInFailure(...args),
  },
}));
vi.mock("../../services/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    debug: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
  metrics: {
    signIn: (...args: unknown[]) => mockMetricsSignIn(...args),
    signInAttempt: vi.fn(),
    signInFailure: (...args: unknown[]) => mockMetricsSignInFailure(...args),
    accountDeleted: vi.fn(),
  },
}));
vi.mock("../../lib/sentry", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  setUser: (...args: unknown[]) => mockSetSentryUser(...args),
}));
vi.mock("../../lib/posthog", () => ({
  identify: (...args: unknown[]) => mockPosthogIdentify(...args),
  resetIdentity: (...args: unknown[]) => mockPosthogReset(...args),
}));
vi.mock("../../hooks/useAnalyticsConsent", () => ({
  useAnalyticsConsent: () => mockConsent(),
}));

class ErrorCatcher extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <span data-testid="error">{this.state.error.message}</span> : this.props.children;
  }
}

describe("useAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
  });

  it("throws when used outside AuthProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function TestComponent() {
      useAuthContext();
      return null;
    }

    const { getByTestId } = render(
      <ErrorCatcher>
        <TestComponent />
      </ErrorCatcher>,
    );

    expect(getByTestId("error").textContent).toBe("useAuthContext must be used within AuthProvider");
    spy.mockRestore();
  });

  it("returns context value when used inside AuthProvider", () => {
    function TestComponent() {
      const ctx = useAuthContext();
      return <span data-testid="loading">{String(ctx.loading)}</span>;
    }

    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    expect(getByTestId("loading").textContent).toBe("false");
  });
});

/**
 * Analytics + error-tracking identity sync. PostHog identify is analytics and
 * must be gated on consent (PrivacyPolicy §Usage data); Sentry setUser is
 * legitimate-interest crash reporting and fires regardless. Both use the wider
 * hashIdentity surrogate, never the raw Firebase uid.
 */
describe("identity sync", () => {
  // Renders the provider with a signed-in u1/sk8r user and the given analytics
  // consent, or a signed-out session when `user` is null.
  function renderIdentity(opts: { user: boolean; consent: boolean }): void {
    mockConsent.mockReturnValue(opts.consent);
    mockUseAuth.mockReturnValue(
      opts.user
        ? { loading: false, user: { uid: "u1" }, profile: { uid: "u1", username: "sk8r" }, refreshProfile: vi.fn() }
        : { loading: false, user: null, profile: null, refreshProfile: vi.fn() },
    );
    function Harness() {
      useAuthContext();
      return null;
    }
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockConsent.mockReturnValue(false);
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
  });

  it("sets the Sentry user with a hashed surrogate even without analytics consent", () => {
    renderIdentity({ user: true, consent: false });

    expect(mockSetSentryUser).toHaveBeenCalledWith({ id: hashIdentity("u1"), username: "sk8r" });
    // Sentry id must not be the raw uid.
    expect(mockSetSentryUser.mock.calls[0][0]).not.toMatchObject({ id: "u1" });
  });

  it("does NOT identify to PostHog until analytics consent is granted", () => {
    renderIdentity({ user: true, consent: false });

    expect(mockPosthogIdentify).not.toHaveBeenCalled();
  });

  it("identifies to PostHog with the hashed surrogate once consent is granted", () => {
    renderIdentity({ user: true, consent: true });

    expect(mockPosthogIdentify).toHaveBeenCalledWith(hashIdentity("u1"), { username: "sk8r" });
  });

  it("resets PostHog and clears the Sentry user on sign-out", () => {
    renderIdentity({ user: false, consent: true });

    expect(mockPosthogReset).toHaveBeenCalled();
    expect(mockSetSentryUser).toHaveBeenCalledWith(null);
    expect(mockPosthogIdentify).not.toHaveBeenCalled();
  });
});

/**
 * Second-factor challenge capture. Users with MFA enrolled used to be stranded:
 * the Google popup rejected with auth/multi-factor-auth-required and the raw
 * code landed in the error banner with no way to finish signing in.
 */
describe("mfa challenge", () => {
  const challenge = { resolver: {}, hints: [{ uid: "f1", factorId: "phone" }] };

  // Exposes the live context so tests can drive the Google flow and read back
  // the challenge state.
  function renderCtx(): { current: ReturnType<typeof useAuthContext> | null } {
    const ctxRef: { current: ReturnType<typeof useAuthContext> | null } = { current: null };
    function Harness() {
      const ctx = useAuthContext();
      // Mirrored in an effect (not during render) so the value published to the
      // test is always one React has committed. `value` is a fresh object each
      // render, so this re-runs whenever anything in the context changes.
      useEffect(() => {
        ctxRef.current = ctx;
      }, [ctx]);
      return null;
    }
    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );
    return ctxRef;
  }

  // Starting point for the "how does it get cleared" cases: a provider with a
  // challenge already captured.
  async function renderWithChallenge(
    method: "google" | "email" = "email",
  ): Promise<{ current: ReturnType<typeof useAuthContext> | null }> {
    mockGetMfaChallenge.mockReturnValue(challenge);
    const ctx = renderCtx();
    await act(async () => {
      ctx.current?.beginMfaChallenge({ code: "auth/multi-factor-auth-required" }, method);
    });
    expect(ctx.current?.mfaChallenge).toBe(challenge);
    return ctx;
  }

  /** Flips useAuth to a signed-in session and nudges a re-render (via a real
   *  state change) so the provider's effects observe it. */
  async function resolveSession(ctx: { current: ReturnType<typeof useAuthContext> | null }): Promise<void> {
    await act(async () => {
      mockUseAuth.mockReturnValue({
        loading: false,
        user: { uid: "u1" } as { uid: string },
        profile: null,
        refreshProfile: vi.fn(),
      });
      ctx.current?.setActiveProfile({ uid: "u1", username: "sk8r" } as UserProfile);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMfaChallenge.mockReturnValue(null);
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
  });

  it("captures the challenge from a Google rejection without surfacing an error", async () => {
    const err = { code: "auth/multi-factor-auth-required" };
    mockSignInWithGoogle.mockRejectedValueOnce(err);
    mockGetMfaChallenge.mockReturnValue(challenge);

    const ctx = renderCtx();
    await act(async () => {
      await ctx.current?.handleGoogleSignIn();
    });

    expect(mockGetMfaChallenge).toHaveBeenCalledWith(err);
    expect(ctx.current?.mfaChallenge).toBe(challenge);
    // The banner stays empty — the card is the recovery path, not an error.
    expect(ctx.current?.googleError).toBe("");
    // Expected account state, not an outage: nothing goes to Sentry.
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith("google_sign_in_mfa_required", { factorCount: 1 });
    // Nor a failure: attempt=1/failure=1/success=0 per MFA sign-in made
    // dashboards read growing MFA adoption as a rising failure rate.
    expect(mockAnalyticsSignInFailure).not.toHaveBeenCalled();
    expect(mockMetricsSignInFailure).not.toHaveBeenCalled();
  });

  it("still records a sign-in failure for non-MFA Google rejections", async () => {
    // The telemetry guard is narrow — only the challenge branch is exempt.
    mockSignInWithGoogle.mockRejectedValueOnce({ code: "auth/user-disabled" });

    const ctx = renderCtx();
    await act(async () => {
      await ctx.current?.handleGoogleSignIn();
    });

    expect(mockAnalyticsSignInFailure).toHaveBeenCalledWith("google", "auth/user-disabled");
    expect(mockMetricsSignInFailure).toHaveBeenCalledWith("google", "auth/user-disabled");
  });

  it("emits the deferred sign_in once the challenge resolves, tagged with its method", async () => {
    // The attempt that provoked the challenge recorded no outcome at all, so
    // this is the event that closes the funnel.
    const ctx = await renderWithChallenge("google");
    expect(mockAnalyticsSignIn).not.toHaveBeenCalled();

    await resolveSession(ctx);

    await waitFor(() => expect(mockAnalyticsSignIn).toHaveBeenCalledWith("google"));
    expect(mockMetricsSignIn).toHaveBeenCalledWith("google", "u1");
    expect(mockLoggerInfo).toHaveBeenCalledWith("mfa_sign_in_completed", { uid: "u1", method: "google" });
  });

  it("attributes the email path when the challenge came from the password form", async () => {
    const ctx = await renderWithChallenge("email");

    await resolveSession(ctx);

    await waitFor(() => expect(mockAnalyticsSignIn).toHaveBeenCalledWith("email"));
    expect(mockMetricsSignIn).toHaveBeenCalledWith("email", "u1");
  });

  it("does NOT emit the deferred sign_in for an ordinary sign-in", async () => {
    // No challenge was pending, so the call site already emitted its own
    // event — firing here too would double-count every normal sign-in.
    const ctx = renderCtx();

    await resolveSession(ctx);

    expect(mockAnalyticsSignIn).not.toHaveBeenCalled();
    expect(mockMetricsSignIn).not.toHaveBeenCalled();
  });

  it("captures the challenge from the mount-time redirect resolution", async () => {
    // Mobile/Safari take the redirect fallback, so the MFA rejection arrives
    // on mount rather than from the popup call.
    mockResolveGoogleRedirect.mockRejectedValueOnce({ code: "auth/multi-factor-auth-required" });
    mockGetMfaChallenge.mockReturnValue(challenge);

    const ctx = renderCtx();

    await waitFor(() => expect(ctx.current?.mfaChallenge).toBe(challenge));
    expect(ctx.current?.googleError).toBe("");
    expect(mockCaptureException).not.toHaveBeenCalled();
    // Same parity rule as the popup path: a challenge is not a failure.
    expect(mockAnalyticsSignInFailure).not.toHaveBeenCalled();
    expect(mockMetricsSignInFailure).not.toHaveBeenCalled();
  });

  it("still records a sign-in failure when the redirect fails for another reason", async () => {
    mockResolveGoogleRedirect.mockRejectedValueOnce({ code: "auth/network-request-failed" });

    const ctx = renderCtx();

    await waitFor(() =>
      expect(mockAnalyticsSignInFailure).toHaveBeenCalledWith("google", "auth/network-request-failed"),
    );
    expect(mockMetricsSignInFailure).toHaveBeenCalledWith("google", "auth/network-request-failed");
    expect(ctx.current?.mfaChallenge).toBeNull();
  });

  it("still surfaces googleError for non-MFA rejections", async () => {
    mockSignInWithGoogle.mockRejectedValueOnce({ code: "auth/user-disabled" });

    const ctx = renderCtx();
    await act(async () => {
      await ctx.current?.handleGoogleSignIn();
    });

    expect(ctx.current?.mfaChallenge).toBeNull();
    expect(ctx.current?.googleError).toMatch(/account has been disabled/);
  });

  it("beginMfaChallenge reports whether the error was a challenge", async () => {
    const ctx = renderCtx();

    let declined: boolean | undefined;
    await act(async () => {
      declined = ctx.current?.beginMfaChallenge(new Error("nope"), "email");
    });
    expect(declined).toBe(false);
    expect(ctx.current?.mfaChallenge).toBeNull();

    mockGetMfaChallenge.mockReturnValue(challenge);
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = ctx.current?.beginMfaChallenge({ code: "auth/multi-factor-auth-required" }, "email");
    });
    expect(accepted).toBe(true);
    expect(ctx.current?.mfaChallenge).toBe(challenge);
  });

  it("clearMfaChallenge drops the pending challenge", async () => {
    const ctx = await renderWithChallenge();

    await act(async () => {
      ctx.current?.clearMfaChallenge();
    });
    expect(ctx.current?.mfaChallenge).toBeNull();
  });

  it("drops the challenge on sign-out", async () => {
    const ctx = await renderWithChallenge();

    await act(async () => {
      await ctx.current?.handleSignOut();
    });
    expect(ctx.current?.mfaChallenge).toBeNull();
  });

  it("drops the challenge once a session resolves", async () => {
    // The resolver is single-use: a signed-in user must never see a stale card
    // if they navigate back to /auth in the same tab.
    const ctx = await renderWithChallenge();

    await resolveSession(ctx);

    await waitFor(() => expect(ctx.current?.mfaChallenge).toBeNull());
  });
});

/**
 * handleDeleteAccount — production-critical GDPR flow. The Sentry + logger
 * assertions here complement the UX-focused smoke tests: they exist so an
 * operator can detect users stranded mid-deletion (Firestore wiped, auth
 * alive — the "reverse orphan" state).
 */
describe("handleDeleteAccount", () => {
  type Profile = { uid: string; username: string };
  const profile: Profile = { uid: "u1", username: "sk8r" };

  function renderWithTrigger(initialProfile: Profile): {
    triggerDelete: () => Promise<Error | null>;
  } {
    const ref: { trigger: (() => Promise<Error | null>) | null } = { trigger: null };

    function Harness() {
      const ctx = useAuthContext();
      const seeded = useRef(false);
      useEffect(() => {
        if (!seeded.current) {
          seeded.current = true;
          ctx.setActiveProfile(initialProfile as unknown as UserProfile);
        }
      }, [ctx]);
      useEffect(() => {
        ref.trigger = async () => {
          try {
            await ctx.handleDeleteAccount();
            return null;
          } catch (err) {
            return err as Error;
          }
        };
      }, [ctx]);
      return null;
    }

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>,
    );

    return {
      triggerDelete: async () => {
        let result: Error | null = null;
        await act(async () => {
          result = ref.trigger ? await ref.trigger() : null;
        });
        return result;
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
  });

  it("captures Sentry when deleteAccount fails (generic auth error) and does NOT wipe Firestore", async () => {
    // With the reverse order, Auth deletion runs first. A generic failure
    // means no Firestore data was touched — the profile is still intact.
    const authErr = new Error("network");
    mockDeleteAccount.mockRejectedValueOnce(authErr);

    const { triggerDelete } = renderWithTrigger(profile);
    const thrown = await triggerDelete();

    expect(thrown).toBe(authErr);
    expect(mockDeleteUserData).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledWith(
      authErr,
      expect.objectContaining({
        extra: expect.objectContaining({
          context: expect.stringContaining("erasure did not run"),
          uid: "u1",
          username: "sk8r",
        }),
      }),
    );
  });

  it("captures Sentry and rethrows friendly message on auth/requires-recent-login", async () => {
    const authErr = new Error("auth/requires-recent-login");
    (authErr as unknown as { code: string }).code = "auth/requires-recent-login";
    mockDeleteAccount.mockRejectedValueOnce(authErr);

    const { triggerDelete } = renderWithTrigger(profile);
    const thrown = await triggerDelete();

    expect(thrown?.message).toMatch(/sign out and sign back in/);
    expect((thrown as { cause?: Error })?.cause).toBe(authErr);
    // Sentry captures the *original* error so the stack and code survive.
    expect(mockCaptureException).toHaveBeenCalledWith(
      authErr,
      expect.objectContaining({
        extra: expect.objectContaining({ code: "auth/requires-recent-login", uid: "u1" }),
      }),
    );
    // Reverse-order invariant: no Firestore wipe happened, profile preserved.
    expect(mockDeleteUserData).not.toHaveBeenCalled();
  });

  it("does NOT capture Sentry on fully successful delete", async () => {
    mockDeleteAccount.mockResolvedValueOnce({ authDeleted: true });

    const { triggerDelete } = renderWithTrigger(profile);
    const thrown = await triggerDelete();

    expect(thrown).toBeNull();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("uses snapshot of uid/username even if activeProfile mutates mid-flow", async () => {
    // Simulates mid-flight state drift: deleteAccount is in flight, then
    // useAuth reports a different profile before it resolves. The snapshot
    // means Sentry telemetry still reflects the original identity.
    let rejectAuth: (err: Error) => void = () => {};
    const authErr = new Error("boom");
    mockDeleteAccount.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAuth = reject;
        }),
    );

    const { triggerDelete } = renderWithTrigger(profile);
    const pending = triggerDelete();

    await act(async () => {
      mockUseAuth.mockReturnValue({
        loading: false,
        user: { uid: "OTHER" } as { uid: string },
        profile: { uid: "OTHER", username: "other" } as Profile,
        refreshProfile: vi.fn(),
      });
      rejectAuth(authErr);
    });

    await pending;

    // deleteAccount was called with the *original* uid, not the mutated one.
    expect(mockDeleteAccount).toHaveBeenCalledWith("u1");
    expect(mockCaptureException).toHaveBeenCalledWith(
      authErr,
      expect.objectContaining({
        extra: expect.objectContaining({ uid: "u1", username: "sk8r" }),
      }),
    );
  });

  it("tags auth-failure log with firebase error code when present", async () => {
    const authErr = new Error("denied");
    (authErr as unknown as { code: string }).code = "permission-denied";
    mockDeleteAccount.mockRejectedValueOnce(authErr);

    const { triggerDelete } = renderWithTrigger(profile);
    await waitFor(async () => {
      await triggerDelete();
    });

    expect(mockLoggerError).toHaveBeenCalledWith(
      "delete_account_auth_failed",
      expect.objectContaining({ code: "permission-denied", uid: "u1" }),
    );
  });

  /**
   * Recovery-gap tests — close the stuck state where a re-auth bounce wiped
   * Firestore but the sign-out/sign-in round-trip left activeProfile null
   * (no profile doc to re-fetch). sessionStorage["skate.pendingDeleteUid"]
   * is the bridge that lets the retry skip deleteUserData and finish the
   * auth delete.
   */
  describe("pending-delete recovery", () => {
    const STORAGE_KEY = "skate.pendingDeleteUid";

    it("captures uid to sessionStorage when deleteAccount bounces with requires-recent-login", async () => {
      const recentErr = new Error("requires-recent-login");
      (recentErr as unknown as { code: string }).code = "auth/requires-recent-login";
      mockDeleteAccount.mockRejectedValueOnce(recentErr);

      const { triggerDelete } = renderWithTrigger(profile);
      const thrown = await triggerDelete();

      expect(thrown?.message).toMatch(/Finish deletion/);
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe("u1");
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "delete_account_pending_retry_captured",
        expect.objectContaining({ uid: "u1" }),
      );
    });

    it("clears sessionStorage on fully successful first-attempt delete", async () => {
      mockDeleteAccount.mockResolvedValueOnce({ authDeleted: true });

      const { triggerDelete } = renderWithTrigger(profile);
      const thrown = await triggerDelete();

      expect(thrown).toBeNull();
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "delete_account_pending_retry_cleared",
        expect.objectContaining({ uid: "u1", reason: "first_attempt_success" }),
      );
    });

    it("resume with null activeProfile + matching pending uid completes the deletion", async () => {
      // Post-bounce / post-sign-in state: sessionStorage still holds the
      // pending uid, useAuth reports the SAME user but no profile.
      //
      // This used to bail, because the client needed the username to release
      // the reservation and there was no profile left to read it from. That
      // was a dead end: it is also the state left behind when erasure
      // succeeded but the Auth delete failed, so the orphaned Auth record
      // could never be cleaned up from the UI. The server derives the
      // username itself now, so the retry needs nothing but the uid.
      sessionStorage.setItem(STORAGE_KEY, "u1");
      mockUseAuth.mockReturnValue({
        loading: false,
        user: { uid: "u1" } as { uid: string },
        profile: null,
        refreshProfile: vi.fn(),
      });

      let trigger: (() => Promise<Error | null>) | null = null;
      function Harness() {
        const ctx = useAuthContext();
        useEffect(() => {
          trigger = async () => {
            try {
              await ctx.handleDeleteAccount();
              return null;
            } catch (err) {
              return err as Error;
            }
          };
        }, [ctx]);
        return null;
      }
      render(
        <AuthProvider>
          <Harness />
        </AuthProvider>,
      );
      let thrown: Error | null = null;
      await act(async () => {
        thrown = trigger ? await trigger() : null;
      });

      expect(thrown).toBeNull();
      // Proceeds on the uid alone — no profile required.
      expect(mockDeleteAccount).toHaveBeenCalledWith("u1");
      // Still never from the client: erasure is the server's job.
      expect(mockDeleteUserData).not.toHaveBeenCalled();
      // Completed, so the marker is retired and the banner stops offering it.
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("retry early-returns when pending uid does not match current user", async () => {
      // Defensive: pending flag belongs to a different account (stale
      // session, user signed in with different credentials). Must NOT call
      // deleteAccount on the wrong account.
      sessionStorage.setItem(STORAGE_KEY, "u1");
      mockUseAuth.mockReturnValue({
        loading: false,
        user: { uid: "DIFFERENT" } as { uid: string },
        profile: null,
        refreshProfile: vi.fn(),
      });

      let trigger: (() => Promise<Error | null>) | null = null;
      function Harness() {
        const ctx = useAuthContext();
        useEffect(() => {
          trigger = async () => {
            try {
              await ctx.handleDeleteAccount();
              return null;
            } catch (err) {
              return err as Error;
            }
          };
        }, [ctx]);
        return null;
      }
      render(
        <AuthProvider>
          <Harness />
        </AuthProvider>,
      );
      await act(async () => {
        await (trigger ? trigger() : Promise.resolve(null));
      });

      expect(mockDeleteAccount).not.toHaveBeenCalled();
      expect(mockDeleteUserData).not.toHaveBeenCalled();
    });

    it("clears sessionStorage when a different user signs in", async () => {
      sessionStorage.setItem(STORAGE_KEY, "u1");
      // Mount with user "u1" first (would keep the flag), then swap to
      // a different uid and confirm the effect clears it.
      mockUseAuth.mockReturnValue({
        loading: false,
        user: { uid: "u1" } as { uid: string },
        profile: null,
        refreshProfile: vi.fn(),
      });

      function Harness() {
        useAuthContext();
        return null;
      }
      const { rerender } = render(
        <AuthProvider>
          <Harness />
        </AuthProvider>,
      );
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe("u1");

      // Swap the mock before re-render so the effect sees the new uid.
      await act(async () => {
        mockUseAuth.mockReturnValue({
          loading: false,
          user: { uid: "OTHER" } as { uid: string },
          profile: null,
          refreshProfile: vi.fn(),
        });
        rerender(
          <AuthProvider>
            <Harness />
          </AuthProvider>,
        );
      });

      await waitFor(() => {
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      });
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "delete_account_pending_retry_cleared",
        expect.objectContaining({ uid: "u1", reason: "different_user_signed_in" }),
      );
    });

    it("preserves sessionStorage across sign-out (retry path depends on it)", async () => {
      // The entire point of sessionStorage vs React state is surviving the
      // sign-out/sign-in round-trip the re-auth flow demands. handleSignOut
      // must NOT clear the pending flag.
      sessionStorage.setItem(STORAGE_KEY, "u1");
      mockUseAuth.mockReturnValue({
        loading: false,
        user: { uid: "u1" } as { uid: string },
        profile: null,
        refreshProfile: vi.fn(),
      });

      let trigger: (() => Promise<void>) | null = null;
      function Harness() {
        const ctx = useAuthContext();
        useEffect(() => {
          trigger = async () => {
            await ctx.handleSignOut();
          };
        }, [ctx]);
        return null;
      }
      render(
        <AuthProvider>
          <Harness />
        </AuthProvider>,
      );
      await act(async () => {
        await (trigger ? trigger() : Promise.resolve());
      });

      expect(sessionStorage.getItem(STORAGE_KEY)).toBe("u1");
    });
  });
});
