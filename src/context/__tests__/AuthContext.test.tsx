import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { useAuthContext, AuthProvider } from "../AuthContext";

const { mockUseAuth, mockDeleteAccount, mockDeleteUserData, mockLoggerError, mockCaptureException } = vi.hoisted(
  () => ({
    mockUseAuth: vi.fn(() => ({ loading: false, user: null, profile: null, refreshProfile: vi.fn() })),
    mockDeleteAccount: vi.fn(),
    mockDeleteUserData: vi.fn(),
    mockLoggerError: vi.fn(),
    mockCaptureException: vi.fn(),
  }),
);

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
vi.mock("../../services/userData", () => ({
  exportUserData: vi.fn(),
  serializeUserData: vi.fn(() => "{}"),
  userDataFilename: vi.fn(() => "export.json"),
}));
vi.mock("../../services/analytics", () => ({
  analytics: { signIn: vi.fn() },
}));
vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => mockLoggerError(...args) },
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
          ctx.setActiveProfile(initialProfile);
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
    mockUseAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
  });

  it("captures Sentry when deleteUserData throws and does NOT call deleteAccount", async () => {
    const firestoreErr = new Error("permission-denied");
    mockDeleteUserData.mockRejectedValueOnce(firestoreErr);

    const { triggerDelete } = renderWithTrigger(profile);
    const thrown = await triggerDelete();

    expect(thrown).toBe(firestoreErr);
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledWith(
      firestoreErr,
      expect.objectContaining({
        extra: expect.objectContaining({
          context: expect.stringContaining("deleteUserData before auth deletion"),
          uid: "u1",
          username: "sk8r",
        }),
      }),
    );
  });

  it("captures Sentry when deleteAccount fails after Firestore wipe (generic error)", async () => {
    mockDeleteUserData.mockResolvedValueOnce(undefined);
    const authErr = new Error("network");
    mockDeleteAccount.mockRejectedValueOnce(authErr);

    const { triggerDelete } = renderWithTrigger(profile);
    const thrown = await triggerDelete();

    expect(thrown).toBe(authErr);
    expect(mockCaptureException).toHaveBeenCalledWith(
      authErr,
      expect.objectContaining({
        extra: expect.objectContaining({
          context: expect.stringContaining("deleteAccount after Firestore wipe"),
          uid: "u1",
          username: "sk8r",
        }),
      }),
    );
  });

  it("captures Sentry and rethrows friendly message on auth/requires-recent-login", async () => {
    mockDeleteUserData.mockResolvedValueOnce(undefined);
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
  });

  it("does NOT capture Sentry on fully successful delete", async () => {
    mockDeleteUserData.mockResolvedValueOnce(undefined);
    mockDeleteAccount.mockResolvedValueOnce(undefined);

    const { triggerDelete } = renderWithTrigger(profile);
    const thrown = await triggerDelete();

    expect(thrown).toBeNull();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("uses snapshot of uid/username even if activeProfile mutates mid-flow", async () => {
    // Simulates mid-flight state drift: deleteUserData resolves, then
    // useAuth reports a different profile before deleteAccount runs. The
    // snapshot means deleteAccount still operates on the original identity
    // and telemetry/Sentry contexts stay coherent.
    let resolveFirestore: () => void = () => {};
    mockDeleteUserData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirestore = resolve;
        }),
    );
    const authErr = new Error("boom");
    mockDeleteAccount.mockRejectedValueOnce(authErr);

    const { triggerDelete } = renderWithTrigger(profile);
    const pending = triggerDelete();

    // While deleteUserData is in flight, simulate the AuthContext receiving
    // a different profile (e.g. from a delayed useAuth update).
    await act(async () => {
      mockUseAuth.mockReturnValue({
        loading: false,
        user: { uid: "OTHER" } as { uid: string },
        profile: { uid: "OTHER", username: "other" } as Profile,
        refreshProfile: vi.fn(),
      });
      resolveFirestore();
    });

    await pending;

    // The Firestore call used the *original* uid/username, not the mutated one.
    expect(mockDeleteUserData).toHaveBeenCalledWith("u1", "sk8r");
    // Sentry context for the failed auth delete reflects the snapshot identity.
    expect(mockCaptureException).toHaveBeenCalledWith(
      authErr,
      expect.objectContaining({
        extra: expect.objectContaining({ uid: "u1", username: "sk8r" }),
      }),
    );
  });

  it("tags Firestore-failure log with firebase error code when present", async () => {
    const firestoreErr = new Error("denied");
    (firestoreErr as unknown as { code: string }).code = "permission-denied";
    mockDeleteUserData.mockRejectedValueOnce(firestoreErr);

    const { triggerDelete } = renderWithTrigger(profile);
    await waitFor(async () => {
      await triggerDelete();
    });

    expect(mockLoggerError).toHaveBeenCalledWith(
      "delete_account_firestore_failed",
      expect.objectContaining({ code: "permission-denied", uid: "u1", username: "sk8r" }),
    );
  });
});
