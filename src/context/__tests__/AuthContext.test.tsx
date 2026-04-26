import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { useAuthContext, AuthProvider } from "../AuthContext";
import type { UserProfile } from "../../services/users";

// Widened return shape so mockReturnValue can swap user/profile to non-null
// values mid-test (the initial () => null literals would otherwise narrow the
// inferred return to { user: null; profile: null } and reject any override).
type AuthState = {
  loading: boolean;
  user: { uid: string } | null;
  profile: { uid: string; username: string } | null;
  refreshProfile: () => void;
};

const { mockUseAuth, mockDeleteAccount, mockDeleteUserData, mockLoggerError, mockLoggerInfo, mockCaptureException } =
  vi.hoisted(() => ({
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
  }));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("../../services/auth", () => ({
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  resolveGoogleRedirect: vi.fn().mockResolvedValue(null),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));
vi.mock("../../services/users", () => ({
  deleteUserData: (...args: unknown[]) => mockDeleteUserData(...args),
}));
vi.mock("../../services/fcm", () => ({
  removeCurrentFcmToken: vi.fn().mockResolvedValue(undefined),
}));
// Native push service is fully gated via isPushSupported(); the AuthContext
// tests run in jsdom where Capacitor.isNativePlatform() is false, so the
// real helpers would short-circuit. Mock anyway to stay insulated from
// accidental side effects (the plugin import graph pulls @capacitor/core).
vi.mock("../../services/pushNotifications", () => ({
  isPushSupported: vi.fn().mockReturnValue(false),
  registerPushToken: vi.fn().mockResolvedValue(undefined),
  unregisterPushToken: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/userData", () => ({
  exportUserData: vi.fn(),
  serializeUserData: vi.fn(() => "{}"),
  userDataFilename: vi.fn(() => "export.json"),
}));
vi.mock("../../services/analytics", () => ({
  analytics: { signIn: vi.fn() },
}));
vi.mock("../../services/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    debug: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
  metrics: { signIn: vi.fn(), accountDeleted: vi.fn() },
}));
vi.mock("../../lib/sentry", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  setUser: vi.fn(),
}));
vi.mock("../../lib/posthog", () => ({
  identify: vi.fn(),
  resetIdentity: vi.fn(),
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
          context: expect.stringContaining("Auth deletion bounced"),
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
    mockDeleteAccount.mockResolvedValueOnce(undefined);

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

    // deleteAccount was called with the *original* uid/username, not the mutated one.
    expect(mockDeleteAccount).toHaveBeenCalledWith("u1", "sk8r");
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
      mockDeleteAccount.mockResolvedValueOnce(undefined);

      const { triggerDelete } = renderWithTrigger(profile);
      const thrown = await triggerDelete();

      expect(thrown).toBeNull();
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "delete_account_pending_retry_cleared",
        expect.objectContaining({ uid: "u1", reason: "first_attempt_success" }),
      );
    });

    it("resume with null activeProfile + matching pending uid bails safely (no username to wipe)", async () => {
      // Post-bounce / post-sign-in state: sessionStorage still holds the
      // pending uid, useAuth reports the SAME user but no profile. With the
      // reverse order (Auth-first), no Firestore wipe has happened so the
      // username reservation is still there. We need the username to delete
      // it — without a profile reload we can't safely proceed. Bail with a
      // warn; the user will re-trigger once their profile loads.
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
      expect(mockDeleteAccount).not.toHaveBeenCalled();
      expect(mockDeleteUserData).not.toHaveBeenCalled();
      // Flag remains until the profile reloads and a fresh attempt runs.
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe("u1");
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
